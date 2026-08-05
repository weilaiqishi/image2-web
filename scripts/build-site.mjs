import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { resolveAdConfig } from "./ad-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(root, "site");
const outputDir = join(root, "dist-site");
const defaultOrigin = "https://image2-studio.pages.dev";
const siteOrigin = (process.env.SITE_ORIGIN || defaultOrigin).replace(/\/$/, "");
const adConfig = resolveAdConfig(process.env);

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteOrigin)) {
  throw new Error("SITE_ORIGIN must be an HTTPS origin without a path");
}

const replacements = new Map([
  ["__SITE_ORIGIN__", siteOrigin],
  ["__AD_PROVIDER__", adConfig.activeProvider],
  ["__ADSENSE_CLIENT__", adConfig.adsense.client],
  ["__ADSENSE_ACCOUNT_CLIENT__", adConfig.adsense.publisherClient],
  ["__ADSENSE_SLOT__", adConfig.adsense.slot],
  ["__ADSENSE_SCRIPT_URL__", adConfig.adsense.scriptUrl],
  ["__ADSENSE_PUBLISHER_ID__", adConfig.adsense.publisherClient.replace(/^ca-/, "")],
  ["__ADSENSE_ADS_TXT_RECORD__", adConfig.adsTxtRecords.find((record) => record.startsWith("google.com,")) || ""],
  ["__ADSTERRA_PLACEMENT_ID__", adConfig.adsterra.placementId],
  ["__ADSTERRA_OPTIONS_SOURCE_JSON__", JSON.stringify(adConfig.adsterra.optionsSource)],
  ["__ADSTERRA_SCRIPT_ORIGIN__", adConfig.adsterra.scriptOrigin],
  ["__ADSTERRA_SCRIPT_URL__", adConfig.adsterra.scriptUrl],
  ["__ADSTERRA_ADS_TXT_RECORD__", adConfig.adsterra.adsTxtRecord],
]);

function renderTemplate(source) {
  let rendered = source;
  for (const [placeholder, value] of replacements) rendered = rendered.replaceAll(placeholder, value);
  return rendered;
}

async function renderTextFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await renderTextFiles(path);
      continue;
    }
    if (!/\.(?:css|html|js|txt|xml)$/i.test(entry.name) && !entry.name.startsWith("_")) continue;
    const source = await readFile(path, "utf8");
    await writeFile(path, renderTemplate(source));
  }
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
  if (entry.name === "images") continue;
  await cp(join(sourceDir, entry.name), join(outputDir, entry.name), { recursive: entry.isDirectory(), force: true });
}

await renderTextFiles(outputDir);

const imageDir = join(outputDir, "images");
await rm(imageDir, { recursive: true, force: true });
await mkdir(imageDir, { recursive: true });
await cp(join(sourceDir, "images"), imageDir, { recursive: true, force: true });

const images = [
  ["docs/images/manual-workspace-dark-v2.jpg", "studio-workspace-dark.jpg"],
  ["src-tauri/icons/128x128.png", "favicon.png"],
  ["docs/images/manual-settings-dark.jpg", "guide/settings.jpg"],
  ["docs/images/manual-workspace-dark-v2.jpg", "guide/workspace.jpg"],
  ["docs/images/manual-annotation-example.webp", "guide/annotation.webp"],
];

for (const [source, target] of images) {
  await mkdir(resolve(join(imageDir, target), ".."), { recursive: true });
  await cp(join(root, source), join(imageDir, target), { force: true });
}

await cp(
  join(root, "node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2"),
  join(outputDir, "assets/instrument-sans.woff2"),
  { force: true },
);
const ogOverlay = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#050607" fill-opacity="0.74"/>
    <rect x="62" y="60" width="58" height="58" rx="4" fill="#0d2a21" stroke="#68f0be" stroke-width="2"/>
    <text x="91" y="98" fill="#68f0be" font-family="Arial, sans-serif" font-size="27" font-weight="700" text-anchor="middle">I²</text>
    <text x="62" y="382" fill="#f3f6f4" font-family="Arial, sans-serif" font-size="76" font-weight="700">Image2 Studio</text>
    <text x="64" y="446" fill="#68f0be" font-family="Arial, sans-serif" font-size="31">Your gateway. A controlled image workflow.</text>
    <text x="64" y="505" fill="#f3f6f4" font-family="Arial, sans-serif" font-size="23">gpt-image-2 · OpenAI-compatible · Local-first</text>
  </svg>
`);

await sharp(join(sourceDir, "images/cases/case-ui.webp"))
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .composite([{ input: ogOverlay }])
  .jpeg({ quality: 88, progressive: true })
  .toFile(join(imageDir, "og-image2-studio.jpg"));

console.log(`Marketing site assembled in dist-site for ${siteOrigin} (ads: ${adConfig.activeProvider})`);
