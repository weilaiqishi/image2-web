import type {
  AnnotationAttachment,
  AgentDiagnosticLog,
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
  AnnotationDocumentV2,
  WorkspaceState,
} from "../types";
import { bridge, errorMessage } from "./bridge";
import { createAgentTurn, recommendGenerationSettings, type AgentTurnDiagnostics } from "./agentProvider";
import { SIZE_PRESETS } from "../types";
import { defaultGenerationParams, interruptRunningTasks, loadWorkspace, saveWorkspace } from "./workspaceStore";
import { assertCompilable, compileEditRequest, providerCapabilitiesForModel, referenceConflictDiagnostics, renderMaskDataUrl } from "./promptCompiler";
import { getLocale, translate } from "../i18n";
import { sanitizeDiagnosticValue } from "./diagnosticLog";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const MAX_AGENT_DIAGNOSTIC_LOGS = 100;

type Listener = (state: WorkspaceState) => void;

export class AgentRuntime {
  private state: WorkspaceState;
  private listeners = new Set<Listener>();
  private processing = false;
  private pendingSubmissions = new Map<string, { token: string; userMessageId: string; draft: ComposerDraft; conversation: Conversation }>();

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
    const conversation: Conversation = { id: newId(), title: translate("workspace.newConversation"), createdAt: timestamp, updatedAt: timestamp };
    await this.commit({
      ...this.state,
      selectedConversationId: conversation.id,
      conversations: [conversation, ...this.state.conversations],
      drafts: { ...this.state.drafts, [conversation.id]: { text: "", attachments: [], nextImageSequence: 1, params: { ...defaultGenerationParams } } },
    });
  }

  async renameConversation(conversationId: string, title: string) {
    const normalized = title.trim();
    if (!normalized) return;
    await this.commit({ ...this.state, conversations: this.state.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, title: normalized, updatedAt: now() } : conversation) });
  }

  async deleteConversation(conversationId: string) {
    if (this.state.conversations.length === 1) {
      await this.renameConversation(conversationId, translate("workspace.newConversation"));
      await this.commit({
        ...this.state,
        messages: this.state.messages.filter((message) => message.conversationId !== conversationId),
        diagnosticLogs: this.state.diagnosticLogs.filter((log) => log.conversationId !== conversationId),
      });
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
      diagnosticLogs: this.state.diagnosticLogs.filter((log) => log.conversationId !== conversationId),
      drafts,
    });
  }

  private async recordAgentDiagnosticLog(log: AgentDiagnosticLog) {
    const sanitized = sanitizeDiagnosticValue(log) as AgentDiagnosticLog;
    const diagnosticLogs = [...this.state.diagnosticLogs, sanitized].slice(-MAX_AGENT_DIAGNOSTIC_LOGS);
    try {
      await this.commit({ ...this.state, diagnosticLogs });
    } catch (error) {
      console.error("Unable to persist Agent diagnostic log", error);
    }
  }

  async updateDraft(conversationId: string, update: Partial<ComposerDraft>) {
    const current = this.state.drafts[conversationId] ?? { text: "", attachments: [], nextImageSequence: 1, params: { ...defaultGenerationParams } };
    const next = { ...current, ...update };
    if (update.attachments && !update.attachments.some((attachment) => attachment.kind === "reference" || attachment.kind === "asset")) next.recommendation = undefined;
    await this.commit({ ...this.state, drafts: { ...this.state.drafts, [conversationId]: next } });
  }

  async upsertAnnotationDocument(document: AnnotationDocumentV2) {
    await this.commit({
      ...this.state,
      annotationDocuments: { ...this.state.annotationDocuments, [document.id]: document },
    });
  }

  preflightDraft(conversationId: string, settings: Settings) {
    const draft = this.state.drafts[conversationId];
    if (!draft) throw new Error(translate("errors.draftNotFound"));
    const labels = new Set(draft.attachments.filter((attachment) => attachment.kind !== "annotation").map((attachment) => attachment.descriptor?.label).filter(Boolean));
    const objectNames = new Set(draft.attachments.filter((attachment): attachment is AnnotationAttachment => attachment.kind === "annotation").flatMap((attachment) => this.state.annotationDocuments[attachment.documentId]?.objects.map((object) => object.displayName) ?? []));
    const diagnostics = referenceConflictDiagnostics(draft.attachments);
    for (const match of draft.text.matchAll(/@(Image\d+)/g)) {
      if (!labels.has(match[1])) diagnostics.push({ code: "missing-reference", severity: "error", message: translate("errors.invalidReference", { name: match[1] }), targetId: match[1] });
    }
    for (const match of draft.text.matchAll(/@(Mark\d+|Region\d+|Move\d+|Note\d+)/g)) {
      if (!objectNames.has(match[1])) diagnostics.push({ code: "missing-object", severity: "error", message: translate("errors.invalidReference", { name: match[1] }), targetId: match[1] });
    }
    for (const match of draft.text.matchAll(/#[0-9A-Za-z]{6}\b/g)) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(match[0])) diagnostics.push({ code: "invalid-color", severity: "error", message: translate("errors.invalidColor", { color: match[0] }), targetId: match[0] });
    }
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length) throw new Error(errors.map((diagnostic) => diagnostic.message).join(getLocale() === "zh-CN" ? "；" : "; "));
    const capabilities = providerCapabilitiesForModel(settings.imageModel);
    return draft.attachments.filter((attachment): attachment is AnnotationAttachment => attachment.kind === "annotation").map((attachment) => {
      const document = this.state.annotationDocuments[attachment.documentId];
      if (!document) throw new Error(translate("errors.documentNotFound"));
      const compiled = compileEditRequest({ ...document, promptText: [document.promptText, draft.text].filter(Boolean).join("\n") }, draft.attachments, draft.params, capabilities);
      assertCompilable(compiled);
      return compiled;
    });
  }

  private async attachmentImages(attachments: Attachment[]): Promise<Record<string, string[]>> {
    const entries = await Promise.all(attachments.map(async (attachment): Promise<[string, string[]]> => {
      if (attachment.kind === "reference") return [attachment.id, [attachment.dataUrl]];
      if (attachment.kind === "asset") return [attachment.id, [await bridge.readAssetDataUrl(attachment.assetId)]];
      const document = this.state.annotationDocuments[attachment.documentId];
      const legacyOverlay = attachment.annotatedDataUrl ?? document?.legacyAnnotatedDataUrl;
      const overlay = legacyOverlay ?? (attachment.compiledOverlayAssetId ? await bridge.readAnnotationOverlayDataUrl(attachment.compiledOverlayAssetId).catch(() => undefined) : undefined);
      return [attachment.id, [await bridge.readAssetDataUrl(attachment.sourceAssetId), ...(overlay ? [overlay] : [])]];
    }));
    return Object.fromEntries(entries);
  }

  async addAttachmentsAndRecommend(conversationId: string, attachments: Attachment[], settings: Settings) {
    const draft = this.state.drafts[conversationId];
    if (!draft || !attachments.length) return;
    let nextImageSequence = draft.nextImageSequence;
    const normalized = attachments.map((attachment): Attachment => {
      if (attachment.kind === "annotation") return attachment;
      if (attachment.descriptor?.label) {
        const existingSequence = Number(attachment.descriptor.label.match(/^Image(\d+)$/)?.[1] ?? 0);
        nextImageSequence = Math.max(nextImageSequence, existingSequence + 1);
        return attachment;
      }
      const descriptor = { label: `Image${String(nextImageSequence).padStart(3, "0")}`, roles: ["other" as const], priority: 0, preserve: [] };
      nextImageSequence += 1;
      return { ...attachment, descriptor };
    });
    const combined = [...draft.attachments, ...normalized].slice(0, 6);
    const reference = attachments.find((attachment) => attachment.kind === "reference" || attachment.kind === "asset");
    await this.commit({
      ...this.state,
      drafts: { ...this.state.drafts, [conversationId]: { ...draft, attachments: combined, nextImageSequence, recommendation: reference && settings.hasApiKey ? { aspectRatio: draft.params.aspectRatio, quality: draft.params.quality, reason: translate("runtime.analyzingReference"), status: "loading" } : draft.recommendation } },
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
    if (this.pendingSubmissions.has(conversationId)) throw new Error(translate("errors.submissionPending"));
    const timestamp = now();
    const userMessage: ChatMessage = {
      id: newId(), conversationId, role: "user", content: draft.text.trim() || translate("runtime.attachmentFallback"), attachments: draft.attachments, createdAt: timestamp,
    };
    const existingMessages = this.state.messages.filter((message) => message.conversationId === conversationId);
    const conversation = this.state.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(translate("errors.conversationNotFound"));
    const submissionToken = newId();
    this.pendingSubmissions.set(conversationId, { token: submissionToken, userMessageId: userMessage.id, draft: structuredClone(draft), conversation: { ...conversation } });
    await this.commit({
      ...this.state,
      messages: [...this.state.messages, userMessage],
      conversations: this.state.conversations.map((item) => item.id === conversationId ? { ...item, title: existingMessages.length ? item.title : userMessage.content.slice(0, 24), updatedAt: timestamp } : item),
      drafts: { ...this.state.drafts, [conversationId]: { ...draft, text: "", attachments: [], recommendation: undefined } },
    });

    const diagnosticId = newId();
    const diagnosticStartedAt = now();
    const diagnostics: AgentTurnDiagnostics = {};
    try {
      const attachments = userMessage.attachments;
      const result = await createAgentTurn(settings, {
        messages: [...existingMessages, userMessage],
        attachments,
        attachmentImages: await this.attachmentImages(attachments),
        annotationDocuments: this.state.annotationDocuments,
      }, bridge.proxyAgent, diagnostics);
      if (this.pendingSubmissions.get(conversationId)?.token !== submissionToken) return;
      if (!result.plan) {
        await this.recordAgentDiagnosticLog({
          id: diagnosticId, conversationId, startedAt: diagnosticStartedAt, completedAt: now(), protocol: settings.agentProtocol,
          model: settings.agentModel, status: "succeeded", allowedAttachmentIds: attachments.map((attachment) => attachment.id),
          request: diagnostics.request, response: diagnostics.response,
        });
        this.pendingSubmissions.delete(conversationId);
        await this.appendAssistant(conversationId, result.text || translate("runtime.needMoreInfo"));
        return;
      }

      const batchId = newId();
      const tasks: GenerationTask[] = result.plan.tasks.map((planned, position) => {
        const taskAttachments = attachments.filter((attachment) => planned.referenceIds.includes(attachment.id) || planned.annotationId === attachment.id || (attachment.kind === "annotation" && planned.annotationDocumentId === attachment.documentId));
        const inferredBaseAssetId = taskAttachments.find((attachment): attachment is AssetAttachment => attachment.kind === "asset" && Boolean(attachment.descriptor?.roles.includes("base")))?.assetId;
        const annotationSnapshot = planned.annotationDocumentId ? structuredClone(this.state.annotationDocuments[planned.annotationDocumentId]) : undefined;
        const capabilitiesSnapshot = providerCapabilitiesForModel(settings.imageModel);
        const compiledPrompt = annotationSnapshot ? compileEditRequest(
          { ...annotationSnapshot, objects: planned.annotationObjectIds?.length ? annotationSnapshot.objects.filter((object) => planned.annotationObjectIds?.includes(object.id)) : annotationSnapshot.objects, promptText: [annotationSnapshot.promptText, planned.prompt].filter(Boolean).join("\n") },
          taskAttachments,
          draft.params,
          capabilitiesSnapshot,
          planned.preserve,
        ).prompt : undefined;
        return {
          id: newId(), batchId, position, title: planned.title, prompt: planned.prompt, operation: planned.operation,
          status: "queued", referenceIds: planned.referenceIds, attachments: taskAttachments,
          annotationId: planned.annotationId,
          annotationDocumentId: planned.annotationDocumentId,
          annotationObjectIds: planned.annotationObjectIds,
          baseAssetId: planned.baseAssetId ?? inferredBaseAssetId,
          preserve: planned.preserve,
          variantGroupId: planned.variantGroupId,
          annotationSnapshot,
          capabilitiesSnapshot,
          compiledPrompt,
          attempt: 0,
        };
      });
      const batch: GenerationBatch = { id: batchId, conversationId, status: "queued", params: { ...draft.params }, taskIds: tasks.map((task) => task.id), createdAt: now() };
      const assistant: ChatMessage = {
        id: newId(), conversationId, role: "assistant", content: result.plan.summary || result.text || translate("runtime.tasksCreated", { count: tasks.length }), attachments: [], batchId, createdAt: now(),
      };
      await this.recordAgentDiagnosticLog({
        id: diagnosticId, conversationId, startedAt: diagnosticStartedAt, completedAt: now(), protocol: settings.agentProtocol,
        model: settings.agentModel, status: "succeeded", allowedAttachmentIds: attachments.map((attachment) => attachment.id),
        request: diagnostics.request, response: diagnostics.response,
      });
      this.pendingSubmissions.delete(conversationId);
      await this.commit({ ...this.state, batches: [...this.state.batches, batch], tasks: [...this.state.tasks, ...tasks], messages: [...this.state.messages, assistant] });
      void this.processQueue();
    } catch (error) {
      if (this.pendingSubmissions.get(conversationId)?.token !== submissionToken) return;
      await this.recordAgentDiagnosticLog({
        id: diagnosticId, conversationId, startedAt: diagnosticStartedAt, completedAt: now(), protocol: settings.agentProtocol,
        model: settings.agentModel, status: "failed", allowedAttachmentIds: userMessage.attachments.map((attachment) => attachment.id),
        request: diagnostics.request, response: diagnostics.response, error: errorMessage(error),
      });
      this.pendingSubmissions.delete(conversationId);
      await this.appendAssistant(conversationId, translate("runtime.taskCreationFailed", { message: errorMessage(error) }));
    }
  }

  async cancelPendingSubmission(conversationId: string) {
    const pending = this.pendingSubmissions.get(conversationId);
    if (!pending) return false;
    this.pendingSubmissions.delete(conversationId);
    await this.commit({
      ...this.state,
      conversations: this.state.conversations.map((conversation) => conversation.id === conversationId ? pending.conversation : conversation),
      messages: this.state.messages.filter((message) => message.id !== pending.userMessageId),
      drafts: { ...this.state.drafts, [conversationId]: pending.draft },
    });
    return true;
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
      const sourceDocument = task.annotationSnapshot ?? this.state.annotationDocuments[task.annotationDocumentId ?? annotation.documentId];
      if (!sourceDocument) throw new Error(translate("errors.documentNotFound"));
      const selectedObjects = task.annotationObjectIds?.length
        ? sourceDocument.objects.filter((object) => task.annotationObjectIds?.includes(object.id))
        : sourceDocument.objects;
      const taskDocument = { ...sourceDocument, objects: selectedObjects, promptText: [sourceDocument.promptText, task.prompt].filter(Boolean).join("\n") };
      const capabilities = task.capabilitiesSnapshot ?? providerCapabilitiesForModel((await bridge.getSettings()).imageModel);
      const compiled = compileEditRequest(taskDocument, task.attachments, params, capabilities, task.preserve);
      assertCompilable(compiled);
      const annotatedDataUrl = annotation.annotatedDataUrl ?? sourceDocument.legacyAnnotatedDataUrl;
      return bridge.edit({
        ...params,
        prompt: task.prompt,
        originalAssetId: task.baseAssetId ?? compiled.originalAssetId,
        annotatedDataUrl,
        overlayAssetId: compiled.overlayAssetId ?? annotation.compiledOverlayAssetId,
        maskDataUrl: capabilities.supportsMask ? renderMaskDataUrl(taskDocument) : undefined,
        referenceAssetIds: compiled.referenceAssetIds,
        referenceDataUrls: compiled.referenceDataUrls,
        structuredRegions: compiled.structuredRegions,
        sourceTaskId: task.id,
        sourceDocumentId: sourceDocument.id,
        branchLabel: task.title,
        annotationPrompt: compiled.prompt,
      });
    }
    if (annotation) assetIds.push(annotation.sourceAssetId);
    return bridge.generate({ ...params, prompt: task.prompt, referenceDataUrls: references, referenceAssetIds: assetIds, parentAssetId: task.baseAssetId, sourceTaskId: task.id, sourceDocumentId: task.annotationDocumentId, branchLabel: task.title });
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
