import { describe, expect, it, vi } from "vitest";
import type { AnnotationDocumentV2, AnnotationObjectRecord, Attachment, GenerationParams } from "../types";
import { assertCompilable, BASIC_IMAGE_CAPABILITIES, compileEditRequest, providerCapabilitiesForModel, renderMaskDataUrl } from "./promptCompiler";

const params: GenerationParams = {
  prompt: "",
  aspectRatio: "3:4",
  resolution: "2K",
  size: "1536x2048",
  quality: "high",
  outputFormat: "png",
};

function object(overrides: Partial<AnnotationObjectRecord> = {}): AnnotationObjectRecord {
  return {
    id: "object-region-1",
    documentId: "document-1",
    kind: "rect",
    displayName: "Region01",
    sequence: 1,
    geometry: { kind: "rect", x: 0.04, y: 0.02, width: 0.92, height: 0.31 },
    color: "#D64536",
    note: "改为中古红色背景",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

function document(overrides: Partial<AnnotationDocumentV2> = {}): AnnotationDocumentV2 {
  return {
    id: "document-1",
    sourceAssetId: "asset-1",
    conversationId: "conversation-1",
    sourceWidth: 1200,
    sourceHeight: 1600,
    fabricJson: "{\"objects\":[]}",
    objects: [object()],
    promptText: "把 @Region01 改成红色，材质参考 @Image001",
    promptTokens: [
      { id: "token-region", kind: "annotation", targetId: "object-region-1", displayText: "@Region01", start: 2, end: 11 },
      { id: "token-image", kind: "reference", targetId: "ref-1", displayText: "@Image001", start: 20, end: 29 },
    ],
    status: "attached",
    overlayAssetId: "overlay-document-1",
    legacy: false,
    nextSequence: { point: 1, rect: 2, mask: 1, arrow: 1, note: 1 },
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

const references: Attachment[] = [{
  id: "ref-1",
  kind: "reference",
  name: "材质.png",
  dataUrl: "data:image/png;base64,AA==",
  descriptor: { label: "Image001", roles: ["material"], priority: 1, preserve: ["只使用材质"] },
}];

describe("Prompt Compiler", () => {
  it("declares model capabilities without claiming unsupported layers", () => {
    expect(providerCapabilitiesForModel("gpt-image-2")).toEqual(expect.objectContaining({ supportsEdit: true, supportsMultipleReferences: true, supportsMask: true, supportsLayers: false }));
    expect(providerCapabilitiesForModel("unknown-image-model")).toEqual(BASIC_IMAGE_CAPABILITIES);
  });
  it("expands structured objects, reference roles and output constraints", () => {
    const compiled = compileEditRequest(document(), references, params);
    expect(compiled.prompt).toContain("Region01：矩形 x=0.04, y=0.02, w=0.92, h=0.31；改为中古红色背景");
    expect(compiled.prompt).toContain("Image001：主角色 材质，优先级 1；必须保持：只使用材质");
    expect(compiled.prompt).toContain("输出比例 3:4，分辨率 2K，质量 high");
    expect(compiled.referenceDataUrls).toEqual(["data:image/png;base64,AA=="]);
    expect(compiled.structuredRegions).toEqual([]);
    expect(() => assertCompilable(compiled)).not.toThrow();
  });

  it("routes regions and masks only when provider capabilities declare support", () => {
    const mask = object({
      id: "mask-1",
      kind: "mask",
      displayName: "Region02",
      sequence: 2,
      geometry: { kind: "mask", points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], brushWidth: 0.02 },
    });
    const compiled = compileEditRequest(document({ objects: [object(), mask] }), references, params, {
      ...BASIC_IMAGE_CAPABILITIES,
      supportsMask: true,
      supportsStructuredRegions: true,
    });
    expect(compiled.structuredRegions.map((item) => item.id)).toEqual(["object-region-1"]);
    expect(compiled.maskObjectIds).toEqual(["mask-1"]);
  });

  it("expands task preservation and arrow source relationships", () => {
    const mark = object({ id: "mark-1", kind: "point", displayName: "Mark01", geometry: { kind: "point", x: 0.2, y: 0.3, radius: 0.01 } });
    const move = object({ id: "move-1", kind: "arrow", displayName: "Move01", sourceObjectId: mark.id, geometry: { kind: "arrow", from: { x: 0.2, y: 0.3 }, to: { x: 0.8, y: 0.7 } } });
    const compiled = compileEditRequest(document({ objects: [mark, move] }), references, params, BASIC_IMAGE_CAPABILITIES, ["文字版式", "品牌色"]);
    expect(compiled.prompt).toContain("Move01：方向从 (0.2, 0.3) 到 (0.8, 0.7)，起点关联 Mark01");
    expect(compiled.prompt).toContain("必须保持：未标注区域、原图主体身份、产品结构、整体构图、文字版式、品牌色");
  });

  it("blocks missing tokens, illegal colors, reference conflicts and absent fallback overlay", () => {
    const conflict: Attachment[] = [
      { id: "ref-1", kind: "reference", name: "产品一", dataUrl: "data:image/png;base64,AA==", descriptor: { label: "Image001", roles: ["product"], priority: 5, preserve: [] } },
      { id: "ref-2", kind: "asset", assetId: "asset-2", name: "冲突产品", descriptor: { label: "Image002", roles: ["product"], priority: 5, preserve: [] } },
    ];
    const invalid = document({
      overlayAssetId: undefined,
      promptText: "把 @Region99 改成 #12GG00，并参考 @Image003",
      promptTokens: [],
    });
    const compiled = compileEditRequest(invalid, conflict, params);
    expect(compiled.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["missing-object", "missing-reference", "invalid-color", "reference-conflict", "overlay-required"]));
    expect(() => assertCompilable(compiled)).toThrow("非法 Hex");
  });

  it("renders original-size masks including a single-point brush stroke", () => {
    const context = { fillStyle: "", globalCompositeOperation: "", lineCap: "", lineJoin: "", lineWidth: 0, fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL: vi.fn(() => "data:image/png;base64,MASK") };
    const createElement = vi.spyOn(globalThis.document, "createElement").mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const mask = object({ id: "mask-1", kind: "mask", displayName: "Region02", geometry: { kind: "mask", points: [{ x: 0.2, y: 0.3 }], brushWidth: 0.02 } });

    expect(renderMaskDataUrl(document({ sourceWidth: 100, sourceHeight: 80, objects: [mask] }))).toBe("data:image/png;base64,MASK");
    expect(canvas).toMatchObject({ width: 100, height: 80 });
    expect(context.arc).toHaveBeenCalledWith(20, 24, 1, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalledOnce();
    createElement.mockRestore();
  });
});
