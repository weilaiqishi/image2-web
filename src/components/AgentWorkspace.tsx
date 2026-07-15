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
import { assetSrc, bridge, filesToDataUrls } from "../lib/bridge";
import { compileEditRequest, providerCapabilitiesForModel, type CompiledEditRequest } from "../lib/promptCompiler";
import { PromptLibrary } from "./PromptLibrary";
import { ChoiceFeedback } from "./ChoiceFeedback";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
import { StructuredComposer } from "./StructuredComposer";
import {
  SIZE_PRESETS,
  type AspectRatio,
  type AssetRecord,
  type Attachment,
  type ComposerDraft,
  type GenerationParams,
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

const statusLabel: Record<GenerationTask["status"], string> = {
  queued: "等待中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断",
};

const referenceRoles: Array<{ id: ReferenceRole; label: string }> = [
  { id: "base", label: "原图" }, { id: "identity", label: "人物" }, { id: "product", label: "产品" },
  { id: "pose", label: "动作" }, { id: "composition", label: "构图" }, { id: "material", label: "材质" },
  { id: "palette", label: "色卡" }, { id: "style", label: "风格" }, { id: "layout", label: "版式" },
  { id: "logo", label: "Logo" }, { id: "other", label: "其他" },
];

export function AgentWorkspace(props: AgentWorkspaceProps) {
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
    const attachment: Attachment = { id: crypto.randomUUID(), kind: "asset", assetId: asset.id, name: asset.prompt || "历史图片" };
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
        for (const object of document?.objects ?? []) items.push({ id: object.id, label: object.displayName, detail: object.kind, documentId: document.id, sourceAssetId: document.sourceAssetId });
      } else if (attachment.descriptor) {
        items.push({ id: attachment.id, label: attachment.descriptor.label, detail: attachment.descriptor.roles.map((role) => referenceRoles.find((item) => item.id === role)?.label ?? role).join("/") });
      }
    }
    return items;
  }, [draft.attachments, props.workspace.annotationDocuments]);

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
  }), [draft.attachments, draft.params, draft.text, props.settings.imageModel, props.workspace.annotationDocuments]);

  return (
    <div className={`agent-shell ${props.view === "inspire" ? "inspiration-view" : ""}`}>
      <aside className="conversation-sidebar">
        <div className="agent-brand"><span className={`brand-mark ${working ? "working" : ""}`}>I²</span><div><strong>Image2</strong><small>Agent Studio</small></div></div>
        <button className="new-chat-button" type="button" onClick={props.onNewConversation}><MessageSquarePlus size={16} />新对话</button>
        <nav className="sidebar-primary-nav" aria-label="主导航">
          <button className={props.view === "inspire" ? "active" : ""} type="button" onClick={() => props.onViewChange("inspire")}><Lightbulb size={15} />灵感库</button>
        </nav>
        <div className="conversation-list" aria-label="对话列表">
          {props.workspace.conversations.map((item) => (
            <div className={`conversation-row ${item.id === conversation.id ? "active" : ""}`} key={item.id}>
              <button type="button" onClick={() => props.onSelectConversation(item.id)} onDoubleClick={() => {
                const title = window.prompt("重命名对话", item.title);
                if (title) props.onRenameConversation(item.id, title);
              }}><span>{item.title}</span><time>{new Date(item.updatedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></button>
              <button className="conversation-menu" type="button" onClick={() => props.onDeleteConversation(item.id)} aria-label={`删除 ${item.title}`} title="删除对话"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <button type="button" onClick={props.onSettings}><Settings size={16} /><span>连接设置</span><i className={props.settings.hasApiKey ? "online" : ""} /></button>
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
          <div><span>当前会话</span><h1>{conversation.title}</h1></div>
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
                  <div className="message-author">{message.role === "user" ? "你" : <><Sparkles size={13} />Image2 Agent</>}</div>
                  <p>{message.content}</p>
                  {message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <AttachmentChip attachment={attachment} assetMap={assetMap} key={attachment.id} onPreview={(src, title) => setPreview({ src, title })} onDraw={(asset, documentId) => props.onAnnotate(asset, documentId)} />)}</div>}
                  {batch && <BatchResults tasks={tasks} aspectRatio={batch.params.aspectRatio} assetMap={assetMap} onAnnotate={props.onAnnotate} onContinue={props.onContinue} onRegenerate={props.onRegenerate} onRename={props.onRenameVersion} onHide={props.onHideVersion} onExport={props.onExport} onCompare={(asset) => { const parent = asset.parentId ? assetMap.get(asset.parentId) : undefined; if (parent) setCompare({ before: parent, after: asset, alternatives: [...assetMap.values()].filter((candidate) => candidate.parentId === parent.id && !candidate.hiddenAt) }); }} onPreview={(src, title, asset) => setPreview({ src, title, asset })} />}
                </article>
              );
            })}
            {props.analyzing && <div className="agent-thinking"><span className="thinking-logo">I²</span>正在理解需求并编排任务</div>}
          </div>
        </div>

        <div className="composer-zone">
          <div className="composer">
            {draft.attachments.length > 0 && <div className="composer-attachments">
              {draft.attachments.map((attachment, attachmentIndex) => {
                const src = attachmentPreview(attachment, assetMap);
                const title = attachment.kind === "annotation" ? "标注修改" : attachment.name;
                const sourceAsset = attachment.kind === "asset" ? assetMap.get(attachment.assetId) : attachment.kind === "annotation" ? assetMap.get(attachment.sourceAssetId) : undefined;
                return <span className="composer-attachment" key={attachment.id}>
                  <AttachmentPreview attachment={attachment} src={src} title={title} onPreview={(previewSrc) => setPreview({ src: previewSrc, title })} />
                  <span className="composer-attachment-copy"><strong>{attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title}</strong><small>{title}</small></span>
                  {attachment.kind !== "annotation" && attachment.descriptor && <span className="reference-controls">
                    <ReferenceRoleMenu descriptor={attachment.descriptor} onChange={(descriptor) => updateAttachment(attachment.id, (current) => current.kind === "annotation" ? current : { ...current, descriptor })} />
                    <select aria-label={`${attachment.descriptor.label} 优先级`} value={attachment.descriptor.priority} onChange={(event) => updateAttachment(attachment.id, (current) => current.kind === "annotation" ? current : { ...current, descriptor: { ...current.descriptor!, priority: Number(event.target.value) } })}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
                  </span>}
                  {sourceAsset && <button className="attachment-draw-button" type="button" onClick={() => props.onAnnotate(sourceAsset, attachment.kind === "annotation" ? attachment.documentId : undefined)} aria-label={`Draw ${title}`} title="Draw"><PencilLine size={12} /></button>}
                  <span className="attachment-order-controls"><button type="button" disabled={attachmentIndex === 0} onClick={() => moveAttachment(attachmentIndex, -1)} aria-label={`前移 ${attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title}`} title="前移"><ChevronLeft size={12} /></button><button type="button" disabled={attachmentIndex === draft.attachments.length - 1} onClick={() => moveAttachment(attachmentIndex, 1)} aria-label={`后移 ${attachment.kind === "annotation" ? "Annotation" : attachment.descriptor?.label ?? title}`} title="后移"><ChevronRight size={12} /></button></span>
                  <button className="attachment-remove-button" type="button" onClick={() => props.onDraftChange({ attachments: draft.attachments.filter((item) => item.id !== attachment.id) })} aria-label="移除附件"><X size={12} /></button>
                </span>;
              })}
            </div>}
            {draft.recommendation?.status === "loading" && <ChoiceFeedback loading title="正在分析参考图" description="Agent 正在判断更合适的画面比例与质量。" />}
            {draft.recommendation?.status === "ready" && <ChoiceFeedback
              title={`推荐 ${draft.recommendation.aspectRatio} · ${{ low: "草稿", medium: "标准", high: "精细" }[draft.recommendation.quality]}`}
              description={draft.recommendation.reason}
              options={[{ id: "apply", label: "应用推荐", primary: true }, { id: "dismiss", label: "保持当前" }]}
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
              placeholder="描述你要完成的一组图片，例如：保持这个妆容，生成三视图"
              ariaLabel="给 Image2 Agent 发消息"
            />
            {mentionOpen && mentionItems.length > 0 && <div className="composer-mention-menu" role="listbox" aria-label="插入引用">{mentionItems.map((item) => <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => insertMention(item)}><strong>@{item.label}</strong><span>{item.detail}</span></button>)}</div>}
            <div className="composer-toolbar">
              <div className="attachment-tools">
                <button type="button" onClick={() => fileInput.current?.click()} aria-label="添加参考图" title="添加参考图"><ImagePlus size={16} /></button>
                <button className={assetsOpen ? "active" : ""} type="button" onClick={() => setAssetsOpen((value) => !value)} aria-label="选择历史图片" title="历史素材"><History size={16} /></button>
                {compiledPreviews.length > 0 && <button type="button" onClick={() => setCompilePreviewOpen(true)} aria-label="检查编辑请求" title="检查编辑请求"><FileSearch size={16} /></button>}
                <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} />
              </div>
              <div className="parameter-tags" aria-label="生成参数">
                <ParameterSelect label="分辨率" value={draft.params.resolution} values={["1K", "2K", "4K"]} onChange={(value) => updateParams("resolution", value as Resolution)} />
                <ParameterSelect label="比例" value={draft.params.aspectRatio} values={["1:1", "4:3", "16:9", "3:4", "9:16"]} onChange={(value) => updateParams("aspectRatio", value as AspectRatio)} />
                <ParameterSelect label="质量" value={draft.params.quality} values={["low", "medium", "high"]} display={{ low: "草稿", medium: "标准", high: "精细" }} onChange={(value) => updateParams("quality", value as Quality)} />
                <ParameterSelect label="格式" value={draft.params.outputFormat} values={["png", "jpeg", "webp"]} onChange={(value) => updateParams("outputFormat", value as OutputFormat)} />
              </div>
              <button className="send-button" type="button" disabled={!props.analyzing && (recommending || (!draft.text.trim() && !draft.attachments.length))} onClick={props.analyzing ? props.onCancelSend : props.onSend} aria-label={props.analyzing ? "取消发送" : "发送"} title={props.analyzing ? "取消发送" : "发送"}>{props.analyzing ? <CircleStop size={17} /> : <Send size={17} />}</button>
            </div>
            {assetsOpen && <div className="asset-picker">
              <div><strong>历史素材</strong><button type="button" onClick={() => setAssetsOpen(false)} aria-label="关闭素材选择"><X size={15} /></button></div>
              {props.assets.some((asset) => !asset.hiddenAt) ? <div className="asset-picker-grid">{props.assets.filter((asset) => !asset.hiddenAt).slice(0, 12).map((asset) => <button type="button" key={asset.id} onClick={() => attachAsset(asset)}><img src={assetSrc(asset)} alt="" /><span>{asset.lineage?.branchLabel || asset.prompt || "生成图片"}</span></button>)}</div> : <p>还没有可用图片。</p>}
            </div>}
          </div>
          <small>任务会按照右侧队列顺序逐个执行</small>
        </div>
      </main>

      <aside className="task-sidebar">
        <div className="task-sidebar-heading"><div><span>执行轨道</span><h2>串行任务</h2></div><code>{conversationBatches.length}</code></div>
        <div className="task-runway">
          {!conversationBatches.length && <div className="queue-empty"><MoreHorizontal size={22} /><p>Agent 创建的任务会依次出现在这里。</p></div>}
          {[...conversationBatches].reverse().map((batch) => {
            const tasks = props.workspace.tasks.filter((task) => task.batchId === batch.id);
            return <section className="queue-batch" key={batch.id}>
              <header><span>{tasks.length} 项任务</span><code>{batch.status}</code>{["queued", "running"].includes(batch.status) && <button type="button" onClick={() => props.onCancelBatch(batch.id)} aria-label="停止批次"><CircleStop size={14} /></button>}{batch.status === "interrupted" && <button type="button" onClick={() => props.onResumeBatch(batch.id)} aria-label="恢复批次"><Play size={14} /></button>}</header>
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
  return <div className="compile-preview-backdrop" role="dialog" aria-modal="true" aria-label="编辑请求检查">
    <div className="compile-preview-dialog">
      <header><div><strong>编辑请求</strong><span>{requests.length} 个结构化文档</span></div><button type="button" onClick={onClose} aria-label="关闭请求检查"><X size={18} /></button></header>
      <div className="compile-preview-body">{requests.map((request, index) => <section key={`${request.originalAssetId}-${index}`}>
        <div className="capability-readout"><code>EDIT</code>{request.capabilities.supportsMultipleReferences && <code>MULTI</code>}{request.capabilities.supportsMask && <code>MASK</code>}{request.capabilities.supportsStructuredRegions && <code>REGION</code>}{request.capabilities.supportsLayers && <code>LAYERS</code>}</div>
        {request.diagnostics.length > 0 && <ul>{request.diagnostics.map((diagnostic, diagnosticIndex) => <li className={diagnostic.severity} key={`${diagnostic.code}-${diagnosticIndex}`}>{diagnostic.message}</li>)}</ul>}
        <pre>{request.prompt}</pre>
      </section>)}</div>
      <footer><button className="button primary" type="button" onClick={onClose}>完成检查</button></footer>
    </div>
  </div>;
}

function ParameterSelect({ label, value, values, display = {}, onChange }: { label: string; value: string; values: string[]; display?: Record<string, string>; onChange: (value: string) => void }) {
  return <label title={label}><span>{display[value] ?? value}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option key={item} value={item}>{display[item] ?? item}</option>)}</select></label>;
}

function ReferenceRoleMenu({ descriptor, onChange }: { descriptor: ReferenceDescriptor; onChange: (descriptor: ReferenceDescriptor) => void }) {
  const labels = descriptor.roles.map((role) => referenceRoles.find((item) => item.id === role)?.label ?? role);
  const summary = labels.length > 1 ? `主:${labels[0]} +${labels.length - 1}` : `主:${labels[0] ?? "其他"}`;
  return <details className="reference-role-menu">
    <summary role="button" aria-label={`${descriptor.label} 参考角色`}>{summary}</summary>
    <div>
      <p className="reference-primary-role">主角色：{labels[0] ?? "其他"}</p>
      {referenceRoles.map((role) => <label key={role.id}><input type="checkbox" checked={descriptor.roles.includes(role.id)} onChange={(event) => {
        const roles = event.target.checked ? [...new Set([...descriptor.roles.filter((item) => item !== "other"), role.id])] : descriptor.roles.filter((item) => item !== role.id);
        onChange({ ...descriptor, roles: roles.length ? roles : ["other"] });
      }} />{role.label}</label>)}
      <label className="preserve-field"><span>保持约束</span><input aria-label={`${descriptor.label} 保持约束`} value={descriptor.preserve.join("，")} onChange={(event) => onChange({ ...descriptor, preserve: event.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} placeholder="主体结构，未标注区域" /></label>
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
  const [resolved, setResolved] = useState(src);
  useEffect(() => {
    setResolved(src);
    if (src || attachment.kind !== "annotation" || !attachment.compiledOverlayAssetId) return;
    let cancelled = false;
    void bridge.readAnnotationOverlayDataUrl(attachment.compiledOverlayAssetId).then((value) => { if (!cancelled) setResolved(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [attachment, src]);
  return resolved ? <button className="attachment-preview-button" type="button" onClick={() => onPreview(resolved)} aria-label={`预览 ${title}`}><img src={resolved} alt="" /></button> : <span className="attachment-placeholder"><Paperclip size={12} /></span>;
}

function AttachmentChip({ attachment, assetMap, onPreview, onDraw }: { attachment: Attachment; assetMap: Map<string, AssetRecord>; onPreview: (src: string, title: string) => void; onDraw: (asset: AssetRecord, documentId?: string) => void }) {
  const preview = attachmentPreview(attachment, assetMap);
  const title = attachment.kind === "annotation" ? `标注：${attachment.instruction}` : attachment.name;
  const source = attachment.kind === "asset" ? assetMap.get(attachment.assetId) : attachment.kind === "annotation" ? assetMap.get(attachment.sourceAssetId) : undefined;
  return <span className="message-attachment">{preview ? <button className="attachment-preview-button" type="button" onClick={() => onPreview(preview, title)} aria-label={`预览 ${title}`}><img src={preview} alt="" /></button> : <Paperclip size={12} />}<span>{attachment.kind === "annotation" ? "Annotation" : attachment.kind === "reference" ? attachment.descriptor?.label ?? title : attachment.descriptor?.label ?? title}</span>{source && <button className="message-draw-button" type="button" onClick={() => onDraw(source, attachment.kind === "annotation" ? attachment.documentId : undefined)} aria-label={`Draw ${title}`} title="Draw"><PencilLine size={11} /></button>}</span>;
}

function EmptyConversation() {
  return <div className="empty-conversation"><span className="empty-monogram">I²</span><h2>从一个目标开始</h2><p>上传参考图，说明最终需要哪些素材。Agent 会先拆成独立任务，再按顺序生成。</p><div><span>人物三视图</span><span>产品多角度</span><span>系列广告素材</span></div></div>;
}

function BatchResults({ tasks, aspectRatio, assetMap, onAnnotate, onContinue, onRegenerate, onRename, onHide, onExport, onCompare, onPreview }: { tasks: GenerationTask[]; aspectRatio: AspectRatio; assetMap: Map<string, AssetRecord>; onAnnotate: (asset: AssetRecord) => void; onContinue: (asset: AssetRecord) => void; onRegenerate: (task: GenerationTask) => void; onRename: (asset: AssetRecord, label: string) => void; onHide: (asset: AssetRecord) => void; onExport: (asset: AssetRecord) => void; onCompare: (asset: AssetRecord) => void; onPreview: (src: string, title: string, asset: AssetRecord) => void }) {
  return <div className="batch-results">{tasks.map((task) => {
    const asset = task.resultAssetId ? assetMap.get(task.resultAssetId) : undefined;
    const children = asset ? [...assetMap.values()].filter((candidate) => candidate.parentId === asset.id) : [];
    return <div className={`result-tile ${task.status}`} key={task.id}>
      <div className={`result-media ${asset ? "has-image" : ""}`} style={asset ? undefined : { aspectRatio: aspectRatio.replace(":", " / ") }}>{asset ? <><button type="button" onClick={() => onPreview(assetSrc(asset), task.title, asset)} aria-label={`预览 ${task.title}`}><img src={assetSrc(asset)} alt="" /></button><span className="asset-hover-actions"><button type="button" onClick={() => onAnnotate(asset)} aria-label={`Draw ${task.title}`} title="Draw"><PencilLine size={13} /></button><button type="button" onClick={() => onRegenerate(task)} aria-label={`重新生成 ${task.title}`} title="重新生成"><Repeat2 size={13} /></button><button type="button" onClick={() => onContinue(asset)} aria-label={`基于 ${task.title} 继续`} title="基于此图继续"><GitBranch size={13} /></button><button type="button" onClick={() => onExport(asset)} aria-label={`导出 ${task.title}`} title="导出"><Download size={13} /></button>{asset.parentId && <button type="button" onClick={() => onCompare(asset)} aria-label={`对比 ${task.title}`} title="前后对比"><Columns2 size={13} /></button>}</span></> : task.status === "failed" ? <AlertCircle size={24} /> : task.status === "running" ? <LoaderCircle className="spin" size={24} /> : <span>{String(task.position + 1).padStart(2, "0")}</span>}</div>
      <div className="result-caption"><div><strong>{asset?.lineage?.branchLabel || task.title}</strong><small>{statusLabel[task.status]}</small></div>{asset && <span><button type="button" onClick={() => { const label = window.prompt("版本名称", asset.lineage?.branchLabel || task.title); if (label?.trim()) onRename(asset, label); }} aria-label={`重命名 ${task.title}`} title="重命名版本"><Tag size={14} /></button><button type="button" onClick={() => onHide(asset)} aria-label={`隐藏 ${task.title}`} title="隐藏版本"><EyeOff size={14} /></button><button type="button" onClick={() => onAnnotate(asset)} aria-label={`标注 ${task.title}`} title="标注修改"><PencilLine size={14} /></button><button type="button" onClick={() => onExport(asset)} aria-label={`导出 ${task.title}`} title="导出"><Download size={14} /></button></span>}</div>
      {asset && (asset.parentId || children.length > 0) && <div className="version-trail"><GitBranch size={11} /><span>R{asset.lineage?.revision ?? (asset.parentId ? 1 : 0)} · {asset.parentId ? "子版本" : "根版本"}</span><code>{children.length} 分支</code></div>}
    </div>;
  })}</div>;
}

function BeforeAfterCompare({ before, after, alternatives, onClose }: { before: AssetRecord; after: AssetRecord; alternatives: AssetRecord[]; onClose: () => void }) {
  const [position, setPosition] = useState(50);
  const [afterId, setAfterId] = useState(after.id);
  const selectedAfter = alternatives.find((asset) => asset.id === afterId) ?? after;
  return <div className="compare-backdrop" role="dialog" aria-modal="true" aria-label="前后对比">
    <div className="compare-dialog">
      <header><div><strong>版本对比</strong><span>{before.prompt || "父版本"} / {selectedAfter.lineage?.branchLabel || selectedAfter.prompt || "当前版本"}</span></div>{alternatives.length > 1 && <select aria-label="选择兄弟方案" value={selectedAfter.id} onChange={(event) => setAfterId(event.target.value)}>{alternatives.map((asset) => <option key={asset.id} value={asset.id}>{asset.lineage?.branchLabel || asset.prompt || `R${asset.lineage?.revision ?? 1}`}</option>)}</select>}<button type="button" onClick={onClose} aria-label="关闭对比"><X size={18} /></button></header>
      <div className="compare-stage">
        <img src={assetSrc(before)} alt="父版本" />
        <div className="compare-after" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><img src={assetSrc(selectedAfter)} alt="当前版本" /></div>
        <i style={{ left: `${position}%` }} />
      </div>
      <footer><span>父版本</span><input type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} aria-label="调整前后对比" /><span>当前版本</span></footer>
    </div>
  </div>;
}

function QueueTask({ task, onRetry }: { task: GenerationTask; onRetry: () => void }) {
  const Icon = task.status === "succeeded" ? Check : task.status === "running" ? LoaderCircle : task.status === "failed" ? AlertCircle : task.status === "interrupted" ? CircleStop : MoreHorizontal;
  return <div className={`queue-task ${task.status}`}><span className="runway-node"><Icon className={task.status === "running" ? "spin" : ""} size={13} /></span><div><strong>{task.title}</strong><small>{task.error || statusLabel[task.status]}</small></div>{["failed", "interrupted", "cancelled"].includes(task.status) && <button type="button" onClick={onRetry} aria-label={`重试 ${task.title}`} title="重试"><RefreshCw size={13} /></button>}</div>;
}
