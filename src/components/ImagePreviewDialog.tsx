import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";

interface ImagePreviewDialogProps {
  src: string;
  title: string;
  onClose: () => void;
}

export function ImagePreviewDialog({ src, title, onClose }: ImagePreviewDialogProps) {
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
          <button ref={closeButton} type="button" onClick={onClose} aria-label="关闭预览" title="关闭"><X size={18} /></button>
        </header>
        <div className="image-preview-stage">
          <img src={src} alt={title} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
