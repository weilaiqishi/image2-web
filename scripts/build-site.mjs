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

const images = [
  ["docs/images/manual-workspace.jpg", "studio-workspace.jpg"],
  ["docs/images/manual-prompt-library.jpg", "prompt-library.jpg"],
  ["docs/images/manual-settings.jpg", "connection-settings.jpg"],
  ["public/demo/mooncake-original.jpg", "mooncake-original.jpg"],
  ["public/demo/mooncake-edited.jpg", "mooncake-edited.jpg"],
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
await cp(
  join(root, "node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2"),
  join(outputDir, "assets/newsreader-italic.woff2"),
  { force: true },
);

const ogOverlay = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#142019" fill-opacity="0.82"/>
    <rect x="62" y="64" width="62" height="62" rx="8" fill="#e54f3b"/>
    <text x="93" y="106" fill="#ffffff" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle">I²</text>
    <text x="62" y="382" fill="#ffffff" font-family="Arial, sans-serif" font-size="78" font-weight="700">Image2 Studio</text>
    <text x="64" y="448" fill="#9fe3c2" font-family="Arial, sans-serif" font-size="34">One relay setup. A studio the family can use.</text>
    <text x="64" y="510" fill="#ffffff" font-family="Arial, sans-serif" font-size="25">Compatible relay · Local-first · Chinese &amp; English</text>
  </svg>
`);

await sharp(join(root, "docs/images/manual-workspace.jpg"))
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .composite([{ input: ogOverlay }])
  .jpeg({ quality: 88, progressive: true })
  .toFile(join(imageDir, "og-image2-studio.jpg"));

console.log(`Marketing site assembled in dist-site for ${siteOrigin}`);
