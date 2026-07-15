import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import sharp from "sharp";

const SOURCE_ORIGIN = "https://image-2.net";
const CATALOG_URL = `${SOURCE_ORIGIN}/gpt-image-2-prompts/`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = path.join(root, "src", "data", "prompt-catalog.json");
const thumbnailDir = path.join(root, "public", "prompt-thumbnails");
const importAll = process.argv.includes("--all");
const perCategoryArg = process.argv.find((argument) => argument.startsWith("--per-category="));
const perCategory = Math.max(1, Number(perCategoryArg?.split("=")[1] ?? 3));

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Image2-Studio-Prompt-Importer/0.2 (+local desktop catalog)" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

function remoteImageUrl(src) {
  if (!src) return "";
  const url = new URL(src, SOURCE_ORIGIN);
  return url.searchParams.get("url") ?? url.href;
}

function parseCatalog(html) {
  const $ = load(html);
  const bySlug = new Map();

  $('a[href^="/gpt-image-2-prompts/"]').each((_, element) => {
    const card = $(element);
    const href = card.attr("href") ?? "";
    const slug = href.match(/^\/gpt-image-2-prompts\/([^/?]+)\/$/)?.[1];
    const title = card.find("h3").first().text().trim();
    const prompt = card.find("p").first().text().trim();
    const metadata = card.find("span").map((__, span) => $(span).text().trim()).get().filter(Boolean);
    if (!slug || !title || !prompt || metadata.length < 2 || bySlug.has(slug)) return;

    bySlug.set(slug, {
      slug,
      title,
      prompt,
      category: metadata.at(-2),
      aspectRatio: metadata.at(-1),
      thumbnailUrl: remoteImageUrl(card.find("img").first().attr("src") ?? ""),
      sourceUrl: new URL(href, SOURCE_ORIGIN).href,
    });
  });

  return [...bySlug.values()];
}

function selectBalanced(items) {
  if (importAll) return items;
  const categoryCounts = new Map();
  return items.filter((item) => {
    const count = categoryCounts.get(item.category) ?? 0;
    if (count >= perCategory) return false;
    categoryCounts.set(item.category, count + 1);
    return true;
  });
}

function definition($, label) {
  const term = $("dt").filter((_, element) => $(element).text().trim().toLowerCase() === label.toLowerCase()).first();
  return term.next("dd").text().trim();
}

function parseDetail(html, fallback) {
  const $ = load(html);
  const jsonLd = $('script[type="application/ld+json"]')
    .map((_, element) => {
      try { return JSON.parse($(element).text()); } catch { return null; }
    })
    .get()
    .find((entry) => entry?.["@type"] === "ImageObject");
  const tags = $('a[href*="?tag="]').map((_, element) => $(element).text().trim().replace(/^#/, "")).get();
  const category = $('a[href*="?category="]').last().text().trim() || fallback.category;
  const prompt = jsonLd?.caption?.trim() || fallback.prompt;

  return {
    ...fallback,
    title: jsonLd?.name?.trim() || fallback.title,
    description: jsonLd?.description?.trim() || "",
    prompt,
    category,
    tags: [...new Set(tags)],
    aspectRatio: definition($, "Aspect ratio") || fallback.aspectRatio,
    resolution: (definition($, "Resolution") || "2K").toUpperCase(),
    model: definition($, "Model") || "GPT-Image-2",
    bestFor: definition($, "Best for"),
    publishedAt: jsonLd?.datePublished ?? "",
    previewUrl: jsonLd?.contentUrl ?? fallback.thumbnailUrl,
    phrases: prompt.split(/,\s*/).map((phrase) => phrase.trim()).filter(Boolean),
  };
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function downloadThumbnail(item) {
  const response = await fetch(item.thumbnailUrl, {
    headers: { "User-Agent": "Image2-Studio-Prompt-Importer/0.2 (+local desktop catalog)" },
  });
  if (!response.ok) throw new Error(`Thumbnail ${response.status}: ${item.thumbnailUrl}`);
  const input = Buffer.from(await response.arrayBuffer());
  const filename = `${item.slug}.webp`;
  const output = await sharp(input).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  await writeFile(path.join(thumbnailDir, filename), output);
  return `/prompt-thumbnails/${filename}`;
}

const catalog = parseCatalog(await fetchText(CATALOG_URL));
const selected = selectBalanced(catalog);
if (!selected.length) throw new Error("No prompt cards were found; the source structure may have changed.");

await mkdir(path.dirname(outputFile), { recursive: true });
await mkdir(thumbnailDir, { recursive: true });

const detailed = await mapConcurrent(selected, 4, async (item, index) => {
  const detail = parseDetail(await fetchText(item.sourceUrl), item);
  const thumbnail = await downloadThumbnail(detail);
  process.stdout.write(`\rImported ${String(index + 1).padStart(2, " ")}/${selected.length}: ${detail.slug}      `);
  return { ...detail, thumbnail };
});

const output = {
  source: {
    name: "Image2 - Free, Curated GPT Image 2 Prompts",
    url: CATALOG_URL,
    discovered: catalog.length,
    imported: detailed.length,
  },
  items: detailed.map(({ thumbnailUrl, ...item }) => item),
};

await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`\nWrote ${path.relative(root, outputFile)} with ${detailed.length} prompts.\n`);
