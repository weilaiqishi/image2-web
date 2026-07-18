import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AnnotationDialog } from "./components/AnnotationDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { AgentRuntime } from "./lib/agentRuntime";
import { bridge, errorMessage } from "./lib/bridge";
import { normalizeAspectRatio, normalizeResolution } from "./lib/promptCatalog";
import { replaceSourceAttachmentWithAnnotation } from "./lib/annotationModel";
import { useI18n } from "./i18n";
import {
  exportPromptCatalogData,
  importPromptCatalogData,
  loadPromptCatalog,
  recordPromptUsage,
  requestPromptSyncCancellation,
  savePromptPreferences,
  shouldAutoUpdate,
  syncPromptCatalog,
  updatePromptLocalState,
} from "./lib/promptCatalogStore";
import { SIZE_PRESETS, type AnnotationAttachment, type AssetRecord, type Attachment, type GenerationTask, type PromptCatalogPreferences, type PromptCatalogSnapshot, type PromptLocalState, type PromptTemplateView, type SaveSettingsInput, type Settings, type WorkspaceState } from "./types";

const initialSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: false,
};

export default function App() {
  const { t } = useI18n();
  const [runtime, setRuntime] = useState<AgentRuntime>();
  const [workspace, setWorkspace] = useState<WorkspaceState>();
  const [settings, setSettings] = useState(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [view, setView] = useState<"chat" | "inspire">("chat");
  const [annotationTarget, setAnnotationTarget] = useState<{ asset: AssetRecord; documentId?: string }>();
  const [promptCatalog, setPromptCatalog] = useState<PromptCatalogSnapshot>();
  const [promptCatalogSyncing, setPromptCatalogSyncing] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string }>();
  const annotationTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([AgentRuntime.create(), bridge.getSettings(), bridge.listAssets(), loadPromptCatalog()])
      .then(([nextRuntime, nextSettings, nextAssets, nextPromptCatalog]) => {
        if (cancelled) return;
        setRuntime(nextRuntime);
        setWorkspace(nextRuntime.snapshot());
        unsubscribe = nextRuntime.subscribe(setWorkspace);
        setSettings(nextSettings);
        setAssets(nextAssets);
        setPromptCatalog(nextPromptCatalog);
        if (!nextSettings.hasApiKey) setSettingsOpen(true);
      })
      .catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!promptCatalog || promptCatalogSyncing || !shouldAutoUpdate(promptCatalog.preferences)) return;
    setPromptCatalogSyncing(true);
    void syncPromptCatalog()
      .then(setPromptCatalog)
      .catch(() => undefined)
      .finally(() => setPromptCatalogSyncing(false));
  }, [promptCatalog?.catalogVersion]);

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
    setNotice({ type: "success", text: t("settings.saved") });
  };

  const send = async () => {
    if (!runtime || !selectedConversationId) return;
    if (!settings.hasApiKey) {
      setSettingsOpen(true);
      setNotice({ type: "error", text: t("app.configureApiKey") });
      return;
    }
    setAnalyzing(true);
    setNotice(undefined);
    try {
      runtime.preflightDraft(selectedConversationId, settings);
      await runtime.submit(selectedConversationId, settings);
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error) });
    } finally {
      setAnalyzing(false);
    }
  };

  const cancelSend = async () => {
    if (!runtime || !selectedConversationId) return;
    if (await runtime.cancelPendingSubmission(selectedConversationId)) {
      setNotice({ type: "success", text: t("app.sendCancelled") });
    }
    setAnalyzing(false);
  };

  const openAnnotation = (asset: AssetRecord, documentId?: string) => {
    setNotice(undefined);
    annotationTrigger.current = document.activeElement as HTMLElement | null;
    const recoverable = documentId ?? Object.values(workspace?.annotationDocuments ?? {})
      .filter((document) => document.sourceAssetId === asset.id && document.conversationId === selectedConversationId && document.status === "draft")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id;
    setAnnotationTarget({ asset, documentId: recoverable });
  };

  const closeAnnotation = () => {
    setAnnotationTarget(undefined);
    window.setTimeout(() => annotationTrigger.current?.focus(), 0);
  };

  const addAnnotation = (attachment: AnnotationAttachment) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    void runtime.updateDraft(selectedConversationId, { attachments: replaceSourceAttachmentWithAnnotation(selectedDraft.attachments, attachment) });
  };

  const addAttachments = (attachments: Attachment[]) => {
    if (!runtime || !selectedConversationId) return;
    void runtime.addAttachmentsAndRecommend(selectedConversationId, attachments, settings);
    if (attachments.some((attachment) => attachment.kind === "asset")) void bridge.listAssets().then(setAssets).catch(() => undefined);
  };

  const continueFromAsset = (asset: AssetRecord) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      kind: "asset",
      assetId: asset.id,
      name: asset.prompt || t("workspace.historyImage"),
      descriptor: { label: `Image${String(selectedDraft.nextImageSequence).padStart(3, "0")}`, roles: ["base"], priority: 5, preserve: [t("compiler.defaultPreserveUnmarked"), t("role.identityDetailed"), t("compiler.defaultPreserveComposition")] },
    };
    void (async () => {
      if (!selectedDraft.text.trim()) await runtime.updateDraft(selectedConversationId, { text: t("app.continueDefaultPrompt") });
      await runtime.addAttachmentsAndRecommend(selectedConversationId, [attachment], settings);
    })();
    setNotice({ type: "success", text: t("app.continueAttached") });
  };

  const regenerateTask = (task: GenerationTask) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    const attachments = structuredClone(task.attachments);
    const maxSequence = attachments.reduce((maximum, attachment) => {
      if (attachment.kind === "annotation") return maximum;
      return Math.max(maximum, Number(attachment.descriptor?.label.match(/^Image(\d+)$/)?.[1] ?? 0));
    }, 0);
    void runtime.updateDraft(selectedConversationId, {
      text: task.prompt,
      attachments,
      nextImageSequence: Math.max(selectedDraft.nextImageSequence, maxSequence + 1),
    });
    setNotice({ type: "success", text: t("app.regenerateReady") });
  };

  const renameVersion = (asset: AssetRecord, label: string) => {
    void bridge.updateAssetMetadata(asset.id, { branchLabel: label }).then((updated) => {
      setAssets((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice({ type: "success", text: t("app.versionRenamed") });
    }).catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  const hideVersion = (asset: AssetRecord) => {
    const childCount = assets.filter((item) => item.parentId === asset.id).length;
    const message = childCount ? t("app.hideVersionChildrenConfirm", { count: childCount }) : t("app.hideVersionConfirm");
    if (!window.confirm(message)) return;
    void bridge.updateAssetMetadata(asset.id, { hidden: true }).then((updated) => {
      setAssets((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice({ type: "success", text: t("app.versionHidden") });
    }).catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  const useTemplate = (template: PromptTemplateView) => {
    if (!runtime || !selectedConversationId || !selectedDraft) return;
    const aspectRatio = normalizeAspectRatio(template.aspectRatio);
    const resolution = normalizeResolution(template.resolution);
    void runtime.updateDraft(selectedConversationId, {
      text: template.displayPrompt,
      params: { ...selectedDraft.params, aspectRatio, resolution, size: SIZE_PRESETS[resolution][aspectRatio] },
    });
    setView("chat");
    void recordPromptUsage(template.id, selectedConversationId).then(setPromptCatalog);
    setNotice({ type: "success", text: t("app.templateAdded", { title: template.title }) });
  };

  const changePromptLocal = (templateId: string, patch: Partial<PromptLocalState>) => {
    void updatePromptLocalState(templateId, patch).then(setPromptCatalog).catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  const changePromptPreferences = (patch: Partial<PromptCatalogPreferences>) => {
    void savePromptPreferences(patch).then(setPromptCatalog).catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  const checkPromptUpdates = (sourceId?: string) => {
    setPromptCatalogSyncing(true);
    setNotice(undefined);
    void syncPromptCatalog(sourceId ? [sourceId] : undefined)
      .then((next) => { setPromptCatalog(next); const run = next.syncRuns[0]; setNotice({ type: "success", text: t("app.catalogChecked", { added: run?.added ?? 0, updated: run?.updated ?? 0, archived: run?.archived ?? 0 }) }); })
      .catch((error) => setNotice({ type: "error", text: errorMessage(error) }))
      .finally(() => setPromptCatalogSyncing(false));
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportPrompts = (format: "json" | "zip") => {
    void exportPromptCatalogData().then(async (data) => {
      const json = JSON.stringify(data, null, 2);
      if (format === "json") downloadBlob(new Blob([json], { type: "application/json" }), `image2-inspiration-${Date.now()}.json`);
      else {
        const zip = new JSZip();
        zip.file("catalog.json", json);
        zip.file("README.txt", "Image2 Studio local inspiration catalog export. Favorites, notes, rewrites and usage stay in this archive.");
        downloadBlob(await zip.generateAsync({ type: "blob" }), `image2-inspiration-${Date.now()}.zip`);
      }
    }).catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  const importPrompts = (file: File) => {
    void (async () => {
      const data = file.name.toLowerCase().endsWith(".zip")
        ? JSON.parse(await (await JSZip.loadAsync(file)).file("catalog.json")!.async("string"))
        : JSON.parse(await file.text());
      const next = await importPromptCatalogData(data);
      setPromptCatalog(next);
      setNotice({ type: "success", text: t("app.catalogImported") });
    })().catch((error) => setNotice({ type: "error", text: errorMessage(error) }));
  };

  if (!runtime || !workspace || !selectedConversationId || !selectedDraft || !promptCatalog) {
    return <div className="app-loading"><span className="brand-mark working" aria-hidden="true">I²</span><p>{t("app.loadingWorkspace")}</p></div>;
  }

  return (
    <>
      <AgentWorkspace
        workspace={workspace}
        assets={assets}
        settings={settings}
        analyzing={analyzing}
        promptCatalog={promptCatalog}
        promptCatalogSyncing={promptCatalogSyncing}
        view={view}
        onNewConversation={() => { setView("chat"); void runtime.createConversation(); }}
        onSelectConversation={(id) => { setView("chat"); void runtime.selectConversation(id); }}
        onRenameConversation={(id, title) => void runtime.renameConversation(id, title)}
        onDeleteConversation={(id) => { if (window.confirm(t("app.deleteConversationConfirm"))) void runtime.deleteConversation(id); }}
        onDraftChange={(draft) => void runtime.updateDraft(selectedConversationId, draft)}
        onAddAttachments={addAttachments}
        onAnswerRecommendation={(apply) => void runtime.answerRecommendation(selectedConversationId, apply)}
        onViewChange={setView}
        onUseTemplate={useTemplate}
        onPromptLocalChange={changePromptLocal}
        onPromptCatalogSync={checkPromptUpdates}
        onPromptCatalogCancel={() => requestPromptSyncCancellation()}
        onPromptPreferencesChange={changePromptPreferences}
        onPromptCatalogExport={exportPrompts}
        onPromptCatalogImport={importPrompts}
        onSend={() => void send()}
        onCancelSend={() => void cancelSend()}
        onSettings={() => setSettingsOpen(true)}
        onAnnotate={openAnnotation}
        onContinue={continueFromAsset}
        onRenameVersion={renameVersion}
        onHideVersion={hideVersion}
        onExport={(asset) => void bridge.exportAsset(asset.id)}
        onCancelBatch={(id) => void runtime.cancelBatch(id)}
        onResumeBatch={(id) => void runtime.resumeBatch(id)}
        onRetryTask={(id) => void runtime.retryTask(id)}
        onRegenerate={regenerateTask}
      />
      {notice && !annotationTarget && <div className={`notice ${notice.type}`} role="status">{notice.text}<button type="button" onClick={() => setNotice(undefined)} aria-label={t("app.closeNotice")}>×</button></div>}
      <SettingsDialog open={settingsOpen} settings={settings} onClose={() => setSettingsOpen(false)} onSave={saveSettings} />
      {annotationTarget && <AnnotationDialog asset={annotationTarget.asset} conversationId={selectedConversationId} initialDocument={annotationTarget.documentId ? workspace.annotationDocuments[annotationTarget.documentId] : undefined} onClose={closeAnnotation} onExport={() => void bridge.exportAsset(annotationTarget.asset.id)} onSubmit={addAnnotation} onDocumentChange={(document) => void runtime.upsertAnnotationDocument(document)} />}
    </>
  );
}
