import { describe, expect, it } from "vitest";
import type { PromptCatalogDownload, PromptLocalState, PromptTemplate } from "../types";
import { applyCatalogUpdate, createDefaultLocalState, exportPromptCatalogData, importPromptCatalogData, mergePromptView, shouldAutoUpdate } from "./promptCatalogStore";

function template(id: string, hash: string, prompt = "Prompt text"): PromptTemplate {
  const [sourceId, sourceKey] = id.split(":");
  return {
    id, sourceId, sourceKey, sourceUrl: `https://example.com/${sourceKey}`, title: sourceKey, description: "", prompt, language: "en", category: "creative", tags: [], modelFamilies: ["gpt-image"], promptHash: hash, importedAt: "2026-01-01T00:00:00.000Z",
    sourceReferences: [{ sourceId, sourceKey, sourceUrl: `https://example.com/${sourceKey}`, license: "MIT", attribution: "Fixture" }],
  };
}

function download(items: PromptTemplate[]): PromptCatalogDownload {
  return { manifest: { schemaVersion: 1, catalogVersion: "2", generatedAt: "2026-02-01T00:00:00.000Z", checksum: "ok", sources: [] }, items, thumbnailPaths: {} };
}

describe("prompt catalog local state and updates", () => {
  it("keeps local favorites, notes, and rewrites outside remote records", () => {
    const remote = template("source:one", "a", "Remote prompt");
    const local: PromptLocalState = { ...createDefaultLocalState(remote.id), favorite: true, note: "Private note", customPrompt: "Local rewrite", customTags: ["mine"] };
    const view = mergePromptView(remote, local);
    expect(view.displayPrompt).toBe("Local rewrite");
    expect(view.local.favorite).toBe(true);
    expect(remote).not.toHaveProperty("note");
  });

  it("updates remote fields without duplicating templates", () => {
    const current = template("source:one", "a", "Old prompt");
    const incoming = { ...template("source:one", "b", "New prompt"), title: "Updated title" };
    const result = applyCatalogUpdate([current], download([incoming]), "add-and-update", ["source"]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Updated title");
    expect(result.updated).toBe(1);
  });

  it("archives missing upstream templates instead of deleting them", () => {
    const current = template("source:one", "a");
    const result = applyCatalogUpdate([current], download([]), "add-and-update", ["source"]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].archivedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(result.archived).toBe(1);
  });

  it("supports add-only updates and auto-update intervals", () => {
    const current = template("source:one", "a", "Old");
    const incoming = template("source:one", "b", "New");
    expect(applyCatalogUpdate([current], download([incoming]), "add-only", ["source"]).items[0].prompt).toBe("Old");
    expect(shouldAutoUpdate({ autoUpdate: "daily", updateStrategy: "add-only", thumbnailStrategy: "lazy", enabledSourceIds: ["source"], lastCheckedAt: "2026-01-01T00:00:00.000Z" }, Date.parse("2026-01-02T00:00:01.000Z"))).toBe(true);
  });

  it("is idempotent when the same catalog version is applied repeatedly", () => {
    const current = template("source:one", "a");
    const first = applyCatalogUpdate([current], download([current]), "add-and-update", ["source"]);
    const second = applyCatalogUpdate(first.items, download([current]), "add-and-update", ["source"]);
    expect(second.items).toHaveLength(1);
    expect(second).toMatchObject({ added: 0, updated: 0, archived: 0, unchanged: 1 });
  });

  it("restores templates, local state, usage and sync history from one export", async () => {
    const remote = template("fixture:one", "a");
    const local = { ...createDefaultLocalState(remote.id), favorite: true, note: "Restored note" };
    await importPromptCatalogData({
      schemaVersion: 1,
      exportedAt: "2026-02-01T00:00:00.000Z",
      templates: [remote],
      sources: [{ id: "fixture", name: "Fixture", url: "https://example.com", enabledByDefault: true, status: "success", itemCount: 1, fetchedAt: "2026-02-01T00:00:00.000Z" }],
      local: [local],
      usage: [{ id: "usage-1", templateId: remote.id, conversationId: "conversation-1", usedAt: "2026-02-01T00:00:00.000Z" }],
      sync: [{ id: "sync-1", startedAt: "2026-02-01T00:00:00.000Z", completedAt: "2026-02-01T00:00:01.000Z", status: "completed", sourceIds: ["fixture"], added: 1, updated: 0, archived: 0, unchanged: 0, errors: {} }],
      meta: { id: "catalog", catalogVersion: "99999999999999", generatedAt: "2026-02-01T00:00:00.000Z", preferences: { autoUpdate: "off", updateStrategy: "add-and-update", thumbnailStrategy: "lazy", enabledSourceIds: ["fixture"] } },
    });

    const restored = await exportPromptCatalogData();
    expect(restored.templates).toEqual([remote]);
    expect(restored.local).toEqual([local]);
    expect(restored.usage).toHaveLength(1);
    expect(restored.sync).toMatchObject([{ id: "sync-1", status: "completed" }]);
  });
});
