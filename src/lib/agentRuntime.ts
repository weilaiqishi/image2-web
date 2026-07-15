import type {
  AnnotationAttachment,
  AssetAttachment,
  Attachment,
  ChatMessage,
  ComposerDraft,
  Conversation,
  GenerationBatch,
  GenerationParams,
  GenerationTask,
  ReferenceAttachment,
  Settings,
  WorkspaceState,
} from "../types";
import { bridge, errorMessage } from "./bridge";
import { createAgentTurn, recommendGenerationSettings } from "./agentProvider";
import { SIZE_PRESETS } from "../types";
import { defaultGenerationParams, interruptRunningTasks, loadWorkspace, saveWorkspace } from "./workspaceStore";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();

type Listener = (state: WorkspaceState) => void;

export class AgentRuntime {
  private state: WorkspaceState;
  private listeners = new Set<Listener>();
  private processing = false;

  private constructor(state: WorkspaceState) {
    this.state = state;
  }

  static async create(): Promise<AgentRuntime> {
    const restored = interruptRunningTasks(await loadWorkspace());
    await saveWorkspace(restored);
    return new AgentRuntime(restored);
  }

  snapshot(): WorkspaceState {
    return this.state;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async commit(next: WorkspaceState) {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
    await saveWorkspace(next);
  }

  async selectConversation(conversationId: string) {
    if (!this.state.conversations.some((conversation) => conversation.id === conversationId)) return;
    await this.commit({ ...this.state, selectedConversationId: conversationId });
  }

  async createConversation() {
    const timestamp = now();
    const conversation: Conversation = { id: newId(), title: "新对话", createdAt: timestamp, updatedAt: timestamp };
    await this.commit({
      ...this.state,
      selectedConversationId: conversation.id,
      conversations: [conversation, ...this.state.conversations],
      drafts: { ...this.state.drafts, [conversation.id]: { text: "", attachments: [], params: { ...defaultGenerationParams } } },
    });
  }

  async renameConversation(conversationId: string, title: string) {
    const normalized = title.trim();
    if (!normalized) return;
    await this.commit({ ...this.state, conversations: this.state.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, title: normalized, updatedAt: now() } : conversation) });
  }

  async deleteConversation(conversationId: string) {
    if (this.state.conversations.length === 1) {
      await this.renameConversation(conversationId, "新对话");
      await this.commit({ ...this.state, messages: this.state.messages.filter((message) => message.conversationId !== conversationId) });
      return;
    }
    const conversations = this.state.conversations.filter((conversation) => conversation.id !== conversationId);
    const batchIds = new Set(this.state.batches.filter((batch) => batch.conversationId === conversationId).map((batch) => batch.id));
    const drafts = { ...this.state.drafts };
    delete drafts[conversationId];
    await this.commit({
      ...this.state,
      selectedConversationId: this.state.selectedConversationId === conversationId ? conversations[0].id : this.state.selectedConversationId,
      conversations,
      messages: this.state.messages.filter((message) => message.conversationId !== conversationId),
      batches: this.state.batches.filter((batch) => batch.conversationId !== conversationId),
      tasks: this.state.tasks.filter((task) => !batchIds.has(task.batchId)),
      drafts,
    });
  }

  async updateDraft(conversationId: string, update: Partial<ComposerDraft>) {
    const current = this.state.drafts[conversationId] ?? { text: "", attachments: [], params: { ...defaultGenerationParams } };
    const next = { ...current, ...update };
    if (update.attachments && !update.attachments.some((attachment) => attachment.kind === "reference" || attachment.kind === "asset")) next.recommendation = undefined;
    await this.commit({ ...this.state, drafts: { ...this.state.drafts, [conversationId]: next } });
  }

  private async attachmentImages(attachments: Attachment[]): Promise<Record<string, string[]>> {
    const entries = await Promise.all(attachments.map(async (attachment): Promise<[string, string[]]> => {
      if (attachment.kind === "reference") return [attachment.id, [attachment.dataUrl]];
      if (attachment.kind === "asset") return [attachment.id, [await bridge.readAssetDataUrl(attachment.assetId)]];
      return [attachment.id, [await bridge.readAssetDataUrl(attachment.sourceAssetId), attachment.annotatedDataUrl]];
    }));
    return Object.fromEntries(entries);
  }

  async addAttachmentsAndRecommend(conversationId: string, attachments: Attachment[], settings: Settings) {
    const draft = this.state.drafts[conversationId];
    if (!draft || !attachments.length) return;
    const combined = [...draft.attachments, ...attachments].slice(0, 6);
    const reference = attachments.find((attachment) => attachment.kind === "reference" || attachment.kind === "asset");
    await this.commit({
      ...this.state,
      drafts: { ...this.state.drafts, [conversationId]: { ...draft, attachments: combined, recommendation: reference && settings.hasApiKey ? { aspectRatio: draft.params.aspectRatio, quality: draft.params.quality, reason: "正在分析参考图", status: "loading" } : draft.recommendation } },
    });
    if (!reference || !settings.hasApiKey) return;
    try {
      const image = (await this.attachmentImages([reference]))[reference.id][0];
      const recommendation = await recommendGenerationSettings(settings, image, bridge.proxyAgent);
      const current = this.state.drafts[conversationId];
      if (!current?.attachments.some((attachment) => attachment.id === reference.id)) return;
      await this.commit({ ...this.state, drafts: { ...this.state.drafts, [conversationId]: { ...current, recommendation: { ...recommendation, status: "ready" } } } });
    } catch (error) {
      const current = this.state.drafts[conversationId];
      if (!current) return;
      await this.commit({ ...this.state, drafts: { ...this.state.drafts, [conversationId]: { ...current, recommendation: { aspectRatio: current.params.aspectRatio, quality: current.params.quality, reason: errorMessage(error), status: "error" } } } });
    }
  }

  async answerRecommendation(conversationId: string, apply: boolean) {
    const draft = this.state.drafts[conversationId];
    const recommendation = draft?.recommendation;
    if (!draft || !recommendation || recommendation.status !== "ready") return;
    const params = apply ? {
      ...draft.params,
      aspectRatio: recommendation.aspectRatio,
      quality: recommendation.quality,
      size: SIZE_PRESETS[draft.params.resolution][recommendation.aspectRatio],
    } : draft.params;
    await this.commit({ ...this.state, drafts: { ...this.state.drafts, [conversationId]: { ...draft, params, recommendation: { ...recommendation, status: apply ? "applied" : "dismissed" } } } });
  }

  async submit(conversationId: string, settings: Settings) {
    const draft = this.state.drafts[conversationId];
    if (!draft || (!draft.text.trim() && !draft.attachments.length)) return;
    const timestamp = now();
    const userMessage: ChatMessage = {
      id: newId(), conversationId, role: "user", content: draft.text.trim() || "请根据附件继续", attachments: draft.attachments, createdAt: timestamp,
    };
    const existingMessages = this.state.messages.filter((message) => message.conversationId === conversationId);
    await this.commit({
      ...this.state,
      messages: [...this.state.messages, userMessage],
      conversations: this.state.conversations.map((item) => item.id === conversationId ? { ...item, title: existingMessages.length ? item.title : userMessage.content.slice(0, 24), updatedAt: timestamp } : item),
      drafts: { ...this.state.drafts, [conversationId]: { ...draft, text: "", attachments: [], recommendation: undefined } },
    });

    try {
      const attachments = userMessage.attachments;
      const result = await createAgentTurn(settings, {
        messages: [...existingMessages, userMessage],
        attachments,
        attachmentImages: await this.attachmentImages(attachments),
      }, bridge.proxyAgent);
      if (!result.plan) {
        await this.appendAssistant(conversationId, result.text || "我需要更多信息才能创建图片任务。请补充主体、视角或用途。" );
        return;
      }

      const batchId = newId();
      const tasks: GenerationTask[] = result.plan.tasks.map((planned, position) => {
        const taskAttachments = attachments.filter((attachment) => planned.referenceIds.includes(attachment.id) || planned.annotationId === attachment.id);
        return {
          id: newId(), batchId, position, title: planned.title, prompt: planned.prompt, operation: planned.operation,
          status: "queued", referenceIds: planned.referenceIds, attachments: taskAttachments,
          annotationId: planned.annotationId, attempt: 0,
        };
      });
      const batch: GenerationBatch = { id: batchId, conversationId, status: "queued", params: { ...draft.params }, taskIds: tasks.map((task) => task.id), createdAt: now() };
      const assistant: ChatMessage = {
        id: newId(), conversationId, role: "assistant", content: result.plan.summary || result.text || `已创建 ${tasks.length} 个串行任务。`, attachments: [], batchId, createdAt: now(),
      };
      await this.commit({ ...this.state, batches: [...this.state.batches, batch], tasks: [...this.state.tasks, ...tasks], messages: [...this.state.messages, assistant] });
      void this.processQueue();
    } catch (error) {
      await this.appendAssistant(conversationId, `未能创建任务：${errorMessage(error)}`);
    }
  }

  private async appendAssistant(conversationId: string, content: string) {
    const message: ChatMessage = { id: newId(), conversationId, role: "assistant", content, attachments: [], createdAt: now() };
    await this.commit({ ...this.state, messages: [...this.state.messages, message] });
  }

  private async executeTask(task: GenerationTask, params: GenerationParams) {
    const references = task.attachments.filter((item): item is ReferenceAttachment => item.kind === "reference").map((item) => item.dataUrl);
    const assetIds = task.attachments.filter((item): item is AssetAttachment => item.kind === "asset").map((item) => item.assetId);
    const annotation = task.attachments.find((item): item is AnnotationAttachment => item.kind === "annotation" && (!task.annotationId || item.id === task.annotationId));
    if (task.operation === "edit" && annotation) {
      return bridge.edit({ ...params, prompt: task.prompt, originalAssetId: annotation.sourceAssetId, annotatedDataUrl: annotation.annotatedDataUrl, annotationPrompt: `${annotation.instruction}\n${task.prompt}` });
    }
    if (annotation) assetIds.push(annotation.sourceAssetId);
    return bridge.generate({ ...params, prompt: task.prompt, referenceDataUrls: references, referenceAssetIds: assetIds });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const task = this.state.tasks.find((item) => item.status === "queued");
        if (!task) break;
        const batch = this.state.batches.find((item) => item.id === task.batchId);
        if (!batch || batch.status === "cancelled") continue;
        await this.commit({
          ...this.state,
          batches: this.state.batches.map((item) => item.id === batch.id ? { ...item, status: "running" } : item),
          tasks: this.state.tasks.map((item) => item.id === task.id ? { ...item, status: "running", attempt: item.attempt + 1, error: undefined } : item),
        });
        try {
          const asset = await this.executeTask(task, batch.params);
          await this.commit({ ...this.state, tasks: this.state.tasks.map((item) => item.id === task.id ? { ...item, status: "succeeded", resultAssetId: asset.id } : item) });
        } catch (error) {
          await this.commit({ ...this.state, tasks: this.state.tasks.map((item) => item.id === task.id ? { ...item, status: "failed", error: errorMessage(error) } : item) });
        }
        await this.refreshBatch(batch.id);
      }
    } finally {
      this.processing = false;
    }
  }

  private async refreshBatch(batchId: string) {
    const tasks = this.state.tasks.filter((task) => task.batchId === batchId);
    const finished = tasks.every((task) => ["succeeded", "failed", "cancelled"].includes(task.status));
    if (!finished) return;
    const currentBatch = this.state.batches.find((batch) => batch.id === batchId);
    const status = currentBatch?.status === "cancelled" ? "cancelled" : tasks.every((task) => task.status === "succeeded") ? "completed" : tasks.every((task) => task.status === "cancelled") ? "cancelled" : "partial";
    await this.commit({ ...this.state, batches: this.state.batches.map((batch) => batch.id === batchId ? { ...batch, status } : batch) });
  }

  async cancelBatch(batchId: string) {
    await this.commit({
      ...this.state,
      batches: this.state.batches.map((batch) => batch.id === batchId ? { ...batch, status: "cancelled" } : batch),
      tasks: this.state.tasks.map((task) => task.batchId === batchId && ["queued", "interrupted"].includes(task.status) ? { ...task, status: "cancelled" } : task),
    });
  }

  async retryTask(taskId: string) {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task || !["failed", "interrupted", "cancelled"].includes(task.status)) return;
    await this.commit({
      ...this.state,
      batches: this.state.batches.map((batch) => batch.id === task.batchId ? { ...batch, status: "queued" } : batch),
      tasks: this.state.tasks.map((item) => item.id === taskId ? { ...item, status: "queued", error: undefined } : item),
    });
    void this.processQueue();
  }

  async resumeBatch(batchId: string) {
    await this.commit({
      ...this.state,
      batches: this.state.batches.map((batch) => batch.id === batchId ? { ...batch, status: "queued" } : batch),
      tasks: this.state.tasks.map((task) => task.batchId === batchId && task.status === "interrupted" ? { ...task, status: "queued" } : task),
    });
    void this.processQueue();
  }
}
