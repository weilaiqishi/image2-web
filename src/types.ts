export type WorkspaceMode = "generate" | "inspire" | "annotate";
export type AgentProtocol = "responses" | "chat_completions";
export type Quality = "low" | "medium" | "high";
export type OutputFormat = "png" | "jpeg" | "webp";
export type AspectRatio = "1:1" | "4:3" | "16:9" | "3:4" | "9:16";
export type Resolution = "1K" | "2K" | "4K";

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
}

export interface EditInput extends GenerationParams {
  originalAssetId: string;
  annotatedDataUrl: string;
  annotationPrompt: string;
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
  kind: "generated" | "edited" | "imported";
}

export interface AnnotationDocument {
  assetId: string;
  json: string;
  updatedAt: string;
}

export type Attachment = ReferenceAttachment | AssetAttachment | AnnotationAttachment;

export interface ReferenceAttachment {
  id: string;
  kind: "reference";
  name: string;
  dataUrl: string;
}

export interface AssetAttachment {
  id: string;
  kind: "asset";
  assetId: string;
  name: string;
}

export interface AnnotationAttachment {
  id: string;
  kind: "annotation";
  sourceAssetId: string;
  documentJson: string;
  annotatedDataUrl: string;
  instruction: string;
  createdAt: string;
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
  resultAssetId?: string;
  error?: string;
  attempt: number;
}

export interface ComposerDraft {
  text: string;
  attachments: Attachment[];
  params: GenerationParams;
  recommendation?: GenerationRecommendation;
}

export interface GenerationRecommendation {
  aspectRatio: AspectRatio;
  quality: Quality;
  reason: string;
  status: "loading" | "ready" | "applied" | "dismissed" | "error";
}

export interface WorkspaceState {
  version: 1;
  selectedConversationId: string;
  conversations: Conversation[];
  messages: ChatMessage[];
  batches: GenerationBatch[];
  tasks: GenerationTask[];
  drafts: Record<string, ComposerDraft>;
}

export interface PlannedImageTask {
  title: string;
  prompt: string;
  operation: "generate" | "edit";
  referenceIds: string[];
  annotationId?: string;
}

export interface CreateImageTasksInput {
  summary: string;
  tasks: PlannedImageTask[];
}

export interface AgentTurnResult {
  text: string;
  plan?: CreateImageTasksInput;
}

export interface PromptTemplate {
  slug: string;
  title: string;
  description: string;
  prompt: string;
  category: string;
  tags: string[];
  aspectRatio: string;
  resolution: string;
  model: string;
  bestFor: string;
  publishedAt: string;
  previewUrl: string;
  thumbnail: string;
  sourceUrl: string;
  phrases: string[];
}

export interface PromptCatalogSource {
  name: string;
  url: string;
  discovered: number;
  imported: number;
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
