import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Columns2,
  Download,
  FileSearch,
  EyeOff,
  GitBranch,
  History,
  ImagePlus,
  Lightbulb,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PencilLine,
  Play,
  RefreshCw,
  Repeat2,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type TranslationKey } from "../i18n";
import { assetSrc, bridge, filesToDataUrls } from "../lib/bridge";
import { compileEditRequest, providerCapabilitiesForModel, type CompiledEditRequest } from "../lib/promptCompiler";
import { PromptLibrary } from "./PromptLibrary";
import { ChoiceFeedback } from "./ChoiceFeedback";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { StructuredComposer } from "./StructuredComposer";
import { LanguageSwitcher } from "./LanguageSwitcher";
import {
  SIZE_PRESETS,
  type AspectRatio,
  type AnnotationObjectKind,
  type AssetRecord,
  type Attachment,
  type ComposerDraft,
  type GenerationParams,
  type GenerationBatch,
  type GenerationTask,
  type OutputFormat,
  type Quality,
  type ReferenceRole,
  type ReferenceDescriptor,
  type PromptCatalogPreferences,
  type PromptCatalogSnapshot,
  type PromptLocalState,
  type PromptTemplateView,
  type Resolution,
  type Settings as StudioSettings,
  type WorkspaceState,
} from "../types";

interface AgentWorkspaceProps {
  workspace: WorkspaceState;
  assets: AssetRecord[];
  settings: StudioSettings;
  analyzing: boolean;
  promptCatalog: PromptCatalogSnapshot;
  promptCatalogSyncing: boolean;
  view: "chat" | "inspire";
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onDraftChange: (draft: Partial<ComposerDraft>) => void;
  onAddAttachments: (attachments: Attachment[]) => void;
  onAnswerRecommendation: (apply: boolean) => void;
  onViewChange: (view: "chat" | "inspire") => void;
  onUseTemplate: (template: PromptTemplateView) => void;
  onPromptLocalChange: (templateId: string, patch: Partial<PromptLocalState>) => void;
  onPromptCatalogSync: (sourceId?: string) => void;
  onPromptCatalogCancel: () => void;
  onPromptPreferencesChange: (patch: Partial<PromptCatalogPreferences>) => void;
  onPromptCatalogExport: (format: "json" | "zip") => void;
  onPromptCatalogImport: (file: File) => void;
  onSend: () => void;
  onCancelSend: () => void;
  onSettings: () => void;
  onAnnotate: (asset: AssetRecord, documentId?: string) => void;
  onContinue: (asset: AssetRecord) => void;
  onRenameVersion: (asset: AssetRecord, label: string) => void;
  onHideVersion: (asset: AssetRecord) => void;
  onExport: (asset: AssetRecord) => void;
  onCancelBatch: (id: string) => void;
  onResumeBatch: (id: string) => void;
  onRetryTask: (id: string) => void;
  onRegenerate: (task: GenerationTask) => void;
}

const statusKeys: Record<GenerationTask["status"], TranslationKey> = {
  queued: "task.queued", running: "task.running", succeeded: "task.succeeded", failed: "task.failed", cancelled: "task.cancelled", interrupted: "task.interrupted",
};

const batchStatusKeys: Record<GenerationBatch["status"], TranslationKey> = {
  queued: "batch.queued", running: "batch.running", completed: "batch.completed", partial: "batch.partial", cancelled: "batch.cancelled", interrupted: "batch.interrupted",
};

const referenceRoleKeys: Record<ReferenceRole, TranslationKey> = {
  base: "role.base", identity: "role.identity", product: "role.product", pose: "role.pose", composition: "role.composition", material: "role.material",
  palette: "role.palette", style: "role.style", layout: "role.layout", logo: "role.logo", other: "role.other",
};

const annotationKindKeys: Record<AnnotationObjectKind, TranslationKey> = {
  point: "annotation.kind.point", rect: "annotation.kind.rect", mask: "annotation.kind.mask", arrow: "annotation.kind.arrow", note: "annotation.kind.note",
};

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const { locale, localeTag, t } = useI18n();
  const referenceRoles = (Object.keys(referenceRoleKeys) as ReferenceRole[]).map((id) => ({ id, label: t(referenceRoleKeys[id]) }));
  const conversation = props.workspace.conversations.find((item) => item.id === props.workspace.selectedConversationId) ?? props.workspace.conversations[0];
  const draft = props.workspace.drafts[conversation.id];
  const messages = props.workspace.messages.filter((message) => message.conversationId === conversation.id);
  const conversationBatches = props.workspace.batches.filter((batch) => batch.conversationId === conversation.id);
  const [transientAssets, setTransientAssets] = useState<AssetRecord[]>([]);
  const assetMap = useMemo(() => new Map([...props.assets, ...transientAssets].map((asset) => [asset.id, asset])), [props.assets, transientAssets]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [preview, setPreview] = useState<{ src: string; title: string; asset?: AssetRecord }>();
  const [compare, setCompare] = useState<{ before: AssetRecord; after: AssetRecord; alternatives: AssetRecord[] }>();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [compilePreviewOpen, setCompilePreviewOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const recommending = draft.recommendation?.status === "loading";
  const working = props.analyzing || recommending;
  const qualityLabels: Record<Quality, string> = { low: t("workspace.qualityLow"), medium: t("workspace.qualityMedium"), high: t("workspace.qualityHigh") };

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/") && file.size <= 20 * 1024 * 1024).slice(0, 4);
    const dataUrls = await filesToDataUrls(images);
    const imported = await Promise.all(images.map((file, index) => bridge.importAssetDataUrl(dataUrls[index], file.name)));
    setTransientAssets((current) => [...current, ...imported]);
    const attachments: Attachment[] = imported.map((asset, index) => ({ id: crypto.randomUUID(), kind: "asset", assetId: asset.id, name: images[index].name }));
    props.onAddAttachments(attachments);
  };

  const updateParams = <K extends keyof GenerationParams>(key: K, value: GenerationParams[K]) => {
    const next = { ...draft.params, [key]: value };
    next.size = SIZE_PRESETS[next.resolution][next.aspectRatio];
    props.onDraftChange({ params: next });
  };

  const attachAsset = (asset: AssetRecord) => {
    const attachment: Attachment = { id: crypto.randomUUID(), kind: "asset", assetId: asset.id, name: asset.prompt || t("workspace.historyImage") };
    props.onAddAttachments([attachment]);
    setAssetsOpen(false);
  };

  const updateAttachment = (attachmentId: string, update: (attachment: Attachment) => Attachment) => {
    props.onDraftChange({ attachments: draft.attachments.map((attachment) => attachment.id === attachmentId ? update(attachment) : attachment) });
  };

  const moveAttachment = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= draft.attachments.length) return;
    const attachments = [...draft.attachments];
    [attachments[index], attachments[target]] = [attachments[target], attachments[index]];
    props.onDraftChange({ attachments });
  };

  const mentionItems = useMemo(() => {
    const items: Array<{ id: string; label: string; detail: string; documentId?: string; sourceAssetId?: string }> = [];
    for (const attachment of draft.attachments) {
      if (attachment.kind === "annotation") {
        const document = props.workspace.annotationDocuments[attachment.documentId];
        for (const object of document?.objects ?? []) items.push({ id: object.id, label: object.displayName, detail: t(annotationKindKeys[object.kind]), documentId: document.id, sourceAssetId: document.sourceAssetId });
      } else if (attachment.descriptor) {
        items.push({ id: attachment.id, label: attachment.descriptor.label, detail: attachment.descriptor.roles.map((role) => referenceRoles.find((item) => item.id === role)?.label ?? role).join("/") });
      }
    }
    return items;
  }, [draft.attachments, props.workspace.annotationDocuments, locale]);

  const changeDraftText = (text: string) => {
    props.onDraftChange({ text });
    setMentionOpen(/@[\w]*$/.test(text));
  };

  const insertMention = (item: (typeof mentionItems)[number]) => {
    changeDraftText(`${draft.text.replace(/@[\w]*$/, "")}@${item.label} `);
    setMentionOpen(false);
    setComposerFocusRequest((value) => value + 1);
    if (item.documentId && item.sourceAssetId) {
      const asset = assetMap.get(item.sourceAssetId);
      if (asset) props.onAnnotate(asset, item.documentId);
    }
  };

  const compiledPreviews = useMemo(() => draft.attachments.filter((attachment) => attachment.kind === "annotation").flatMap((attachment) => {
    const document = props.workspace.annotationDocuments[attachment.documentId];
    if (!document) return [];
    return [compileEditRequest({ ...document, promptText: [document.promptText, draft.text].filter(Boolean).join("\n") }, draft.attachments, draft.params, providerCapabilitiesForModel(props.settings.imageModel))];
  }), [draft.attachments, draft.params, draft.text, locale, props.settings.imageModel, props.workspace.annotationDocuments]);

  return (
    <div className={`agent-shell ${props.view === "inspire" ? "inspiration-view" : ""}`}>
      <aside className="conversation-sidebar">
        <div className="agent-brand"><span className={`brand-mark ${working ? "working" : ""}`}>I²</span><div><strong>Image2</strong><small>Agent Studio</small></div></div>
        <button className="new-chat-button" type="button" onClick={props.onNewConversation}><MessageSquarePlus size={16} />{t("workspace.newConversation")}</button>
        <nav className="sidebar-primary-nav" aria-label={t("workspace.mainNavigation")}>
          <button className={props.view === "inspire" ? "active" : ""} type="button" onClick={() => props.onViewChange("inspire")}><Lightbulb size={15} />{t("workspace.inspiration")}</button>
        </nav>
        <div className="conversation-list" aria-label={t("workspace.conversationList")}>
          {props.workspace.conversations.map((item) => (
            <div className={`conversation-row ${item.id === conversation.id ? "active" : ""}`} key={item.id}>
              <button type="button" onClick={() => props.onSelectConversation(item.id)} onDoubleClick={() => {
                const title = window.prompt(t("workspace.renameConversation"), item.title === "新对话" || item.title === "New conversation" ? t("workspace.newConversation") : item.title);
                if (title) props.onRenameConversation(item.id, title);
              }}><span>{item.title === "新对话" || item.title === "New conversation" ? t("workspace.newConversation") : item.title}</span><time>{new Date(item.updatedAt).toLocaleDateString(localeTag, { month: "2-digit", day: "2-digit" })}</time></button>
              <button className="conversation-menu" type="button" onClick={() => props.onDeleteConversation(item.id)} aria-label={t("workspace.deleteConversation", { title: item.title === "新对话" || item.title === "New conversation" ? t("workspace.newConversation") : item.title })} title={t("workspace.deleteConversationTitle")}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <LanguageSwitcher />
          <button type="button" onClick={props.onSettings}><Settings size={16} /><span>{t("settings.open")}</span><i className={props.settings.hasApiKey ? "online" : ""} /></button>
        </div>
      </aside>

      {props.view === "inspire" ? (
        <PromptLibrary
          catalog={props.promptCatalog}
          syncing={props.promptCatalogSyncing}
          onUse={props.onUseTemplate}
          onLocalChange={props.onPromptLocalChange}
          onSync={props.onPromptCatalogSync}
          onCancelSync={props.onPromptCatalogCancel}
          onPreferencesChange={props.onPromptPreferencesChange}
          onExport={props.onPromptCatalogExport}
          onImport={props.onPromptCatalogImport}
        />
      ) : <>

      <main className="chat-workspace">
        <header className="chat-header">
          <div><span>{t("workspace.currentConversation")}</span><h1>{conversation.title === "新对话" || conversation.title === "New conversation" ? t("workspace.newConversation") : conversation.title}</h1></div>
          <div className="model-readout"><i className={props.settings.hasApiKey ? "online" : ""} /><span>{props.settings.agentModel}</span><code>{props.settings.agentProtocol === "responses" ? "RESPONSES" : "CHAT"}</code></div>
        </header>

        <div className="message-scroll">
          {!messages.length && <EmptyConversation />}
          <div className="message-column">
            {messages.map((message) => {
              const batch = message.batchId ? props.workspace.batches.find((item) => item.id === message.batchId) : undefined;
              const tasks = batch ? props.workspace.tasks.filter((task) => task.batchId === batch.id) : [];
              return (
                <article className={`chat-message ${message.role}`} key={message.id}>
                  <div className="message-author">{message.role === "user" ? t("workspace.you") : <><Sparkles size={13} />Image2 Agent</>}</div>
                  <p>{message.content}</p>
                  {message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <AttachmentChip attachment={attachment} assetMap={assetMap} key={attachment.id} onPreview={(src, title) => setPreview({ src, title })} onDraw={(asset, documentId) => props.onAnnotate(asset, documentId)} />)}</div>}
                  {batch && <BatchResults tasks={tasks} aspectRatio={batch.params.aspectRatio} assetMap={assetMap} onAnnotate={props.onAnnotate} onContinue={props.onContinue} onRegenerate={props.onRegenerate} onRename={props.onRenameVersion} onHide={props.onHideVersion} onExport={props.onExport} onCompare={(asset) => { const parent = asset.parentId ? assetMap.get(asset.parentId) : undefined; if (parent) setCompare({ before: parent, after: asset, alternatives: [...assetMap.values()].filter((candidate) => candidate.parentId === parent.id && !candidate.hiddenAt) }); }} onPreview={(src, title, asset) => setPreview({ src, title, asset })} />}
                </article>
              );
            })}
            {props.analyzing && <div className="agent-thinking"><span className="thinking-logo">I²</span>{t("workspace.agentThinking")}</div>}
          </div>
        </div>

        <div className="composer-zone">
          <div className="composer">
            {draft.attachments.length > 0 && <div className="composer-attachments">
              {draft.attachments.map((attachment, attachmentIndex) => {
                const src = attachmentPreview(attachment, assetMap);
                const title = attachment.kind === "annotation" ? t("workspace.annotationEdit") : attachment.name;
                const sourceAsset = attachment.kind === "asset" ? assetMap.get(attachment.assetId) : attachment.kind === "annotation" ? assetMap.get(attachment.sourceAssetId) : undefined;
                return <span className="composer-attachment" key={attachment.id}>
                  <AttachmentPreview attachment={attachment} src={src} title={title} onPreview={(previewSrc) => setPreview({ src: previewSrc, title })} />
                  <span className="composer-attachment-copy"><strong>{attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title}</strong><small>{title}</small></span>
                  {attachment.kind !== "annotation" && attachment.descriptor && <span className="reference-controls">
                    <ReferenceRoleMenu descriptor={attachment.descriptor} onChange={(descriptor) => updateAttachment(attachment.id, (current) => current.kind === "annotation" ? current : { ...current, descriptor })} />
                    <select aria-label={t("workspace.priority", { label: attachment.descriptor.label })} value={attachment.descriptor.priority} onChange={(event) => updateAttachment(attachment.id, (current) => current.kind === "annotation" ? current : { ...current, descriptor: { ...current.descriptor!, priority: Number(event.target.value) } })}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
                  </span>}
                  {sourceAsset && <button className="attachment-draw-button" type="button" onClick={() => props.onAnnotate(sourceAsset, attachment.kind === "annotation" ? attachment.documentId : undefined)} aria-label={`Draw ${title}`} title="Draw"><PencilLine size={12} /></button>}
                  <span className="attachment-order-controls"><button type="button" disabled={attachmentIndex === 0} onClick={() => moveAttachment(attachmentIndex, -1)} aria-label={t("workspace.moveEarlier", { name: attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title })} title={t("workspace.moveEarlierTitle")}><ChevronLeft size={12} /></button><button type="button" disabled={attachmentIndex === draft.attachments.length - 1} onClick={() => moveAttachment(attachmentIndex, 1)} aria-label={t("workspace.moveLater", { name: attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title })} title={t("workspace.moveLaterTitle")}><ChevronRight size={12} /></button></span>
                  <button className="attachment-remove-button" type="button" onClick={() => props.onDraftChange({ attachments: draft.attachments.filter((item) => item.id !== attachment.id) })} aria-label={t("workspace.removeAttachment")}><X size={12} /></button>
                </span>;
              })}
            </div>}
            {draft.recommendation?.status === "loading" && <ChoiceFeedback loading title={t("workspace.analyzingReference")} description={t("workspace.analyzingReferenceDescription")} />}
            {draft.recommendation?.status === "ready" && <ChoiceFeedback
              title={t("workspace.recommendation", { aspectRatio: draft.recommendation.aspectRatio, quality: qualityLabels[draft.recommendation.quality] })}
              description={draft.recommendation.reason}
              options={[{ id: "apply", label: t("workspace.applyRecommendation"), primary: true }, { id: "dismiss", label: t("workspace.keepCurrent") }]}
              onChoose={(id) => props.onAnswerRecommendation(id === "apply")}
            />}
            <StructuredComposer
              value={draft.text}
              knownTokens={mentionItems.map((item) => `@${item.label}`)}
              focusRequest={composerFocusRequest}
              onChange={changeDraftText}
              onTokenClick={(token) => {
                const item = mentionItems.find((candidate) => `@${candidate.label}` === token);
                if (item?.documentId && item.sourceAssetId) {
                  const asset = assetMap.get(item.sourceAssetId);
                  if (asset) props.onAnnotate(asset, item.documentId);
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                if (files.length) { event.preventDefault(); void addFiles(files); }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSend(); }
              }}
              placeholder={t("workspace.composerPlaceholder")}
              ariaLabel={t("workspace.composerLabel")}
            />
            {mentionOpen && mentionItems.length > 0 && <div className="composer-mention-menu" role="listbox" aria-label={t("workspace.insertReference")}>{mentionItems.map((item) => <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => insertMention(item)}><strong>@{item.label}</strong><span>{item.detail}</span></button>)}</div>}
            <div className="composer-toolbar">
              <div className="attachment-tools">
                <button type="button" onClick={() => fileInput.current?.click()} aria-label={t("workspace.addReference")} title={t("workspace.addReference")}><ImagePlus size={16} /></button>
                <button className={assetsOpen ? "active" : ""} type="button" onClick={() => setAssetsOpen((value) => !value)} aria-label={t("workspace.selectHistory")} title={t("workspace.historyAssets")}><History size={16} /></button>
                {compiledPreviews.length > 0 && <button type="button" onClick={() => setCompilePreviewOpen(true)} aria-label={t("workspace.inspectEditRequest")} title={t("workspace.inspectEditRequest")}><FileSearch size={16} /></button>}
                <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} />
              </div>
              <div className="parameter-tags" aria-label={t("workspace.generationParams")}>
                <ParameterSelect label={t("workspace.resolution")} value={draft.params.resolution} values={["1K", "2K", "4K"]} onChange={(value) => updateParams("resolution", value as Resolution)} />
                <ParameterSelect label={t("workspace.aspectRatio")} value={draft.params.aspectRatio} values={["1:1", "4:3", "16:9", "3:4", "9:16"]} onChange={(value) => updateParams("aspectRatio", value as AspectRatio)} />
                <ParameterSelect label={t("workspace.quality")} value={draft.params.quality} values={["low", "medium", "high"]} display={qualityLabels} onChange={(value) => updateParams("quality", value as Quality)} />
                <ParameterSelect label={t("workspace.format")} value={draft.params.outputFormat} values={["png", "jpeg", "webp"]} onChange={(value) => updateParams("outputFormat", value as OutputFormat)} />
              </div>
              <button className="send-button" type="button" disabled={!props.analyzing && (recommending || (!draft.text.trim() && !draft.attachments.length))} onClick={props.analyzing ? props.onCancelSend : props.onSend} aria-label={props.analyzing ? t("workspace.cancelSend") : t("workspace.send")} title={props.analyzing ? t("workspace.cancelSend") : t("workspace.send")}>{props.analyzing ? <CircleStop size={17} /> : <Send size={17} />}</button>
            </div>
            {assetsOpen && <div className="asset-picker">
              <div><strong>{t("workspace.historyAssets")}</strong><button type="button" onClick={() => setAssetsOpen(false)} aria-label={t("workspace.closeAssetPicker")}><X size={15} /></button></div>
              {props.assets.some((asset) => !asset.hiddenAt) ? <div className="asset-picker-grid">{props.assets.filter((asset) => !asset.hiddenAt).slice(0, 12).map((asset) => <button type="button" key={asset.id} onClick={() => attachAsset(asset)}><img src={assetSrc(asset)} alt="" /><span>{asset.lineage?.branchLabel || asset.prompt || t("workspace.generatedImage")}</span></button>)}</div> : <p>{t("workspace.noAssets")}</p>}
            </div>}
          </div>
          <small>{t("workspace.serialQueueNote")}</small>
        </div>
      </main>

      <aside className="task-sidebar">
        <div className="task-sidebar-heading"><div><span>{t("workspace.runwayEyebrow")}</span><h2>{t("workspace.serialTasks")}</h2></div><code>{conversationBatches.length}</code></div>
        <div className="task-runway">
          {!conversationBatches.length && <div className="queue-empty"><MoreHorizontal size={22} /><p>{t("workspace.queueEmpty")}</p></div>}
          {[...conversationBatches].reverse().map((batch) => {
            const tasks = props.workspace.tasks.filter((task) => task.batchId === batch.id);
            return <section className="queue-batch" key={batch.id}>
              <header><span>{t("workspace.taskCount", { count: tasks.length })}</span><code>{t(batchStatusKeys[batch.status])}</code>{["queued", "running"].includes(batch.status) && <button type="button" onClick={() => props.onCancelBatch(batch.id)} aria-label={t("workspace.stopBatch")}><CircleStop size={14} /></button>}{batch.status === "interrupted" && <button type="button" onClick={() => props.onResumeBatch(batch.id)} aria-label={t("workspace.resumeBatch")}><Play size={14} /></button>}</header>
              {tasks.map((task) => <QueueTask task={task} key={task.id} onRetry={() => props.onRetryTask(task.id)} />)}
            </section>;
          })}
        </div>
      </aside>
      </>}
      {preview && <ImagePreviewDialog src={preview.src} title={preview.title} onClose={() => setPreview(undefined)} onDraw={preview.asset ? () => { props.onAnnotate(preview.asset!); setPreview(undefined); } : undefined} onContinue={preview.asset ? () => { props.onContinue(preview.asset!); setPreview(undefined); } : undefined} onCompare={preview.asset?.parentId ? () => { const parent = assetMap.get(preview.asset!.parentId!); if (parent) setCompare({ before: parent, after: preview.asset!, alternatives: [...assetMap.values()].filter((candidate) => candidate.parentId === parent.id && !candidate.hiddenAt) }); setPreview(undefined); } : undefined} onExport={preview.asset ? () => props.onExport(preview.asset!) : undefined} />}
      {compare && <BeforeAfterCompare before={compare.before} after={compare.after} alternatives={compare.alternatives} onClose={() => setCompare(undefined)} />}
      {compilePreviewOpen && <CompilePreviewDialog requests={compiledPreviews} onClose={() => setCompilePreviewOpen(false)} />}
    </div>
  );
}

function CompilePreviewDialog({ requests, onClose }: { requests: CompiledEditRequest[]; onClose: () => void }) {
  const { t } = useI18n();
  return <div className="compile-preview-backdrop" role="dialog" aria-modal="true" aria-label={t("workspace.inspectEditRequest")}>
    <div className="compile-preview-dialog">
      <header><div><strong>{t("workspace.editRequest")}</strong><span>{t("workspace.structuredDocumentCount", { count: requests.length })}</span></div><button type="button" onClick={onClose} aria-label={t("workspace.closeRequestInspection")}><X size={18} /></button></header>
      <div className="compile-preview-body">{requests.map((request, index) => <section key={`${request.originalAssetId}-${index}`}>
        <div className="capability-readout"><code>EDIT</code>{request.capabilities.supportsMultipleReferences && <code>MULTI</code>}{request.capabilities.supportsMask && <code>MASK</code>}{request.capabilities.supportsStructuredRegions && <code>REGION</code>}{request.capabilities.supportsLayers && <code>LAYERS</code>}</div>
        {request.diagnostics.length > 0 && <ul>{request.diagnostics.map((diagnostic, diagnosticIndex) => <li className={diagnostic.severity} key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.message}</li>)}</ul>}
        <pre>{request.prompt}</pre>
      </section>)}</div>
      <footer><button className="button primary" type="button" onClick={onClose}>{t("common.done")}</button></footer>
    </div>
  </div>;
}

function ParameterSelect({ label, value, values, display = {}, onChange }: { label: string; value: string; values: string[]; display?: Record<string, string>; onChange: (value: string) => void }) {
  return <label title={label}><span>{display[value] ?? value}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option key={item} value={item}>{display[item] ?? item}</option>)}</select></label>;
}

function ReferenceRoleMenu({ descriptor, onChange }: { descriptor: ReferenceDescriptor; onChange: (descriptor: ReferenceDescriptor) => void }) {
  const { locale, t } = useI18n();
  const referenceRoles = (Object.keys(referenceRoleKeys) as ReferenceRole[]).map((id) => ({ id, label: t(referenceRoleKeys[id]) }));
  const labels = descriptor.roles.map((role) => referenceRoles.find((item) => item.id === role)?.label ?? role);
  const summary = labels.length > 1 ? `${t("workspace.primaryRoleCompact", { role: labels[0] })} +${labels.length - 1}` : t("workspace.primaryRoleCompact", { role: labels[0] ?? t("role.other") });
  return <details className="reference-role-menu">
    <summary role="button" aria-label={t("workspace.referenceRole", { label: descriptor.label })}>{summary}</summary>
    <div>
      <p className="reference-primary-role">{t("workspace.primaryRole", { role: labels[0] ?? t("role.other") })}</p>
      {referenceRoles.map((role) => <label key={role.id}><input type="checkbox" checked={descriptor.roles.includes(role.id)} onChange={(event) => {
        const roles = event.target.checked ? [...new Set([...descriptor.roles.filter((item) => item !== "other"), role.id])] : descriptor.roles.filter((item) => item !== role.id);
        onChange({ ...descriptor, roles: roles.length ? roles : ["other"] });
      }} />{role.label}</label>)}
      <label className="preserve-field"><span>{t("workspace.preserveConstraints")}</span><input aria-label={`${descriptor.label} ${t("workspace.preserveConstraints")}`} value={descriptor.preserve.join(locale === "zh-CN" ? "，" : ", ")} onChange={(event) => onChange({ ...descriptor, preserve: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} placeholder={t("workspace.preservePlaceholder")} /></label>
    </div>
  </details>;
}

function attachmentPreview(attachment: Attachment, assetMap: Map<string, AssetRecord>) {
  if (attachment.kind === "reference") return attachment.dataUrl;
  if (attachment.kind === "annotation") return attachment.annotatedDataUrl;
  const asset = assetMap.get(attachment.assetId);
  return asset ? assetSrc(asset) : undefined;
}

function AttachmentPreview({ attachment, src, title, onPreview }: { attachment: Attachment; src?: string; title: string; onPreview: (src: string) => void }) {
  const { t } = useI18n();
  const [resolved, setResolved] = useState(src);
  useEffect(() => {
    setResolved(src);
    if (src || attachment.kind !== "annotation" || !attachment.compiledOverlayAssetId) return;
    let cancelled = false;
    void bridge.readAnnotationOverlayDataUrl(attachment.compiledOverlayAssetId).then((value) => { if (!cancelled) setResolved(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [attachment, src]);
  return resolved ? <button className="attachment-preview-button" type="button" onClick={() => onPreview(resolved)} aria-label={t("workspace.preview", { title })}><img src={resolved} alt="" /></button> : <span className="attachment-placeholder"><Paperclip size={12} /></span>;
}

function AttachmentChip({ attachment, assetMap, onPreview, onDraw }: { attachment: Attachment; assetMap: Map<string, AssetRecord>; onPreview: (src: string, title: string) => void; onDraw: (asset: AssetRecord, documentId?: string) => void }) {
  const { t } = useI18n();
  const preview = attachmentPreview(attachment, assetMap);
  const title = attachment.kind === "annotation" ? t("workspace.annotationAttachment", { instruction: attachment.instruction }) : attachment.name;
  const source = attachment.kind === "asset" ? assetMap.get(attachment.assetId) : attachment.kind === "annotation" ? assetMap.get(attachment.sourceAssetId) : undefined;
  return <span className="message-attachment">{preview ? <button className="attachment-preview-button" type="button" onClick={() => onPreview(preview, title)} aria-label={t("workspace.preview", { title })}><img src={preview} alt="" /></button> : <Paperclip size={12} />}<span>{attachment.kind === "annotation" ? "Annotation" : attachment.kind === "reference" ? attachment.descriptor?.label ?? title : attachment.descriptor?.label ?? title}</span>{source && <button className="message-draw-button" type="button" onClick={() => onDraw(source, attachment.kind === "annotation" ? attachment.documentId : undefined)} aria-label={`Draw ${title}`} title={t("preview.draw")}><PencilLine size={11} /></button>}</span>;
}

function EmptyConversation() {
  const { t } = useI18n();
  return <div className="empty-conversation"><span className="empty-monogram">I²</span><h2>{t("workspace.emptyTitle")}</h2><p>{t("workspace.emptyDescription")}</p><div><span>{t("workspace.examplePortrait")}</span><span>{t("workspace.exampleProduct")}</span><span>{t("workspace.exampleCampaign")}</span></div></div>;
}

function BatchResults({ tasks, aspectRatio, assetMap, onAnnotate, onContinue, onRegenerate, onRename, onHide, onExport, onCompare, onPreview }: { tasks: GenerationTask[]; aspectRatio: AspectRatio; assetMap: Map<string, AssetRecord>; onAnnotate: (asset: AssetRecord) => void; onContinue: (asset: AssetRecord) => void; onRegenerate: (task: GenerationTask) => void; onRename: (asset: AssetRecord, label: string) => void; onHide: (asset: AssetRecord) => void; onExport: (asset: AssetRecord) => void; onCompare: (asset: AssetRecord) => void; onPreview: (src: string, title: string, asset: AssetRecord) => void }) {
  const { t } = useI18n();
  return <div className="batch-results">{tasks.map((task) => {
    const asset = task.resultAssetId ? assetMap.get(task.resultAssetId) : undefined;
    const children = asset ? [...assetMap.values()].filter((candidate) => candidate.parentId === asset.id) : [];
    return <div className={`result-tile ${task.status}`} key={task.id}>
      <div className={`result-media ${asset ? "has-image" : ""}`} style={asset ? undefined : { aspectRatio: aspectRatio.replace(":", " / ") }}>{asset ? <><button type="button" onClick={() => onPreview(assetSrc(asset), task.title, asset)} aria-label={t("workspace.preview", { title: task.title })}><img src={assetSrc(asset)} alt="" /></button><span className="asset-hover-actions"><button type="button" onClick={() => onAnnotate(asset)} aria-label={`Draw ${task.title}`} title={t("preview.draw")}><PencilLine size={13} /></button><button type="button" onClick={() => onRegenerate(task)} aria-label={t("workspace.regenerate", { title: task.title })} title={t("workspace.regenerateTitle")}><Repeat2 size={13} /></button><button type="button" onClick={() => onContinue(asset)} aria-label={t("workspace.continue", { title: task.title })} title={t("workspace.continueTitle")}><GitBranch size={13} /></button><button type="button" onClick={() => onExport(asset)} aria-label={t("workspace.exportTitle", { title: task.title })} title={t("common.download")}><Download size={13} /></button>{asset.parentId && <button type="button" onClick={() => onCompare(asset)} aria-label={t("workspace.compare", { title: task.title })} title={t("workspace.compareTitle")}><Columns2 size={13} /></button>}</span></> : task.status === "failed" ? <AlertCircle size={24} /> : task.status === "running" ? <LoaderCircle className="spin" size={24} /> : <span>{String(task.position + 1).padStart(2, "0")}</span>}</div>
      <div className="result-caption"><div><strong>{asset?.lineage?.branchLabel || task.title}</strong><small>{t(statusKeys[task.status])}</small></div>{asset && <span><button type="button" onClick={() => { const label = window.prompt(t("workspace.versionNamePrompt"), asset.lineage?.branchLabel || task.title); if (label?.trim()) onRename(asset, label); }} aria-label={t("workspace.renameVersion", { title: task.title })} title={t("workspace.renameVersionTitle")}><Tag size={14} /></button><button type="button" onClick={() => onHide(asset)} aria-label={t("workspace.hideVersion", { title: task.title })} title={t("workspace.hideVersionTitle")}><EyeOff size={14} /></button><button type="button" onClick={() => onAnnotate(asset)} aria-label={t("workspace.annotate", { title: task.title })} title={t("workspace.annotateTitle")}><PencilLine size={14} /></button><button type="button" onClick={() => onExport(asset)} aria-label={t("workspace.exportTitle", { title: task.title })} title={t("common.download")}><Download size={14} /></button></span>}</div>
      {asset && (asset.parentId || children.length > 0) && <div className="version-trail"><GitBranch size={11} /><span>{t("workspace.revision", { revision: asset.lineage?.revision ?? (asset.parentId ? 1 : 0), kind: asset.parentId ? t("workspace.childVersion") : t("workspace.rootVersion") })}</span><code>{t("workspace.branchCount", { count: children.length })}</code></div>}
    </div>;
  })}</div>;
}

function BeforeAfterCompare({ before, after, alternatives, onClose }: { before: AssetRecord; after: AssetRecord; alternatives: AssetRecord[]; onClose: () => void }) {
  const { t } = useI18n();
  const [position, setPosition] = useState(50);
  const [afterId, setAfterId] = useState(after.id);
  const selectedAfter = alternatives.find((asset) => asset.id === afterId) ?? after;
  return <div className="compare-backdrop" role="dialog" aria-modal="true" aria-label={t("workspace.compareDialog")}>
    <div className="compare-dialog">
      <header><div><strong>{t("workspace.versionCompare")}</strong><span>{before.prompt || t("workspace.parentVersion")} / {selectedAfter.lineage?.branchLabel || selectedAfter.prompt || t("workspace.currentVersion")}</span></div>{alternatives.length > 1 && <select aria-label={t("workspace.selectSibling")} value={selectedAfter.id} onChange={(event) => setAfterId(event.target.value)}>{alternatives.map((asset) => <option key={asset.id} value={asset.id}>{asset.lineage?.branchLabel || asset.prompt || `R${asset.lineage?.revision ?? 1}`}</option>)}</select>}<button type="button" onClick={onClose} aria-label={t("workspace.closeCompare")}><X size={18} /></button></header>
      <div className="compare-stage">
        <img src={assetSrc(before)} alt={t("workspace.parentVersion")} />
        <div className="compare-after" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><img src={assetSrc(selectedAfter)} alt={t("workspace.currentVersion")} /></div>
        <i style={{ left: `${position}%` }} />
      </div>
      <footer><span>{t("workspace.parentVersion")}</span><input type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} aria-label={t("workspace.adjustCompare")} /><span>{t("workspace.currentVersion")}</span></footer>
    </div>
  </div>;
}

function QueueTask({ task, onRetry }: { task: GenerationTask; onRetry: () => void }) {
  const { t } = useI18n();
  const Icon = task.status === "succeeded" ? Check : task.status === "running" ? LoaderCircle : task.status === "failed" ? AlertCircle : task.status === "interrupted" ? CircleStop : MoreHorizontal;
  return <div className={`queue-task ${task.status}`}><span className="runway-node"><Icon className={task.status === "running" ? "spin" : ""} size={13} /></span><div><strong>{task.title}</strong><small>{task.error || t(statusKeys[task.status])}</small></div>{["failed", "interrupted", "cancelled"].includes(task.status) && <button type="button" onClick={onRetry} aria-label={t("workspace.retry", { title: task.title })} title={t("workspace.retryTitle")}><RefreshCw size={13} /></button>}</div>;
}
