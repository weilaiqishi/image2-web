import { makeRecord, normalizePrompt } from "./utils.mjs";

export const openaiCookbookSource = {
  id: "openai-cookbook",
  name: "OpenAI Cookbook",
  url: "https://github.com/openai/openai-cookbook",
  license: "MIT",
  attribution: "OpenAI Cookbook",
};
export function parseCookbookNotebook(notebookJson) {
  const notebook = typeof notebookJson === "string" ? JSON.parse(notebookJson) : notebookJson;
  const candidates = [];
  for (const cell of notebook.cells || []) {
    if (cell.cell_type !== "code") continue;
    const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");
    for (const match of source.matchAll(/(?:prompt\w*)\s*=\s*(?:[rubf]*)(["']{3})([\s\S]*?)\1|(?:prompt\w*)\s*=\s*(["'])(.*?)\3/g)) {
      const prompt = normalizePrompt(match[2] || match[4]);
      if (prompt.length >= 24) candidates.push(prompt);
    }
  }
  return [...new Set(candidates)].map((prompt, index) => makeRecord(openaiCookbookSource, {
    sourceKey: `generate-images-${index + 1}`,
    title: `Cookbook image example ${index + 1}`,
    prompt,
    sourceUrl: `${openaiCookbookSource.url}/blob/main/examples/Generate_Images_With_GPT_Image.ipynb`,
    modelFamilies: ["gpt-image-1"],
    tags: ["official", "cookbook"],
  }));
}

export const openaiCookbookAdapter = {
  source: openaiCookbookSource,
  async fetchIndex({ limit = 12 } = {}) {
    const response = await fetch("https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/Generate_Images_With_GPT_Image.ipynb");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${response.url}`);
    return parseCookbookNotebook(await response.text()).slice(0, limit);
  },
};
