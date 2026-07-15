import {
  AlertCircle,
  ArrowUpRight,
  Brush,
  Download,
  Hand,
  LoaderCircle,
  MapPin,
  Maximize2,
  MousePointer2,
  Redo2,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Canvas as FabricCanvas,
  Circle,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Line,
  PencilBrush,
  Rect,
  Triangle,
  type TPointerEvent,
} from "fabric";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { annotationTokensForPrompt, appendAnnotationObject, createAnnotationDocument, missingAnnotationReferences, removeAnnotationObjects, updateAnnotationObject } from "../lib/annotationModel";
import { bridge, errorMessage } from "../lib/bridge";
import type { AnnotationDocumentV2, AnnotationObjectKind, AnnotationObjectRecord, AssetRecord, NormalizedGeometry } from "../types";
import { StructuredComposer } from "./StructuredComposer";

FabricObject.customProperties = ["annotationId", "annotationKind", "displayName"];

export interface AnnotationSubmission {
  document: AnnotationDocumentV2;
  annotatedDataUrl: string;
}

interface AnnotationEditorProps {
  asset: AssetRecord;
  conversationId: string;
  documentId: string;
  initialDocument?: AnnotationDocumentV2;
  onSubmit: (input: AnnotationSubmission) => Promise<void> | void;
  onExport: () => void;
  onDirty?: () => void;
  onDocumentChange?: (document: AnnotationDocumentV2) => void;
}

type Tool = "select" | "pan" | "point" | "rect" | "mask" | "arrow" | "note";
type AnnotatedFabricObject = FabricObject & { annotationId?: string; annotationKind?: AnnotationObjectKind; displayName?: string };

type DrawingGesture = {
  tool: "rect" | "arrow";
  startX: number;
  startY: number;
  rect?: Rect;
  line?: Line;
  head?: Triangle;
};

interface EditorSnapshot {
  fabricJson: string;
  document: AnnotationDocumentV2;
}

const annotationColors = ["#D64536", "#2455C3", "#181A18", "#FFFFFF"];

function fabricJson(canvas: FabricCanvas) {
  return JSON.stringify(canvas.toJSON());
}

function point(event: { e: TPointerEvent }, canvas: FabricCanvas) {
  return canvas.getScenePoint(event.e);
}

function normalizedPoint(x: number, y: number, width: number, height: number) {
  return { x: x / Math.max(1, width), y: y / Math.max(1, height) };
}

function bindObject(object: AnnotatedFabricObject, record: AnnotationObjectRecord) {
  object.annotationId = record.id;
  object.annotationKind = record.kind;
  object.displayName = record.displayName;
  return object;
}

function label(text: string, color: string, left = 0, top = 0) {
  return new IText(text, {
    left,
    top,
    fontFamily: "Instrument Sans",
    fontSize: 13,
    fontWeight: 700,
    fill: "#FFFFFF",
    backgroundColor: color,
    padding: 4,
    selectable: false,
    evented: false,
  });
}

function canvasLabel(text: string, color: string, left: number, top: number, width: number, height: number) {
  const visual = label(text, color, left, top);
  visual.set({
    left: Math.min(Math.max(4, left), Math.max(4, width - visual.getScaledWidth() - 4)),
    top: Math.min(Math.max(4, top), Math.max(4, height - visual.getScaledHeight() - 4)),
  });
  return visual;
}

function recordGeometry(record: AnnotationObjectRecord, object: FabricObject, width: number, height: number): NormalizedGeometry {
  const bounds = object.getBoundingRect();
  if (record.kind === "point") {
    return { kind: "point", ...normalizedPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, width, height), radius: Math.max(bounds.width, bounds.height) / Math.max(width, height) / 2 };
  }
  if (record.kind === "rect") {
    return { kind: "rect", ...normalizedPoint(bounds.left, bounds.top, width, height), width: bounds.width / width, height: bounds.height / height };
  }
  if (record.kind === "mask") {
    const previous = record.geometry.kind === "mask" ? record.geometry : { kind: "mask" as const, points: [], brushWidth: 0.02 };
    const old = previous.points.length ? previous.points : [{ x: bounds.left / width, y: bounds.top / height }];
    const minX = Math.min(...old.map((item) => item.x));
    const minY = Math.min(...old.map((item) => item.y));
    const spanX = Math.max(0.001, Math.max(...old.map((item) => item.x)) - minX);
    const spanY = Math.max(0.001, Math.max(...old.map((item) => item.y)) - minY);
    return {
      kind: "mask",
      points: old.map((item) => ({ x: bounds.left / width + ((item.x - minX) / spanX) * bounds.width / width, y: bounds.top / height + ((item.y - minY) / spanY) * bounds.height / height })),
      brushWidth: previous.brushWidth * Math.max(object.scaleX, object.scaleY),
    };
  }
  if (record.kind === "arrow") {
    const previous = record.geometry.kind === "arrow" ? record.geometry : { kind: "arrow" as const, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    const leftToRight = previous.to.x >= previous.from.x;
    const topToBottom = previous.to.y >= previous.from.y;
    return {
      kind: "arrow",
      from: { x: (leftToRight ? bounds.left : bounds.left + bounds.width) / width, y: (topToBottom ? bounds.top : bounds.top + bounds.height) / height },
      to: { x: (leftToRight ? bounds.left + bounds.width : bounds.left) / width, y: (topToBottom ? bounds.top + bounds.height : bounds.top) / height },
    };
  }
  return { kind: "note", ...normalizedPoint(bounds.left, bounds.top, width, height), width: bounds.width / width, height: bounds.height / height };
}

export function AnnotationEditor({ asset, conversationId, documentId, initialDocument, onSubmit, onExport, onDirty, onDocumentChange }: AnnotationEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const naturalSizeRef = useRef({ width: 1024, height: 1024 });
  const historyRef = useRef<EditorSnapshot[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const toolRef = useRef<Tool>("select");
  const colorRef = useRef(annotationColors[0]);
  const drawingRef = useRef<DrawingGesture | null>(null);
  const brushPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const documentRef = useRef(initialDocument ?? createAnnotationDocument({ id: documentId, sourceAssetId: asset.id, conversationId }));
  const onDocumentChangeRef = useRef(onDocumentChange);
  const onDirtyRef = useRef(onDirty);
  const panGestureRef = useRef<{ x: number; y: number; panX: number; panY: number } | undefined>(undefined);
  const panRef = useRef({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState({ width: 720, height: 720 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(annotationColors[0]);
  const [brushSize, setBrushSize] = useState(1.8);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [document, setDocument] = useState(documentRef.current);
  const [selectedObjectId, setSelectedObjectId] = useState<string>();
  const [editorError, setEditorError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [, setHistoryVersion] = useState(0);

  useEffect(() => { onDocumentChangeRef.current = onDocumentChange; }, [onDocumentChange]);
  useEffect(() => { onDirtyRef.current = onDirty; }, [onDirty]);

  const setCurrentDocument = useCallback((next: AnnotationDocumentV2) => {
    documentRef.current = next;
    setDocument(next);
    onDocumentChangeRef.current?.(next);
  }, []);

  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => {
    let cancelled = false;
    setImageUrl("");
    setImageError("");
    void bridge.readAssetDataUrl(asset.id).then((dataUrl) => {
      if (!cancelled) setImageUrl(dataUrl);
    }).catch((error) => {
      if (!cancelled) setImageError(errorMessage(error));
    });
    return () => { cancelled = true; };
  }, [asset.id]);

  useEffect(() => {
    toolRef.current = tool;
    colorRef.current = color;
    const canvas = fabricRef.current;
    if (!canvas) return;
    const drawing = tool === "point" || tool === "rect" || tool === "arrow";
    canvas.isDrawingMode = tool === "mask";
    if (canvas.isDrawingMode) {
      const brush = new PencilBrush(canvas);
      brush.color = color;
      brush.width = Math.max(3, stageSize.width * brushSize / 100);
      canvas.freeDrawingBrush = brush;
    }
    canvas.selection = tool === "select";
    canvas.skipTargetFind = drawing || tool === "mask" || tool === "pan";
    canvas.defaultCursor = tool === "pan" ? "grab" : drawing || tool === "mask" ? "crosshair" : "default";
    canvas.hoverCursor = tool === "pan" ? "grab" : drawing || tool === "mask" ? "crosshair" : "move";
    canvas.requestRenderAll();
  }, [brushSize, color, stageSize.width, tool]);

  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      naturalSizeRef.current = { width: image.naturalWidth, height: image.naturalHeight };
      const host = hostRef.current;
      if (!host) return;
      const availableWidth = Math.max(360, host.clientWidth - 72);
      const availableHeight = Math.max(320, host.clientHeight - 72);
      const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight, 1);
      setStageSize({ width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) });
      const next = { ...documentRef.current, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight };
      setCurrentDocument(next);
    };
    image.onerror = () => setEditorError("无法载入待标注图片");
    image.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, setCurrentDocument]);

  const persist = useCallback((canvas: FabricCanvas, next: AnnotationDocumentV2) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const saved = { ...next, fabricJson: fabricJson(canvas), promptTokens: annotationTokensForPrompt(next.promptText, next.objects), updatedAt: new Date().toISOString() };
      setCurrentDocument(saved);
      void bridge.saveAnnotation(saved.id, saved.sourceAssetId, JSON.stringify(saved)).catch(() => undefined);
    }, 350);
  }, [setCurrentDocument]);

  const pushHistory = useCallback((canvas: FabricCanvas, next = documentRef.current) => {
    if (restoringRef.current) return;
    const saved = { ...next, fabricJson: fabricJson(canvas), promptTokens: annotationTokensForPrompt(next.promptText, next.objects), updatedAt: new Date().toISOString() };
    const snapshot = { fabricJson: saved.fabricJson, document: saved };
    if (historyRef.current[historyIndexRef.current]?.fabricJson === snapshot.fabricJson && historyRef.current[historyIndexRef.current]?.document.promptText === snapshot.document.promptText) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;
    setCurrentDocument(saved);
    setHistoryVersion((version) => version + 1);
    persist(canvas, saved);
    onDirtyRef.current?.();
  }, [persist, setCurrentDocument]);

  useLayoutEffect(() => {
    const element = canvasElementRef.current;
    if (!element || !imageUrl) return;
    const canvas = new FabricCanvas(element, {
      width: stageSize.width,
      height: stageSize.height,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selectionColor: "rgba(36, 85, 195, 0.08)",
      selectionBorderColor: "#2455C3",
      selectionLineWidth: 1,
    });
    fabricRef.current = canvas;
    let disposed = false;

    const addRecordVisual = (record: AnnotationObjectRecord, visual: FabricObject) => {
      bindObject(visual as AnnotatedFabricObject, record);
      canvas.add(visual);
      canvas.setActiveObject(visual);
      const next = documentRef.current.objects.some((object) => object.id === record.id)
        ? documentRef.current
        : { ...documentRef.current, objects: [...documentRef.current.objects, record], updatedAt: record.updatedAt };
      setCurrentDocument(next);
      pushHistory(canvas, next);
    };

    const startDrawing = (event: { e: TPointerEvent }) => {
      const activeTool = toolRef.current;
      const scene = point(event, canvas);
      if (activeTool === "pan") {
        const pointer = event.e as PointerEvent;
        panGestureRef.current = { x: pointer.clientX, y: pointer.clientY, panX: panRef.current.x, panY: panRef.current.y };
        return;
      }
      if (activeTool === "mask") {
        brushPointsRef.current = [normalizedPoint(scene.x, scene.y, stageSize.width, stageSize.height)];
        return;
      }
      if (activeTool === "point") {
        const anchor = { x: Math.min(stageSize.width - 10, Math.max(10, scene.x)), y: Math.min(stageSize.height - 10, Math.max(10, scene.y)) };
        const appended = appendAnnotationObject(documentRef.current, "point", { kind: "point", ...normalizedPoint(anchor.x, anchor.y, stageSize.width, stageSize.height), radius: 0.012 }, colorRef.current);
        documentRef.current = appended.document;
        const dot = new Circle({ radius: 9, fill: colorRef.current, stroke: "#FFFFFF", strokeWidth: 2, originX: "center", originY: "center" });
        const text = label(appended.object.displayName, colorRef.current, anchor.x > stageSize.width - 110 ? -92 : 13, anchor.y < 24 ? 2 : -11);
        const group = new Group([dot, text], { left: anchor.x, top: anchor.y, selectable: true, evented: true });
        addRecordVisual(appended.object, group);
        setTool("select");
        return;
      }
      if (activeTool !== "rect" && activeTool !== "arrow") return;
      canvas.discardActiveObject();
      if (activeTool === "rect") {
        const rect = new Rect({ left: scene.x, top: scene.y, width: 0, height: 0, fill: `${colorRef.current}24`, stroke: colorRef.current, strokeWidth: 3, selectable: false, evented: false });
        canvas.add(rect);
        drawingRef.current = { tool: activeTool, startX: scene.x, startY: scene.y, rect };
      } else {
        const line = new Line([scene.x, scene.y, scene.x, scene.y], { stroke: colorRef.current, strokeWidth: 4, selectable: false, evented: false });
        const head = new Triangle({ left: scene.x, top: scene.y, width: 18, height: 22, fill: colorRef.current, originX: "center", originY: "center", selectable: false, evented: false });
        canvas.add(line, head);
        drawingRef.current = { tool: activeTool, startX: scene.x, startY: scene.y, line, head };
      }
    };

    const continueDrawing = (event: { e: TPointerEvent }) => {
      const activeTool = toolRef.current;
      const scene = point(event, canvas);
      if (activeTool === "pan" && panGestureRef.current) {
        const pointer = event.e as PointerEvent;
        setPan({ x: panGestureRef.current.panX + pointer.clientX - panGestureRef.current.x, y: panGestureRef.current.panY + pointer.clientY - panGestureRef.current.y });
        return;
      }
      if (activeTool === "mask" && brushPointsRef.current.length) {
        brushPointsRef.current.push(normalizedPoint(scene.x, scene.y, stageSize.width, stageSize.height));
      }
      const gesture = drawingRef.current;
      if (!gesture) return;
      if (gesture.tool === "rect" && gesture.rect) {
        gesture.rect.set({ left: Math.min(gesture.startX, scene.x), top: Math.min(gesture.startY, scene.y), width: Math.abs(scene.x - gesture.startX), height: Math.abs(scene.y - gesture.startY) });
        gesture.rect.setCoords();
      } else if (gesture.line && gesture.head) {
        const angle = Math.atan2(scene.y - gesture.startY, scene.x - gesture.startX) * 180 / Math.PI;
        gesture.line.set({ x2: scene.x, y2: scene.y });
        gesture.head.set({ left: scene.x, top: scene.y, angle: angle + 90 });
        gesture.line.setCoords();
        gesture.head.setCoords();
      }
      canvas.requestRenderAll();
    };

    const finishDrawing = (event: { e: TPointerEvent }) => {
      if (toolRef.current === "pan") {
        panGestureRef.current = undefined;
        return;
      }
      const gesture = drawingRef.current;
      if (!gesture) return;
      continueDrawing(event);
      drawingRef.current = null;
      const scene = point(event, canvas);
      const distance = Math.hypot(scene.x - gesture.startX, scene.y - gesture.startY);
      if (distance < 8) {
        if (gesture.rect) canvas.remove(gesture.rect);
        if (gesture.line) canvas.remove(gesture.line);
        if (gesture.head) canvas.remove(gesture.head);
        return;
      }
      if (gesture.tool === "rect" && gesture.rect) {
        canvas.remove(gesture.rect);
        const geometry: NormalizedGeometry = { kind: "rect", ...normalizedPoint(Math.min(gesture.startX, scene.x), Math.min(gesture.startY, scene.y), stageSize.width, stageSize.height), width: Math.abs(scene.x - gesture.startX) / stageSize.width, height: Math.abs(scene.y - gesture.startY) / stageSize.height };
        const appended = appendAnnotationObject(documentRef.current, "rect", geometry, colorRef.current);
        documentRef.current = appended.document;
        const region = new Rect({ width: Math.abs(scene.x - gesture.startX), height: Math.abs(scene.y - gesture.startY), fill: `${colorRef.current}24`, stroke: colorRef.current, strokeWidth: 3 });
        const group = new Group([region, label(appended.object.displayName, colorRef.current, 4, 4)], { left: Math.min(gesture.startX, scene.x), top: Math.min(gesture.startY, scene.y), selectable: true, evented: true });
        addRecordVisual(appended.object, group);
      } else if (gesture.line && gesture.head) {
        canvas.remove(gesture.line, gesture.head);
        const geometry: NormalizedGeometry = { kind: "arrow", from: normalizedPoint(gesture.startX, gesture.startY, stageSize.width, stageSize.height), to: normalizedPoint(scene.x, scene.y, stageSize.width, stageSize.height) };
        const sourceObject = documentRef.current.objects
          .filter((object) => object.geometry.kind === "point")
          .map((object) => ({ object, distance: Math.hypot(object.geometry.kind === "point" ? object.geometry.x - geometry.from.x : 1, object.geometry.kind === "point" ? object.geometry.y - geometry.from.y : 1) }))
          .filter((entry) => entry.distance <= 0.06)
          .sort((left, right) => left.distance - right.distance)[0]?.object;
        const appended = appendAnnotationObject(documentRef.current, "arrow", geometry, colorRef.current, "移动到箭头终点", sourceObject?.id);
        documentRef.current = appended.document;
        const localLine = new Line([0, 0, scene.x - gesture.startX, scene.y - gesture.startY], { stroke: colorRef.current, strokeWidth: 4 });
        const angle = Math.atan2(scene.y - gesture.startY, scene.x - gesture.startX) * 180 / Math.PI;
        const head = new Triangle({ left: scene.x - gesture.startX, top: scene.y - gesture.startY, width: 18, height: 22, fill: colorRef.current, originX: "center", originY: "center", angle: angle + 90 });
        const group = new Group([localLine, head, label(appended.object.displayName, colorRef.current, 4, 6)], { left: Math.min(gesture.startX, scene.x), top: Math.min(gesture.startY, scene.y), selectable: true, evented: true });
        addRecordVisual(appended.object, group);
      }
      setTool("select");
      canvas.requestRenderAll();
    };

    const pathCreated = (event: { path?: FabricObject }) => {
      if (!event.path || !brushPointsRef.current.length) return;
      const appended = appendAnnotationObject(documentRef.current, "mask", { kind: "mask", points: brushPointsRef.current, brushWidth: Math.max(3, stageSize.width * brushSize / 100) / stageSize.width }, colorRef.current);
      documentRef.current = appended.document;
      const path = event.path;
      const bounds = path.getBoundingRect();
      canvas.remove(path);
      const group = new Group([path, canvasLabel(appended.object.displayName, colorRef.current, bounds.left + 4, bounds.top + 4, stageSize.width, stageSize.height)], { selectable: true, evented: true });
      bindObject(group as AnnotatedFabricObject, appended.object);
      canvas.add(group);
      canvas.setActiveObject(group);
      const next = appended.document;
      setCurrentDocument(next);
      pushHistory(canvas, next);
      brushPointsRef.current = [];
      setTool("select");
    };

    const modified = (event: { target?: FabricObject }) => {
      const target = event.target as AnnotatedFabricObject | undefined;
      const record = documentRef.current.objects.find((object) => object.id === target?.annotationId);
      if (!target || !record) return;
      const next = updateAnnotationObject(documentRef.current, record.id, { geometry: recordGeometry(record, target, stageSize.width, stageSize.height), note: target instanceof IText ? target.text : record.note });
      pushHistory(canvas, next);
    };
    const selected = (event: { selected?: FabricObject[] }) => setSelectedObjectId((event.selected?.[0] as AnnotatedFabricObject | undefined)?.annotationId);

    const initialize = async () => {
      const savedDocument = initialDocument ?? await bridge.loadAnnotation(documentId).then((stored) => stored ? JSON.parse(stored.json) as AnnotationDocumentV2 : undefined).catch(() => undefined);
      if (disposed) return;
      if (savedDocument) setCurrentDocument(savedDocument);
      const activeDocument = savedDocument ?? documentRef.current;
      if (activeDocument.fabricJson && JSON.parse(activeDocument.fabricJson).objects?.length) {
        restoringRef.current = true;
        const serialized = JSON.parse(activeDocument.fabricJson) as { objects?: Array<Record<string, unknown>> };
        if (serialized.objects?.[0]) serialized.objects[0].src = imageUrl;
        await canvas.loadFromJSON(serialized);
        const objects = canvas.getObjects();
        const background = objects[0];
        if (background) {
          const oldWidth = Math.max(1, background.getScaledWidth());
          const oldHeight = Math.max(1, background.getScaledHeight());
          const scaleX = stageSize.width / oldWidth;
          const scaleY = stageSize.height / oldHeight;
          objects.slice(1).forEach((object) => {
            object.set({ left: object.left * scaleX, top: object.top * scaleY, scaleX: object.scaleX * scaleX, scaleY: object.scaleY * scaleY });
            object.setCoords();
          });
          const source = (background as FabricImage).getElement?.() as HTMLImageElement | undefined;
          const sourceWidth = source?.naturalWidth || background.width || stageSize.width;
          const sourceHeight = source?.naturalHeight || background.height || stageSize.height;
          background.set({ left: 0, top: 0, originX: "left", originY: "top", width: sourceWidth, height: sourceHeight, scaleX: stageSize.width / sourceWidth, scaleY: stageSize.height / sourceHeight, selectable: false, evented: false });
        }
        restoringRef.current = false;
      } else {
        const image = await FabricImage.fromURL(imageUrl);
        if (disposed) return;
        const source = image.getElement() as HTMLImageElement;
        const sourceWidth = source.naturalWidth || image.width || stageSize.width;
        const sourceHeight = source.naturalHeight || image.height || stageSize.height;
        image.set({ left: 0, top: 0, originX: "left", originY: "top", width: sourceWidth, height: sourceHeight, scaleX: stageSize.width / sourceWidth, scaleY: stageSize.height / sourceHeight, selectable: false, evented: false });
        canvas.add(image);
        canvas.sendObjectToBack(image);
      }
      canvas.requestRenderAll();
      const initial = { fabricJson: fabricJson(canvas), document: { ...activeDocument, fabricJson: fabricJson(canvas) } };
      historyRef.current = [initial];
      historyIndexRef.current = 0;
      setHistoryVersion((version) => version + 1);
      setEditorError("");
    };

    canvas.on("mouse:down", startDrawing);
    canvas.on("mouse:move", continueDrawing);
    canvas.on("mouse:up", finishDrawing);
    canvas.on("path:created", pathCreated);
    canvas.on("object:modified", modified);
    canvas.on("selection:created", selected);
    canvas.on("selection:updated", selected);
    canvas.on("selection:cleared", () => setSelectedObjectId(undefined));
    void initialize().catch((error) => setEditorError(errorMessage(error)));

    return () => {
      disposed = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [documentId, imageUrl, initialDocument, pushHistory, setCurrentDocument, stageSize.height, stageSize.width]);

  const addNote = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const geometry: NormalizedGeometry = { kind: "note", x: 0.3, y: 0.72, width: 0.3, height: 0.08 };
    const appended = appendAnnotationObject(documentRef.current, "note", geometry, color, "修改说明");
    documentRef.current = appended.document;
    const text = new IText(`${appended.object.displayName} 修改说明`, {
      left: stageSize.width * 0.3,
      top: stageSize.height * 0.72,
      fontFamily: "Instrument Sans",
      fontSize: Math.max(18, stageSize.width * 0.026),
      fontWeight: 650,
      fill: color,
      backgroundColor: color === "#FFFFFF" ? "rgba(24,26,24,.78)" : "rgba(255,255,255,.9)",
      padding: 6,
    });
    bindObject(text as AnnotatedFabricObject, appended.object);
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    pushHistory(canvas, appended.document);
    setTool("select");
  };

  useEffect(() => {
    if (tool === "note") addNote();
    // Note is an action tool and immediately returns to selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const restoreAt = async (index: number) => {
    const canvas = fabricRef.current;
    const snapshot = historyRef.current[index];
    if (!canvas || !snapshot) return;
    restoringRef.current = true;
    await canvas.loadFromJSON(snapshot.fabricJson);
    canvas.getObjects()[0]?.set({ selectable: false, evented: false });
    historyIndexRef.current = index;
    setCurrentDocument(snapshot.document);
    restoringRef.current = false;
    setHistoryVersion((version) => version + 1);
    canvas.requestRenderAll();
    persist(canvas, snapshot.document);
  };

  const deleteSelection = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const ids = canvas.getActiveObjects().map((object) => (object as AnnotatedFabricObject).annotationId).filter((value): value is string => Boolean(value));
    if (!ids.length) return;
    canvas.getObjects().filter((object) => ids.includes((object as AnnotatedFabricObject).annotationId ?? "")).forEach((object) => canvas.remove(object));
    canvas.discardActiveObject();
    const next = removeAnnotationObjects(documentRef.current, ids);
    setSelectedObjectId(undefined);
    canvas.requestRenderAll();
    pushHistory(canvas, next);
  }, [pushHistory]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLElement && (event.target.matches("input, textarea") || event.target.isContentEditable)) return;
      if (!fabricRef.current?.getActiveObjects().length) return;
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [deleteSelection]);

  const focusObject = (objectId: string) => {
    const canvas = fabricRef.current;
    const visual = canvas?.getObjects().find((object) => (object as AnnotatedFabricObject).annotationId === objectId);
    if (!canvas || !visual) return;
    canvas.setActiveObject(visual);
    setSelectedObjectId(objectId);
    canvas.requestRenderAll();
  };

  const updatePrompt = (text: string) => {
    const next = { ...documentRef.current, promptText: text, promptTokens: annotationTokensForPrompt(text, documentRef.current.objects), updatedAt: new Date().toISOString() };
    setEditorError("");
    setCurrentDocument(next);
    setMentionOpen(/@$/.test(text));
    const canvas = fabricRef.current;
    if (canvas) persist(canvas, next);
    onDirtyRef.current?.();
  };

  const insertMention = (record: AnnotationObjectRecord) => {
    const base = document.promptText.replace(/@$/, "");
    updatePrompt(`${base}@${record.displayName} `);
    setMentionOpen(false);
    setComposerFocusRequest((value) => value + 1);
    focusObject(record.id);
  };

  const compiledColors = useMemo(() => [...new Set([...document.promptText.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((match) => match[0].toUpperCase()))], [document.promptText]);
  const missingReferences = useMemo(() => missingAnnotationReferences(document.promptText, document.objects), [document.objects, document.promptText]);

  const submit = async () => {
    const canvas = fabricRef.current;
    if (!canvas || !documentRef.current.objects.length) {
      setEditorError("请先添加 Mark、Region、Mask、箭头或备注");
      return;
    }
    if (missingReferences.length) {
      setEditorError(`提示词引用了已删除的 ${missingReferences.map((name) => `@${name}`).join("、")}`);
      return;
    }
    setEditorError("");
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const legendBackground = new Rect({ width: Math.min(stageSize.width - 16, 300), height: 28, fill: "rgba(18,22,20,.82)", rx: 3, ry: 3 });
    const legendText = new IText("编辑标注 · 编号与颜色不进入最终画面", { left: 8, top: 7, fontFamily: "Instrument Sans", fontSize: 10, fill: "#FFFFFF", selectable: false, evented: false });
    const legend = new Group([legendBackground, legendText], { left: 8, top: Math.max(8, stageSize.height - 36), selectable: false, evented: false });
    canvas.add(legend);
    canvas.requestRenderAll();
    const multiplier = Math.max(naturalSizeRef.current.width / stageSize.width, naturalSizeRef.current.height / stageSize.height, 1);
    const annotatedDataUrl = canvas.toDataURL({ format: "png", multiplier });
    canvas.remove(legend);
    canvas.requestRenderAll();
    const overlayAssetId = await bridge.saveAnnotationOverlay(documentRef.current.id, annotatedDataUrl);
    const next = {
      ...documentRef.current,
      fabricJson: fabricJson(canvas),
      promptTokens: annotationTokensForPrompt(documentRef.current.promptText, documentRef.current.objects),
      status: "attached" as const,
      overlayAssetId,
      legacyAnnotatedDataUrl: undefined,
      updatedAt: new Date().toISOString(),
    };
    setCurrentDocument(next);
    await bridge.saveAnnotation(next.id, next.sourceAssetId, JSON.stringify(next));
    await onSubmit({ document: next, annotatedDataUrl });
  };

  return <div className="annotation-workspace">
    <aside className="annotation-toolbar" aria-label="标注工具">
      <ToolButton active={tool === "select"} label="选择" onClick={() => setTool("select")}><MousePointer2 size={18} /></ToolButton>
      <ToolButton active={tool === "pan"} label="移动画布" onClick={() => setTool("pan")}><Hand size={18} /></ToolButton>
      <span className="tool-divider" />
      <ToolButton active={tool === "point"} drawing label="点选 Mark" onClick={() => setTool("point")}><MapPin size={18} /></ToolButton>
      <ToolButton active={tool === "rect"} drawing label="框选 Region" onClick={() => setTool("rect")}><SquareDashed size={18} /></ToolButton>
      <ToolButton active={tool === "mask"} drawing label="画笔 Mask" onClick={() => setTool("mask")}><Brush size={18} /></ToolButton>
      <ToolButton active={tool === "arrow"} drawing label="方向箭头" onClick={() => setTool("arrow")}><ArrowUpRight size={18} /></ToolButton>
      <ToolButton label="文字备注" onClick={() => setTool("note")}><Type size={18} /></ToolButton>
      <span className="tool-divider" />
      <ToolButton label="撤销" disabled={historyIndexRef.current <= 0} onClick={() => void restoreAt(historyIndexRef.current - 1)}><Undo2 size={18} /></ToolButton>
      <ToolButton label="重做" disabled={historyIndexRef.current >= historyRef.current.length - 1} onClick={() => void restoreAt(historyIndexRef.current + 1)}><Redo2 size={18} /></ToolButton>
      <ToolButton label="删除" onClick={deleteSelection}><Trash2 size={18} /></ToolButton>
    </aside>

    <main className="annotation-stage" ref={hostRef} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.min(2.5, Math.max(0.35, value + (event.deltaY < 0 ? 0.1 : -0.1)))); }}>
      <div className="annotation-topline"><span>原图坐标标注 · {document.objects.length} 对象</span><code>{Math.round(zoom * 100)}%</code></div>
      {!imageUrl && <div className={`annotation-image-state ${imageError ? "error" : ""}`}>{imageError ? <><AlertCircle size={22} /><strong>图片载入失败</strong><span>{imageError}</span></> : <><LoaderCircle className="spin" size={22} /><span>正在载入原图</span></>}</div>}
      <div className="fabric-viewport" hidden={!imageUrl} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: stageSize.width, height: stageSize.height }}><canvas ref={canvasElementRef} /></div>
      <div className="zoom-controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.35, value - 0.1))} aria-label="缩小" title="缩小"><ZoomOut size={16} /></button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="适应窗口" title="适应窗口"><Maximize2 size={16} /></button>
        <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))} aria-label="放大" title="放大"><ZoomIn size={16} /></button>
      </div>
    </main>

    <aside className="annotation-inspector">
      <div><span className="eyebrow">Structured Edit</span><h2>标注与指令</h2></div>
      <div className="annotation-object-list" aria-label="标注对象">
        {document.objects.map((record) => <button className={record.id === selectedObjectId ? "selected" : ""} type="button" key={record.id} onClick={() => focusObject(record.id)}><span style={{ background: record.color }} /><strong>{record.displayName}</strong><small>{record.kind}</small></button>)}
      </div>
      <label className="field-label">标注颜色</label>
      <div className="color-swatches">{annotationColors.map((value) => <button key={value} type="button" className={color === value ? "selected" : ""} style={{ "--swatch": value } as React.CSSProperties} onClick={() => setColor(value)} aria-label={`选择颜色 ${value}`} title={value} />)}</div>
      {tool === "mask" && <label className="annotation-brush-size"><span>画笔宽度</span><input type="range" min="0.5" max="5" step="0.1" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="画笔宽度" /><output>{brushSize.toFixed(1)}%</output></label>}
      <span className="field-label">修改要求</span>
      <div className="annotation-composer">
        <StructuredComposer className="annotation-prompt" value={document.promptText} knownTokens={document.objects.map((record) => `@${record.displayName}`)} activeTokens={selectedObjectId ? document.objects.filter((record) => record.id === selectedObjectId).map((record) => `@${record.displayName}`) : []} focusRequest={composerFocusRequest} onChange={updatePrompt} onTokenClick={(token) => { const record = document.objects.find((item) => `@${item.displayName}` === token); if (record) focusObject(record.id); }} placeholder="输入 @ 引用 Mark、Region 或 Move" ariaLabel="修改要求" />
        {mentionOpen && document.objects.length > 0 && <div className="mention-menu" role="listbox" aria-label="插入标注引用">{document.objects.map((record) => <button role="option" aria-selected="false" type="button" key={record.id} onClick={() => insertMention(record)}><strong>@{record.displayName}</strong><span>{record.kind}</span></button>)}</div>}
      </div>
      {compiledColors.length > 0 && <div className="annotation-color-tokens">{compiledColors.map((value) => <span key={value}><i style={{ background: value }} />{value}</span>)}</div>}
      {missingReferences.length > 0 && <button className="button secondary" type="button" onClick={() => updatePrompt(missingReferences.reduce((text, name) => text.replaceAll(`@${name}`, ""), document.promptText).replace(/ {2,}/g, " ").trim())}>删除失效引用</button>}
      {editorError && <p className="inline-error">{editorError}</p>}
      <div className="annotation-actions">
        <button className="button secondary" type="button" onClick={onExport}><Download size={16} />导出原图</button>
        <button className="generate-button" type="button" disabled={!document.promptText.trim() || !document.objects.length} onClick={() => void submit()}><Sparkles size={18} />添加到对话</button>
      </div>
    </aside>
  </div>;
}

function ToolButton({ active, drawing, label: text, disabled, onClick, children }: { active?: boolean; drawing?: boolean; label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? drawing ? "active drawing" : "active" : ""} type="button" disabled={disabled} onClick={onClick} aria-label={text} title={text}>{children}</button>;
}
