export type WorkspaceMode = "generate" | "inspire" | "annotate";
export type Quality = "low" | "medium" | "high";
export type OutputFormat = "png" | "jpeg" | "webp";
export type AspectRatio = "1:1" | "4:3" | "16:9" | "3:4" | "9:16";
export type Resolution = "1K" | "2K" | "4K";

export interface Settings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface SaveSettingsInput {
  baseUrl: string;
  model: string;
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
