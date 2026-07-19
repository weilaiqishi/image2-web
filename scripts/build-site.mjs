import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(root, "site");
const outputDir = join(root, "dist-site");
const defaultOrigin = "https://image2-studio.pages.dev";
const siteOrigin = (process.env.SITE_ORIGIN || defaultOrigin).replace(/\/$/, "");
const requestedAdsenseClient = (process.env.ADSENSE_CLIENT || "").trim();
const requestedAdsenseSlot = (process.env.ADSENSE_SLOT || "").trim();
const validAdsenseClient = /^ca-pub-\d{16}$/.test(requestedAdsenseClient);
const validAdsenseSlot = /^\d{10}$/.test(requestedAdsenseSlot);
const certifiedCmpConfirmed = process.env.ADSENSE_CMP_CERTIFIED === "true";
const adsenseEnabled = validAdsenseClient && validAdsenseSlot && certifiedCmpConfirmed;
const adsensePublisherClient = validAdsenseClient ? requestedAdsenseClient : "";
const adsenseClient = adsenseEnabled ? requestedAdsenseClient : "";
const adsenseSlot = adsenseEnabled ? requestedAdsenseSlot : "";
const adsenseScriptUrl = adsenseEnabled ? "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" : "";
const selfOnlyCsp = "Content-Security-Policy: default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'; upgrade-insecure-requests";

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteOrigin)) {
  throw new Error("SITE_ORIGIN must be an HTTPS origin without a path");
}

if (requestedAdsenseClient && !validAdsenseClient) {
  console.warn("AdSense publisher verification disabled: ADSENSE_CLIENT must match ca-pub- plus 16 digits");
} else if (requestedAdsenseSlot && !validAdsenseSlot) {
  console.warn("AdSense ad serving disabled: ADSENSE_SLOT must contain 10 digits");
} else if (validAdsenseClient && validAdsenseSlot && !certifiedCmpConfirmed) {
  console.warn("AdSense disabled: set ADSENSE_CMP_CERTIFIED=true only after a Google-certified CMP is configured for production traffic");
}

const replacements = new Map([
  ["__SITE_ORIGIN__", siteOrigin],
  ["__ADSENSE_CLIENT__", adsenseClient],
  ["__ADSENSE_ACCOUNT_CLIENT__", adsensePublisherClient],
  ["__ADSENSE_SLOT__", adsenseSlot],
  ["__ADSENSE_SCRIPT_URL__", adsenseScriptUrl],
  ["__ADSENSE_PUBLISHER_ID__", adsensePublisherClient.replace(/^ca-/, "")],
  ["__ADSENSE_ADS_TXT_RECORD__", validAdsenseClient ? `google.com, ${adsensePublisherClient.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0` : ""],
  // Google only supports nonce-based strict CSP for AdSense. A static Pages build
  // cannot issue a fresh nonce per response, so ad-enabled builds omit CSP rather
  // than ship a brittle domain allowlist that can silently block ad resources.
  ["__CONTENT_SECURITY_POLICY__", adsenseEnabled ? "" : selfOnlyCsp],
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
    let rendered = renderTemplate(source);
    if (entry.name === "_headers") {
      rendered = rendered.replace(/(Content-Security-Policy:[^\n]+)/, (line) => line.replace(/[ \t]{2,}/g, " ").replace(/\s+;/g, ";"));
    }
    await writeFile(path, rendered);
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

console.log(`Marketing site assembled in dist-site for ${siteOrigin} (AdSense ${adsenseEnabled ? "configured" : "disabled"})`);
