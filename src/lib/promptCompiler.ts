import type {
  AnnotationDocumentV2,
  AnnotationObjectRecord,
  Attachment,
  GenerationParams,
  ImageProviderCapabilities,
  ReferenceAttachment,
  ReferenceDescriptor,
} from "../types";

export interface PromptDiagnostic {
  code: "missing-object" | "missing-reference" | "invalid-color" | "reference-conflict" | "overlay-required";
  severity: "error" | "warning";
  message: string;
  targetId?: string;
}

export interface CompiledEditRequest {
  originalAssetId: string;
  overlayAssetId?: string;
  prompt: string;
  referenceAttachmentIds: string[];
  referenceAssetIds: string[];
  referenceDataUrls: string[];
  referenceRoleSummary: string[];
  structuredRegions: AnnotationObjectRecord[];
  maskObjectIds: string[];
  diagnostics: PromptDiagnostic[];
  capabilities: ImageProviderCapabilities;
}

export const BASIC_IMAGE_CAPABILITIES: ImageProviderCapabilities = {
  supportsEdit: true,
  supportsMultipleReferences: false,
  supportsMask: false,
  supportsStructuredRegions: false,
  supportsLayers: false,
};

export function providerCapabilitiesForModel(model: string): ImageProviderCapabilities {
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-image")) {
    return { supportsEdit: true, supportsMultipleReferences: true, supportsMask: true, supportsStructuredRegions: false, supportsLayers: false };
  }
  if (normalized.includes("seedream")) {
    return { supportsEdit: true, supportsMultipleReferences: true, supportsMask: false, supportsStructuredRegions: false, supportsLayers: false };
  }
  return BASIC_IMAGE_CAPABILITIES;
}

const roleLabels: Record<ReferenceDescriptor["roles"][number], string> = {
  base: "原图",
  identity: "人物身份",
  product: "产品结构",
  pose: "动作姿势",
  composition: "构图",
  material: "材质",
  palette: "色卡",
  style: "视觉风格",
  layout: "版式",
  logo: "Logo",
  other: "其他参考",
};

function fixed(value: number) {
  return Number(value.toFixed(4));
}

function geometryText(object: AnnotationObjectRecord, objectsById: Map<string, AnnotationObjectRecord>) {
  const geometry = object.geometry;
  if (geometry.kind === "point") return `点 x=${fixed(geometry.x)}, y=${fixed(geometry.y)}, r=${fixed(geometry.radius)}`;
  if (geometry.kind === "rect") return `矩形 x=${fixed(geometry.x)}, y=${fixed(geometry.y)}, w=${fixed(geometry.width)}, h=${fixed(geometry.height)}`;
  if (geometry.kind === "mask") return `不规则蒙版，共 ${geometry.points.length} 个采样点，相对笔宽 ${fixed(geometry.brushWidth)}`;
  if (geometry.kind === "arrow") {
    const source = object.sourceObjectId ? objectsById.get(object.sourceObjectId) : undefined;
    return `方向从 (${fixed(geometry.from.x)}, ${fixed(geometry.from.y)}) 到 (${fixed(geometry.to.x)}, ${fixed(geometry.to.y)})${source ? `，起点关联 ${source.displayName}` : ""}`;
  }
  return `备注位置 x=${fixed(geometry.x)}, y=${fixed(geometry.y)}, w=${fixed(geometry.width)}, h=${fixed(geometry.height)}`;
}

function referenceDescriptor(attachment: Exclude<Attachment, { kind: "annotation" }>, index: number): ReferenceDescriptor {
  return attachment.descriptor ?? { label: `Image${String(index + 1).padStart(3, "0")}`, roles: ["other"], priority: 0, preserve: [] };
}

function invalidColorDiagnostics(text: string): PromptDiagnostic[] {
  return [...text.matchAll(/#[0-9A-Za-z]{6}\b/g)]
    .filter((match) => !/^#[0-9A-Fa-f]{6}$/.test(match[0]))
    .map((match) => ({ code: "invalid-color", severity: "error", message: `非法 Hex 色值 ${match[0]}`, targetId: match[0] }));
}

export function referenceConflictDiagnostics(attachments: Attachment[]): PromptDiagnostic[] {
  const references = attachments.filter((attachment): attachment is Exclude<Attachment, { kind: "annotation" }> => attachment.kind !== "annotation");
  const referenceEntries = references.map((attachment, index) => ({ attachment, descriptor: referenceDescriptor(attachment, index) }));
  const diagnostics: PromptDiagnostic[] = [];
  for (const role of ["identity", "product", "logo"] as const) {
    const candidates = referenceEntries.filter((entry) => entry.descriptor.roles.includes(role));
    const maxPriority = Math.max(-1, ...candidates.map((entry) => entry.descriptor.priority));
    const highest = candidates.filter((entry) => entry.descriptor.priority === maxPriority);
    if (highest.length > 1) {
      diagnostics.push({
        code: "reference-conflict",
        severity: "error",
        message: `${highest.map((entry) => entry.descriptor.label).join("、")} 同时声明为最高优先级${roleLabels[role]}参考`,
      });
    }
  }
  return diagnostics;
}

export function compileEditRequest(
  document: AnnotationDocumentV2,
  attachments: Attachment[],
  params: GenerationParams,
  capabilities: ImageProviderCapabilities = BASIC_IMAGE_CAPABILITIES,
  preserve: string[] = [],
): CompiledEditRequest {
  const diagnostics: PromptDiagnostic[] = invalidColorDiagnostics(document.promptText);
  const objectsById = new Map(document.objects.map((object) => [object.id, object]));
  const objectsByName = new Map(document.objects.map((object) => [object.displayName, object]));
  const references = attachments.filter((attachment): attachment is Exclude<Attachment, { kind: "annotation" }> => attachment.kind !== "annotation");
  const referenceEntries = references.map((attachment, index) => ({ attachment, descriptor: referenceDescriptor(attachment, index) }));
  const referencesByLabel = new Map(referenceEntries.map((entry) => [entry.descriptor.label, entry]));

  for (const token of document.promptTokens) {
    if (token.kind === "annotation" && !objectsById.has(token.targetId)) {
      diagnostics.push({ code: "missing-object", severity: "error", message: `${token.displayText} 指向已删除或其他文档中的标注对象`, targetId: token.targetId });
    }
    if (token.kind === "reference" && !referenceEntries.some((entry) => entry.attachment.id === token.targetId)) {
      diagnostics.push({ code: "missing-reference", severity: "error", message: `${token.displayText} 指向已删除的参考图`, targetId: token.targetId });
    }
  }

  for (const match of document.promptText.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)) {
    if (!objectsByName.has(match[1])) diagnostics.push({ code: "missing-object", severity: "error", message: `提示词引用了不存在的 @${match[1]}`, targetId: match[1] });
  }
  for (const match of document.promptText.matchAll(/@(Image\d+)/g)) {
    if (!referencesByLabel.has(match[1])) diagnostics.push({ code: "missing-reference", severity: "error", message: `提示词引用了不存在的 @${match[1]}`, targetId: match[1] });
  }

  diagnostics.push(...referenceConflictDiagnostics(attachments));

  if (!capabilities.supportsStructuredRegions && !document.overlayAssetId && !document.legacyAnnotatedDataUrl) {
    diagnostics.push({ code: "overlay-required", severity: "error", message: "当前 Provider 不支持结构化区域，发送前必须生成标注 overlay" });
  }

  const objectLines = document.objects.map((object) => `- ${object.displayName}：${geometryText(object, objectsById)}${object.note ? `；${object.note}` : ""}`);
  const referenceRoleSummary = referenceEntries.map(({ descriptor }) => {
    const [primaryRole, ...secondaryRoles] = descriptor.roles;
    const roles = `主角色 ${roleLabels[primaryRole ?? "other"]}${secondaryRoles.length ? `；辅助角色 ${secondaryRoles.map((role) => roleLabels[role]).join("、")}` : ""}`;
    const preserve = descriptor.preserve.length ? `；必须保持：${descriptor.preserve.join("、")}` : "";
    return `${descriptor.label}：${roles}，优先级 ${descriptor.priority}${preserve}`;
  });
  const preservation = [...new Set(["未标注区域", "原图主体身份", "产品结构", "整体构图", ...preserve.map((item) => item.trim()).filter(Boolean)])];
  const expandedPrompt = [
    "根据原图和标注示意进行精准修改。标注颜色、边框和编号仅用于定位，不得出现在最终画面。",
    objectLines.length ? "标注对象：" : "",
    ...objectLines,
    referenceRoleSummary.length ? "参考图分工：" : "",
    ...referenceRoleSummary.map((line) => `- ${line}`),
    `用户要求：${document.promptText.trim() || "按标注对象修改画面"}`,
    `必须保持：${preservation.join("、")}。`,
    `输出比例 ${params.aspectRatio}，分辨率 ${params.resolution}，质量 ${params.quality}。`,
  ].filter(Boolean).join("\n");

  return {
    originalAssetId: document.sourceAssetId,
    overlayAssetId: document.overlayAssetId,
    prompt: expandedPrompt,
    referenceAttachmentIds: references.map((attachment) => attachment.id),
    referenceAssetIds: references.filter((attachment) => attachment.kind === "asset").map((attachment) => attachment.assetId),
    referenceDataUrls: references.filter((attachment): attachment is ReferenceAttachment => attachment.kind === "reference").map((attachment) => attachment.dataUrl),
    referenceRoleSummary,
    structuredRegions: capabilities.supportsStructuredRegions ? document.objects.filter((object) => object.kind === "point" || object.kind === "rect") : [],
    maskObjectIds: capabilities.supportsMask ? document.objects.filter((object) => object.kind === "mask").map((object) => object.id) : [],
    diagnostics,
    capabilities,
  };
}

export function assertCompilable(request: CompiledEditRequest) {
  const errors = request.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join("；"));
}

export function renderMaskDataUrl(document: AnnotationDocumentV2): string | undefined {
  const masks = document.objects.filter((object) => object.geometry.kind === "mask");
  if (!masks.length || !document.sourceWidth || !document.sourceHeight) return undefined;
  const canvas = globalThis.document?.createElement("canvas");
  if (!canvas) return undefined;
  canvas.width = document.sourceWidth;
  canvas.height = document.sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-out";
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const object of masks) {
    const geometry = object.geometry;
    if (geometry.kind !== "mask" || !geometry.points.length) continue;
    context.beginPath();
    context.lineWidth = geometry.brushWidth * canvas.width;
    const first = geometry.points[0];
    if (geometry.points.length === 1) {
      context.arc(first.x * canvas.width, first.y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.moveTo(first.x * canvas.width, first.y * canvas.height);
    for (const point of geometry.points.slice(1)) context.lineTo(point.x * canvas.width, point.y * canvas.height);
    context.stroke();
  }
  return canvas.toDataURL("image/png");
}
