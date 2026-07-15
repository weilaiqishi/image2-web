import {
  AlertCircle,
  ArrowUpRight,
  Circle,
  Download,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Redo2,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Canvas as FabricCanvas,
  Ellipse,
  FabricImage,
  Group,
  IText,
  Line,
  Triangle,
  type TPointerEvent,
} from "fabric";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bridge, errorMessage } from "../lib/bridge";
import type { AssetRecord } from "../types";

export interface AnnotationSubmission {
  documentJson: string;
  annotatedDataUrl: string;
  instruction: string;
}

interface AnnotationEditorProps {
  asset: AssetRecord;
  onSubmit: (input: AnnotationSubmission) => Promise<void> | void;
  onExport: () => void;
  onDirty?: () => void;
}

type Tool = "select" | "ellipse" | "arrow" | "text";

type DrawingGesture = {
  tool: "ellipse" | "arrow";
  startX: number;
  startY: number;
  ellipse?: Ellipse;
  line?: Line;
  head?: Triangle;
};

const annotationColors = ["#d64536", "#2455c3", "#181a18", "#ffffff"];

export function AnnotationEditor({ asset, onSubmit, onExport, onDirty }: AnnotationEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const naturalSizeRef = useRef({ width: 1024, height: 1024 });
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const restoringRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const toolRef = useRef<Tool>("select");
  const colorRef = useRef(annotationColors[0]);
  const drawingRef = useRef<DrawingGesture | null>(null);
  const [stageSize, setStageSize] = useState({ width: 720, height: 720 });
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(annotationColors[0]);
  const [zoom, setZoom] = useState(1);
  const [annotationPrompt, setAnnotationPrompt] = useState("按箭头和文字标注修改画面");
  const [editorError, setEditorError] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const [, setHistoryVersion] = useState(0);

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
    const isDrawing = tool === "ellipse" || tool === "arrow";
    canvas.selection = !isDrawing;
    canvas.skipTargetFind = isDrawing;
    canvas.defaultCursor = isDrawing ? "crosshair" : "default";
    canvas.hoverCursor = isDrawing ? "crosshair" : "move";
    canvas.requestRenderAll();
  }, [color, tool]);

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
    };
    image.onerror = () => setEditorError("无法载入待标注图片");
    image.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl]);

  const persist = useCallback((canvas: FabricCanvas) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void bridge.saveAnnotation(asset.id, JSON.stringify(canvas.toJSON())).catch(() => undefined);
    }, 400);
  }, [asset.id]);

  const pushHistory = useCallback((canvas: FabricCanvas) => {
    if (restoringRef.current) return;
    const snapshot = JSON.stringify(canvas.toJSON());
    if (historyRef.current[historyIndexRef.current] === snapshot) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion((version) => version + 1);
    persist(canvas);
    onDirty?.();
  }, [onDirty, persist]);

  useLayoutEffect(() => {
    const element = canvasElementRef.current;
    if (!element || !imageUrl) return;
    const startsInDrawingMode = toolRef.current === "ellipse" || toolRef.current === "arrow";
    const canvas = new FabricCanvas(element, {
      width: stageSize.width,
      height: stageSize.height,
      enableRetinaScaling: false,
      preserveObjectStacking: true,
      selection: !startsInDrawingMode,
      skipTargetFind: startsInDrawingMode,
      defaultCursor: startsInDrawingMode ? "crosshair" : "default",
      hoverCursor: startsInDrawingMode ? "crosshair" : "move",
      selectionColor: "rgba(36, 85, 195, 0.08)",
      selectionBorderColor: "#2455c3",
      selectionLineWidth: 1,
    });
    fabricRef.current = canvas;
    let disposed = false;

    const pointFromEvent = (event: { e: TPointerEvent }) => canvas.getScenePoint(event.e);

    const startDrawing = (event: { e: TPointerEvent }) => {
      const drawingTool = toolRef.current;
      if (drawingTool !== "ellipse" && drawingTool !== "arrow") return;
      const point = pointFromEvent(event);
      canvas.discardActiveObject();

      if (drawingTool === "ellipse") {
        const ellipse = new Ellipse({
          left: point.x,
          top: point.y,
          rx: 0,
          ry: 0,
          fill: "transparent",
          stroke: colorRef.current,
          strokeWidth: 5,
          selectable: false,
          evented: false,
        });
        canvas.add(ellipse);
        drawingRef.current = { tool: drawingTool, startX: point.x, startY: point.y, ellipse };
      } else {
        const line = new Line([point.x, point.y, point.x, point.y], {
          stroke: colorRef.current,
          strokeWidth: 5,
          selectable: false,
          evented: false,
        });
        const head = new Triangle({
          left: point.x,
          top: point.y,
          width: 20,
          height: 24,
          fill: colorRef.current,
          originX: "center",
          originY: "center",
          selectable: false,
          evented: false,
        });
        canvas.add(line, head);
        drawingRef.current = { tool: drawingTool, startX: point.x, startY: point.y, line, head };
      }
      canvas.requestRenderAll();
    };

    const continueDrawing = (event: { e: TPointerEvent }) => {
      const gesture = drawingRef.current;
      if (!gesture) return;
      const point = pointFromEvent(event);

      if (gesture.tool === "ellipse" && gesture.ellipse) {
        gesture.ellipse.set({
          left: Math.min(gesture.startX, point.x),
          top: Math.min(gesture.startY, point.y),
          rx: Math.abs(point.x - gesture.startX) / 2,
          ry: Math.abs(point.y - gesture.startY) / 2,
        });
        gesture.ellipse.setCoords();
      } else if (gesture.line && gesture.head) {
        const angle = Math.atan2(point.y - gesture.startY, point.x - gesture.startX) * 180 / Math.PI;
        gesture.line.set({ x2: point.x, y2: point.y });
        gesture.head.set({ left: point.x, top: point.y, angle: angle + 90 });
        gesture.line.setCoords();
        gesture.head.setCoords();
      }
      canvas.requestRenderAll();
    };

    const finishDrawing = (event: { e: TPointerEvent }) => {
      const gesture = drawingRef.current;
      if (!gesture) return;
      continueDrawing(event);
      drawingRef.current = null;

      const point = pointFromEvent(event);
      const distance = Math.hypot(point.x - gesture.startX, point.y - gesture.startY);
      let completed: Ellipse | Group | undefined;

      if (distance >= 8 && gesture.tool === "ellipse" && gesture.ellipse) {
        gesture.ellipse.set({ selectable: true, evented: true });
        completed = gesture.ellipse;
      } else if (distance >= 8 && gesture.line && gesture.head) {
        canvas.remove(gesture.line, gesture.head);
        completed = new Group([gesture.line, gesture.head], { selectable: true, evented: true });
        canvas.add(completed);
      } else {
        if (gesture.ellipse) canvas.remove(gesture.ellipse);
        if (gesture.line) canvas.remove(gesture.line);
        if (gesture.head) canvas.remove(gesture.head);
      }

      if (completed) {
        canvas.setActiveObject(completed);
        pushHistory(canvas);
      }
      setTool("select");
      canvas.requestRenderAll();
    };

    const initialize = async () => {
      const saved = await bridge.loadAnnotation(asset.id).catch(() => null);
      if (disposed) return;
      if (saved?.json) {
        restoringRef.current = true;
        const document = JSON.parse(saved.json) as { objects?: Array<Record<string, unknown>> };
        if (document.objects?.[0]) document.objects[0].src = imageUrl;
        await canvas.loadFromJSON(document);
        const objects = canvas.getObjects();
        const background = objects[0];
        if (background) {
          const oldWidth = Math.max(1, background.getScaledWidth());
          const oldHeight = Math.max(1, background.getScaledHeight());
          const scaleX = stageSize.width / oldWidth;
          const scaleY = stageSize.height / oldHeight;
          const source = (background as FabricImage).getElement?.() as HTMLImageElement | undefined;
          const sourceWidth = source?.naturalWidth || background.width || stageSize.width;
          const sourceHeight = source?.naturalHeight || background.height || stageSize.height;
          objects.slice(1).forEach((object) => {
            object.set({
              left: object.left * scaleX,
              top: object.top * scaleY,
              scaleX: object.scaleX * scaleX,
              scaleY: object.scaleY * scaleY,
            });
            object.setCoords();
          });
          background.set({
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
            width: sourceWidth,
            height: sourceHeight,
            scaleX: stageSize.width / sourceWidth,
            scaleY: stageSize.height / sourceHeight,
            selectable: false,
            evented: false,
          });
          background.setCoords();
        }
        restoringRef.current = false;
      } else {
        const image = await FabricImage.fromURL(imageUrl);
        if (disposed) return;
        const source = image.getElement() as HTMLImageElement;
        const sourceWidth = source.naturalWidth || image.width || stageSize.width;
        const sourceHeight = source.naturalHeight || image.height || stageSize.height;
        image.set({
          left: 0,
          top: 0,
          originX: "left",
          originY: "top",
          width: sourceWidth,
          height: sourceHeight,
          scaleX: stageSize.width / sourceWidth,
          scaleY: stageSize.height / sourceHeight,
          selectable: false,
          evented: false,
        });
        canvas.add(image);
        canvas.sendObjectToBack(image);
      }
      canvas.requestRenderAll();
      const initial = JSON.stringify(canvas.toJSON());
      historyRef.current = [initial];
      historyIndexRef.current = 0;
      setHistoryVersion((version) => version + 1);
      setEditorError("");
    };

    const modified = () => pushHistory(canvas);
    canvas.on("object:modified", modified);
    canvas.on("mouse:down", startDrawing);
    canvas.on("mouse:move", continueDrawing);
    canvas.on("mouse:up", finishDrawing);
    void initialize().catch((error) => setEditorError(errorMessage(error)));

    return () => {
      disposed = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      canvas.off("object:modified", modified);
      canvas.off("mouse:down", startDrawing);
      canvas.off("mouse:move", continueDrawing);
      canvas.off("mouse:up", finishDrawing);
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [asset.id, imageUrl, pushHistory, stageSize.height, stageSize.width]);

  const addText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const text = new IText("修改说明", {
      left: stageSize.width * 0.3,
      top: stageSize.height * 0.72,
      fontFamily: "Instrument Sans",
      fontSize: Math.max(20, stageSize.width * 0.035),
      fontWeight: 650,
      fill: color,
      backgroundColor: color === "#ffffff" ? "rgba(24,26,24,.7)" : "rgba(255,255,255,.88)",
      padding: 6,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    canvas.requestRenderAll();
    pushHistory(canvas);
    setTool("select");
  };

  useEffect(() => {
    if (tool === "text") addText();
    // The action tools intentionally reset to selection after inserting an object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  const restoreAt = async (index: number) => {
    const canvas = fabricRef.current;
    const snapshot = historyRef.current[index];
    if (!canvas || !snapshot) return;
    restoringRef.current = true;
    await canvas.loadFromJSON(snapshot);
    canvas.getObjects()[0]?.set({ selectable: false, evented: false });
    historyIndexRef.current = index;
    restoringRef.current = false;
    setHistoryVersion((version) => version + 1);
    canvas.requestRenderAll();
    persist(canvas);
  };

  const deleteSelection = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const selected = canvas.getActiveObjects().filter((object) => object.selectable !== false);
    selected.forEach((object) => canvas.remove(object));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    if (selected.length) pushHistory(canvas);
  }, [pushHistory]);

  useEffect(() => {
    const deleteWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input, textarea") || target.isContentEditable)) return;

      const canvas = fabricRef.current;
      const activeObject = canvas?.getActiveObject();
      if (!canvas || (activeObject instanceof IText && activeObject.isEditing)) return;
      if (!canvas.getActiveObjects().some((object) => object.selectable !== false)) return;

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener("keydown", deleteWithKeyboard);
    return () => window.removeEventListener("keydown", deleteWithKeyboard);
  }, [deleteSelection]);

  const changeZoom = (next: number) => setZoom(Math.min(1.75, Math.max(0.5, next)));

  const submit = async () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const annotations = canvas.getObjects().filter((object) => object.selectable !== false);
    if (!annotations.length) {
      setEditorError("请先添加圈选、箭头或文字标注");
      return;
    }
    setEditorError("");
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    const multiplier = Math.max(1, naturalSizeRef.current.width / stageSize.width);
    const annotatedDataUrl = canvas.toDataURL({ format: "png", multiplier });
    const documentJson = JSON.stringify(canvas.toJSON());
    await onSubmit({
      documentJson,
      annotatedDataUrl,
      instruction: annotationPrompt,
    });
  };

  return (
    <div className="annotation-workspace">
      <aside className="annotation-toolbar" aria-label="标注工具">
        <ToolButton active={tool === "select"} label="选择" onClick={() => setTool("select")}><MousePointer2 size={18} /></ToolButton>
        <span className="tool-divider" />
        <ToolButton active={tool === "ellipse"} drawing label="圈选" onClick={() => setTool("ellipse")}><Circle size={18} /></ToolButton>
        <ToolButton active={tool === "arrow"} drawing label="箭头" onClick={() => setTool("arrow")}><ArrowUpRight size={18} /></ToolButton>
        <ToolButton label="文字" onClick={() => setTool("text")}><Type size={18} /></ToolButton>
        <span className="tool-divider" />
        <ToolButton label="撤销" disabled={historyIndexRef.current <= 0} onClick={() => void restoreAt(historyIndexRef.current - 1)}><Undo2 size={18} /></ToolButton>
        <ToolButton label="重做" disabled={historyIndexRef.current >= historyRef.current.length - 1} onClick={() => void restoreAt(historyIndexRef.current + 1)}><Redo2 size={18} /></ToolButton>
        <ToolButton label="删除" onClick={deleteSelection}><Trash2 size={18} /></ToolButton>
      </aside>

      <main className="annotation-stage" ref={hostRef}>
        <div className="annotation-topline"><span>固定图片标注</span><code>{Math.round(zoom * 100)}%</code></div>
        {!imageUrl && <div className={`annotation-image-state ${imageError ? "error" : ""}`}>{imageError ? <><AlertCircle size={22} /><strong>图片载入失败</strong><span>{imageError}</span></> : <><LoaderCircle className="spin" size={22} /><span>正在载入原图</span></>}</div>}
        <div className="fabric-viewport" hidden={!imageUrl} style={{ transform: `scale(${zoom})`, width: stageSize.width, height: stageSize.height }}>
          <canvas ref={canvasElementRef} />
        </div>
        <div className="zoom-controls">
          <button type="button" onClick={() => changeZoom(zoom - 0.1)} aria-label="缩小" title="缩小"><ZoomOut size={16} /></button>
          <button type="button" onClick={() => changeZoom(1)} aria-label="适应窗口" title="适应窗口"><Maximize2 size={16} /></button>
          <button type="button" onClick={() => changeZoom(zoom + 0.1)} aria-label="放大" title="放大"><ZoomIn size={16} /></button>
        </div>
      </main>

      <aside className="annotation-inspector">
        <div><span className="eyebrow">Cowart 式反馈</span><h2>描述修改</h2></div>
        <p className="inspector-copy">用圈选确定区域、箭头说明位置，再用文字说清结果。原图会一直保留。</p>
        <label className="field-label">标注颜色</label>
        <div className="color-swatches">
          {annotationColors.map((value) => (
            <button
              key={value}
              type="button"
              className={color === value ? "selected" : ""}
              style={{ "--swatch": value } as React.CSSProperties}
              onClick={() => setColor(value)}
              aria-label={`选择颜色 ${value}`}
              title={value}
            />
          ))}
        </div>
        <label className="field-label" htmlFor="annotation-prompt">修改要求</label>
        <textarea id="annotation-prompt" className="annotation-prompt" value={annotationPrompt} onChange={(event) => setAnnotationPrompt(event.target.value)} />
        {editorError && <p className="inline-error">{editorError}</p>}
        <div className="annotation-actions">
          <button className="button secondary" type="button" onClick={onExport}><Download size={16} />导出原图</button>
          <button className="generate-button" type="button" disabled={!annotationPrompt.trim()} onClick={() => void submit()}>
            <Sparkles size={18} />添加到对话
          </button>
        </div>
      </aside>
    </div>
  );
}

function ToolButton({ active, drawing, label, disabled, onClick, children }: { active?: boolean; drawing?: boolean; label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={active ? drawing ? "active drawing" : "active" : ""} type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label}>{children}</button>;
}
