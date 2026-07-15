import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, Settings } from "../types";
import { AgentRuntime } from "./agentRuntime";

let active = 0;
let maxActive = 0;
let generated = 0;
let failAt = 0;

vi.mock("./bridge", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
  bridge: {
    proxyAgent: vi.fn(async () => ({ output: [{ type: "function_call", name: "create_image_tasks", arguments: JSON.stringify({
      summary: "three",
      tasks: ["front", "left", "right"].map((title) => ({ title, prompt: title, operation: "generate", referenceIds: [] })),
    }) }] })),
    generate: vi.fn(async (): Promise<AssetRecord> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      generated += 1;
      if (generated === failAt) throw new Error("gateway timeout");
      return { id: `asset-${generated}`, filePath: `/asset-${generated}.png`, mimeType: "image/png", prompt: "", createdAt: new Date().toISOString(), kind: "generated" };
    }),
    edit: vi.fn(),
    readAssetDataUrl: vi.fn(),
  },
}));

const settings: Settings = { baseUrl: "https://api.openai.com/v1", agentProtocol: "responses", agentModel: "gpt-5.6", imageModel: "gpt-image-2", hasApiKey: true };

describe("SerialImageQueue", () => {
  beforeEach(() => { active = 0; maxActive = 0; generated = 0; failAt = 0; });

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
});
