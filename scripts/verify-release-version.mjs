#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function normalizeReleaseVersion(input) {
  const original = typeof input === "string" ? input : "";
  const version = original.startsWith("v") ? original.slice(1) : original;

  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(
      `Invalid release version or tag "${original}": expected exact SemVer, optionally prefixed with v.`,
    );
  }

  return version;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function cargoPackageVersion(source) {
  let inPackageTable = false;

  for (const line of source.split(/\r?\n/)) {
    const table = line.match(/^\s*\[([^\]]+)]\s*(?:#.*)?$/);
    if (table) {
      inPackageTable = table[1].trim() === "package";
      continue;
    }

    if (!inPackageTable) continue;

    const version = line.match(/^\s*version\s*=\s*(["'])([^"']+)\1\s*(?:#.*)?$/);
    if (version) return version[2];
  }

  throw new Error("Unable to find package.version in src-tauri/Cargo.toml.");
}

function displayVersion(version) {
  return typeof version === "string" ? version : JSON.stringify(version);
}

export async function verifyReleaseVersion(input, root = process.cwd()) {
  const expected = normalizeReleaseVersion(input);
  const [packageJson, packageLock, cargoToml, tauriConfig] = await Promise.all([
    readJson(resolve(root, "package.json")),
    readJson(resolve(root, "package-lock.json")),
    readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8"),
    readJson(resolve(root, "src-tauri/tauri.conf.json")),
  ]);

  const sources = [
    ["package.json version", packageJson.version],
    ["package-lock.json version", packageLock.version],
    ["src-tauri/Cargo.toml package.version", cargoPackageVersion(cargoToml)],
    ["src-tauri/tauri.conf.json version", tauriConfig.version],
  ];

  if (Object.hasOwn(packageLock.packages ?? {}, "")) {
    sources.splice(2, 0, [
      'package-lock.json packages[""].version',
      packageLock.packages[""].version,
    ]);
  }

  const mismatches = sources
    .filter(([, actual]) => actual !== expected)
    .map(([label, actual]) => (
      `- ${label}: expected ${expected}, found ${displayVersion(actual)}`
    ));

  if (mismatches.length > 0) {
    throw new Error(`Release version ${expected} does not match:\n${mismatches.join("\n")}`);
  }

  return expected;
}

const isDirectInvocation = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/verify-release-version.mjs <version-or-tag>");
    process.exitCode = 1;
  } else {
    verifyReleaseVersion(process.argv[2])
      .then((version) => {
        console.log(`Release version ${version} matches all version sources.`);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
      });
  }
}
