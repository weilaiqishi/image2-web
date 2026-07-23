import { Columns2, Download, GitBranch, PencilLine } from "lucide-react";
import type { ReactNode } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  const toolbarButtons: ReactNode[] = [];

  const addAction = (key: string, label: string, icon: ReactNode, onClick?: () => void) => {
    if (!onClick) return;
    toolbarButtons.push(
      <button key={key} type="button" className="yarl__button image-preview-action" onClick={onClick} aria-label={label} title={label}>
        {icon}
      </button>,
    );
  };

  addAction("draw", t("preview.draw"), <PencilLine size={18} />, onDraw);
  addAction("continue", t("preview.continue"), <GitBranch size={18} />, onContinue);
  addAction("compare", t("preview.compare"), <Columns2 size={18} />, onCompare);
  addAction("export", t("preview.export"), <Download size={18} />, onExport);
  toolbarButtons.push("zoom", "close");

  return (
    <Lightbox
      open
      close={onClose}
      className="image-preview-lightbox"
      slides={[{ src, alt: title }]}
      plugins={[Zoom]}
      carousel={{ finite: true, imageFit: "contain", padding: 24 }}
      controller={{ closeOnBackdropClick: true }}
      zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      toolbar={{ buttons: toolbarButtons }}
      labels={{
        Lightbox: t("workspace.preview", { title }),
        Close: t("preview.close"),
        "Zoom in": t("annotation.zoomIn"),
        "Zoom out": t("annotation.zoomOut"),
      }}
      render={{
        buttonPrev: () => null,
        buttonNext: () => null,
        controls: () => <div className="image-preview-title"><strong>{title}</strong></div>,
      }}
    />
  );
}
