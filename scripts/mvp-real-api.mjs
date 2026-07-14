import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const outputDir = path.resolve("artifacts/mvp-test");
const address = "上海市静安区南京西路 888 号";

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required");
}

await fs.mkdir(outputDir, { recursive: true });

const originalPrompt = [
  "方形商业产品摄影，一盒高端中国中秋月饼放在深红色漆面桌上，",
  "礼盒打开，四枚精致广式月饼整齐陈列，旁边有一盏柔和暖灯和少量桂花枝，",
  "真实食物质感，克制的东方高级感，柔和侧光，清晰产品细节，",
  "画面底部保留干净的深红留白区域，不要出现任何文字、商标或水印。",
].join("");

console.log("[1/4] Generating mooncake product image...");
const original = await requestGeneration({
  model,
  prompt: originalPrompt,
  size: "1024x1024",
  quality: "low",
  output_format: "png",
  n: 1,
});
const originalPath = path.join(outputDir, "01-mooncake-original.png");
await fs.writeFile(originalPath, original);
await assertImage(originalPath, "original");

console.log("[2/4] Creating Cowart-style arrow annotation...");
const metadata = await sharp(original).metadata();
const width = metadata.width || 1024;
const height = metadata.height || 1024;
const overlay = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-opacity="0.28"/></filter>
      <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
        <path d="M0,0 L12,6 L0,12 z" fill="#e2392b"/>
      </marker>
    </defs>
    <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.73)}" width="${Math.round(width * 0.68)}" height="${Math.round(height * 0.11)}" rx="12" fill="white" fill-opacity="0.94" stroke="#e2392b" stroke-width="5" filter="url(#shadow)"/>
    <text x="${Math.round(width * 0.115)}" y="${Math.round(height * 0.795)}" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="${Math.round(width * 0.035)}" font-weight="700" fill="#c72f24">底部增加商店地址</text>
    <path d="M ${Math.round(width * 0.7)} ${Math.round(height * 0.79)} C ${Math.round(width * 0.83)} ${Math.round(height * 0.81)}, ${Math.round(width * 0.76)} ${Math.round(height * 0.91)}, ${Math.round(width * 0.6)} ${Math.round(height * 0.91)}" fill="none" stroke="#e2392b" stroke-width="8" stroke-linecap="round" marker-end="url(#arrow)"/>
    <ellipse cx="${Math.round(width * 0.48)}" cy="${Math.round(height * 0.91)}" rx="${Math.round(width * 0.28)}" ry="${Math.round(height * 0.055)}" fill="none" stroke="#e2392b" stroke-width="7" stroke-dasharray="16 10"/>
  </svg>
`);
const annotated = await sharp(original).composite([{ input: overlay }]).png().toBuffer();
const annotatedPath = path.join(outputDir, "02-mooncake-annotated.png");
await fs.writeFile(annotatedPath, annotated);
await assertImage(annotatedPath, "annotated");

const editPrompt = [
  "第一张图片是干净原图，第二张图片中的红色箭头、虚线圈和中文说明只用于指出修改位置。",
  `请在原图底部留白区域加入一行清晰、准确、易读的白色中文商店地址：“${address}”。`,
  "保持月饼、礼盒、灯光、构图和原有风格不变。",
  "输出干净的商业成图，不要保留红色箭头、圈线、标注框或“底部增加商店地址”这句说明。",
].join("");

console.log("[3/4] Sending annotated revision request...");
const edited = await requestEdit(original, annotated, editPrompt);
const editedPath = path.join(outputDir, "03-mooncake-address-edited.png");
await fs.writeFile(editedPath, edited);
await assertImage(editedPath, "edited");

console.log("[4/4] Verifying output difference...");
const difference = await pixelDifference(original, edited);
if (difference < 1) {
  throw new Error(`Edited output is unexpectedly similar to the original (${difference.toFixed(2)})`);
}

const report = {
  baseUrl,
  model,
  address,
  generatedAt: new Date().toISOString(),
  files: {
    original: path.basename(originalPath),
    annotated: path.basename(annotatedPath),
    edited: path.basename(editedPath),
  },
  dimensions: { width, height },
  meanPixelDifference: Number(difference.toFixed(2)),
};
await fs.writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
console.log(`MVP real-API test passed. Mean pixel difference: ${difference.toFixed(2)}`);
console.log(`Artifacts: ${outputDir}`);

async function requestGeneration(body) {
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readImageResponse(response, "generation");
}

async function requestEdit(originalBytes, annotatedBytes, prompt) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", "1024x1024");
  form.set("quality", "low");
  form.set("output_format", "png");
  form.append("image[]", new Blob([originalBytes], { type: "image/png" }), "original.png");
  form.append("image[]", new Blob([annotatedBytes], { type: "image/png" }), "annotated.png");
  let response = await fetch(`${baseUrl}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (response.status === 400) {
    const firstError = await response.text();
    const fallback = new FormData();
    fallback.set("model", model);
    fallback.set("prompt", prompt);
    fallback.set("size", "1024x1024");
    fallback.set("quality", "low");
    fallback.set("output_format", "png");
    fallback.append("image", new Blob([annotatedBytes], { type: "image/png" }), "annotated.png");
    response = await fetch(`${baseUrl}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fallback,
    });
    if (!response.ok) {
      const fallbackError = await response.text();
      throw new Error(`Edit request failed. Multi-image: ${safeError(firstError)}; fallback: ${safeError(fallbackError)}`);
    }
  }

  return readImageResponse(response, "edit");
}

async function readImageResponse(response, label) {
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status}): ${safeError(await response.text())}`);
  }
  const payload = await response.json();
  const item = payload?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const download = await fetch(item.url);
    if (!download.ok) throw new Error(`${label} image download failed (${download.status})`);
    return Buffer.from(await download.arrayBuffer());
  }
  throw new Error(`${label} response did not include image data`);
}

function safeError(value) {
  return value.replaceAll(apiKey, "[redacted]").slice(0, 600);
}

async function assertImage(file, label) {
  const info = await sharp(file).metadata();
  if (!info.width || !info.height || !info.format) throw new Error(`${label} is not a valid image`);
}

async function pixelDifference(left, right) {
  const leftPixels = await sharp(left).resize(128, 128).removeAlpha().raw().toBuffer();
  const rightPixels = await sharp(right).resize(128, 128).removeAlpha().raw().toBuffer();
  let total = 0;
  for (let index = 0; index < leftPixels.length; index += 1) {
    total += Math.abs(leftPixels[index] - rightPixels[index]);
  }
  return total / leftPixels.length;
}
