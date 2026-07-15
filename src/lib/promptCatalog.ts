import catalogJson from "../data/prompt-catalog-v2.json";
import type { AspectRatio, PromptCatalogSource, PromptTemplate, PromptTemplateView, Resolution } from "../types";
import { createDefaultLocalState, mergePromptView } from "./promptCatalogStore";

interface PromptCatalogData {
  sources: PromptCatalogSource[];
  items: PromptTemplate[];
}

const data = catalogJson as unknown as PromptCatalogData;

export const promptCatalog = data.items.map((item) => mergePromptView(item, createDefaultLocalState(item.id, item.importedAt)));
export const promptCatalogSources = data.sources;

export const categoryLabels: Record<string, string> = {
  character: "角色",
  cityscape: "城市",
  creative: "创意",
  documentary: "纪实",
  experimental: "实验",
  infographic: "信息图",
  interior: "空间",
  landscape: "风景",
  lifestyle: "生活方式",
  marketing: "营销",
  nature: "自然",
  panorama: "全景",
  portrait: "人像",
  poster: "海报",
  product: "产品",
  rednote: "小红书",
  storyboard: "分镜",
  ui: "界面",
  wildlife: "野生动物",
};

export function localizedCategory(category: string): string {
  return categoryLabels[category.toLowerCase()] ?? category;
}

export interface PromptFilters {
  query?: string;
  category?: string;
  sourceId?: string;
  view?: "all" | "favorites" | "recent" | "modified" | "archived";
}

export function filterPromptTemplates(items: PromptTemplateView[], queryOrFilters: string | PromptFilters = "", legacyCategory = "all"): PromptTemplateView[] {
  const filters: PromptFilters = typeof queryOrFilters === "string" ? { query: queryOrFilters, category: legacyCategory } : queryOrFilters;
  const normalizedQuery = filters.query?.trim().toLocaleLowerCase() ?? "";
  return items.filter((item) => {
    if (filters.category && filters.category !== "all" && item.category.toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.sourceId && filters.sourceId !== "all" && !item.sourceReferences.some((source) => source.sourceId === filters.sourceId)) return false;
    if (filters.view === "favorites" && !item.local.favorite) return false;
    if (filters.view === "recent" && !item.local.lastUsedAt) return false;
    if (filters.view === "modified" && !item.local.customPrompt && !item.local.customTitle && !item.local.note && !item.local.customTags.length) return false;
    if (filters.view === "archived" && !item.archivedAt) return false;
    if (filters.view !== "archived" && item.archivedAt && !item.local.favorite && !item.local.useCount && !item.local.customPrompt) return false;
    if (!normalizedQuery) return true;
    return [item.displayTitle, item.description, item.displayPrompt, item.category, item.bestFor, item.attribution, ...item.displayTags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function normalizeAspectRatio(source = "1:1"): AspectRatio {
  const [width, height] = source.split(":").map(Number);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const supported: Array<[AspectRatio, number]> = [
    ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["3:4", 3 / 4], ["9:16", 9 / 16],
  ];
  return supported.reduce((best, candidate) => Math.abs(Math.log(candidate[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? candidate : best)[0];
}

export function normalizeResolution(source = "2K"): Resolution {
  const normalized = source.toUpperCase();
  if (normalized.includes("4K")) return "4K";
  if (normalized.includes("1K")) return "1K";
  return "2K";
}
