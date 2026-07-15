import { useEffect, useRef, useState } from "react";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AnnotationDialog } from "./components/AnnotationDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { AgentRuntime } from "./lib/agentRuntime";
import { bridge, errorMessage } from "./lib/bridge";
import { normalizeAspectRatio, normalizeResolution } from "./lib/promptCatalog";
import { SIZE_PRESETS, type AnnotationAttachment, type AssetRecord, type Attachment, type PromptTemplate, type SaveSettingsInput, type Settings, type WorkspaceState } from "./types";

const initialSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: false,
};

export default function App() {
  const [runtime, setRuntime] = useState<AgentRuntime>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [view, setView] = useState<"chat" | "inspire">("chat");
  const [annotationAsset, setAnnotationAsset] = useState<AssetRecord>();
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string }>();
  const annotationTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([AgentRuntime.create(), bridge.getSettings(), bridge.listAssets()])
      .then(([nextRuntime, nextSettings, nextAssets]) => {
        if (cancelled) return;
        setRuntime(nextRuntime);
        setWorkspace(nextRuntime.snapshot());
        unsubscribe = nextRuntime.subscribe(setWorkspace);
        setSettings(nextSettings);
        setAssets(nextAssets);
        if (!nextSettings.hasApiKey) setSettingsOpen(true);
      })
      .catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  const succeeded = workspace?.tasks.filter((task) => task.status === "succeeded").length ?? 0;
  useEffect(() => {
    if (!runtime || !succeeded) return;
    void bridge.listAssets().then(setAssets).catch(() => undefined);
  }, [runtime, succeeded]);

  const selectedConversationId = workspace?.selectedConversationId;
  const selectedDraft = selectedConversationId ? workspace?.drafts[selectedConversationId] : undefined;
  const saveSettings = async (input: SaveSettingsInput) => {
    const next = await bridge.saveSettings(input);
    setSettings(next);
    setNotice({ type: "success", text: "连接设置已保存" });
  };

  const send = async () => {
    if (!runtime || !selectedConversationId) return;
    if (!settings.hasApiKey) {
      setSettingsOpen(true);
      setNotice({ type: "error", text: "请先配置 API Key" });
      return;
    }
    setAnalyzing(true);
    setNotice(undefined);
    try {
      await runtime.submit(selectedConversationId, settings);
    } finally {
      setAnalyzing(false);
    }
  };

  const openAnnotation = (asset: AssetRecord) => {
    annotationTrigger.current = document.activeElement as HTMLElement | null;
    setAnnotationAsset(asset);
  };

  const closeAnnotation = () => {
    setAnnotationAsset(undefined);
    window.setTimeout(() => annotationTrigger.current?.focus(), 0);
  };

  const addAnnotation = (attachment: AnnotationAttachment) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    void runtime.updateDraft(selectedConversationId, { attachments: [...selectedDraft.attachments, attachment].slice(0, 6) });
  };

  const addAttachments = (attachments: Attachment[]) => {
    if (!runtime || !selectedConversationId) return;
    void runtime.addAttachmentsAndRecommend(selectedConversationId, attachments, settings);
  };

  const useTemplate = (template: PromptTemplate) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    const aspectRatio = normalizeAspectRatio(template.aspectRatio);
    const resolution = normalizeResolution(template.resolution);
    void runtime.updateDraft(selectedConversationId, {
      text: template.prompt,
      params: { ...selectedDraft.params, aspectRatio, resolution, size: SIZE_PRESETS[resolution][aspectRatio] },
    });
    setView("chat");
    setNotice({ type: "success", text: `已将“${template.title}”加入当前对话` });
  };

  if (!runtime || !workspace || !selectedConversationId || !selectedDraft) {
    return <div className="app-loading"><span className="brand-mark working" aria-hidden="true">I²</span><p>正在载入本地工作区</p></div>;
  }

  return (
    <>
      <AgentWorkspace
        workspace={workspace}
        assets={assets}
        settings={settings}
        analyzing={analyzing}
        view={view}
        onNewConversation={() => { setView("chat"); void runtime.createConversation(); }}
        onSelectConversation={(id) => { setView("chat"); void runtime.selectConversation(id); }}
        onRenameConversation={(id, title) => void runtime.renameConversation(id, title)}
        onDeleteConversation={(id) => { if (window.confirm("删除这个对话？生成图片仍会保留在历史素材中。")) void runtime.deleteConversation(id); }}
        onDraftChange={(draft) => void runtime.updateDraft(selectedConversationId, draft)}
        onAddAttachments={addAttachments}
        onAnswerRecommendation={(apply) => void runtime.answerRecommendation(selectedConversationId, apply)}
        onViewChange={setView}
        onUseTemplate={useTemplate}
        onSend={() => void send()}
        onSettings={() => setSettingsOpen(true)}
        onAnnotate={openAnnotation}
        onExport={(asset) => void bridge.exportAsset(asset.id)}
        onCancelBatch={(id) => void runtime.cancelBatch(id)}
        onResumeBatch={(id) => void runtime.resumeBatch(id)}
        onRetryTask={(id) => void runtime.retryTask(id)}
      />
      {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(undefined)} aria-label="关闭提示">×</button></div>}
      <SettingsDialog open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      {annotationAsset && <AnnotationDialog asset={annotationAsset} onClose={closeAnnotation} onExport={() => void bridge.exportAsset(annotationAsset.id)} onSubmit={addAnnotation} />}
    </>
  );
}
