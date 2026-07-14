import { Download, PencilLine, Trash2 } from "lucide-react";
import type { AssetRecord } from "../types";
import { assetSrc } from "../lib/bridge";

interface HistoryRailProps {
  assets: AssetRecord[];
  selectedId?: string;
  onSelect: (asset: AssetRecord) => void;
  onAnnotate: (asset: AssetRecord) => void;
  onExport: (asset: AssetRecord) => void;
  onDelete: (asset: AssetRecord) => void;
}

export function HistoryRail({ assets, selectedId, onSelect, onAnnotate, onExport, onDelete }: HistoryRailProps) {
  return (
    <aside className="history-rail">
      <div className="history-heading">
        <div><span className="eyebrow">本地版本</span><h2>历史</h2></div>
        <span className="history-count">{assets.length}</span>
      </div>
      <div className="history-list">
        {assets.length === 0 && <p className="history-empty">生成结果会按版本保存在这里。</p>}
        {assets.map((asset, index) => (
          <article className={`history-item ${selectedId === asset.id ? "selected" : ""}`} key={asset.id}>
            <button className="history-preview" type="button" onClick={() => onSelect(asset)} aria-label={`查看版本 ${assets.length - index}`}>
              <img src={assetSrc(asset)} alt="生成版本缩略图" />
              <span className={`kind-badge ${asset.kind}`}>{asset.kind === "edited" ? "修订" : "原稿"}</span>
            </button>
            <div className="history-meta">
              <time>{new Date(asset.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
              <div className="history-actions">
                <button type="button" onClick={() => onAnnotate(asset)} aria-label="标注修改" title="标注修改"><PencilLine size={14} /></button>
                <button type="button" onClick={() => onExport(asset)} aria-label="导出图片" title="导出"><Download size={14} /></button>
                <button type="button" onClick={() => onDelete(asset)} aria-label="删除版本" title="删除"><Trash2 size={14} /></button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
