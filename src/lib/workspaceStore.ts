import type { GenerationParams, WorkspaceState } from "../types";

const DB_NAME = "image2-agent";
const STORE_NAME = "workspace";
const STATE_KEY = "current";
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
    version: 1,
    selectedConversationId: conversationId,
    conversations: [{ id: conversationId, title: "新对话", createdAt: now, updatedAt: now }],
    messages: [],
    batches: [],
    tasks: [],
    drafts: {
      [conversationId]: { text: "", attachments: [], params: { ...defaultGenerationParams } },
    },
  };
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
  if (typeof indexedDB === "undefined") return structuredClone(memoryState ?? createInitialWorkspace());
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      const stored = request.result as WorkspaceState | undefined;
      resolve(stored ?? createInitialWorkspace());
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
