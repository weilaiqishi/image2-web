import { load } from "cheerio";
import { fetchText, makeRecord } from "./utils.mjs";

export const image2NetSource = {
  id: "image2-net",
  name: "image-2.net",
  url: "https://image-2.net/gpt-image-2-prompts/",
  license: "Source terms",
  attribution: "image-2.net",
};
function remoteImageUrl(src) {
  if (!src) return "";
  const url = new URL(src, image2NetSource.url);
  return url.searchParams.get("url") ?? url.href;
}

export function parseImage2NetIndex(html) {
  const $ = load(html);
  const records = new Map();
  $('a[href^="/gpt-image-2-prompts/"]').each((_, element) => {
    const card = $(element);
    const href = card.attr("href") ?? "";
    const sourceKey = href.match(/^\/gpt-image-2-prompts\/([^/?]+)\/$/)?.[1];
    const title = card.find("h3").first().text().trim();
    const prompt = card.find("p").first().text().trim();
    const metadata = card.find("span").map((__, span) => $(span).text().trim()).get().filter(Boolean);
    if (!sourceKey || !title || !prompt || records.has(sourceKey)) return;
    records.set(sourceKey, makeRecord(image2NetSource, {
      sourceKey,
      title,
      prompt,
      category: metadata.at(-2) || "creative",
      aspectRatio: metadata.at(-1),
      previewUrl: remoteImageUrl(card.find("img").first().attr("src")),
      sourceUrl: new URL(href, image2NetSource.url).href,
      modelFamilies: ["gpt-image-2"],
    }));
  });
  return [...records.values()];
}

export const image2NetAdapter = {
  source: image2NetSource,
  async fetchIndex() {
    return parseImage2NetIndex(await fetchText(image2NetSource.url));
  },
};
