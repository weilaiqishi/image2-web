import type {
  AnnotationAttachment,
  AnnotationDocumentV2,
  AnnotationObjectKind,
  Attachment,
  GenerationParams,
  ReferenceDescriptor,
  WorkspaceState,
} from "../types";

const DB_NAME = "image2-agent";
const STORE_NAME = "workspace";
const STATE_KEY = "current";
const MIGRATION_BACKUP_KEY = "migration-backup-v1";
let memoryState: WorkspaceState | undefined;

export const defaultGenerationParams: GenerationParams = {
  prompt: "",
  aspectRatio: "1:1",
  resolution: "1K",
  size: "1024x1024",
  quality: "medium",
  outputFormat: "png",
};

const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function createInitialWorkspace(): WorkspaceState {
  const now = new Date().toISOString();
  const conversationId = id();
  return {
    version: 2,
    selectedConversationId: conversationId,
    conversations: [{ id: conversationId, title: "新对话", createdAt: now, updatedAt: now }],
    messages: [],
    batches: [],
    tasks: [],
    drafts: {
      [conversationId]: { text: "", attachments: [], nextImageSequence: 1, params: { ...defaultGenerationParams } },
    },
    annotationDocuments: {},
  };
}

const annotationKinds: AnnotationObjectKind[] = ["point", "rect", "mask", "arrow", "note"];

function nextSequences(): Record<AnnotationObjectKind, number> {
  return Object.fromEntries(annotationKinds.map((kind) => [kind, 1])) as Record<AnnotationObjectKind, number>;
}

function safeId(value: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
  return normalized || id();
}

function descriptor(label: string): ReferenceDescriptor {
  return { label, roles: ["other"], priority: 0, preserve: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function migrateWorkspace(input: unknown): WorkspaceState {
  if (!isRecord(input)) return { ...createInitialWorkspace(), migrationWarning: "旧 Workspace 无法读取，已保留迁移备份。" };

  const source = input as Record<string, any>;
  const conversations = Array.isArray(source.conversations) ? source.conversations : [];
  const selectedConversationId = typeof source.selectedConversationId === "string" && source.selectedConversationId
    ? source.selectedConversationId
    : conversations[0]?.id;
  if (!selectedConversationId || !conversations.length) {
    return { ...createInitialWorkspace(), migrationWarning: "旧 Workspace 缺少对话索引，已保留迁移备份。" };
  }

  const documents: Record<string, AnnotationDocumentV2> = isRecord(source.annotationDocuments)
    ? structuredClone(source.annotationDocuments as Record<string, AnnotationDocumentV2>)
    : {};
  const descriptors = new Map<string, ReferenceDescriptor>();
  let imageSequence = 1;

  const normalizeAttachment = (value: unknown): Attachment => {
    const attachment = structuredClone(value) as Attachment & Record<string, any>;
    if (!isRecord(attachment) || typeof attachment.id !== "string" || typeof attachment.kind !== "string") {
      throw new Error("Workspace 包含无效附件");
    }
    if (attachment.kind === "annotation") {
      const documentId = typeof attachment.documentId === "string" && attachment.documentId
        ? attachment.documentId
        : `legacy-${safeId(attachment.id)}`;
      const sourceAssetId = String(attachment.sourceAssetId || "");
      if (!sourceAssetId) throw new Error("旧标注缺少源资产");
      if (!documents[documentId]) {
        const createdAt = typeof attachment.createdAt === "string" ? attachment.createdAt : new Date().toISOString();
        documents[documentId] = {
          id: documentId,
          sourceAssetId,
          conversationId: selectedConversationId,
          sourceWidth: 0,
          sourceHeight: 0,
          fabricJson: typeof attachment.documentJson === "string" ? attachment.documentJson : "{\"objects\":[]}",
          objects: [],
          promptText: typeof attachment.instruction === "string" ? attachment.instruction : "",
          promptTokens: [],
          status: "attached",
          overlayAssetId: typeof attachment.compiledOverlayAssetId === "string" ? attachment.compiledOverlayAssetId : undefined,
          legacyAnnotatedDataUrl: typeof attachment.annotatedDataUrl === "string" ? attachment.annotatedDataUrl : undefined,
          legacy: true,
          nextSequence: nextSequences(),
          createdAt,
          updatedAt: createdAt,
        };
      }
      const normalized: AnnotationAttachment = {
        id: attachment.id,
        kind: "annotation",
        sourceAssetId,
        documentId,
        objectIds: Array.isArray(attachment.objectIds) ? attachment.objectIds.filter((item: unknown): item is string => typeof item === "string") : [],
        compiledOverlayAssetId: typeof attachment.compiledOverlayAssetId === "string" ? attachment.compiledOverlayAssetId : documents[documentId].overlayAssetId,
        instruction: typeof attachment.instruction === "string" ? attachment.instruction : documents[documentId].promptText,
        tokens: Array.isArray(attachment.tokens) ? attachment.tokens : [],
        createdAt: typeof attachment.createdAt === "string" ? attachment.createdAt : documents[documentId].createdAt,
      };
      return normalized;
    }
    let nextDescriptor = attachment.descriptor as ReferenceDescriptor | undefined;
    if (!nextDescriptor?.label) {
      nextDescriptor = descriptors.get(attachment.id);
      if (!nextDescriptor) {
        nextDescriptor = descriptor(`Image${String(imageSequence).padStart(3, "0")}`);
        descriptors.set(attachment.id, nextDescriptor);
        imageSequence += 1;
      }
    } else {
      descriptors.set(attachment.id, nextDescriptor);
    }
    return { ...attachment, descriptor: nextDescriptor } as Attachment;
  };

  const normalizeAttachments = (items: unknown) => Array.isArray(items) ? items.map(normalizeAttachment) : [];
  try {
    const messages = (Array.isArray(source.messages) ? source.messages : []).map((message: any) => ({ ...message, attachments: normalizeAttachments(message.attachments) }));
    const tasks = (Array.isArray(source.tasks) ? source.tasks : []).map((task: any) => ({ ...task, attachments: normalizeAttachments(task.attachments) }));
    const drafts = Object.fromEntries(Object.entries(isRecord(source.drafts) ? source.drafts : {}).map(([key, value]) => {
      const draft = isRecord(value) ? value : {};
      const attachments = normalizeAttachments(draft.attachments);
      const maxImageSequence = attachments.reduce((maximum, attachment) => {
        if (attachment.kind === "annotation") return maximum;
        const value = Number(attachment.descriptor?.label.match(/^Image(\d+)$/)?.[1] ?? 0);
        return Math.max(maximum, value);
      }, 0);
      return [key, { ...draft, text: typeof draft.text === "string" ? draft.text : "", attachments, nextImageSequence: Math.max(Number(draft.nextImageSequence) || 1, maxImageSequence + 1), params: { ...defaultGenerationParams, ...(isRecord(draft.params) ? draft.params : {}) } }];
    }));
    return {
      version: 2,
      selectedConversationId,
      conversations,
      messages,
      batches: Array.isArray(source.batches) ? source.batches : [],
      tasks,
      drafts,
      annotationDocuments: documents,
      migrationWarning: typeof source.migrationWarning === "string" ? source.migrationWarning : undefined,
    } as WorkspaceState;
  } catch (error) {
    return {
      ...createInitialWorkspace(),
      migrationWarning: `Workspace 迁移失败，原始数据已保留：${error instanceof Error ? error.message : "未知错误"}`,
    };
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  if (typeof indexedDB === "undefined") return migrateWorkspace(memoryState ?? createInitialWorkspace());
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      const stored = request.result as unknown;
      const migrated = stored ? migrateWorkspace(stored) : createInitialWorkspace();
      if (isRecord(stored) && stored.version !== 2) {
        const backupTransaction = database.transaction(STORE_NAME, "readwrite");
        backupTransaction.objectStore(STORE_NAME).put(stored, MIGRATION_BACKUP_KEY);
        backupTransaction.oncomplete = () => { database.close(); resolve(migrated); };
        backupTransaction.onerror = () => { database.close(); reject(backupTransaction.error); };
        return;
      }
      resolve(migrated);
      database.close();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  if (typeof indexedDB === "undefined") {
    memoryState = structuredClone(state);
    return;
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => reject(transaction.error);
  });
}

export function interruptRunningTasks(state: WorkspaceState): WorkspaceState {
  const runningBatchIds = new Set(state.batches.filter((batch) => ["queued", "running"].includes(batch.status)).map((batch) => batch.id));
  if (!runningBatchIds.size) return state;
  return {
    ...state,
    batches: state.batches.map((batch) => runningBatchIds.has(batch.id) ? { ...batch, status: "interrupted" } : batch),
    tasks: state.tasks.map((task) => ["queued", "running"].includes(task.status) ? { ...task, status: "interrupted" } : task),
  };
}
