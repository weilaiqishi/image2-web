import type { AnnotationAttachment, AnnotationDocumentV2, AnnotationObjectKind, AnnotationObjectRecord, AnnotationToken, Attachment, NormalizedGeometry } from "../types";

const prefixes: Record<AnnotationObjectKind, string> = {
  point: "Mark",
  rect: "Region",
  mask: "Region",
  arrow: "Move",
  note: "Note",
};

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function clampNormalized(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function normalizeGeometry(geometry: NormalizedGeometry): NormalizedGeometry {
  if (geometry.kind === "point") return { ...geometry, x: clampNormalized(geometry.x), y: clampNormalized(geometry.y), radius: Math.min(1, Math.max(0.002, geometry.radius)) };
  if (geometry.kind === "rect") return {
    ...geometry,
    x: clampNormalized(geometry.x),
    y: clampNormalized(geometry.y),
    width: Math.min(1 - clampNormalized(geometry.x), Math.max(0.002, geometry.width)),
    height: Math.min(1 - clampNormalized(geometry.y), Math.max(0.002, geometry.height)),
  };
  if (geometry.kind === "mask") return {
    ...geometry,
    points: geometry.points.map((point) => ({ x: clampNormalized(point.x), y: clampNormalized(point.y) })),
    brushWidth: Math.min(1, Math.max(0.001, geometry.brushWidth)),
  };
  if (geometry.kind === "arrow") return {
    ...geometry,
    from: { x: clampNormalized(geometry.from.x), y: clampNormalized(geometry.from.y) },
    to: { x: clampNormalized(geometry.to.x), y: clampNormalized(geometry.to.y) },
  };
  return {
    ...geometry,
    x: clampNormalized(geometry.x),
    y: clampNormalized(geometry.y),
    width: Math.min(1 - clampNormalized(geometry.x), Math.max(0.002, geometry.width)),
    height: Math.min(1 - clampNormalized(geometry.y), Math.max(0.002, geometry.height)),
  };
}

function nextSequence(document: AnnotationDocumentV2, kind: AnnotationObjectKind) {
  if (kind === "rect" || kind === "mask") return Math.max(document.nextSequence.rect, document.nextSequence.mask);
  return document.nextSequence[kind];
}

export function appendAnnotationObject(
  document: AnnotationDocumentV2,
  kind: AnnotationObjectKind,
  geometry: NormalizedGeometry,
  color: string,
  note?: string,
  sourceObjectId?: string,
): { document: AnnotationDocumentV2; object: AnnotationObjectRecord } {
  const sequence = nextSequence(document, kind);
  const timestamp = new Date().toISOString();
  const object: AnnotationObjectRecord = {
    id: id(),
    documentId: document.id,
    kind,
    displayName: `${prefixes[kind]}${String(sequence).padStart(2, "0")}`,
    sequence,
    geometry: normalizeGeometry(geometry),
    color,
    note,
    sourceObjectId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const next = { ...document.nextSequence, [kind]: sequence + 1 };
  if (kind === "rect" || kind === "mask") {
    next.rect = sequence + 1;
    next.mask = sequence + 1;
  }
  return {
    object,
    document: { ...document, objects: [...document.objects, object], nextSequence: next, updatedAt: timestamp },
  };
}

export function annotationTokensForPrompt(text: string, objects: AnnotationObjectRecord[]): AnnotationToken[] {
  const tokens: AnnotationToken[] = [];
  const byName = new Map(objects.map((object) => [object.displayName, object]));
  for (const [index, match] of [...text.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)].entries()) {
    const object = byName.get(match[1]);
    if (!object || match.index === undefined) continue;
    tokens.push({ id: `token-${object.id}-${index}`, kind: "annotation", targetId: object.id, displayText: match[0], start: match.index, end: match.index + match[0].length });
  }
  for (const [index, match] of [...text.matchAll(/#[0-9A-Fa-f]{6}\b/g)].entries()) {
    if (match.index === undefined) continue;
    const color = match[0].toUpperCase();
    tokens.push({ id: `color-${color.slice(1)}-${index}`, kind: "color", targetId: color, displayText: color, start: match.index, end: match.index + match[0].length });
  }
  return tokens.sort((left, right) => left.start - right.start);
}

export function missingAnnotationReferences(text: string, objects: AnnotationObjectRecord[]) {
  const names = new Set(objects.map((object) => object.displayName));
  return [...new Set([...text.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)].map((match) => match[1]).filter((name) => !names.has(name)))];
}

export function updateAnnotationObject(document: AnnotationDocumentV2, objectId: string, update: Partial<Pick<AnnotationObjectRecord, "geometry" | "color" | "note">>) {
  const timestamp = new Date().toISOString();
  return {
    ...document,
    objects: document.objects.map((object) => object.id === objectId ? {
      ...object,
      ...update,
      geometry: update.geometry ? normalizeGeometry(update.geometry) : object.geometry,
      updatedAt: timestamp,
    } : object),
    updatedAt: timestamp,
  };
}

export function removeAnnotationObjects(document: AnnotationDocumentV2, objectIds: string[]) {
  const removed = new Set(objectIds);
  return {
    ...document,
    objects: document.objects
      .filter((object) => !removed.has(object.id))
      .map((object) => object.sourceObjectId && removed.has(object.sourceObjectId) ? { ...object, sourceObjectId: undefined } : object),
    promptTokens: document.promptTokens.filter((token) => token.kind !== "annotation" || !removed.has(token.targetId)),
    updatedAt: new Date().toISOString(),
  };
}

export function replaceSourceAttachmentWithAnnotation(attachments: Attachment[], annotation: AnnotationAttachment): Attachment[] {
  const next: Attachment[] = [];
  let inserted = false;
  for (const attachment of attachments) {
    const isSource = attachment.kind === "asset" && attachment.assetId === annotation.sourceAssetId;
    const isSameDocument = attachment.kind === "annotation" && attachment.documentId === annotation.documentId;
    if (isSource || isSameDocument) {
      if (!inserted) {
        next.push(annotation);
        inserted = true;
      }
      continue;
    }
    next.push(attachment);
  }
  if (!inserted) next.push(annotation);
  return next.slice(0, 6);
}

export function createAnnotationDocument(input: { id: string; sourceAssetId: string; conversationId: string; sourceWidth?: number; sourceHeight?: number }): AnnotationDocumentV2 {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    sourceAssetId: input.sourceAssetId,
    conversationId: input.conversationId,
    sourceWidth: input.sourceWidth ?? 0,
    sourceHeight: input.sourceHeight ?? 0,
    fabricJson: "{\"objects\":[]}",
    objects: [],
    promptText: "",
    promptTokens: [],
    status: "draft",
    legacy: false,
    nextSequence: { point: 1, rect: 1, mask: 1, arrow: 1, note: 1 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
