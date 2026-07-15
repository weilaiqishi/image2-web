import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  AnnotationDocument,
  AssetRecord,
  EditInput,
  AgentProtocol,
  GenerateInput,
  SaveSettingsInput,
  Settings,
} from "../types";

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
  {
    id: "demo-wide-result-v1",
    filePath: "/prompt-thumbnails/deep-ocean-underwater.webp",
    mimeType: "image/webp",
    prompt: "深海水下世界宽幅样片",
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    width: 640,
    height: 360,
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
      if (isDemo()) return { ...demoAssets[2], prompt: input.prompt };
      desktopOnly();
    }
    return invoke("generate_image", { input });
  },
  async proxyAgent(protocol: AgentProtocol, body: unknown): Promise<unknown> {
    if (!isTauri()) {
      const serialized = JSON.stringify(body);
      if (serialized.includes("recommend_generation_settings")) {
        const args = JSON.stringify({ aspectRatio: "3:4", quality: "high", reason: "参考图以人物为主体且为竖向构图，精细质量更适合保留妆容细节。" });
        return protocol === "responses"
          ? { output: [{ type: "function_call", name: "recommend_generation_settings", arguments: args }] }
          : { choices: [{ message: { tool_calls: [{ function: { name: "recommend_generation_settings", arguments: args } }] } }] };
      }
      const references = [...serialized.matchAll(/附件 ([\w-]+)，类型/g)].map((match) => match[1]);
      const tasks = serialized.includes("三视图") ? ["正面视图", "左侧视图", "右侧视图"].map((title, index) => ({
        title,
        prompt: `保持参考图人物、妆容与光线一致，生成${title}，干净背景，高细节。`,
        operation: "generate",
        referenceIds: references.slice(0, 1),
      })) : [{ title: "生成校样", prompt: "根据用户要求和参考图生成高质量图片。", operation: "generate", referenceIds: references.slice(0, 1) }];
      const args = JSON.stringify({ summary: `已拆分为 ${tasks.length} 个串行任务。`, tasks });
      return protocol === "responses"
        ? { output: [{ type: "function_call", name: "create_image_tasks", arguments: args }] }
        : { choices: [{ message: { content: "", tool_calls: [{ function: { name: "create_image_tasks", arguments: args } }] } }] };
    }
    return invoke("proxy_agent", { input: { protocol, body } });
  },
  async edit(input: EditInput): Promise<AssetRecord> {
    if (!isTauri()) desktopOnly();
    return invoke("edit_image", { input });
  },
  async listAssets(): Promise<AssetRecord[]> {
    return isTauri() ? invoke("list_assets") : isDemo() ? demoAssets : [];
  },
  async readAssetDataUrl(assetId: string): Promise<string> {
    if (!isTauri()) {
      const asset = demoAssets.find((item) => item.id === assetId);
      if (!asset) throw new Error("找不到图片");
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
