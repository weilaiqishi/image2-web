import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AnnotationDocument,
  AssetRecord,
  EditInput,
  GenerateInput,
  SaveSettingsInput,
  Settings,
} from "../types";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const isDemo = () => new URLSearchParams(window.location.search).get("demo") === "1";

const browserSettings: Settings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-image-2",
  hasApiKey: isDemo(),
};

const demoAssets: AssetRecord[] = [
  {
    id: "demo-edited-address-v2",
    filePath: "/demo/mooncake-edited.jpg",
    mimeType: "image/jpeg",
    prompt: "月饼产品图，底部加入商店地址",
    createdAt: new Date().toISOString(),
    parentId: "demo-original-mooncake-v2",
    kind: "edited",
  },
  {
    id: "demo-original-mooncake-v2",
    filePath: "/demo/mooncake-original.jpg",
    mimeType: "image/jpeg",
    prompt: "高端中秋月饼礼盒商业产品摄影",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    kind: "generated",
  },
];

const desktopOnly = (): never => {
  throw new Error("图片请求需要在 Image2 Studio 桌面客户端中运行");
};

export const bridge = {
  async getSettings(): Promise<Settings> {
    return isTauri() ? invoke("get_settings") : browserSettings;
  },
  async saveSettings(input: SaveSettingsInput): Promise<Settings> {
    if (!isTauri()) {
      Object.assign(browserSettings, {
        baseUrl: input.baseUrl,
        model: input.model,
        hasApiKey: Boolean(input.apiKey) || browserSettings.hasApiKey,
      });
      return { ...browserSettings };
    }
    return invoke("save_settings", { input });
  },
  async generate(input: GenerateInput): Promise<AssetRecord> {
    if (!isTauri()) desktopOnly();
    return invoke("generate_image", { input });
  },
  async edit(input: EditInput): Promise<AssetRecord> {
    if (!isTauri()) desktopOnly();
    return invoke("edit_image", { input });
  },
  async listAssets(): Promise<AssetRecord[]> {
    return isTauri() ? invoke("list_assets") : isDemo() ? demoAssets : [];
  },
  async deleteAsset(assetId: string): Promise<void> {
    if (!isTauri()) return;
    return invoke("delete_asset", { assetId });
  },
  async exportAsset(assetId: string): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke("export_asset", { assetId });
  },
  async saveAnnotation(assetId: string, json: string): Promise<void> {
    if (!isTauri()) {
      localStorage.setItem(`image2-annotation:${assetId}`, json);
      return;
    }
    return invoke("save_annotation", { assetId, json });
  },
  async loadAnnotation(assetId: string): Promise<AnnotationDocument | null> {
    if (!isTauri()) {
      const json = localStorage.getItem(`image2-annotation:${assetId}`);
      return json ? { assetId, json, updatedAt: new Date().toISOString() } : null;
    }
    return invoke("load_annotation", { assetId });
  },
};

export function assetSrc(asset: AssetRecord): string {
  if (/^(data:|blob:|https?:)/.test(asset.filePath)) return asset.filePath;
  return isTauri() ? convertFileSrc(asset.filePath) : asset.filePath;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "操作未完成，请检查设置后重试";
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
