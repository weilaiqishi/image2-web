import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AnnotationAttachment, AssetRecord } from "../types";
import type { AnnotationSubmission } from "./AnnotationEditor";

const AnnotationEditor = lazy(() => import("./AnnotationEditor").then((module) => ({ default: module.AnnotationEditor })));

interface AnnotationDialogProps {
  asset: AssetRecord;
  onClose: () => void;
  onExport: () => void;
  onSubmit: (attachment: AnnotationAttachment) => void;
}

export function AnnotationDialog({ asset, onClose, onExport, onSubmit }: AnnotationDialogProps) {
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (dirtyRef.current && !window.confirm("放弃尚未提交的标注？")) return;
    onClose();
  };

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const submit = (input: AnnotationSubmission) => {
    onSubmit({
      id: crypto.randomUUID(),
      kind: "annotation",
      sourceAssetId: asset.id,
      documentJson: input.documentJson,
      annotatedDataUrl: input.annotatedDataUrl,
      instruction: input.instruction,
      createdAt: new Date().toISOString(),
    });
    setDirty(false);
    onClose();
  };

  return createPortal(
    <div className="annotation-dialog-backdrop">
      <div className="annotation-dialog" role="dialog" aria-modal="true" aria-label="标注修改">
        <header className="annotation-dialog-header">
          <div><span>标注修改</span><strong>{asset.prompt || "生成图片"}</strong></div>
          <button ref={closeButton} className="icon-button" type="button" onClick={close} aria-label="关闭标注"><X size={18} /></button>
        </header>
        <Suspense fallback={<div className="annotation-loading"><span />正在载入标注工具</div>}>
          <AnnotationEditor asset={asset} onSubmit={submit} onExport={onExport} onDirty={() => setDirty(true)} />
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}
