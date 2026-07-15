import { describe, expect, it } from "vitest";
import { annotationTokensForPrompt, appendAnnotationObject, createAnnotationDocument, missingAnnotationReferences, removeAnnotationObjects, replaceSourceAttachmentWithAnnotation } from "./annotationModel";

describe("structured annotation model", () => {
  it("keeps display numbers stable and never reuses deleted numbers", () => {
    let document = createAnnotationDocument({ id: "document-1", sourceAssetId: "asset-1", conversationId: "conversation-1" });
    const first = appendAnnotationObject(document, "point", { kind: "point", x: 0.2, y: 0.3, radius: 0.01 }, "#D64536");
    document = first.document;
    const second = appendAnnotationObject(document, "point", { kind: "point", x: 0.4, y: 0.5, radius: 0.01 }, "#D64536");
    document = removeAnnotationObjects(second.document, [first.object.id]);
    const third = appendAnnotationObject(document, "point", { kind: "point", x: 0.6, y: 0.7, radius: 0.01 }, "#D64536");
    expect([second.object.displayName, third.object.displayName]).toEqual(["Mark02", "Mark03"]);
  });

  it("shares Region numbering between rectangle and mask tools", () => {
    let document = createAnnotationDocument({ id: "document-1", sourceAssetId: "asset-1", conversationId: "conversation-1" });
    const rect = appendAnnotationObject(document, "rect", { kind: "rect", x: 0, y: 0, width: 0.5, height: 0.5 }, "#D64536");
    document = rect.document;
    const mask = appendAnnotationObject(document, "mask", { kind: "mask", points: [{ x: 0.2, y: 0.2 }], brushWidth: 0.02 }, "#2455C3");
    expect([rect.object.displayName, mask.object.displayName]).toEqual(["Region01", "Region02"]);
  });

  it("records stable annotation and color tokens and reports stale references", () => {
    const base = createAnnotationDocument({ id: "document-1", sourceAssetId: "asset-1", conversationId: "conversation-1" });
    const point = appendAnnotationObject(base, "point", { kind: "point", x: 0.2, y: 0.3, radius: 0.01 }, "#D64536");
    const tokens = annotationTokensForPrompt("将 @Mark01 改为 #c59a3a", point.document.objects);
    expect(tokens.map((token) => [token.kind, token.displayText, token.targetId])).toEqual([
      ["annotation", "@Mark01", point.object.id],
      ["color", "#C59A3A", "#C59A3A"],
    ]);
    expect(missingAnnotationReferences("修改 @Mark01 和 @Region99", point.document.objects)).toEqual(["Region99"]);
  });

  it("upgrades the source asset in place without duplicating an annotation document", () => {
    const source = { id: "asset-attachment", kind: "asset" as const, assetId: "asset-1", name: "source.png" };
    const reference = { id: "reference-1", kind: "reference" as const, name: "style.png", dataUrl: "data:image/png;base64,AA==" };
    const annotation = { id: "annotation-1", kind: "annotation" as const, sourceAssetId: "asset-1", documentId: "document-1", objectIds: [], instruction: "修改", tokens: [], createdAt: "now" };
    expect(replaceSourceAttachmentWithAnnotation([reference, source], annotation)).toEqual([reference, annotation]);
    expect(replaceSourceAttachmentWithAnnotation([reference, annotation], { ...annotation, instruction: "再次修改" })).toEqual([reference, { ...annotation, instruction: "再次修改" }]);
  });

  it("associates an arrow with its source Mark", () => {
    let document = createAnnotationDocument({ id: "document-1", sourceAssetId: "asset-1", conversationId: "conversation-1" });
    const mark = appendAnnotationObject(document, "point", { kind: "point", x: 0.2, y: 0.3, radius: 0.01 }, "#D64536");
    document = mark.document;
    const move = appendAnnotationObject(document, "arrow", { kind: "arrow", from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } }, "#D64536", "移动", mark.object.id);
    expect(move.object).toMatchObject({ displayName: "Move01", sourceObjectId: mark.object.id });
    expect(removeAnnotationObjects(move.document, [mark.object.id]).objects[0].sourceObjectId).toBeUndefined();
  });
});
