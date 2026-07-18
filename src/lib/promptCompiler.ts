import type {
  AnnotationDocumentV2,
  AnnotationObjectRecord,
  Attachment,
  GenerationParams,
  ImageProviderCapabilities,
  ReferenceAttachment,
  ReferenceDescriptor,
} from "../types";
import { getLocale, translate, type TranslationKey } from "../i18n";

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

const roleLabelKeys: Record<ReferenceDescriptor["roles"][number], TranslationKey> = {
  base: "role.base",
  identity: "role.identityDetailed",
  product: "role.productDetailed",
  pose: "role.poseDetailed",
  composition: "role.composition",
  material: "role.material",
  palette: "role.palette",
  style: "role.styleDetailed",
  layout: "role.layout",
  logo: "role.logo",
  other: "role.otherDetailed",
};

function fixed(value: number) {
  return Number(value.toFixed(4));
}

function geometryText(object: AnnotationObjectRecord, objectsById: Map<string, AnnotationObjectRecord>) {
  const geometry = object.geometry;
  if (geometry.kind === "point") return translate("compiler.point", { x: fixed(geometry.x), y: fixed(geometry.y), r: fixed(geometry.radius) });
  if (geometry.kind === "rect") return translate("compiler.rect", { x: fixed(geometry.x), y: fixed(geometry.y), width: fixed(geometry.width), height: fixed(geometry.height) });
  if (geometry.kind === "mask") return translate("compiler.mask", { count: geometry.points.length, width: fixed(geometry.brushWidth) });
  if (geometry.kind === "arrow") {
    const source = object.sourceObjectId ? objectsById.get(object.sourceObjectId) : undefined;
    return translate("compiler.arrow", { fromX: fixed(geometry.from.x), fromY: fixed(geometry.from.y), toX: fixed(geometry.to.x), toY: fixed(geometry.to.y), source: source ? translate("compiler.arrowSource", { name: source.displayName }) : "" });
  }
  return translate("compiler.note", { x: fixed(geometry.x), y: fixed(geometry.y), width: fixed(geometry.width), height: fixed(geometry.height) });
}

function referenceDescriptor(attachment: Exclude<Attachment, { kind: "annotation" }>, index: number): ReferenceDescriptor {
  return attachment.descriptor ?? { label: `Image${String(index + 1).padStart(3, "0")}`, roles: ["other"], priority: 0, preserve: [] };
}

function invalidColorDiagnostics(text: string): PromptDiagnostic[] {
  return [...text.matchAll(/#[0-9A-Za-z]{6}\b/g)]
    .filter((match) => !/^#[0-9A-Fa-f]{6}$/.test(match[0]))
    .map((match) => ({ code: "invalid-color", severity: "error", message: translate("errors.invalidColor", { color: match[0] }), targetId: match[0] }));
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
        message: translate("errors.referenceConflict", { labels: highest.map((entry) => entry.descriptor.label).join(getLocale() === "zh-CN" ? "、" : ", "), role: translate(roleLabelKeys[role]) }),
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
      diagnostics.push({ code: "missing-object", severity: "error", message: translate("errors.deletedObject", { token: token.displayText }), targetId: token.targetId });
    }
    if (token.kind === "reference" && !referenceEntries.some((entry) => entry.attachment.id === token.targetId)) {
      diagnostics.push({ code: "missing-reference", severity: "error", message: translate("errors.deletedReference", { token: token.displayText }), targetId: token.targetId });
    }
  }

  for (const match of document.promptText.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)) {
    if (!objectsByName.has(match[1])) diagnostics.push({ code: "missing-object", severity: "error", message: translate("errors.invalidReference", { name: match[1] }), targetId: match[1] });
  }
  for (const match of document.promptText.matchAll(/@(Image\d+)/g)) {
    if (!referencesByLabel.has(match[1])) diagnostics.push({ code: "missing-reference", severity: "error", message: translate("errors.invalidReference", { name: match[1] }), targetId: match[1] });
  }

  diagnostics.push(...referenceConflictDiagnostics(attachments));

  if (!capabilities.supportsStructuredRegions && !document.overlayAssetId && !document.legacyAnnotatedDataUrl) {
    diagnostics.push({ code: "overlay-required", severity: "error", message: translate("errors.overlayRequired") });
  }

  const punctuation = getLocale() === "zh-CN" ? { colon: "：", separator: "；", list: "、" } : { colon: ": ", separator: "; ", list: ", " };
  const objectLines = document.objects.map((object) => `- ${object.displayName}${punctuation.colon}${geometryText(object, objectsById)}${object.note ? `${punctuation.separator}${object.note}` : ""}`);
  const referenceRoleSummary = referenceEntries.map(({ descriptor }) => {
    const [primaryRole, ...secondaryRoles] = descriptor.roles;
    const roles = `${translate("compiler.primaryRole", { role: translate(roleLabelKeys[primaryRole ?? "other"]) })}${secondaryRoles.length ? translate("compiler.secondaryRoles", { roles: secondaryRoles.map((role) => translate(roleLabelKeys[role])).join(punctuation.list) }) : ""}`;
    const preserve = descriptor.preserve.length ? translate("compiler.mustPreserve", { items: descriptor.preserve.join(punctuation.list) }) : "";
    return translate("compiler.referenceLine", { label: descriptor.label, roles, priority: descriptor.priority, preserve });
  });
  const preservation = [...new Set([translate("compiler.defaultPreserveUnmarked"), translate("compiler.defaultPreserveIdentity"), translate("compiler.defaultPreserveProduct"), translate("compiler.defaultPreserveComposition"), ...preserve.map((item) => item.trim()).filter(Boolean)])];
  const expandedPrompt = [
    translate("compiler.intro"),
    objectLines.length ? translate("compiler.objects") : "",
    ...objectLines,
    referenceRoleSummary.length ? translate("compiler.references") : "",
    ...referenceRoleSummary.map((line) => `- ${line}`),
    translate("compiler.userRequirement", { requirement: document.promptText.trim() || translate("compiler.defaultRequirement") }),
    translate("compiler.preserve", { items: preservation.join(punctuation.list) }),
    translate("compiler.output", { aspectRatio: params.aspectRatio, resolution: params.resolution, quality: params.quality }),
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
  if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join(getLocale() === "zh-CN" ? "；" : "; "));
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
