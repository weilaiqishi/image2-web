export type WorkspaceMode = "generate" | "inspire" | "annotate";
export type AgentProtocol = "responses" | "chat_completions";
export type Quality = "low" | "medium" | "high";
export type OutputFormat = "png" | "jpeg" | "webp";
export type AspectRatio = "1:1" | "4:3" | "16:9" | "3:4" | "9:16";
export type Resolution = "1K" | "2K" | "4K";
export type ReferenceRole = "base" | "identity" | "product" | "pose" | "composition" | "material" | "palette" | "style" | "layout" | "logo" | "other";
export type AnnotationObjectKind = "point" | "rect" | "mask" | "arrow" | "note";

export interface ImageProviderCapabilities {
  supportsEdit: boolean;
  supportsMultipleReferences: boolean;
  supportsMask: boolean;
  supportsStructuredRegions: boolean;
  supportsLayers: boolean;
}

export interface Settings {
  baseUrl: string;
  agentProtocol: AgentProtocol;
  agentModel: string;
  imageModel: string;
  hasApiKey: boolean;
}

export interface SaveSettingsInput {
  baseUrl: string;
  agentProtocol: AgentProtocol;
  agentModel: string;
  imageModel: string;
  apiKey?: string;
}

export interface GenerationParams {
  prompt: string;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  size: string;
  quality: Quality;
  outputFormat: OutputFormat;
}

export interface GenerateInput extends GenerationParams {
  referenceDataUrls?: string[];
  referenceAssetIds?: string[];
  parentAssetId?: string;
  sourceTaskId?: string;
  sourceDocumentId?: string;
  branchLabel?: string;
}

export interface EditInput extends GenerationParams {
  originalAssetId: string;
  annotatedDataUrl?: string;
  overlayAssetId?: string;
  maskDataUrl?: string;
  referenceAssetIds?: string[];
  referenceDataUrls?: string[];
  structuredRegions?: AnnotationObjectRecord[];
  sourceTaskId?: string;
  sourceDocumentId?: string;
  branchLabel?: string;
  annotationPrompt: string;
}

export interface AssetLineage {
  parentId?: string;
  rootId: string;
  revision: number;
  branchLabel?: string;
  sourceTaskId?: string;
  sourceDocumentId?: string;
}

export interface AssetRecord {
  id: string;
  filePath: string;
  mimeType: string;
  prompt: string;
  createdAt: string;
  width?: number;
  height?: number;
  parentId?: string;
  lineage?: AssetLineage;
  hiddenAt?: string;
  kind: "generated" | "edited" | "imported";
}

export type NormalizedGeometry =
  | { kind: "point"; x: number; y: number; radius: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "mask"; points: Array<{ x: number; y: number }>; brushWidth: number }
  | { kind: "arrow"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: "note"; x: number; y: number; width: number; height: number };

export interface AnnotationObjectRecord {
  id: string;
  documentId: string;
  kind: AnnotationObjectKind;
  displayName: string;
  sequence: number;
  geometry: NormalizedGeometry;
  color: string;
  note?: string;
  sourceObjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationToken {
  id: string;
  kind: "annotation" | "reference" | "color";
  targetId: string;
  displayText: string;
  start: number;
  end: number;
}

export interface AnnotationDocumentV2 {
  id: string;
  sourceAssetId: string;
  conversationId: string;
  sourceWidth: number;
  sourceHeight: number;
  fabricJson: string;
  objects: AnnotationObjectRecord[];
  promptText: string;
  promptTokens: AnnotationToken[];
  status: "draft" | "attached" | "submitted";
  overlayAssetId?: string;
  legacyAnnotatedDataUrl?: string;
  legacy: boolean;
  nextSequence: Record<AnnotationObjectKind, number>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAnnotationDocument {
  documentId: string;
  sourceAssetId: string;
  json: string;
  updatedAt: string;
}

export type AnnotationDocument = StoredAnnotationDocument;

export interface ReferenceDescriptor {
  label: string;
  roles: ReferenceRole[];
  priority: number;
  preserve: string[];
}

export type Attachment = ReferenceAttachment | AssetAttachment | AnnotationAttachment;

export interface ReferenceAttachment {
  id: string;
  kind: "reference";
  name: string;
  dataUrl: string;
  descriptor?: ReferenceDescriptor;
}

export interface AssetAttachment {
  id: string;
  kind: "asset";
  assetId: string;
  name: string;
  descriptor?: ReferenceDescriptor;
}

export interface AnnotationAttachment {
  id: string;
  kind: "annotation";
  sourceAssetId: string;
  documentId: string;
  objectIds: string[];
  compiledOverlayAssetId?: string;
  instruction: string;
  tokens: AnnotationToken[];
  createdAt: string;
  documentJson?: string;
  annotatedDataUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  batchId?: string;
  createdAt: string;
}

export type BatchStatus = "queued" | "running" | "completed" | "partial" | "cancelled" | "interrupted";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface GenerationBatch {
  id: string;
  conversationId: string;
  status: BatchStatus;
  params: GenerationParams;
  taskIds: string[];
  createdAt: string;
}

export interface GenerationTask {
  id: string;
  batchId: string;
  position: number;
  title: string;
  prompt: string;
  operation: "generate" | "edit";
  status: TaskStatus;
  referenceIds: string[];
  attachments: Attachment[];
  annotationId?: string;
  annotationDocumentId?: string;
  annotationObjectIds?: string[];
  baseAssetId?: string;
  preserve?: string[];
  variantGroupId?: string;
  compiledPrompt?: string;
  annotationSnapshot?: AnnotationDocumentV2;
  capabilitiesSnapshot?: ImageProviderCapabilities;
  resultAssetId?: string;
  error?: string;
  attempt: number;
}

export interface ComposerDraft {
  text: string;
  attachments: Attachment[];
  nextImageSequence: number;
  params: GenerationParams;
  recommendation?: GenerationRecommendation;
}

export interface GenerationRecommendation {
  aspectRatio: AspectRatio;
  quality: Quality;
  reason: string;
  status: "loading" | "ready" | "applied" | "dismissed" | "error";
}

export interface AgentDiagnosticLog {
  id: string;
  conversationId: string;
  startedAt: string;
  completedAt: string;
  protocol: AgentProtocol;
  model: string;
  status: "succeeded" | "failed";
  allowedAttachmentIds: string[];
  request?: unknown;
  response?: unknown;
  error?: string;
}

export interface WorkspaceState {
  version: 2;
  selectedConversationId: string;
  conversations: Conversation[];
  messages: ChatMessage[];
  batches: GenerationBatch[];
  tasks: GenerationTask[];
  drafts: Record<string, ComposerDraft>;
  annotationDocuments: Record<string, AnnotationDocumentV2>;
  diagnosticLogs: AgentDiagnosticLog[];
  migrationWarning?: string;
}

export interface PlannedImageTask {
  title: string;
  prompt: string;
  operation: "generate" | "edit";
  referenceIds: string[];
  annotationId?: string;
  annotationDocumentId?: string;
  annotationObjectIds?: string[];
  baseAssetId?: string;
  preserve?: string[];
  variantGroupId?: string;
}

export interface CreateImageTasksInput {
  summary: string;
  tasks: PlannedImageTask[];
}

export interface AgentTurnResult {
  text: string;
  plan?: CreateImageTasksInput;
}

export interface PromptSourceReference {
  sourceId: string;
  sourceKey: string;
  sourceUrl: string;
  license?: string;
  attribution?: string;
}

export interface PromptTemplate {
  id: string;
  sourceId: string;
  sourceKey: string;
  sourceUrl: string;
  sourceRevision?: string;
  license?: string;
  attribution?: string;
  title: string;
  description: string;
  prompt: string;
  language: string;
  category: string;
  tags: string[];
  modelFamilies: string[];
  aspectRatio?: string;
  resolution?: string;
  bestFor?: string;
  previewUrl?: string;
  cachedThumbnailPath?: string;
  promptHash: string;
  publishedAt?: string;
  upstreamUpdatedAt?: string;
  importedAt: string;
  archivedAt?: string;
  sourceReferences: PromptSourceReference[];
}

export interface PromptCatalogSource {
  id: string;
  name: string;
  url: string;
  license?: string;
  attribution?: string;
  enabledByDefault: boolean;
  status: "success" | "stale" | "error";
  error?: string;
  itemCount: number;
  fetchedAt: string;
}

export interface PromptLocalState {
  templateId: string;
  favorite: boolean;
  pinned: boolean;
  hidden: boolean;
  customTitle?: string;
  customPrompt?: string;
  customTags: string[];
  note?: string;
  useCount: number;
  lastUsedAt?: string;
  lastConversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptUsage {
  id: string;
  templateId: string;
  conversationId: string;
  usedAt: string;
}

export interface PromptSyncRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "partial" | "failed" | "cancelled";
  sourceIds: string[];
  added: number;
  updated: number;
  archived: number;
  unchanged: number;
  errors: Record<string, string>;
}

export interface PromptCatalogPreferences {
  autoUpdate: "off" | "startup" | "daily" | "weekly";
  updateStrategy: "add-only" | "add-and-update";
  thumbnailStrategy: "eager" | "lazy";
  enabledSourceIds: string[];
  lastCheckedAt?: string;
}

export interface PromptTemplateView extends PromptTemplate {
  displayTitle: string;
  displayPrompt: string;
  displayTags: string[];
  local: PromptLocalState;
}

export interface PromptCatalogSnapshot {
  catalogVersion: string;
  generatedAt: string;
  templates: PromptTemplateView[];
  sources: PromptCatalogSource[];
  preferences: PromptCatalogPreferences;
  syncRuns: PromptSyncRun[];
}

export interface PromptCatalogDownload {
  manifest: {
    schemaVersion: 1;
    catalogVersion: string;
    generatedAt: string;
    checksum: string;
    sources: PromptCatalogSource[];
  };
  items: PromptTemplate[];
  thumbnailPaths: Record<string, string>;
}

export interface AppError {
  code: string;
  message: string;
  retryable?: boolean;
}

export const SIZE_PRESETS: Record<Resolution, Record<AspectRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1024x768",
    "16:9": "1280x720",
    "3:4": "768x1024",
    "9:16": "720x1280",
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2048x1536",
    "16:9": "2048x1152",
    "3:4": "1536x2048",
    "9:16": "1152x2048",
  },
  "4K": {
    "1:1": "2880x2880",
    "4:3": "3264x2448",
    "16:9": "3840x2160",
    "3:4": "2448x3264",
    "9:16": "2160x3840",
  },
};
