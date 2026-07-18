import { ImagePlus, Sparkles, X } from "lucide-react";
import { useRef } from "react";
import type { AspectRatio, GenerationParams, OutputFormat, Quality, Resolution } from "../types";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
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
          <span className="eyebrow">{t("legacy.generationParams")}</span>
          <h2>{t("legacy.describeImage")}</h2>
        </div>
        <span className="model-dot" title="GPT Image 2" />
      </div>

      <textarea
        className="prompt-input"
        value={params.prompt}
        onChange={(event) => update("prompt", event.target.value)}
        onPaste={pasteReferences}
        placeholder={t("legacy.promptExample")}
        aria-label={t("legacy.promptLabel")}
      />

      <div className="reference-row">
        <button className="reference-button" type="button" onClick={() => fileInput.current?.click()} disabled={references.length >= 4}>
          <ImagePlus size={16} />
          {t("legacy.referenceShort")}
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
              <img src={src} alt={t("legacy.referenceAlt", { index: index + 1 })} />
              <button type="button" onClick={() => onRemoveReference(index)} aria-label={t("legacy.deleteReference", { index: index + 1 })} title={t("common.delete")}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ControlGroup label={t("legacy.aspectRatio")}>
        <div className="option-grid ratios">
          {ratios.map((ratio) => (
            <button className={params.aspectRatio === ratio ? "selected" : ""} type="button" key={ratio} onClick={() => update("aspectRatio", ratio)}>
              <RatioIcon ratio={ratio} />
              {ratio}
            </button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label={t("workspace.resolution")} suffix={params.size}>
        <div className="segmented wide">
          {resolutions.map((resolution) => (
            <button className={params.resolution === resolution ? "selected" : ""} type="button" key={resolution} onClick={() => update("resolution", resolution)}>{resolution}</button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label={t("workspace.quality")}>
        <div className="segmented wide">
          {qualities.map((quality) => (
            <button className={params.quality === quality ? "selected" : ""} type="button" key={quality} onClick={() => update("quality", quality)}>
              {{ low: t("workspace.qualityLow"), medium: t("workspace.qualityMedium"), high: t("workspace.qualityHigh") }[quality]}
            </button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label={t("legacy.outputFormat")}>
        <div className="segmented wide">
          {formats.map((format) => (
            <button className={params.outputFormat === format ? "selected" : ""} type="button" key={format} onClick={() => update("outputFormat", format)}>{format.toUpperCase()}</button>
          ))}
        </div>
      </ControlGroup>

      <button className="generate-button" type="button" disabled={busy || !params.prompt.trim()} onClick={onGenerate}>
        <Sparkles size={18} />
        {busy ? t("legacy.generatingProof") : references.length ? t("legacy.generateFromReference") : t("legacy.generate")}
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
