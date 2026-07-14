import { History, Image as ImageIcon, PenTool, Settings as SettingsIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { GenerationPanel } from "./components/GenerationPanel";
import { HistoryRail } from "./components/HistoryRail";
import { PreviewStage } from "./components/PreviewStage";
import { SettingsDialog } from "./components/SettingsDialog";
import { bridge, errorMessage, filesToDataUrls } from "./lib/bridge";
import {
  SIZE_PRESETS,
  type AssetRecord,
  type EditInput,
  type GenerationParams,
  type SaveSettingsInput,
  type Settings,
  type WorkspaceMode,
} from "./types";

const AnnotationEditor = lazy(() =>
  import("./components/AnnotationEditor").then((module) => ({ default: module.AnnotationEditor })),
);

const initialSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-image-2",
  hasApiKey: false,
};

const initialParams: GenerationParams = {
  prompt: "",
  aspectRatio: "1:1",
  resolution: "1K",
  size: "1024x1024",
  quality: "medium",
  outputFormat: "png",
};

export default function App() {
  const [mode, setMode] = useState<WorkspaceMode>("generate");
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [params, setParams] = useState(initialParams);
  const [references, setReferences] = useState<string[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string }>();

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedId) ?? assets[0],
    [assets, selectedId],
  );

  useEffect(() => {
    void Promise.all([bridge.getSettings(), bridge.listAssets()])
      .then(([nextSettings, nextAssets]) => {
        setSettings(nextSettings);
        setAssets(nextAssets);
        setSelectedId(nextAssets[0]?.id);
        if (!nextSettings.hasApiKey) setSettingsOpen(true);
      })
      .catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  }, []);

  const updateParams = (next: GenerationParams) => {
    const size = SIZE_PRESETS[next.resolution][next.aspectRatio];
    setParams({ ...next, size });
  };

  const saveSettings = async (input: SaveSettingsInput) => {
    const next = await bridge.saveSettings(input);
    setSettings(next);
    setNotice({ type: "success", text: "连接设置已保存" });
  };

  const generate = async () => {
    if (!settings.hasApiKey) {
      setSettingsOpen(true);
      setNotice({ type: "error", text: "请先配置 API Key" });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const asset = await bridge.generate({ ...params, referenceDataUrls: references });
      setAssets((current) => [asset, ...current]);
      setSelectedId(asset.id);
      setNotice({ type: "success", text: "新校样已生成并保存在本机" });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const edit = async (input: EditInput) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const asset = await bridge.edit(input);
      setAssets((current) => [asset, ...current]);
      setSelectedId(asset.id);
      setMode("generate");
      setNotice({ type: "success", text: "修订版已生成，原图和标注均已保留" });
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const annotate = (asset: AssetRecord) => {
    setSelectedId(asset.id);
    setMode("annotate");
  };

  const removeAsset = async (asset: AssetRecord) => {
    await bridge.deleteAsset(asset.id);
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    if (selectedId === asset.id) setSelectedId(undefined);
  };

  const addReferences = async (files: File[]) => {
    const valid = files.filter((file) => file.size <= 20 * 1024 * 1024).slice(0, 4 - references.length);
    const urls = await filesToDataUrls(valid);
    setReferences((current) => [...current, ...urls].slice(0, 4));
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark">I²</span>
          <div><strong>Image2</strong><span>Studio</span></div>
        </div>
        <nav className="mode-switch" aria-label="工作模式">
          <button className={mode === "generate" ? "active" : ""} type="button" onClick={() => setMode("generate")}>
            <ImageIcon size={16} />生成
          </button>
          <button className={mode === "annotate" ? "active" : ""} type="button" disabled={!selectedAsset} onClick={() => setMode("annotate")}>
            <PenTool size={16} />标注修改
          </button>
        </nav>
        <div className="header-actions">
          <span className={`connection-status ${settings.hasApiKey ? "ready" : ""}`}><i />{settings.hasApiKey ? settings.model : "未连接"}</span>
          <button className="icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="打开设置" title="设置"><SettingsIcon size={18} /></button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(undefined)} aria-label="关闭提示">×</button></div>}

      {mode === "generate" ? (
        <div className="generate-workspace">
          <GenerationPanel
            params={params}
            references={references}
            busy={busy}
            onChange={updateParams}
            onReferences={(files) => void addReferences(files)}
            onRemoveReference={(index) => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))}
            onGenerate={() => void generate()}
          />
          <PreviewStage asset={selectedAsset} busy={busy} onAnnotate={() => selectedAsset && annotate(selectedAsset)} onExport={() => selectedAsset && void bridge.exportAsset(selectedAsset.id)} />
          <HistoryRail
            assets={assets}
            selectedId={selectedAsset?.id}
            onSelect={(asset) => setSelectedId(asset.id)}
            onAnnotate={annotate}
            onExport={(asset) => void bridge.exportAsset(asset.id)}
            onDelete={(asset) => void removeAsset(asset)}
          />
        </div>
      ) : selectedAsset ? (
        <Suspense fallback={<div className="annotation-loading"><span />正在载入标注工具</div>}>
          <AnnotationEditor asset={selectedAsset} params={params} busy={busy} onSubmit={edit} onExport={() => void bridge.exportAsset(selectedAsset.id)} />
        </Suspense>
      ) : (
        <div className="missing-selection"><History size={24} /><p>请先生成或选择一张图片。</p></div>
      )}

      <SettingsDialog open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
    </div>
  );
}
