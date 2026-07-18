import { Download, PencilLine, Trash2 } from "lucide-react";
import type { AssetRecord } from "../types";
import { assetSrc } from "../lib/bridge";
import { useI18n } from "../i18n";

interface HistoryRailProps {
  assets: AssetRecord[];
  selectedId?: string;
  onSelect: (asset: AssetRecord) => void;
  onAnnotate: (asset: AssetRecord) => void;
  onExport: (asset: AssetRecord) => void;
  onDelete: (asset: AssetRecord) => void;
}

export function HistoryRail({ assets, selectedId, onSelect, onAnnotate, onExport, onDelete }: HistoryRailProps) {
  const { localeTag, t } = useI18n();
  return (
    <aside className="history-rail">
      <div className="history-heading">
        <div><span className="eyebrow">{t("legacy.localVersions")}</span><h2>{t("legacy.history")}</h2></div>
        <span className="history-count">{assets.length}</span>
      </div>
      <div className="history-list">
        {assets.length === 0 && <p className="history-empty">{t("legacy.historyEmpty")}</p>}
        {assets.map((asset, index) => (
          <article className={`history-item ${selectedId === asset.id ? "selected" : ""}`} key={asset.id}>
            <button className="history-preview" type="button" onClick={() => onSelect(asset)} aria-label={t("legacy.viewVersion", { version: assets.length - index })}>
              <img src={assetSrc(asset)} alt={t("legacy.versionThumbnail")} />
              <span className={`kind-badge ${asset.kind}`}>{asset.kind === "edited" ? t("legacy.revised") : t("legacy.original")}</span>
            </button>
            <div className="history-meta">
              <time>{new Date(asset.createdAt).toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" })}</time>
              <div className="history-actions">
                <button type="button" onClick={() => onAnnotate(asset)} aria-label={t("legacy.annotationEdit")} title={t("legacy.annotationEdit")}><PencilLine size={14} /></button>
                <button type="button" onClick={() => onExport(asset)} aria-label={t("legacy.exportImage")} title={t("common.download")}><Download size={14} /></button>
                <button type="button" onClick={() => onDelete(asset)} aria-label={t("legacy.deleteVersion")} title={t("common.delete")}><Trash2 size={14} /></button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
