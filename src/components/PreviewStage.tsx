import { Download, PencilLine, Sparkles } from "lucide-react";
import type { AssetRecord } from "../types";
import { assetSrc } from "../lib/bridge";

interface PreviewStageProps {
  asset?: AssetRecord;
  busy: boolean;
  onAnnotate: () => void;
  onExport: () => void;
}

export function PreviewStage({ asset, busy, onAnnotate, onExport }: PreviewStageProps) {
  return (
    <main className="preview-stage">
      <div className="stage-topline">
        <span>{asset ? (asset.kind === "edited" ? "修订校样" : "生成校样") : "预览"}</span>
        {asset && <code>{asset.id.slice(0, 8)}</code>}
      </div>
      <div className={`proof-area ${asset ? "has-image" : ""}`}>
        {busy ? (
          <div className="loading-state">
            <span className="loading-mark"><Sparkles size={24} /></span>
            <strong>正在制作校样</strong>
            <p>高分辨率图片可能需要一至两分钟。</p>
          </div>
        ) : asset ? (
          <div className="proof-frame">
            <i className="proof-corner top-left" /><i className="proof-corner top-right" />
            <i className="proof-corner bottom-left" /><i className="proof-corner bottom-right" />
            <img src={assetSrc(asset)} alt={asset.prompt || "生成图片"} />
          </div>
        ) : (
          <div className="empty-proof">
            <span className="empty-monogram">I²</span>
            <strong>第一张校样等待生成</strong>
            <p>描述主体、材质、光线和使用场景。</p>
          </div>
        )}
      </div>
      {asset && (
        <div className="stage-actions">
          <button className="button secondary" type="button" onClick={onExport}><Download size={16} />导出</button>
          <button className="button primary" type="button" onClick={onAnnotate}><PencilLine size={16} />标注修改</button>
        </div>
      )}
    </main>
  );
}
