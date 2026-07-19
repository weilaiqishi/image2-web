import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(root, "site");
const outputDir = join(root, "dist-site");
const defaultOrigin = "https://image2-studio.pages.dev";
const siteOrigin = (process.env.SITE_ORIGIN || defaultOrigin).replace(/\/$/, "");

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(siteOrigin)) {
  throw new Error("SITE_ORIGIN must be an HTTPS origin without a path");
}

await mkdir(outputDir, { recursive: true });

const staticEntries = ["assets", "en", "_headers", "_redirects"];
for (const entry of staticEntries) {
  await cp(join(sourceDir, entry), join(outputDir, entry), { recursive: true, force: true });
}

const templates = ["index.html", "en/index.html", "robots.txt", "sitemap.xml"];
for (const template of templates) {
  const source = await readFile(join(sourceDir, template), "utf8");
  const target = join(outputDir, template);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, source.replaceAll("__SITE_ORIGIN__", siteOrigin));
}

const imageDir = join(outputDir, "images");
await rm(imageDir, { recursive: true, force: true });
await mkdir(imageDir, { recursive: true });
await cp(join(sourceDir, "images"), imageDir, { recursive: true, force: true });

const images = [
  ["docs/images/manual-workspace-dark-v2.jpg", "studio-workspace-dark.jpg"],
  ["src-tauri/icons/128x128.png", "favicon.png"],
];

for (const [source, target] of images) {
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

console.log(`Marketing site assembled in dist-site for ${siteOrigin}`);
