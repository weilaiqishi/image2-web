import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import bundledPromptCatalog from "../data/prompt-catalog-v2.json";
import type {
  AnnotationDocument,
  AssetRecord,
  EditInput,
  AgentProtocol,
  GenerateInput,
  SaveSettingsInput,
  Settings,
  PromptCatalogDownload,
} from "../types";
import { localizedErrorMessage, translate } from "../i18n";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const isDemo = () => new URLSearchParams(window.location.search).get("demo") === "1";

const browserSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  agentProtocol: "responses",
  agentModel: "gpt-5.6",
  imageModel: "gpt-image-2",
  hasApiKey: isDemo(),
};

const demoAssets: AssetRecord[] = [
  {
    id: "demo-edited-address-v2",
    filePath: "/demo/mooncake-edited.jpg",
    mimeType: "image/jpeg",
    prompt: translate("mock.mooncakeEdit"),
    createdAt: new Date().toISOString(),
    parentId: "demo-original-mooncake-v2",
    kind: "edited",
  },
  {
    id: "demo-original-mooncake-v2",
    filePath: "/demo/mooncake-original.jpg",
    mimeType: "image/jpeg",
    prompt: translate("mock.mooncakeProduct"),
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    kind: "generated",
  },
  {
    id: "demo-wide-result-v1",
    filePath: "/prompt-thumbnails/deep-ocean-underwater.webp",
    mimeType: "image/webp",
    prompt: translate("mock.oceanSample"),
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    width: 640,
    height: 360,
    kind: "generated",
  },
];

declare global {
  interface Window {
    __IMAGE2_BROWSER_ASSETS__?: AssetRecord[];
  }
}

// Keep Demo results stable across Vite HMR module replacement.
const browserAssets: AssetRecord[] = window.__IMAGE2_BROWSER_ASSETS__ ?? (window.__IMAGE2_BROWSER_ASSETS__ = isDemo() ? [...demoAssets] : []);

function browserLineage(parentId: string | undefined, input: { branchLabel?: string; sourceTaskId?: string; sourceDocumentId?: string }) {
  const parent = parentId ? browserAssets.find((asset) => asset.id === parentId) : undefined;
  return {
    parentId,
    rootId: parent?.lineage?.rootId ?? parent?.id ?? parentId ?? "",
    revision: parent?.lineage ? parent.lineage.revision + 1 : parentId ? 1 : 0,
    branchLabel: input.branchLabel,
    sourceTaskId: input.sourceTaskId,
    sourceDocumentId: input.sourceDocumentId,
  };
}

const desktopOnly = (): never => {
  throw new Error(translate("errors.desktopRequired"));
};

interface AgentAttachmentMetadata {
  attachmentId: string;
  kind: string;
  documentId?: string;
  baseAssetId?: string;
  objects?: Array<{ id: string }>;
}

function attachmentMetadata(body: unknown): AgentAttachmentMetadata[] {
  const result: AgentAttachmentMetadata[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.startsWith("{")) {
      try {
        const parsed = JSON.parse(record.text) as AgentAttachmentMetadata;
        if (parsed.attachmentId && parsed.kind) result.push(parsed);
      } catch { /* User text may also be JSON. */ }
    }
    Object.values(record).forEach(visit);
  };
  visit(body);
  return result;
}

export function currentUserText(protocol: AgentProtocol, body: unknown): string {
  const request = body as Record<string, any>;
  const items = protocol === "responses" ? request?.input : request?.messages;
  if (!Array.isArray(items)) return "";
  const message = [...items].reverse().find((item) => item?.role === "user");
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  const textType = protocol === "responses" ? "input_text" : "text";
  return message.content.filter((item: any) => item?.type === textType && typeof item?.text === "string").map((item: any) => item.text).join("\n");
}

export const bridge = {
  async getSettings(): Promise<Settings> {
    return isTauri() ? invoke("get_settings") : browserSettings;
  },
  async saveSettings(input: SaveSettingsInput): Promise<Settings> {
    if (!isTauri()) {
      Object.assign(browserSettings, {
        baseUrl: input.baseUrl,
        agentProtocol: input.agentProtocol,
        agentModel: input.agentModel,
        imageModel: input.imageModel,
        hasApiKey: Boolean(input.apiKey) || browserSettings.hasApiKey,
      });
      return { ...browserSettings };
    }
    return invoke("save_settings", { input });
  },
  async generate(input: GenerateInput): Promise<AssetRecord> {
    if (!isTauri()) {
      if (isDemo()) {
        const id = crypto.randomUUID();
        const asset: AssetRecord = {
          ...demoAssets[2],
          id,
          prompt: input.prompt,
          createdAt: new Date().toISOString(),
          parentId: input.parentAssetId,
          lineage: { ...browserLineage(input.parentAssetId, input), rootId: input.parentAssetId ? browserLineage(input.parentAssetId, input).rootId : id },
        };
        browserAssets.unshift(asset);
        return asset;
      }
      desktopOnly();
    }
    return invoke("generate_image", { input });
  },
  async importAssetDataUrl(dataUrl: string, name: string): Promise<AssetRecord> {
    if (!isTauri()) {
      const asset: AssetRecord = { id: crypto.randomUUID(), filePath: dataUrl, mimeType: dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png", prompt: name, createdAt: new Date().toISOString(), kind: "imported" };
      browserAssets.unshift(asset);
      return asset;
    }
    return invoke("import_asset", { dataUrl, name });
  },
  async proxyAgent(protocol: AgentProtocol, body: unknown): Promise<unknown> {
    if (!isTauri()) {
      const serialized = JSON.stringify(body);
      if (serialized.includes("recommend_generation_settings")) {
        const args = JSON.stringify({ aspectRatio: "3:4", quality: "high", reason: translate("mock.recommendationReason") });
        return protocol === "responses"
          ? { output: [{ type: "function_call", name: "recommend_generation_settings", arguments: args }] }
          : { choices: [{ message: { tool_calls: [{ function: { name: "recommend_generation_settings", arguments: args } }] } }] };
      }
      const metadata = attachmentMetadata(body);
      const references = metadata.map((item) => item.attachmentId);
      const annotation = metadata.find((item) => item.kind === "annotation");
      const annotationObjectIds = annotation?.objects?.map((object) => object.id) ?? [];
      const userText = currentUserText(protocol, body);
      const tasks = annotation ? [{
        title: translate("mock.editTitle"),
        prompt: translate("mock.editPrompt"),
        operation: "edit",
        referenceIds: references,
        annotationId: annotation.attachmentId,
        annotationDocumentId: annotation.documentId,
        annotationObjectIds,
        baseAssetId: annotation.baseAssetId,
        preserve: [translate("compiler.defaultPreserveUnmarked"), translate("role.identityDetailed"), translate("compiler.defaultPreserveComposition")],
        variantGroupId: null,
      }] : /(三视图|three[ -]?views?)/i.test(userText) ? [translate("mock.frontView"), translate("mock.leftView"), translate("mock.rightView")].map((title) => ({
        title,
        prompt: translate("mock.viewPrompt", { view: title }),
        operation: "generate",
        referenceIds: references.slice(0, 1),
        annotationId: null,
        annotationDocumentId: null,
        annotationObjectIds: [],
        baseAssetId: null,
        preserve: [],
        variantGroupId: null,
      })) : [{ title: translate("mock.generateTitle"), prompt: translate("mock.generatePrompt"), operation: "generate", referenceIds: references.slice(0, 1), annotationId: null, annotationDocumentId: null, annotationObjectIds: [], baseAssetId: null, preserve: [], variantGroupId: null }];
      const args = JSON.stringify({ summary: translate("runtime.mockSummary", { count: tasks.length }), tasks });
      return protocol === "responses"
        ? { output: [{ type: "function_call", name: "create_image_tasks", arguments: args }] }
        : { choices: [{ message: { content: "", tool_calls: [{ function: { name: "create_image_tasks", arguments: args } }] } }] };
    }
    return invoke("proxy_agent", { input: { protocol, body } });
  },
  async edit(input: EditInput): Promise<AssetRecord> {
    if (!isTauri()) {
      if (isDemo()) {
        const asset = { ...demoAssets[0], id: crypto.randomUUID(), prompt: input.prompt, createdAt: new Date().toISOString(), parentId: input.originalAssetId, lineage: browserLineage(input.originalAssetId, input) };
        browserAssets.unshift(asset);
        return asset;
      }
      desktopOnly();
    }
    return invoke("edit_image", { input });
  },
  async listAssets(): Promise<AssetRecord[]> {
    return isTauri() ? invoke("list_assets") : browserAssets.map((asset) => ({ ...asset, lineage: asset.lineage ? { ...asset.lineage } : undefined }));
  },
  async readAssetDataUrl(assetId: string): Promise<string> {
    if (!isTauri()) {
      const asset = browserAssets.find((item) => item.id === assetId);
      if (!asset) throw new Error(translate("errors.imageNotFound"));
      const response = await fetch(asset.filePath);
      const blob = await response.blob();
      return filesToDataUrls([new File([blob], "asset", { type: blob.type })]).then((values) => values[0]);
    }
    return invoke("read_asset_data_url", { assetId });
  },
  async deleteAsset(assetId: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("delete_asset", { assetId });
  },
  async updateAssetMetadata(assetId: string, input: { branchLabel?: string; hidden?: boolean }): Promise<AssetRecord> {
    if (!isTauri()) {
      const asset = browserAssets.find((item) => item.id === assetId);
      if (!asset) throw new Error(translate("errors.imageNotFound"));
      if (input.branchLabel) asset.lineage = { ...(asset.lineage ?? { parentId: asset.parentId, rootId: asset.parentId ?? asset.id, revision: asset.parentId ? 1 : 0 }), branchLabel: input.branchLabel };
      if (input.hidden !== undefined) asset.hiddenAt = input.hidden ? new Date().toISOString() : undefined;
      return { ...asset };
    }
    return invoke("update_asset_metadata", { assetId, branchLabel: input.branchLabel, hidden: input.hidden });
  },
  async exportAsset(assetId: string): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke("export_asset", { assetId });
  },
  async saveAnnotation(documentId: string, sourceAssetId: string, json: string): Promise<void> {
    if (!isTauri()) {
      localStorage.setItem(`image2-annotation:${documentId}`, JSON.stringify({ documentId, sourceAssetId, json, updatedAt: new Date().toISOString() }));
      return;
    }
    return invoke("save_annotation", { documentId, sourceAssetId, json });
  },
  async loadAnnotation(documentId: string): Promise<AnnotationDocument | null> {
    if (!isTauri()) {
      const value = localStorage.getItem(`image2-annotation:${documentId}`);
      if (!value) return null;
      try {
        const stored = JSON.parse(value) as AnnotationDocument;
        if (stored.documentId && stored.sourceAssetId) return stored;
      } catch {
        return { documentId, sourceAssetId: documentId, json: value, updatedAt: new Date().toISOString() };
      }
      return null;
    }
    return invoke("load_annotation", { documentId });
  },
  async listAnnotations(sourceAssetId: string): Promise<AnnotationDocument[]> {
    if (!isTauri()) {
      return Object.keys(localStorage)
        .filter((key) => key.startsWith("image2-annotation:"))
        .map((key) => {
          try { return JSON.parse(localStorage.getItem(key) ?? "") as AnnotationDocument; } catch { return null; }
        })
        .filter((document): document is AnnotationDocument => document?.sourceAssetId === sourceAssetId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
    return invoke("list_annotations", { sourceAssetId });
  },
  async saveAnnotationOverlay(documentId: string, dataUrl: string): Promise<string> {
    if (!isTauri()) {
      localStorage.setItem(`image2-annotation-overlay:${documentId}`, dataUrl);
      return documentId;
    }
    return invoke("save_annotation_overlay", { documentId, dataUrl });
  },
  async readAnnotationOverlayDataUrl(documentId: string): Promise<string> {
    if (!isTauri()) {
      const value = localStorage.getItem(`image2-annotation-overlay:${documentId}`);
      if (!value) throw new Error(translate("errors.overlayNotFound"));
      return value;
    }
    return invoke("read_annotation_overlay_data_url", { documentId });
  },
  async deleteAnnotation(documentId: string): Promise<void> {
    if (!isTauri()) {
      localStorage.removeItem(`image2-annotation:${documentId}`);
      localStorage.removeItem(`image2-annotation-overlay:${documentId}`);
      return;
    }
    return invoke("delete_annotation", { documentId });
  },
  async downloadPromptCatalog(eagerThumbnails = false): Promise<PromptCatalogDownload> {
    if (!isTauri()) {
      const bundled = bundledPromptCatalog as unknown as PromptCatalogDownload["manifest"] & { items: PromptCatalogDownload["items"] };
      return {
        manifest: {
          schemaVersion: 1,
          catalogVersion: bundled.catalogVersion,
          generatedAt: bundled.generatedAt,
          checksum: bundled.checksum,
          sources: bundled.sources,
        },
        items: bundled.items,
        thumbnailPaths: Object.fromEntries(bundled.items.map((item) => [item.id, item.cachedThumbnailPath ?? ""])),
      };
    }
    return invoke("download_prompt_catalog", { eagerThumbnails });
  },
  async cachePromptThumbnail(remotePath: string): Promise<string> {
    if (!isTauri()) return remotePath;
    return invoke("cache_prompt_thumbnail", { remotePath });
  },
};

export function assetSrc(asset: AssetRecord): string {
  if (/^(data:|blob:|https?:)/.test(asset.filePath)) return asset.filePath;
  return isTauri() ? convertFileSrc(asset.filePath) : asset.filePath;
}

export function promptThumbnailSrc(path?: string): string {
  if (!path) return "";
  if (/^(data:|blob:|https?:)/.test(path) || path.startsWith("/prompt-catalog/")) return path;
  return isTauri() ? convertFileSrc(path) : path;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return localizedErrorMessage(error);
  if (error instanceof Error) return localizedErrorMessage(error.message);
  return translate("errors.generic");
}

export async function filesToDataUrls(files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}
