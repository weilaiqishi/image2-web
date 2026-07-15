import { describe, expect, it } from "vitest";
import { createInitialWorkspace, migrateWorkspace } from "./workspaceStore";

describe("Workspace v2 migration", () => {
  it("creates version 2 workspaces with an annotation document index", () => {
    const workspace = createInitialWorkspace();
    expect(workspace.version).toBe(2);
    expect(workspace.annotationDocuments).toEqual({});
  });

  it("migrates legacy annotations and assigns stable image labels", () => {
    const legacy = {
      version: 1,
      selectedConversationId: "conversation-1",
      conversations: [{ id: "conversation-1", title: "旧对话", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
      messages: [],
      batches: [],
      tasks: [],
      drafts: {
        "conversation-1": {
          text: "修改 @Region01",
          params: { prompt: "", aspectRatio: "1:1", resolution: "1K", size: "1024x1024", quality: "medium", outputFormat: "png" },
          attachments: [
            { id: "ref-1", kind: "reference", name: "色卡.png", dataUrl: "data:image/png;base64,AA==" },
            { id: "asset-ref", kind: "asset", assetId: "asset-2", name: "产品" },
            {
              id: "annotation-1",
              kind: "annotation",
              sourceAssetId: "asset-1",
              documentJson: "{\"objects\":[]}",
              annotatedDataUrl: "data:image/png;base64,AA==",
              instruction: "提亮人物",
              createdAt: "2026-01-01",
            },
          ],
        },
      },
    };

    const migrated = migrateWorkspace(legacy);
    const attachments = migrated.drafts["conversation-1"].attachments;
    expect(migrated.version).toBe(2);
    expect(attachments[0]).toMatchObject({ descriptor: { label: "Image001", roles: ["other"] } });
    expect(attachments[1]).toMatchObject({ descriptor: { label: "Image002", roles: ["other"] } });
    expect(attachments[2]).toMatchObject({ documentId: "legacy-annotation-1", objectIds: [] });
    expect(migrated.annotationDocuments["legacy-annotation-1"]).toMatchObject({
      sourceAssetId: "asset-1",
      legacy: true,
      promptText: "提亮人物",
      legacyAnnotatedDataUrl: "data:image/png;base64,AA==",
    });
  });

  it("is idempotent for version 2 state", () => {
    const workspace = createInitialWorkspace();
    expect(migrateWorkspace(migrateWorkspace(workspace))).toEqual(migrateWorkspace(workspace));
  });
});
