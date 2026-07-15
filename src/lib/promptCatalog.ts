import catalogJson from "../data/prompt-catalog.json";
import type { AspectRatio, PromptCatalogSource, PromptTemplate, Resolution } from "../types";

interface PromptCatalogData {
  source: PromptCatalogSource;
  items: PromptTemplate[];
}

const data = catalogJson as PromptCatalogData;

export const promptCatalog = data.items;
export const promptCatalogSource = data.source;

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

export function filterPromptTemplates(items: PromptTemplate[], query: string, category = "all"): PromptTemplate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (category !== "all" && item.category.toLowerCase() !== category.toLowerCase()) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.description, item.prompt, item.category, item.bestFor, ...item.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function normalizeAspectRatio(source: string): AspectRatio {
  const [width, height] = source.split(":").map(Number);
  if (!width || !height) return "1:1";
  const ratio = width / height;
  const supported: Array<[AspectRatio, number]> = [
    ["1:1", 1],
    ["4:3", 4 / 3],
    ["16:9", 16 / 9],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
  ];
  return supported.reduce((best, candidate) =>
    Math.abs(Math.log(candidate[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? candidate : best,
  )[0];
}

export function normalizeResolution(source: string): Resolution {
  const normalized = source.toUpperCase();
  if (normalized.includes("4K")) return "4K";
  if (normalized.includes("1K")) return "1K";
  return "2K";
}
