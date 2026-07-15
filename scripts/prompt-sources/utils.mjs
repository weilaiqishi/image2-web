import { createHash } from "node:crypto";

export const IMPORTED_AT = "2026-07-15T00:00:00.000Z";

export function sha256(value) {
  const input = typeof value === "string" || ArrayBuffer.isView(value) ? value : JSON.stringify(value);
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function normalizePrompt(value) {
  return String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function slugify(value) {
  return String(value ?? "prompt")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "prompt";
}

export function inferCategory(value) {
  const text = String(value).toLowerCase();
  if (/poster|海报|广告|brand|品牌/.test(text)) return "marketing";
  if (/portrait|人像|肖像|headshot/.test(text)) return "portrait";
  if (/infographic|信息图|diagram|图解/.test(text)) return "infographic";
  if (/product|产品|包装|商品/.test(text)) return "product";
  if (/interior|室内|房间|空间/.test(text)) return "interior";
  if (/city|城市|street|街道/.test(text)) return "cityscape";
  if (/character|角色|人物|动漫|chibi/.test(text)) return "character";
  return "creative";
}

export function makeRecord(source, input) {
  const prompt = normalizePrompt(input.prompt);
  const sourceKey = String(input.sourceKey || slugify(input.title || prompt.slice(0, 64)));
  const title = normalizePrompt(input.title || sourceKey.replace(/-/g, " "));
  return {
    id: `${source.id}:${sourceKey}`,
    sourceId: source.id,
    sourceKey,
    sourceUrl: input.sourceUrl || source.url,
    sourceRevision: input.sourceRevision || undefined,
    license: input.license || source.license,
    attribution: input.attribution || source.attribution,
    title,
    description: normalizePrompt(input.description || ""),
    prompt,
    language: input.language || (/\p{Script=Han}/u.test(prompt) ? "zh" : "en"),
    category: String(input.category || inferCategory(`${title} ${prompt}`)).toLowerCase(),
    tags: [...new Set((input.tags || []).map((tag) => normalizePrompt(tag)).filter(Boolean))],
    modelFamilies: input.modelFamilies || ["gpt-image"],
    aspectRatio: input.aspectRatio || undefined,
    resolution: input.resolution || undefined,
    bestFor: input.bestFor || undefined,
    previewUrl: input.previewUrl || undefined,
    cachedThumbnailPath: input.cachedThumbnailPath || undefined,
    promptHash: sha256(prompt.toLocaleLowerCase()),
    publishedAt: input.publishedAt || undefined,
    upstreamUpdatedAt: input.upstreamUpdatedAt || undefined,
    importedAt: input.importedAt || IMPORTED_AT,
    archivedAt: undefined,
  };
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Image2-Studio-Catalog/1.0 (+https://github.com/weilaiqishi/image2-web)",
      Accept: "application/vnd.github+json, text/plain, text/html",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

export async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

export function retainPreviousSource(items, sourceId) {
  return items.filter((item) => item.sourceId === sourceId || item.sourceReferences?.some((source) => source.sourceId === sourceId));
}
