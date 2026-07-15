import {
  AlertCircle,
  Check,
  CircleStop,
  Download,
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
  Send,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { assetSrc, filesToDataUrls } from "../lib/bridge";
import { promptCatalog, promptCatalogSource } from "../lib/promptCatalog";
import { PromptLibrary } from "./PromptLibrary";
import { ChoiceFeedback } from "./ChoiceFeedback";
import { ImagePreviewDialog } from "./ImagePreviewDialog";
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
  type PromptTemplate,
  type Resolution,
  type Settings as StudioSettings,
  type WorkspaceState,
} from "../types";

interface AgentWorkspaceProps {
  workspace: WorkspaceState;
  assets: AssetRecord[];
  settings: StudioSettings;
  analyzing: boolean;
  view: "chat" | "inspire";
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onDeleteConversation: (id: string) => void;
  onDraftChange: (draft: Partial<ComposerDraft>) => void;
  onAddAttachments: (attachments: Attachment[]) => void;
  onAnswerRecommendation: (apply: boolean) => void;
  onViewChange: (view: "chat" | "inspire") => void;
  onUseTemplate: (template: PromptTemplate) => void;
  onSend: () => void;
  onSettings: () => void;
  onAnnotate: (asset: AssetRecord) => void;
  onExport: (asset: AssetRecord) => void;
  onCancelBatch: (id: string) => void;
  onResumeBatch: (id: string) => void;
  onRetryTask: (id: string) => void;
}

const statusLabel: Record<GenerationTask["status"], string> = {
  queued: "等待中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断",
};

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const conversation = props.workspace.conversations.find((item) => item.id === props.workspace.selectedConversationId) ?? props.workspace.conversations[0];
  const draft = props.workspace.drafts[conversation.id];
  const messages = props.workspace.messages.filter((message) => message.conversationId === conversation.id);
  const conversationBatches = props.workspace.batches.filter((batch) => batch.conversationId === conversation.id);
  const assetMap = useMemo(() => new Map(props.assets.map((asset) => [asset.id, asset])), [props.assets]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [preview, setPreview] = useState<{ src: string; title: string }>();
  const recommending = draft.recommendation?.status === "loading";
  const working = props.analyzing || recommending;

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/") && file.size <= 20 * 1024 * 1024).slice(0, 4);
    const dataUrls = await filesToDataUrls(images);
    const attachments: Attachment[] = images.map((file, index) => ({ id: crypto.randomUUID(), kind: "reference", name: file.name, dataUrl: dataUrls[index] }));
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
        <PromptLibrary templates={promptCatalog} source={promptCatalogSource} onUse={props.onUseTemplate} />
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
                  {message.attachments.length > 0 && <div className="message-attachments">{message.attachments.map((attachment) => <AttachmentChip attachment={attachment} assetMap={assetMap} key={attachment.id} onPreview={(src, title) => setPreview({ src, title })} />)}</div>}
                  {batch && <BatchResults tasks={tasks} aspectRatio={batch.params.aspectRatio} assetMap={assetMap} onAnnotate={props.onAnnotate} onExport={props.onExport} onPreview={(src, title) => setPreview({ src, title })} />}
                </article>
              );
            })}
            {props.analyzing && <div className="agent-thinking"><span className="thinking-logo">I²</span>正在理解需求并编排任务</div>}
          </div>
        </div>

        <div className="composer-zone">
          <div className="composer">
            {draft.attachments.length > 0 && <div className="composer-attachments">
              {draft.attachments.map((attachment) => {
                const src = attachmentPreview(attachment, assetMap);
                const title = attachment.kind === "annotation" ? "标注修改" : attachment.name;
                return <span className="composer-attachment" key={attachment.id}>{src && <button className="attachment-preview-button" type="button" onClick={() => setPreview({ src, title })} aria-label={`预览 ${title}`}><img src={src} alt="" /></button>}<span>{title}</span><button type="button" onClick={() => props.onDraftChange({ attachments: draft.attachments.filter((item) => item.id !== attachment.id) })} aria-label="移除附件"><X size={12} /></button></span>;
              })}
            </div>}
            {draft.recommendation?.status === "loading" && <ChoiceFeedback loading title="正在分析参考图" description="Agent 正在判断更合适的画面比例与质量。" />}
            {draft.recommendation?.status === "ready" && <ChoiceFeedback
              title={`推荐 ${draft.recommendation.aspectRatio} · ${{ low: "草稿", medium: "标准", high: "精细" }[draft.recommendation.quality]}`}
              description={draft.recommendation.reason}
              options={[{ id: "apply", label: "应用推荐", primary: true }, { id: "dismiss", label: "保持当前" }]}
              onChoose={(id) => props.onAnswerRecommendation(id === "apply")}
            />}
            <textarea
              value={draft.text}
              onChange={(event) => props.onDraftChange({ text: event.target.value })}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                if (files.length) { event.preventDefault(); void addFiles(files); }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); props.onSend(); }
              }}
              placeholder="描述你要完成的一组图片，例如：保持这个妆容，生成三视图"
              aria-label="给 Image2 Agent 发消息"
            />
            <div className="composer-toolbar">
              <div className="attachment-tools">
                <button type="button" onClick={() => fileInput.current?.click()} aria-label="添加参考图" title="添加参考图"><ImagePlus size={16} /></button>
                <button className={assetsOpen ? "active" : ""} type="button" onClick={() => setAssetsOpen((value) => !value)} aria-label="选择历史图片" title="历史素材"><History size={16} /></button>
                <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void addFiles(Array.from(event.target.files ?? []))} />
              </div>
              <div className="parameter-tags" aria-label="生成参数">
                <ParameterSelect label="分辨率" value={draft.params.resolution} values={["1K", "2K", "4K"]} onChange={(value) => updateParams("resolution", value as Resolution)} />
                <ParameterSelect label="比例" value={draft.params.aspectRatio} values={["1:1", "4:3", "16:9", "3:4", "9:16"]} onChange={(value) => updateParams("aspectRatio", value as AspectRatio)} />
                <ParameterSelect label="质量" value={draft.params.quality} values={["low", "medium", "high"]} display={{ low: "草稿", medium: "标准", high: "精细" }} onChange={(value) => updateParams("quality", value as Quality)} />
                <ParameterSelect label="格式" value={draft.params.outputFormat} values={["png", "jpeg", "webp"]} onChange={(value) => updateParams("outputFormat", value as OutputFormat)} />
              </div>
              <button className="send-button" type="button" disabled={working || (!draft.text.trim() && !draft.attachments.length)} onClick={props.onSend} aria-label="发送"><Send size={17} /></button>
            </div>
            {assetsOpen && <div className="asset-picker">
              <div><strong>历史素材</strong><button type="button" onClick={() => setAssetsOpen(false)} aria-label="关闭素材选择"><X size={15} /></button></div>
              {props.assets.length ? <div className="asset-picker-grid">{props.assets.slice(0, 12).map((asset) => <button type="button" key={asset.id} onClick={() => attachAsset(asset)}><img src={assetSrc(asset)} alt="" /><span>{asset.prompt || "生成图片"}</span></button>)}</div> : <p>还没有可用图片。</p>}
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
      {preview && <ImagePreviewDialog src={preview.src} title={preview.title} onClose={() => setPreview(undefined)} />}
    </div>
  );
}

function ParameterSelect({ label, value, values, display = {}, onChange }: { label: string; value: string; values: string[]; display?: Record<string, string>; onChange: (value: string) => void }) {
  return <label title={label}><span>{display[value] ?? value}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{values.map((item) => <option key={item} value={item}>{display[item] ?? item}</option>)}</select></label>;
}

function attachmentPreview(attachment: Attachment, assetMap: Map<string, AssetRecord>) {
  if (attachment.kind === "reference") return attachment.dataUrl;
  if (attachment.kind === "annotation") return attachment.annotatedDataUrl;
  const asset = assetMap.get(attachment.assetId);
  return asset ? assetSrc(asset) : undefined;
}

function AttachmentChip({ attachment, assetMap, onPreview }: { attachment: Attachment; assetMap: Map<string, AssetRecord>; onPreview: (src: string, title: string) => void }) {
  const preview = attachmentPreview(attachment, assetMap);
  const title = attachment.kind === "annotation" ? `标注：${attachment.instruction}` : attachment.name;
  return <span className="message-attachment">{preview ? <button className="attachment-preview-button" type="button" onClick={() => onPreview(preview, title)} aria-label={`预览 ${title}`}><img src={preview} alt="" /></button> : <Paperclip size={12} />}<span>{title}</span></span>;
}

function EmptyConversation() {
  return <div className="empty-conversation"><span className="empty-monogram">I²</span><h2>从一个目标开始</h2><p>上传参考图，说明最终需要哪些素材。Agent 会先拆成独立任务，再按顺序生成。</p><div><span>人物三视图</span><span>产品多角度</span><span>系列广告素材</span></div></div>;
}

function BatchResults({ tasks, aspectRatio, assetMap, onAnnotate, onExport, onPreview }: { tasks: GenerationTask[]; aspectRatio: AspectRatio; assetMap: Map<string, AssetRecord>; onAnnotate: (asset: AssetRecord) => void; onExport: (asset: AssetRecord) => void; onPreview: (src: string, title: string) => void }) {
  return <div className="batch-results">{tasks.map((task) => {
    const asset = task.resultAssetId ? assetMap.get(task.resultAssetId) : undefined;
    return <div className={`result-tile ${task.status}`} key={task.id}>
      <div className={`result-media ${asset ? "has-image" : ""}`} style={asset ? undefined : { aspectRatio: aspectRatio.replace(":", " / ") }}>{asset ? <button type="button" onClick={() => onPreview(assetSrc(asset), task.title)} aria-label={`预览 ${task.title}`}><img src={assetSrc(asset)} alt="" /></button> : task.status === "failed" ? <AlertCircle size={24} /> : task.status === "running" ? <LoaderCircle className="spin" size={24} /> : <span>{String(task.position + 1).padStart(2, "0")}</span>}</div>
      <div className="result-caption"><div><strong>{task.title}</strong><small>{statusLabel[task.status]}</small></div>{asset && <span><button type="button" onClick={() => onAnnotate(asset)} aria-label={`标注 ${task.title}`} title="标注修改"><PencilLine size={14} /></button><button type="button" onClick={() => onExport(asset)} aria-label={`导出 ${task.title}`} title="导出"><Download size={14} /></button></span>}</div>
    </div>;
  })}</div>;
}

function QueueTask({ task, onRetry }: { task: GenerationTask; onRetry: () => void }) {
  const Icon = task.status === "succeeded" ? Check : task.status === "running" ? LoaderCircle : task.status === "failed" ? AlertCircle : task.status === "interrupted" ? CircleStop : MoreHorizontal;
  return <div className={`queue-task ${task.status}`}><span className="runway-node"><Icon className={task.status === "running" ? "spin" : ""} size={13} /></span><div><strong>{task.title}</strong><small>{task.error || statusLabel[task.status]}</small></div>{["failed", "interrupted", "cancelled"].includes(task.status) && <button type="button" onClick={onRetry} aria-label={`重试 ${task.title}`} title="重试"><RefreshCw size={13} /></button>}</div>;
}
