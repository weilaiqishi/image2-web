import { describe, expect, it } from "vitest";
import { filterPromptTemplates, normalizeAspectRatio, normalizeResolution, promptCatalog } from "./promptCatalog";

describe("prompt catalog", () => {
  it("filters across titles, prompt text, categories, and tags", () => {
    expect(filterPromptTemplates(promptCatalog, "Tokyo").some((item) => item.slug === "neon-lit-tokyo-street")).toBe(true);
    expect(filterPromptTemplates(promptCatalog, "", "cityscape").every((item) => item.category === "cityscape")).toBe(true);
    expect(filterPromptTemplates(promptCatalog, "no matching prompt phrase")).toHaveLength(0);
  });

  it("maps source ratios and resolutions to supported generation settings", () => {
    expect(normalizeAspectRatio("16:9")).toBe("16:9");
    expect(normalizeAspectRatio("3:2")).toBe("4:3");
    expect(normalizeAspectRatio("4:5")).toBe("3:4");
    expect(normalizeAspectRatio("2:3")).toBe("3:4");
    expect(normalizeResolution("4k")).toBe("4K");
    expect(normalizeResolution("unknown")).toBe("2K");
  });
});
