import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { awesomeGpt4oAdapter, awesomePromptsAdapter, image2NetAdapter, openaiCookbookAdapter } from "./prompt-sources/index.mjs";
import { canonicalJson, retainPreviousSource, sha256, slugify } from "./prompt-sources/utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public", "prompt-catalog");
const thumbnailDir = path.join(publicDir, "thumbnails");
const manifestPath = path.join(publicDir, "catalog-manifest.json");
const shardPath = path.join(publicDir, "catalog-0001.json");
const bundledPath = path.join(root, "src", "data", "prompt-catalog-v2.json");
const baseUrl = "https://raw.githubusercontent.com/weilaiqishi/image2-web/main/public/prompt-catalog";
const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] || 12));
const adapters = [image2NetAdapter, awesomeGpt4oAdapter, awesomePromptsAdapter, openaiCookbookAdapter];
const sourceColors = {
  "image2-net": "#236a52",
  "awesome-gpt4o-images": "#b64535",
  "awesome-prompts": "#315f8c",
  "openai-cookbook": "#6d5f9a",
};

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function atomicWrite(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]);
}

async function placeholder(record, destination) {
  const color = sourceColors[record.sourceId] || "#4f5d57";
  const title = escapeXml(record.title.slice(0, 54));
  const source = escapeXml(record.sourceId.toUpperCase());
  const svg = Buffer.from(`<svg width="640" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="480" fill="#e9ecea"/><rect width="12" height="480" fill="${color}"/><text x="48" y="72" fill="${color}" font-family="Arial" font-size="18" font-weight="700">${source}</text><text x="48" y="210" fill="#17201c" font-family="Arial" font-size="30" font-weight="700">${title}</text><path d="M48 250H560" stroke="#b9c1bd"/><text x="48" y="292" fill="#68716c" font-family="Arial" font-size="16">LOCAL CATALOG PREVIEW</text></svg>`);
  await sharp(svg).webp({ quality: 82 }).toFile(destination);
}

async function cacheThumbnail(record) {
  const fileName = `${slugify(record.id)}-${record.promptHash.slice(0, 10)}.webp`;
  const destination = path.join(thumbnailDir, fileName);
  if (record.previewUrl) {
    try {
      const response = await fetch(record.previewUrl, { headers: { "User-Agent": "Image2-Studio-Catalog/1.0" } });
      if (!response.ok) throw new Error(`${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await sharp(bytes).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(destination);
    } catch {
      await placeholder(record, destination);
    }
  } else {
    await placeholder(record, destination);
  }
  return `/prompt-catalog/thumbnails/${fileName}`;
}

function mergeDuplicates(items) {
  const byHash = new Map();
  for (const item of items) {
    const reference = {
      sourceId: item.sourceId,
      sourceKey: item.sourceKey,
      sourceUrl: item.sourceUrl,
      license: item.license,
      attribution: item.attribution,
    };
    const existing = byHash.get(item.promptHash);
    if (!existing) {
      byHash.set(item.promptHash, { ...item, sourceReferences: [reference] });
    } else if (!existing.sourceReferences.some((source) => source.sourceId === reference.sourceId && source.sourceKey === reference.sourceKey)) {
      existing.sourceReferences.push(reference);
    }
  }
  return [...byHash.values()];
}

await mkdir(thumbnailDir, { recursive: true });
await mkdir(path.dirname(bundledPath), { recursive: true });
const previous = await readJson(bundledPath, { items: [], sources: [] });
const runs = await Promise.all(adapters.map(async (adapter) => {
  try {
    const items = (await adapter.fetchIndex({ limit })).slice(0, limit);
    if (!items.length) throw new Error("source returned no templates");
    return { source: adapter.source, items, status: "success", error: undefined };
  } catch (error) {
    const items = retainPreviousSource(previous.items, adapter.source.id);
    if (!items.length) throw new Error(`${adapter.source.name}: ${error instanceof Error ? error.message : error}`);
    return { source: adapter.source, items, status: "stale", error: error instanceof Error ? error.message : String(error) };
  }
}));

const imported = runs.flatMap((run) => run.items);
const merged = mergeDuplicates(imported);
for (const [index, record] of merged.entries()) {
  record.cachedThumbnailPath = await cacheThumbnail(record);
  process.stdout.write(`\rCaching ${index + 1}/${merged.length}`);
}

const generatedAt = new Date().toISOString();
const catalogVersion = generatedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
const items = merged.sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.title.localeCompare(right.title));
const shard = { schemaVersion: 1, catalogVersion, generatedAt, items };
const shardChecksum = sha256(`${JSON.stringify(shard, null, 2)}\n`);
const sources = runs.map((run) => ({
  id: run.source.id,
  name: run.source.name,
  url: run.source.url,
  license: run.source.license,
  attribution: run.source.attribution,
  enabledByDefault: true,
  status: run.status,
  error: run.error,
  itemCount: items.filter((item) => item.sourceReferences.some((source) => source.sourceId === run.source.id)).length,
  fetchedAt: generatedAt,
}));
const manifestCore = {
  schemaVersion: 1,
  catalogVersion,
  generatedAt,
  sources,
  shards: [{ id: "catalog-0001", url: `${baseUrl}/catalog-0001.json`, checksum: shardChecksum, itemCount: items.length }],
};
const manifest = { ...manifestCore, checksum: sha256(canonicalJson(manifestCore)) };
const bundled = { ...manifest, items };

await atomicWrite(shardPath, shard);
await atomicWrite(manifestPath, manifest);
await atomicWrite(bundledPath, bundled);
process.stdout.write(`\nWrote ${items.length} templates from ${sources.length} sources (${catalogVersion}).\n`);
