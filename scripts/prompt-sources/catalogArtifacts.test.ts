import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "./utils.mjs";

const root = process.cwd();
const manifestPath = path.join(root, "public", "prompt-catalog", "catalog-manifest.json");
const bundledPath = path.join(root, "src", "data", "prompt-catalog-v2.json");

describe("published prompt catalog artifacts", () => {
  it("matches manifest and shard checksums consumed by the Rust downloader", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const expectedManifestChecksum = manifest.checksum;
    const { checksum: _checksum, ...manifestCore } = manifest;
    expect(sha256(canonicalJson(manifestCore))).toBe(expectedManifestChecksum);

    for (const shard of manifest.shards) {
      const fileName = new URL(shard.url).pathname.split("/").pop();
      expect(fileName).toBeTruthy();
      const bytes = await readFile(path.join(root, "public", "prompt-catalog", fileName));
      expect(sha256(bytes)).toBe(shard.checksum);
      const payload = JSON.parse(bytes.toString("utf8"));
      expect(payload.items).toHaveLength(shard.itemCount);
      expect(payload.catalogVersion).toBe(manifest.catalogVersion);
    }
  });

  it("keeps the bundled browser snapshot aligned with the published manifest", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const bundled = JSON.parse(await readFile(bundledPath, "utf8"));
    expect(bundled).toMatchObject(manifest);
    expect(bundled.items).toHaveLength(manifest.shards.reduce((total: number, shard: { itemCount: number }) => total + shard.itemCount, 0));
  });
});
