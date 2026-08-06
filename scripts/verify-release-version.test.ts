import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyReleaseVersion } from "./verify-release-version.mjs";

const temporaryDirectories: string[] = [];

async function createVersionFixture(versions: {
  packageJson?: string;
  packageLock?: string;
  packageLockRoot?: string;
  cargo?: string;
  tauri?: string;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "image2-release-version-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "src-tauri"));

  const packageVersion = versions.packageJson ?? "1.2.3";
  const lockVersion = versions.packageLock ?? "1.2.3";
  const lockRootVersion = versions.packageLockRoot ?? "1.2.3";
  const cargoVersion = versions.cargo ?? "1.2.3";
  const tauriVersion = versions.tauri ?? "1.2.3";

  await Promise.all([
    writeFile(path.join(root, "package.json"), JSON.stringify({ version: packageVersion })),
    writeFile(path.join(root, "package-lock.json"), JSON.stringify({
      version: lockVersion,
      packages: { "": { version: lockRootVersion } },
    })),
    writeFile(path.join(root, "src-tauri", "Cargo.toml"), [
      "[package]",
      'name = "image2-studio"',
      `version = "${cargoVersion}"`,
      "",
      "[dependencies]",
      'example = "9.9.9"',
      "",
    ].join("\n")),
    writeFile(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({
      productName: "Image2 Studio",
      version: tauriVersion,
    })),
  ]);

  return root;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("verifyReleaseVersion", () => {
  it("accepts an exact SemVer matching every version source", async () => {
    const root = await createVersionFixture();

    await expect(verifyReleaseVersion("1.2.3", root)).resolves.toBe("1.2.3");
  });

  it("reports every mismatched version source", async () => {
    const root = await createVersionFixture({
      packageJson: "1.2.4",
      packageLock: "1.2.5",
      packageLockRoot: "1.2.6",
      cargo: "1.2.7",
      tauri: "1.2.8",
    });

    await expect(verifyReleaseVersion("1.2.3", root)).rejects.toThrow([
      "Release version 1.2.3 does not match:",
      "- package.json version: expected 1.2.3, found 1.2.4",
      "- package-lock.json version: expected 1.2.3, found 1.2.5",
      "- package-lock.json packages[\"\"].version: expected 1.2.3, found 1.2.6",
      "- src-tauri/Cargo.toml package.version: expected 1.2.3, found 1.2.7",
      "- src-tauri/tauri.conf.json version: expected 1.2.3, found 1.2.8",
    ].join("\n"));
  });

  it("normalizes one leading v before comparison", async () => {
    const root = await createVersionFixture();

    await expect(verifyReleaseVersion("v1.2.3", root)).resolves.toBe("1.2.3");
  });

  it.each([
    "v1.2",
    "01.2.3",
    "vv1.2.3",
    "v1.2.3-01",
    " v1.2.3",
  ])("rejects malformed release input %s", async (input) => {
    const root = await createVersionFixture();

    await expect(verifyReleaseVersion(input, root)).rejects.toThrow(
      `Invalid release version or tag "${input}": expected exact SemVer, optionally prefixed with v.`,
    );
  });
});
