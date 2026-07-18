import { Download, PencilLine, Sparkles } from "lucide-react";
import type { AssetRecord } from "../types";
import { assetSrc } from "../lib/bridge";
import { useI18n } from "../i18n";

interface PreviewStageProps {
  asset?: AssetRecord;
  busy: boolean;
  onAnnotate: () => void;
  onExport: () => void;
}

export function PreviewStage({ asset, busy, onAnnotate, onExport }: PreviewStageProps) {
  const { t } = useI18n();
  return (
    <main className="preview-stage">
      <div className="stage-topline">
        <span>{asset ? (asset.kind === "edited" ? t("legacy.revisedProof") : t("legacy.generatedProof")) : t("legacy.preview")}</span>
        {asset && <code>{asset.id.slice(0, 8)}</code>}
      </div>
      <div className={`proof-area ${asset ? "has-image" : ""}`}>
        {busy ? (
          <div className="loading-state">
            <span className="loading-mark"><Sparkles size={24} /></span>
            <strong>{t("legacy.creatingProof")}</strong>
            <p>{t("legacy.highResWait")}</p>
          </div>
        ) : asset ? (
          <div className="proof-frame">
            <i className="proof-corner top-left" /><i className="proof-corner top-right" />
            <i className="proof-corner bottom-left" /><i className="proof-corner bottom-right" />
            <img src={assetSrc(asset)} alt={asset.prompt || t("workspace.generatedImage")} />
          </div>
        ) : (
          <div className="empty-proof">
            <span className="empty-monogram">I²</span>
            <strong>{t("legacy.firstProof")}</strong>
            <p>{t("legacy.firstProofDescription")}</p>
          </div>
        )}
      </div>
      {asset && (
        <div className="stage-actions">
          <button className="button secondary" type="button" onClick={onExport}><Download size={16} />{t("common.download")}</button>
          <button className="button primary" type="button" onClick={onAnnotate}><PencilLine size={16} />{t("legacy.annotationEdit")}</button>
        </div>
      )}
    </main>
  );
}
