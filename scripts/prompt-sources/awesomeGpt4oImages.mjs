import { parse } from "yaml";
import { fetchText, makeRecord, mapConcurrent } from "./utils.mjs";

export const awesomeGpt4oSource = {
  id: "awesome-gpt4o-images",
  name: "Awesome GPT-4o Images",
  url: "https://github.com/jamez-bondos/awesome-gpt4o-images",
  license: "CC BY 4.0",
  attribution: "Awesome GPT-4o Images contributors",
};
export function parseAwesomeCase(caseYaml, attributionYaml, sourceKey) {
  const item = parse(caseYaml);
  const credit = parse(attributionYaml);
  return makeRecord(awesomeGpt4oSource, {
    sourceKey,
    title: item.title || item.title_en,
    prompt: item.prompt || item.prompt_en,
    description: item.prompt_note || item.reference_note || "",
    sourceUrl: credit?.source_links?.[0]?.url || item?.source_links?.[0]?.url || `${awesomeGpt4oSource.url}/tree/main/cases/${sourceKey}`,
    license: credit?.license || awesomeGpt4oSource.license,
    attribution: [credit?.prompt_author, credit?.image_author].filter(Boolean).join(" / ") || awesomeGpt4oSource.attribution,
    previewUrl: item.image ? `https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main/cases/${sourceKey}/${item.image}` : undefined,
    publishedAt: credit?.date,
    modelFamilies: ["gpt-4o", "gpt-image-1"],
    tags: [credit?.creation_tool, item.author].filter(Boolean),
  });
}

export const awesomeGpt4oAdapter = {
  source: awesomeGpt4oSource,
  async fetchIndex({ limit = 12 } = {}) {
    const tree = JSON.parse(await fetchText("https://api.github.com/repos/jamez-bondos/awesome-gpt4o-images/git/trees/main?recursive=1"));
    const keys = tree.tree
      .map((entry) => entry.path.match(/^cases\/(\d+)\/case\.yml$/)?.[1])
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, limit);
    return mapConcurrent(keys, 4, async (key) => parseAwesomeCase(
      await fetchText(`https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main/cases/${key}/case.yml`),
      await fetchText(`https://raw.githubusercontent.com/jamez-bondos/awesome-gpt4o-images/main/cases/${key}/ATTRIBUTION.yml`),
      key,
    ));
  },
};
