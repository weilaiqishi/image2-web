import { makeRecord } from "./utils.mjs";

export const awesomePromptsSource = {
  id: "awesome-prompts",
  name: "Awesome Prompts",
  url: "https://github.com/songtianlun/awesome-prompts",
  license: "MIT",
  attribution: "songtianlun/awesome-prompts",
};
export function parseAwesomePromptsMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const records = [];
  let heading = "";
  let sectionLines = [];
  const flush = () => {
    if (!heading) return;
    const section = sectionLines.join("\n");
    const prompt = [...section.matchAll(/```(?:text|markdown)?\n([\s\S]*?)```/g)].map((match) => match[1].trim()).find(Boolean);
    if (!prompt) return;
    const image = section.match(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)/i);
    const sourceKey = heading.match(/(?:案例|Case)\s*(\d+)/i)?.[1] || String(records.length + 1);
    const preview = image?.[1] || image?.[2];
    records.push(makeRecord(awesomePromptsSource, {
      sourceKey,
      title: heading.replace(/^#+\s*/, "").replace(/\s*\(by[\s\S]*$/i, ""),
      prompt,
      sourceUrl: `${awesomePromptsSource.url}/blob/main/docs/text-to-image/gpt/awesome-gpt4o-images.md#案例-${sourceKey}`,
      previewUrl: preview ? new URL(preview, "https://raw.githubusercontent.com/songtianlun/awesome-prompts/main/docs/text-to-image/gpt/").href : undefined,
      modelFamilies: ["gpt-4o", "gpt-image"],
    }));
  };
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      flush();
      heading = line.replace(/^###\s+/, "").trim();
      sectionLines = [];
    } else if (heading) {
      sectionLines.push(line);
    }
  }
  flush();
  return records;
}

export const awesomePromptsAdapter = {
  source: awesomePromptsSource,
  async fetchIndex({ limit = 12 } = {}) {
    const response = await fetch("https://raw.githubusercontent.com/songtianlun/awesome-prompts/main/docs/text-to-image/gpt/awesome-gpt4o-images.md");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${response.url}`);
    return parseAwesomePromptsMarkdown(await response.text()).slice(0, limit);
  },
};
