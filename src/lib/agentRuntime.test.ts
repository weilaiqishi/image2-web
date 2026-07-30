import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, Settings } from "../types";
import { bridge } from "./bridge";
import { AgentRuntime } from "./agentRuntime";
import { appendAnnotationObject, createAnnotationDocument, updateAnnotationObject } from "./annotationModel";

let active = 0;
let maxActive = 0;
let generated = 0;
let failAt = 0;
let planOverride: unknown;
let holdAgent = false;
let releaseAgent: (() => void) | undefined;

vi.mock("./bridge", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  bridge: {
    proxyAgent: vi.fn(async () => {
      if (holdAgent) await new Promise<void>((resolve) => { releaseAgent = resolve; });
      return { output: [{ type: "function_call", name: "create_image_tasks", arguments: JSON.stringify(planOverride ?? {
        summary: "three",
        tasks: ["front", "left", "right"].map((title) => ({ title, prompt: title, operation: "generate", referenceIds: [] })),
      }) }] };
    }),
    generate: vi.fn(async (): Promise<AssetRecord> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      generated += 1;
      if (generated === failAt) throw new Error("gateway timeout");
      return { id: `asset-${generated}`, filePath: `/asset-${generated}.png`, mimeType: "image/png", prompt: "", createdAt: new Date().toISOString(), kind: "generated" };
    }),
    edit: vi.fn(async (): Promise<AssetRecord> => ({ id: "edited-1", filePath: "/edited.png", mimeType: "image/png", prompt: "", createdAt: new Date().toISOString(), kind: "edited" })),
    getSettings: vi.fn(async () => settings),
    readAnnotationOverlayDataUrl: vi.fn(async () => "data:image/png;base64,AA=="),
    readAssetDataUrl: vi.fn(),
  },
}));

const settings: Settings = { baseUrl: "https://api.openai.com/v1", agentProtocol: "responses", agentModel: "gpt-5.6", imageModel: "gpt-image-2", hasApiKey: true };

describe("SerialImageQueue", () => {
  beforeEach(() => { vi.clearAllMocks(); active = 0; maxActive = 0; generated = 0; failAt = 0; planOverride = undefined; holdAgent = false; releaseAgent = undefined; });

  it("cancels analysis before task creation and restores the unsubmitted draft", async () => {
    holdAgent = true;
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    await runtime.updateDraft(conversationId, { text: "不要创建付费任务" });
    const submission = runtime.submit(conversationId, settings);
    await vi.waitFor(() => expect(releaseAgent).toBeTypeOf("function"));
    expect(await runtime.cancelPendingSubmission(conversationId)).toBe(true);
    releaseAgent?.();
    await submission;
    expect(runtime.snapshot().drafts[conversationId].text).toBe("不要创建付费任务");
    expect(runtime.snapshot().messages.some((message) => message.content === "不要创建付费任务")).toBe(false);
    expect(runtime.snapshot().tasks).toHaveLength(0);
    expect(bridge.generate).not.toHaveBeenCalled();
  });

  it("replaces the last deleted conversation with a fresh empty conversation", async () => {
    const runtime = await AgentRuntime.create();
    while (runtime.snapshot().conversations.length > 1) {
      await runtime.deleteConversation(runtime.snapshot().conversations.at(-1)!.id);
    }
    const deletedId = runtime.snapshot().conversations[0].id;
    await runtime.updateDraft(deletedId, { text: "这段草稿必须被删除" });
    await runtime.upsertAnnotationDocument(createAnnotationDocument({ id: "deleted-document", sourceAssetId: "asset-old", conversationId: deletedId }));

    await runtime.deleteConversation(deletedId);

    const snapshot = runtime.snapshot();
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.selectedConversationId).not.toBe(deletedId);
    expect(snapshot.drafts[deletedId]).toBeUndefined();
    expect(snapshot.drafts[snapshot.selectedConversationId]).toMatchObject({ text: "", attachments: [], nextImageSequence: 1 });
    expect(snapshot.annotationDocuments["deleted-document"]).toBeUndefined();
    expect(snapshot.messages.some((message) => message.conversationId === deletedId)).toBe(false);
    expect(snapshot.batches.some((batch) => batch.conversationId === deletedId)).toBe(false);
  });

  it("blocks stale references, invalid colors and equal-priority product conflicts before submission", async () => {
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    const attachments = [
      { id: "product-1", kind: "asset" as const, assetId: "asset-1", name: "one", descriptor: { label: "Image001", roles: ["product" as const], priority: 5, preserve: [] } },
      { id: "product-2", kind: "asset" as const, assetId: "asset-2", name: "two", descriptor: { label: "Image002", roles: ["product" as const], priority: 5, preserve: [] } },
    ];
    await runtime.updateDraft(conversationId, { text: "参考 @Image003 和 @Region99，使用 #12GG00", attachments });
    expect(() => runtime.preflightDraft(conversationId, settings)).toThrow(/最高优先级产品结构参考.*@Image003.*@Region99.*#12GG00/);
    expect(bridge.proxyAgent).not.toHaveBeenCalled();
  });

  it("captures a redacted Agent response when task validation rejects an external attachment", async () => {
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    const attachment = { id: "current-attachment", kind: "reference" as const, name: "source.png", dataUrl: "data:image/png;base64,aGVsbG8=", descriptor: { label: "Image001", roles: ["other" as const], priority: 0, preserve: [] } };
    await runtime.updateDraft(conversationId, { text: "生成海报", attachments: [attachment] });
    planOverride = { summary: "poster", tasks: [{ title: "poster", prompt: "poster", operation: "generate", referenceIds: ["outside-attachment"] }] };

    await runtime.submit(conversationId, settings);

    const log = runtime.snapshot().diagnosticLogs.filter((item) => item.conversationId === conversationId).at(-1)!;
    const json = JSON.stringify(log);
    expect(log).toMatchObject({ status: "failed", allowedAttachmentIds: [attachment.id], error: "Agent 引用了当前消息之外的附件" });
    expect(json).toContain("outside-attachment");
    expect(json).not.toContain("aGVsbG8=");
  });

  it("executes planned image tasks one at a time", async () => {
    const runtime = await AgentRuntime.create();
    const conversationId = runtime.snapshot().selectedConversationId;
    await runtime.updateDraft(conversationId, { text: "three views" });
    await runtime.submit(conversationId, settings);
    if (!runtime.snapshot().batches.some((batch) => batch.status === "completed")) {
      await new Promise<void>((resolve) => {
        const unsubscribe = runtime.subscribe((state) => {
          if (state.batches.some((batch) => batch.status === "completed")) { unsubscribe(); resolve(); }
        });
      });
    }
    expect(generated).toBe(3);
    expect(maxActive).toBe(1);
    expect(runtime.snapshot().tasks.map((task) => task.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
  });

  it("continues the serial batch after one task fails", async () => {
    failAt = 2;
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    await runtime.updateDraft(conversationId, { text: "three views" });
    await runtime.submit(conversationId, settings);
    await new Promise<void>((resolve) => {
      const unsubscribe = runtime.subscribe((state) => {
        const batch = state.batches.find((item) => item.conversationId === conversationId);
        if (batch?.status === "partial") { unsubscribe(); resolve(); }
      });
    });
    const batch = runtime.snapshot().batches.find((item) => item.conversationId === conversationId)!;
    expect(runtime.snapshot().tasks.filter((task) => task.batchId === batch.id).map((task) => task.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(maxActive).toBe(1);
  });

  it("freezes annotation documents and object references when a task is created", async () => {
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    const base = createAnnotationDocument({ id: "document-freeze", sourceAssetId: "asset-base", conversationId });
    const appended = appendAnnotationObject(base, "rect", { kind: "rect", x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, "#D64536", "原始要求");
    const document = { ...appended.document, overlayAssetId: "document-freeze", status: "attached" as const, promptText: "修改 @Region01" };
    await runtime.upsertAnnotationDocument(document);
    const attachment = { id: "annotation-freeze", kind: "annotation" as const, sourceAssetId: "asset-base", documentId: document.id, objectIds: [appended.object.id], compiledOverlayAssetId: document.id, instruction: document.promptText, tokens: [], createdAt: "now" };
    await runtime.updateDraft(conversationId, { text: "精准编辑", attachments: [attachment] });
    planOverride = { summary: "edit", tasks: [{ title: "方案 A", prompt: "修改 @Region01", operation: "edit", referenceIds: [], annotationId: attachment.id, annotationDocumentId: document.id, annotationObjectIds: [appended.object.id], baseAssetId: "asset-base", preserve: ["未标注区域"], variantGroupId: "variants-1" }] };
    await runtime.submit(conversationId, settings);
    const task = runtime.snapshot().tasks.find((item) => item.annotationDocumentId === document.id)!;
    expect(task.annotationSnapshot?.objects[0].note).toBe("原始要求");
    expect(task.capabilitiesSnapshot).toEqual(expect.objectContaining({ supportsMask: true, supportsLayers: false }));
    expect(task.compiledPrompt).toContain("必须保持：未标注区域");
    await runtime.upsertAnnotationDocument(updateAnnotationObject(document, appended.object.id, { note: "后续草稿" }));
    expect(runtime.snapshot().tasks.find((item) => item.id === task.id)?.annotationSnapshot?.objects[0].note).toBe("原始要求");
  });

  it("derives parent lineage for generate tasks from a base-role asset", async () => {
    const runtime = await AgentRuntime.create();
    await runtime.createConversation();
    const conversationId = runtime.snapshot().selectedConversationId;
    const attachment = { id: "base-reference", kind: "asset" as const, assetId: "asset-parent", name: "父版本", descriptor: { label: "Image001", roles: ["base" as const], priority: 5, preserve: ["整体构图"] } };
    await runtime.updateDraft(conversationId, { text: "基于此图生成新方案", attachments: [attachment] });
    planOverride = { summary: "continue", tasks: [{ title: "新方案", prompt: "更换材质", operation: "generate", referenceIds: [attachment.id], annotationId: null, annotationDocumentId: null, annotationObjectIds: [], baseAssetId: null, preserve: ["整体构图"], variantGroupId: "siblings" }] };
    await runtime.submit(conversationId, settings);
    await new Promise<void>((resolve) => {
      const unsubscribe = runtime.subscribe((state) => {
        if (state.tasks.some((task) => task.title === "新方案" && task.status === "succeeded")) { unsubscribe(); resolve(); }
      });
    });
    expect(runtime.snapshot().tasks.find((task) => task.title === "新方案")?.baseAssetId).toBe("asset-parent");
    expect(vi.mocked(bridge.generate)).toHaveBeenLastCalledWith(expect.objectContaining({ parentAssetId: "asset-parent" }));
  });
});
