import bundledCatalog from "../data/prompt-catalog-v2.json";
import type {
  PromptCatalogDownload,
  PromptCatalogPreferences,
  PromptCatalogSnapshot,
  PromptCatalogSource,
  PromptLocalState,
  PromptSyncRun,
  PromptTemplate,
  PromptTemplateView,
  PromptUsage,
} from "../types";
import { bridge } from "./bridge";
import { translate } from "../i18n";

const DB_NAME = "image2-prompt-catalog";
const DB_VERSION = 1;
const STORES = {
  templates: "promptTemplates",
  sources: "promptSources",
  local: "promptLocalState",
  usage: "promptUsage",
  sync: "promptSyncRuns",
  meta: "promptMeta",
} as const;

interface CatalogMeta {
  id: "catalog";
  catalogVersion: string;
  generatedAt: string;
  preferences: PromptCatalogPreferences;
}

interface BundledCatalog extends CatalogMeta {
  sources: PromptCatalogSource[];
  items: PromptTemplate[];
}

const bundled = bundledCatalog as unknown as BundledCatalog;
const memory = {
  templates: new Map<string, PromptTemplate>(),
  sources: new Map<string, PromptCatalogSource>(),
  local: new Map<string, PromptLocalState>(),
  usage: new Map<string, PromptUsage>(),
  sync: new Map<string, PromptSyncRun>(),
  meta: undefined as CatalogMeta | undefined,
};
let syncCancellationRequested = false;

export const defaultPromptPreferences: PromptCatalogPreferences = {
  autoUpdate: "off",
  updateStrategy: "add-and-update",
  thumbnailStrategy: "lazy",
  enabledSourceIds: bundled.sources.map((source) => source.id),
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      Object.values(STORES).forEach((store) => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: store === STORES.meta ? "id" : store === STORES.sources ? "id" : store === STORES.local ? "templateId" : "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  if (typeof indexedDB === "undefined") return [...(memory[storeName === STORES.templates ? "templates" : storeName === STORES.sources ? "sources" : storeName === STORES.local ? "local" : storeName === STORES.usage ? "usage" : "sync"] as Map<string, T>).values()];
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result as T[]); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function getMeta(): Promise<CatalogMeta | undefined> {
  if (typeof indexedDB === "undefined") return memory.meta;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORES.meta, "readonly").objectStore(STORES.meta).get("catalog");
    request.onsuccess = () => { database.close(); resolve(request.result as CatalogMeta | undefined); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function putValue<T extends object>(storeName: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined") {
    if (storeName === STORES.meta) memory.meta = value as unknown as CatalogMeta;
    else {
      const key = storeName === STORES.sources ? (value as PromptCatalogSource).id : storeName === STORES.local ? (value as PromptLocalState).templateId : (value as { id: string }).id;
      (memory[storeName === STORES.templates ? "templates" : storeName === STORES.sources ? "sources" : storeName === STORES.local ? "local" : storeName === STORES.usage ? "usage" : "sync"] as Map<string, T>).set(key, structuredClone(value));
    }
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

async function seedIfNeeded() {
  const existing = await getMeta();
  if (existing && existing.catalogVersion >= bundled.catalogVersion) return;
  if (typeof indexedDB === "undefined") {
    bundled.items.forEach((item) => memory.templates.set(item.id, structuredClone(item)));
    bundled.sources.forEach((source) => memory.sources.set(source.id, structuredClone(source)));
    memory.meta = { id: "catalog", catalogVersion: bundled.catalogVersion, generatedAt: bundled.generatedAt, preferences: existing?.preferences ?? defaultPromptPreferences };
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORES.templates, STORES.sources, STORES.meta], "readwrite");
    bundled.items.forEach((item) => transaction.objectStore(STORES.templates).put(item));
    bundled.sources.forEach((source) => transaction.objectStore(STORES.sources).put(source));
    transaction.objectStore(STORES.meta).put({ id: "catalog", catalogVersion: bundled.catalogVersion, generatedAt: bundled.generatedAt, preferences: existing?.preferences ?? defaultPromptPreferences });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export function createDefaultLocalState(templateId: string, timestamp = new Date().toISOString()): PromptLocalState {
  return { templateId, favorite: false, pinned: false, hidden: false, customTags: [], useCount: 0, createdAt: timestamp, updatedAt: timestamp };
}

export function mergePromptView(template: PromptTemplate, local?: PromptLocalState): PromptTemplateView {
  const state = local ?? createDefaultLocalState(template.id, template.importedAt);
  return {
    ...template,
    displayTitle: state.customTitle?.trim() || template.title,
    displayPrompt: state.customPrompt?.trim() || template.prompt,
    displayTags: [...new Set([...template.tags, ...state.customTags])],
    local: state,
  };
}

export async function loadPromptCatalog(): Promise<PromptCatalogSnapshot> {
  await seedIfNeeded();
  const [templates, sources, localStates, syncRuns, meta] = await Promise.all([
    getAll<PromptTemplate>(STORES.templates),
    getAll<PromptCatalogSource>(STORES.sources),
    getAll<PromptLocalState>(STORES.local),
    getAll<PromptSyncRun>(STORES.sync),
    getMeta(),
  ]);
  const localMap = new Map(localStates.map((state) => [state.templateId, state]));
  const preferences = meta?.preferences ?? defaultPromptPreferences;
  const enabled = new Set(preferences.enabledSourceIds);
  const views = templates
    .filter((template) => template.sourceReferences.some((source) => enabled.has(source.sourceId)))
    .map((template) => mergePromptView(template, localMap.get(template.id)))
    .filter((template) => !template.local.hidden || template.local.favorite || template.local.useCount > 0)
    .sort((left, right) => Number(right.local.pinned) - Number(left.local.pinned) || right.local.useCount - left.local.useCount || left.displayTitle.localeCompare(right.displayTitle));
  return {
    catalogVersion: meta?.catalogVersion ?? bundled.catalogVersion,
    generatedAt: meta?.generatedAt ?? bundled.generatedAt,
    templates: views,
    sources,
    preferences,
    syncRuns: syncRuns.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 20),
  };
}

export async function updatePromptLocalState(templateId: string, patch: Partial<Omit<PromptLocalState, "templateId" | "createdAt">>) {
  const existing = (await getAll<PromptLocalState>(STORES.local)).find((state) => state.templateId === templateId) ?? createDefaultLocalState(templateId);
  await putValue(STORES.local, { ...existing, ...patch, templateId, updatedAt: new Date().toISOString() });
  return loadPromptCatalog();
}

export async function recordPromptUsage(templateId: string, conversationId: string) {
  const usedAt = new Date().toISOString();
  const existing = (await getAll<PromptLocalState>(STORES.local)).find((state) => state.templateId === templateId) ?? createDefaultLocalState(templateId, usedAt);
  await Promise.all([
    putValue(STORES.local, { ...existing, useCount: existing.useCount + 1, lastUsedAt: usedAt, lastConversationId: conversationId, updatedAt: usedAt }),
    putValue(STORES.usage, { id: crypto.randomUUID(), templateId, conversationId, usedAt } satisfies PromptUsage),
  ]);
  return loadPromptCatalog();
}

export async function savePromptPreferences(patch: Partial<PromptCatalogPreferences>) {
  await seedIfNeeded();
  const meta = await getMeta();
  await putValue(STORES.meta, { ...meta, id: "catalog", catalogVersion: meta?.catalogVersion ?? bundled.catalogVersion, generatedAt: meta?.generatedAt ?? bundled.generatedAt, preferences: { ...(meta?.preferences ?? defaultPromptPreferences), ...patch } });
  return loadPromptCatalog();
}

export function applyCatalogUpdate(current: PromptTemplate[], download: PromptCatalogDownload, strategy: PromptCatalogPreferences["updateStrategy"], enabledSourceIds: string[]) {
  const incomingItems = download.items.map((item) => ({ ...item, cachedThumbnailPath: download.thumbnailPaths[item.id] || item.cachedThumbnailPath }));
  const incomingMap = new Map(incomingItems.map((item) => [item.id, item]));
  const enabled = new Set(enabledSourceIds);
  const next = new Map(current.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let archived = 0;
  let unchanged = 0;
  for (const item of incomingItems) {
    if (!item.sourceReferences.some((source) => enabled.has(source.sourceId))) continue;
    const existing = next.get(item.id);
    if (!existing) { next.set(item.id, item); added += 1; }
    else if (existing.promptHash !== item.promptHash && strategy === "add-and-update") { next.set(item.id, { ...item, cachedThumbnailPath: download.thumbnailPaths[item.id] || item.cachedThumbnailPath }); updated += 1; }
    else unchanged += 1;
  }
  for (const item of current) {
    if (item.sourceReferences.some((source) => enabled.has(source.sourceId)) && !incomingMap.has(item.id) && !item.archivedAt) {
      next.set(item.id, { ...item, archivedAt: download.manifest.generatedAt });
      archived += 1;
    }
  }
  return { items: [...next.values()], added, updated, archived, unchanged };
}

export function requestPromptSyncCancellation() {
  syncCancellationRequested = true;
}

export async function syncPromptCatalog(requestedSourceIds?: string[]): Promise<PromptCatalogSnapshot> {
  await seedIfNeeded();
  syncCancellationRequested = false;
  const startedAt = new Date().toISOString();
  const metaBefore = await getMeta();
  const preferencesBefore = metaBefore?.preferences ?? defaultPromptPreferences;
  const sourceIds = requestedSourceIds?.length ? requestedSourceIds.filter((id) => preferencesBefore.enabledSourceIds.includes(id)) : preferencesBefore.enabledSourceIds;
  const run: PromptSyncRun = { id: crypto.randomUUID(), startedAt, status: "running", sourceIds, added: 0, updated: 0, archived: 0, unchanged: 0, errors: {} };
  await putValue(STORES.sync, run);
  try {
    const [download, current, meta] = await Promise.all([bridge.downloadPromptCatalog(preferencesBefore.thumbnailStrategy === "eager"), getAll<PromptTemplate>(STORES.templates), getMeta()]);
    if (syncCancellationRequested) {
      await putValue(STORES.sync, { ...run, status: "cancelled", completedAt: new Date().toISOString() });
      return loadPromptCatalog();
    }
    const preferences = meta?.preferences ?? defaultPromptPreferences;
    const result = applyCatalogUpdate(current, download, preferences.updateStrategy, sourceIds);
    if (typeof indexedDB === "undefined") {
      result.items.forEach((item) => memory.templates.set(item.id, item));
      download.manifest.sources.forEach((source) => memory.sources.set(source.id, source));
    } else {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([STORES.templates, STORES.sources, STORES.meta, STORES.sync], "readwrite");
        result.items.forEach((item) => transaction.objectStore(STORES.templates).put(item));
        download.manifest.sources.forEach((source) => transaction.objectStore(STORES.sources).put(source));
        transaction.objectStore(STORES.meta).put({ id: "catalog", catalogVersion: download.manifest.catalogVersion, generatedAt: download.manifest.generatedAt, preferences: { ...preferences, lastCheckedAt: new Date().toISOString() } });
        transaction.objectStore(STORES.sync).put({ ...run, status: "completed", completedAt: new Date().toISOString(), added: result.added, updated: result.updated, archived: result.archived, unchanged: result.unchanged });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      });
    }
    if (typeof indexedDB === "undefined") {
      memory.meta = { id: "catalog", catalogVersion: download.manifest.catalogVersion, generatedAt: download.manifest.generatedAt, preferences: { ...preferences, lastCheckedAt: new Date().toISOString() } };
      memory.sync.set(run.id, { ...run, status: "completed", completedAt: new Date().toISOString(), added: result.added, updated: result.updated, archived: result.archived, unchanged: result.unchanged });
    }
    return loadPromptCatalog();
  } catch (error) {
    await putValue(STORES.sync, { ...run, status: "failed", completedAt: new Date().toISOString(), errors: { catalog: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

export function shouldAutoUpdate(preferences: PromptCatalogPreferences, now = Date.now()) {
  if (preferences.autoUpdate === "off") return false;
  if (preferences.autoUpdate === "startup") return true;
  if (!preferences.lastCheckedAt) return true;
  const elapsed = now - new Date(preferences.lastCheckedAt).getTime();
  return elapsed >= (preferences.autoUpdate === "daily" ? 24 : 7 * 24) * 60 * 60 * 1000;
}

export async function exportPromptCatalogData() {
  await seedIfNeeded();
  const [templates, sources, local, usage, sync, meta] = await Promise.all([
    getAll<PromptTemplate>(STORES.templates), getAll<PromptCatalogSource>(STORES.sources), getAll<PromptLocalState>(STORES.local), getAll<PromptUsage>(STORES.usage), getAll<PromptSyncRun>(STORES.sync), getMeta(),
  ]);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), templates, sources, local, usage, sync, meta };
}

export async function importPromptCatalogData(input: unknown) {
  const data = input as Awaited<ReturnType<typeof exportPromptCatalogData>>;
  if (
    data?.schemaVersion !== 1
    || !Array.isArray(data.templates)
    || !Array.isArray(data.sources)
    || !Array.isArray(data.local)
    || !Array.isArray(data.usage)
    || !Array.isArray(data.sync)
    || !data.meta
  ) throw new Error(translate("errors.catalogUnsupported"));

  if (typeof indexedDB === "undefined") {
    memory.templates.clear();
    memory.sources.clear();
    memory.local.clear();
    memory.usage.clear();
    memory.sync.clear();
    data.templates.forEach((item) => memory.templates.set(item.id, structuredClone(item)));
    data.sources.forEach((source) => memory.sources.set(source.id, structuredClone(source)));
    data.local.forEach((state) => memory.local.set(state.templateId, structuredClone(state)));
    data.usage.forEach((usage) => memory.usage.set(usage.id, structuredClone(usage)));
    data.sync.forEach((run) => memory.sync.set(run.id, structuredClone(run)));
    memory.meta = structuredClone(data.meta);
    return loadPromptCatalog();
  }

  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const storeNames = [STORES.templates, STORES.sources, STORES.local, STORES.usage, STORES.sync, STORES.meta];
    const transaction = database.transaction(storeNames, "readwrite");
    storeNames.forEach((storeName) => transaction.objectStore(storeName).clear());
    data.templates.forEach((item) => transaction.objectStore(STORES.templates).put(item));
    data.sources.forEach((source) => transaction.objectStore(STORES.sources).put(source));
    data.local.forEach((state) => transaction.objectStore(STORES.local).put(state));
    data.usage.forEach((usage) => transaction.objectStore(STORES.usage).put(usage));
    data.sync.forEach((run) => transaction.objectStore(STORES.sync).put(run));
    transaction.objectStore(STORES.meta).put(data.meta);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error(translate("errors.catalogRollback"))); };
  });
  return loadPromptCatalog();
}
