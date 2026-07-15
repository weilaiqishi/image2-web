import { beforeEach, describe, expect, it, vi } from "vitest";

describe("browser bridge assets", () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.replaceState({}, "", "/?demo=1");
    delete window.__IMAGE2_BROWSER_ASSETS__;
  });

  it("indexes a Demo edit result for result cards and the asset picker", async () => {
    const { bridge } = await import("./bridge");
    const beforeCount = (await bridge.listAssets()).length;

    const edited = await bridge.edit({
      originalAssetId: "demo-original-mooncake-v2",
      prompt: "只修改标注区域",
      annotationPrompt: "@Region01 改为蓝色",
      aspectRatio: "1:1",
      resolution: "1K",
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
    });

    const after = await bridge.listAssets();
    expect(after).toHaveLength(beforeCount + 1);
    expect(after[0]).toMatchObject({
      id: edited.id,
      parentId: "demo-original-mooncake-v2",
      prompt: "只修改标注区域",
      kind: "edited",
    });
  });

  it("creates unique indexed generate branches with inherited root lineage", async () => {
    const { bridge } = await import("./bridge");
    const first = await bridge.generate({ prompt: "方案一", aspectRatio: "1:1", resolution: "1K", size: "1024x1024", quality: "medium", outputFormat: "png", parentAssetId: "demo-original-mooncake-v2", branchLabel: "蓝色方案" });
    const second = await bridge.generate({ prompt: "方案二", aspectRatio: "1:1", resolution: "1K", size: "1024x1024", quality: "medium", outputFormat: "png", parentAssetId: first.id, branchLabel: "材质方案" });

    expect(first.id).not.toBe(second.id);
    expect(first.lineage).toMatchObject({ parentId: "demo-original-mooncake-v2", rootId: "demo-original-mooncake-v2", revision: 1 });
    expect(second.lineage).toMatchObject({ parentId: first.id, rootId: "demo-original-mooncake-v2", revision: 2 });
    expect((await bridge.listAssets()).slice(0, 2).map((asset) => asset.id)).toEqual([second.id, first.id]);
  });

  it("reads only the current user message when the Demo Agent chooses a task shape", async () => {
    const { currentUserText } = await import("./bridge");
    expect(currentUserText("responses", {
      instructions: "系统示例包含三视图",
      input: [{ role: "user", content: [{ type: "input_text", text: "只生成一个绿色方案" }] }],
    })).toBe("只生成一个绿色方案");
    expect(currentUserText("chat_completions", {
      messages: [{ role: "system", content: "系统示例包含三视图" }, { role: "user", content: [{ type: "text", text: "生成三视图" }] }],
    })).toBe("生成三视图");
  });
});
