import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDir = resolve(root, "dist-site");

const pages = [
  { path: "index.html", lang: "zh-CN", canonicalSuffix: "/" },
  { path: "en/index.html", lang: "en", canonicalSuffix: "/en/" },
];

for (const page of pages) {
  const html = await readFile(resolve(outputDir, page.path), "utf8");
  const $ = load(html);
  const failures = [];

  if ($("html").attr("lang") !== page.lang) failures.push(`html lang must be ${page.lang}`);
  if ($("h1").length !== 1 || $("h1").text().trim() !== "Image2 Studio") failures.push("must contain one literal Image2 Studio h1");
  if (($("title").text().trim().length || 0) < 20) failures.push("title is too short");
  if (($('meta[name="description"]').attr("content")?.length || 0) < 80) failures.push("description is too short");
  if (!$('link[rel="canonical"]').attr("href")?.endsWith(page.canonicalSuffix)) failures.push("canonical URL is missing or incorrect");
  if ($('link[rel="alternate"][hreflang="zh-CN"]').length !== 1) failures.push("zh-CN hreflang is missing");
  if ($('link[rel="alternate"][hreflang="en"]').length !== 1) failures.push("English hreflang is missing");
  if ($('meta[property="og:image"]').length !== 1) failures.push("Open Graph image is missing");
  if ($('script[type="application/ld+json"]').length < 1) failures.push("JSON-LD is missing");
  if ($("img:not([alt])").length > 0) failures.push("every image needs an alt attribute");
  if ($('a[href="/app/?demo=1"]').length < 1) failures.push("online demo CTA is missing");
  if ($('a[href*="github.com/weilaiqishi/image2-web"]').length < 1) failures.push("GitHub CTA is missing");

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    JSON.parse($(script).text());
  }

  if (failures.length) throw new Error(`${page.path}: ${failures.join("; ")}`);
}

for (const file of [
  "assets/site.css",
  "assets/site.js",
  "images/og-image2-studio.jpg",
  "images/studio-workspace.jpg",
  "robots.txt",
  "sitemap.xml",
  "_headers",
  "_redirects",
  "app/index.html",
]) {
  await access(resolve(outputDir, file));
}

console.log("Marketing SEO and asset checks passed for zh-CN and en.");
