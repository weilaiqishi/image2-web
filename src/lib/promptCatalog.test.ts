import { describe, expect, it } from "vitest";
import { filterPromptTemplates, normalizeAspectRatio, normalizeResolution, promptCatalog } from "./promptCatalog";

describe("prompt catalog", () => {
  it("filters across titles, prompt text, categories, and tags", () => {
    expect(filterPromptTemplates(promptCatalog, "portrait").length).toBeGreaterThan(0);
    expect(filterPromptTemplates(promptCatalog, "", "cityscape").every((item) => item.category.toLowerCase() === "cityscape")).toBe(true);
    expect(filterPromptTemplates(promptCatalog, "no matching prompt phrase")).toHaveLength(0);
  });

  it("filters by source references after exact prompt deduplication", () => {
    expect(filterPromptTemplates(promptCatalog, { sourceId: "awesome-prompts" }).length).toBeGreaterThan(0);
    expect(filterPromptTemplates(promptCatalog, { sourceId: "openai-cookbook" }).every((item) => item.sourceReferences.some((source) => source.sourceId === "openai-cookbook"))).toBe(true);
  });

  it("keeps archived templates visible when the customer has local value", () => {
    const archived = { ...promptCatalog[0], archivedAt: "2026-07-15T00:00:00.000Z", local: { ...promptCatalog[0].local, favorite: true } };
    expect(filterPromptTemplates([archived], { view: "favorites" })).toHaveLength(1);
    expect(filterPromptTemplates([archived], { view: "archived" })).toHaveLength(1);
  });

  it("maps source ratios and resolutions to supported generation settings", () => {
    expect(normalizeAspectRatio("16:9")).toBe("16:9");
    expect(normalizeAspectRatio("3:2")).toBe("4:3");
    expect(normalizeAspectRatio("4:5")).toBe("3:4");
    expect(normalizeAspectRatio("2:3")).toBe("3:4");
    expect(normalizeResolution("4k")).toBe("4K");
    expect(normalizeResolution("unknown")).toBe("2K");
  });

  it("ships all four P0 sources with provenance and licensing", () => {
    const sourceIds = new Set(promptCatalog.flatMap((item) => item.sourceReferences.map((source) => source.sourceId)));
    expect(sourceIds).toEqual(new Set(["image2-net", "awesome-gpt4o-images", "awesome-prompts", "openai-cookbook"]));
    for (const template of promptCatalog) {
      expect(template.sourceReferences.length).toBeGreaterThan(0);
      expect(template.sourceReferences.every((source) => source.sourceUrl && source.license && source.attribution)).toBe(true);
    }
  });
});
