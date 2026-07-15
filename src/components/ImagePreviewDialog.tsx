import { Columns2, Download, GitBranch, PencilLine, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

interface ImagePreviewDialogProps {
  src: string;
  title: string;
  onClose: () => void;
  onDraw?: () => void;
  onContinue?: () => void;
  onCompare?: () => void;
  onExport?: () => void;
}

export function ImagePreviewDialog({ src, title, onClose, onDraw, onContinue, onCompare, onExport }: ImagePreviewDialogProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      returnFocus.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="image-preview-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="image-preview-dialog" role="dialog" aria-modal="true" aria-label={`预览 ${title}`}>
        <header>
          <strong>{title}</strong>
          <span className="image-preview-actions">
            {onDraw && <button type="button" onClick={onDraw} aria-label="Draw" title="Draw"><PencilLine size={17} /></button>}
            {onContinue && <button type="button" onClick={onContinue} aria-label="基于此图继续" title="基于此图继续"><GitBranch size={17} /></button>}
            {onCompare && <button type="button" onClick={onCompare} aria-label="前后对比" title="前后对比"><Columns2 size={17} /></button>}
            {onExport && <button type="button" onClick={onExport} aria-label="导出" title="导出"><Download size={17} /></button>}
            <button ref={closeButton} type="button" onClick={onClose} aria-label="关闭预览" title="关闭"><X size={18} /></button>
          </span>
        </header>
        <div className="image-preview-stage">
          <img src={src} alt={title} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
