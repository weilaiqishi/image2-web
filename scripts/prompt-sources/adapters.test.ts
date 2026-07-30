import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { parseAwesomePromptsMarkdown } from "./awesomePrompts.mjs";
import { parseImage2NetIndex } from "./image2Net.mjs";
import { retainPreviousSource } from "./utils.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFile(path.join(fixtureDir, name), "utf8");

describe("prompt source adapters", () => {
  it("parses image-2.net cards and rejects empty anchors", async () => {
    const records = parseImage2NetIndex(await fixture("image2-net.html"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: "image2-net:neon-market", aspectRatio: "16:9", category: "cityscape" });
  });

  it("extracts fenced image prompts from awesome-prompts", async () => {
    const records = parseAwesomePromptsMarkdown(await fixture("awesome-prompts.md"));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ sourceId: "awesome-prompts", sourceKey: "12" });
  });

  it("retains the last successful source snapshot when an adapter fails", () => {
    const previous = [
      { id: "one:a", sourceId: "one", sourceReferences: [{ sourceId: "one" }] },
      { id: "two:b", sourceId: "two", sourceReferences: [{ sourceId: "two" }] },
      { id: "one:c", sourceId: "one", sourceReferences: [{ sourceId: "one" }, { sourceId: "mirror" }] },
    ];
    expect(retainPreviousSource(previous, "one").map((item) => item.id)).toEqual(["one:a", "one:c"]);
    expect(retainPreviousSource(previous, "mirror").map((item) => item.id)).toEqual(["one:c"]);
  });
});
