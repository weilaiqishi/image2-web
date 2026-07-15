import { ImagePlus, Sparkles, X } from "lucide-react";
import { useRef } from "react";
import type { AspectRatio, GenerationParams, OutputFormat, Quality, Resolution } from "../types";

interface GenerationPanelProps {
  params: GenerationParams;
  references: string[];
  busy: boolean;
  onChange: (next: GenerationParams) => void;
  onReferences: (files: File[]) => void;
  onRemoveReference: (index: number) => void;
  onGenerate: () => void;
}

const ratios: AspectRatio[] = ["1:1", "4:3", "16:9", "3:4", "9:16"];
const resolutions: Resolution[] = ["1K", "2K", "4K"];
const qualities: Quality[] = ["low", "medium", "high"];
const formats: OutputFormat[] = ["png", "jpeg", "webp"];

export function GenerationPanel({
  params,
  references,
  busy,
  onChange,
  onReferences,
  onRemoveReference,
  onGenerate,
}: GenerationPanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const update = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => {
    onChange({ ...params, [key]: value });
  };
  const pasteReferences = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const itemImages = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const images = itemImages.length
      ? itemImages
      : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));

    if (!images.length) return;
    event.preventDefault();
    onReferences(images);
  };

  return (
    <aside className="control-panel">
      <div className="panel-title-row">
        <div>
          <span className="eyebrow">生成参数</span>
          <h2>描述画面</h2>
        </div>
        <span className="model-dot" title="GPT Image 2" />
      </div>

      <textarea
        className="prompt-input"
        value={params.prompt}
        onChange={(event) => update("prompt", event.target.value)}
        onPaste={pasteReferences}
        placeholder="例如：一盒精致的广式月饼，深红礼盒，商业产品摄影，柔和侧光……"
        aria-label="图片描述"
      />

      <div className="reference-row">
        <button className="reference-button" type="button" onClick={() => fileInput.current?.click()} disabled={references.length >= 4}>
          <ImagePlus size={16} />
          参考图
          <span>{references.length}/4</span>
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => onReferences(Array.from(event.target.files ?? []))}
        />
      </div>

      {references.length > 0 && (
        <div className="reference-strip">
          {references.map((src, index) => (
            <div className="reference-thumb" key={`${src.slice(0, 32)}-${index}`}>
              <img src={src} alt={`参考图 ${index + 1}`} />
              <button type="button" onClick={() => onRemoveReference(index)} aria-label={`删除参考图 ${index + 1}`} title="删除">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ControlGroup label="画面比例">
        <div className="option-grid ratios">
          {ratios.map((ratio) => (
            <button className={params.aspectRatio === ratio ? "selected" : ""} type="button" key={ratio} onClick={() => update("aspectRatio", ratio)}>
              <RatioIcon ratio={ratio} />
              {ratio}
            </button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label="分辨率" suffix={params.size}>
        <div className="segmented wide">
          {resolutions.map((resolution) => (
            <button className={params.resolution === resolution ? "selected" : ""} type="button" key={resolution} onClick={() => update("resolution", resolution)}>{resolution}</button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label="质量">
        <div className="segmented wide">
          {qualities.map((quality) => (
            <button className={params.quality === quality ? "selected" : ""} type="button" key={quality} onClick={() => update("quality", quality)}>
              {{ low: "草稿", medium: "标准", high: "精细" }[quality]}
            </button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label="输出格式">
        <div className="segmented wide">
          {formats.map((format) => (
            <button className={params.outputFormat === format ? "selected" : ""} type="button" key={format} onClick={() => update("outputFormat", format)}>{format.toUpperCase()}</button>
          ))}
        </div>
      </ControlGroup>

      <button className="generate-button" type="button" disabled={busy || !params.prompt.trim()} onClick={onGenerate}>
        <Sparkles size={18} />
        {busy ? "正在生成校样…" : references.length ? "参考图片生成" : "生成图片"}
      </button>
    </aside>
  );
}

function ControlGroup({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <section className="control-group">
      <div className="control-label"><span>{label}</span>{suffix && <code>{suffix}</code>}</div>
      {children}
    </section>
  );
}

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  const [width, height] = ratio.split(":").map(Number);
  const max = 18;
  const scale = max / Math.max(width, height);
  return <span className="ratio-icon" style={{ width: width * scale, height: height * scale }} />;
}
