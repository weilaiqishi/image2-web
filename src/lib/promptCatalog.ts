import catalogJson from "../data/prompt-catalog-v2.json";
import type { AspectRatio, PromptCatalogSource, PromptTemplate, PromptTemplateView, Resolution } from "../types";
import { createDefaultLocalState, mergePromptView } from "./promptCatalogStore";
import { translate, type TranslationKey } from "../i18n";

interface PromptCatalogData {
  sources: PromptCatalogSource[];
  items: PromptTemplate[];
}

const data = catalogJson as unknown as PromptCatalogData;

export const promptCatalog = data.items.map((item) => mergePromptView(item, createDefaultLocalState(item.id, item.importedAt)));
export const promptCatalogSources = data.sources;

export const categoryKeys: Record<string, TranslationKey> = {
  character: "category.character",
  cityscape: "category.cityscape",
  creative: "category.creative",
  documentary: "category.documentary",
  experimental: "category.experimental",
  infographic: "category.infographic",
  interior: "category.interior",
  landscape: "category.landscape",
  lifestyle: "category.lifestyle",
  marketing: "category.marketing",
  nature: "category.nature",
  panorama: "category.panorama",
  portrait: "category.portrait",
  poster: "category.poster",
  product: "category.product",
  rednote: "category.rednote",
  storyboard: "category.storyboard",
  ui: "category.ui",
  wildlife: "category.wildlife",
};

export function localizedCategory(category: string): string {
  const key = categoryKeys[category.toLowerCase()];
  return key ? translate(key) : category;
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
