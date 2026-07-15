import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const outputRoot = path.resolve("artifacts/plan2-real-regression");
const articleUrl = "https://zhuanlan.zhihu.com/p/2060433719106834734";

if (!apiKey) throw new Error("OPENAI_API_KEY is required");

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const mooncake = await fs.readFile(path.resolve("public/demo/mooncake-original.jpg"));
const portrait = await fs.readFile(path.resolve("public/prompt-thumbnails/linkedin-professional-headshot.webp"));
const editorialStyle = await fs.readFile(path.resolve("public/prompt-thumbnails/editorial-typographic-poster.webp"));
const mooncakeInfo = await sharp(mooncake).metadata();
const portraitInfo = await sharp(portrait).metadata();
const mooncakeSize = { width: mooncakeInfo.width || 1024, height: mooncakeInfo.height || 1024 };
const portraitSize = { width: portraitInfo.width || 768, height: portraitInfo.height || 1024 };

const cases = [
  {
    id: "MVP-EDIT-01",
    title: "两个 Region 修改背景与地面",
    sourceSection: "精准局部编辑 / Region",
    expected: ["两个标记区域分别发生对应变化", "月饼礼盒主体和构图保持", "标注线与编号不进入最终图"],
    prepare: async () => ({
      original: mooncake,
      annotated: await overlay(mooncake, mooncakeSize, `
        <rect x="40" y="40" width="${mooncakeSize.width - 80}" height="${Math.round(mooncakeSize.height * 0.38)}" fill="none" stroke="#ef3d31" stroke-width="12" stroke-dasharray="22 14"/>
        <text x="60" y="95" font-size="42" font-weight="700" fill="#ef3d31">Region01 背景</text>
        <rect x="40" y="${Math.round(mooncakeSize.height * 0.68)}" width="${mooncakeSize.width - 80}" height="${Math.round(mooncakeSize.height * 0.27)}" fill="none" stroke="#2455c3" stroke-width="12" stroke-dasharray="22 14"/>
        <text x="60" y="${Math.round(mooncakeSize.height * 0.75)}" font-size="42" font-weight="700" fill="#2455c3">Region02 地面</text>`),
      references: [],
      prompt: "第一张图是必须保持主体的原图，第二张图只包含编辑标注。将 Region01 背景调整为均匀的中古红色墙面，将 Region02 地面改为金色与深红菱形厚绒地毯。严格保持月饼、礼盒结构、灯具、桂花和整体构图。输出干净成图，不保留任何框线、编号或说明文字。",
    }),
  },
  {
    id: "MVP-EDIT-03",
    title: "Mark + Hex 品牌色",
    sourceSection: "精准局部编辑 / Hex",
    expected: ["Mark01 区域采用 #C59A3A", "礼盒与月饼不变", "输出不含 Mark 标记"],
    prepare: async () => ({
      original: mooncake,
      annotated: await overlay(mooncake, mooncakeSize, `
        <circle cx="${Math.round(mooncakeSize.width * 0.28)}" cy="${Math.round(mooncakeSize.height * 0.78)}" r="${Math.round(mooncakeSize.width * 0.17)}" fill="none" stroke="#ef3d31" stroke-width="14"/>
        <text x="${Math.round(mooncakeSize.width * 0.12)}" y="${Math.round(mooncakeSize.height * 0.58)}" font-size="46" font-weight="700" fill="#ef3d31">Mark01</text>`),
      references: [],
      prompt: "第一张图是原图，第二张图的红色圆圈仅用于定位 Mark01。将 Mark01 圈定的桌面局部颜色精准改为 #C59A3A，并保持原有漆面反光。月饼、礼盒、灯光、桂花和构图不得变化。输出不保留圆圈和 Mark01 文字。",
    }),
  },
  {
    id: "MVP-EDIT-04",
    title: "灰阶原图按色卡上色",
    sourceSection: "精准局部编辑 / 色卡",
    expected: ["灰阶图恢复为来自色卡的配色", "原始结构保持", "色卡版式不进入输出"],
    prepare: async () => {
      const grayscale = await sharp(mooncake).grayscale().png().toBuffer();
      const palette = await svgPng(640, 360, `
        <rect width="640" height="360" fill="#f4f4f1"/>
        <rect x="35" y="55" width="130" height="250" fill="#7A1420"/><rect x="180" y="55" width="130" height="250" fill="#C59A3A"/>
        <rect x="325" y="55" width="130" height="250" fill="#244A3A"/><rect x="470" y="55" width="130" height="250" fill="#F0D9A0"/>
        <text x="35" y="38" font-size="24" fill="#222">PALETTE ONLY</text>`);
      return {
        original: grayscale,
        annotated: await overlay(grayscale, mooncakeSize, `<text x="45" y="80" font-size="42" font-weight="700" fill="#ef3d31">保持线条与产品结构</text>`),
        references: [{ name: "palette.png", bytes: palette }],
        prompt: "第一张图是必须保持结构的灰阶产品基线，第二张图只说明保持结构，第三张图仅作为色卡。使用第三张图的酒红、金色、墨绿和暖米色为第一张图自然上色，保留月饼纹理、礼盒比例和清晰边缘。不要复制色卡方块、文字或版式。",
      };
    },
  },
  {
    id: "MVP-REF-04",
    title: "简笔画控制旅行影像构图",
    sourceSection: "多图融合 / 构图草图",
    expected: ["道路、山体、太阳与人物位置遵循草图", "草图转为完整旅行影像", "无意草图线条不残留"],
    prepare: async () => {
      const sketch = await svgPng(1024, 1024, `
        <rect width="1024" height="1024" fill="#f7f5ef"/>
        <path d="M0 560 L230 300 L430 570 L650 250 L1024 600" fill="none" stroke="#282828" stroke-width="18"/>
        <circle cx="780" cy="190" r="75" fill="none" stroke="#282828" stroke-width="18"/>
        <path d="M390 1024 C420 800 500 700 550 560" fill="none" stroke="#282828" stroke-width="42"/>
        <circle cx="480" cy="650" r="24" fill="#282828"/><path d="M480 675 L480 790 M480 710 L430 755 M480 710 L530 750 M480 790 L445 880 M480 790 L520 875" stroke="#282828" stroke-width="18"/>
        <text x="36" y="965" font-size="28" fill="#555">composition sketch</text>`);
      return {
        original: sketch,
        annotated: sketch,
        references: [],
        prompt: "严格按照输入简笔画的主体位置、山体轮廓、弯曲道路、人物站位和右上太阳构图，生成一张魔幻现实主义旅行摄影，略带复古胶片质感，真实光影和景深。不要保留草图文字或黑色手绘线。",
      };
    },
  },
  {
    id: "MVP-REF-06",
    title: "人物身份保持与动作迁移",
    sourceSection: "多图融合 / 动作线稿",
    expected: ["人物身份接近第一张图", "姿势明显遵循动作线稿", "线稿风格不进入成图"],
    prepare: async () => {
      const pose = await svgPng(720, 960, `
        <rect width="720" height="960" fill="#fff"/><circle cx="360" cy="150" r="68" fill="none" stroke="#202020" stroke-width="16"/>
        <path d="M360 220 L340 520 M345 320 L160 190 M345 330 L565 250 M340 520 L210 830 M340 520 L515 820" fill="none" stroke="#202020" stroke-width="22" stroke-linecap="round"/>
        <text x="24" y="920" font-size="26" fill="#444">POSE ONLY</text>`);
      return {
        original: portrait,
        annotated: await overlay(portrait, portraitSize, `<text x="24" y="56" font-size="30" font-weight="700" fill="#ef3d31">保持人物身份</text>`),
        references: [{ name: "pose.png", bytes: pose }],
        prompt: "第一张图提供人物身份、面部、发型和服装，第二张图只标记必须保持身份，第三张图只提供动作姿势。生成同一人物的全身棚拍，姿势严格参考第三张图的抬臂和双腿方向；保持第一张图人物身份与服装，不要把线稿风格或 POSE ONLY 文字带入输出。",
      };
    },
  },
  {
    id: "MVP-DESIGN-04",
    title: "产品结构优先于风格参考",
    sourceSection: "商品设计 / 参考冲突优先级",
    expected: ["月饼礼盒结构来自第一张图", "排版与视觉气质参考第三张图", "风格图不替换产品"],
    prepare: async () => ({
      original: mooncake,
      annotated: await overlay(mooncake, mooncakeSize, `<rect x="${Math.round(mooncakeSize.width * 0.33)}" y="${Math.round(mooncakeSize.height * 0.08)}" width="${Math.round(mooncakeSize.width * 0.62)}" height="${Math.round(mooncakeSize.height * 0.65)}" fill="none" stroke="#ef3d31" stroke-width="12"/><text x="${Math.round(mooncakeSize.width * 0.38)}" y="${Math.round(mooncakeSize.height * 0.15)}" font-size="38" font-weight="700" fill="#ef3d31">产品结构最高优先级</text>`),
      references: [{ name: "style.webp", bytes: editorialStyle }],
      prompt: "第一张图是唯一产品结构参考，第二张图强调产品结构最高优先级，第三张图只参考摄影气质、留白和排版层级。生成高端商品详情海报；任何冲突均以第一张图的四枚月饼、礼盒骨架、比例和材质为准，不得把第三张图的主体替换成产品。输出不保留红框和说明文字。",
    }),
  },
  {
    id: "MVP-PORTRAIT-04",
    title: "上传人像转真实棚拍头像",
    sourceSection: "人像 / 身份保持",
    expected: ["脸型五官和年龄感保持", "背景变为白到浅灰棚拍", "不过度磨皮或通用化"],
    prepare: async () => ({
      original: portrait,
      annotated: await overlay(portrait, portraitSize, `<rect x="12" y="12" width="${portraitSize.width - 24}" height="${portraitSize.height - 24}" fill="none" stroke="#2455c3" stroke-width="10" stroke-dasharray="18 12"/><text x="28" y="62" font-size="28" font-weight="700" fill="#2455c3">身份锁定，仅重做棚拍环境</text>`),
      references: [],
      prompt: "把第一张人物参考重制为真实专业棚拍头像，白到浅灰背景，85 至 100mm 人像镜头，正面柔光。严格保持脸型、五官、骨相、年龄感、发型和真实皮肤纹理；禁止换脸、年龄漂移、过度磨皮和通用网红脸。第二张图的蓝框和文字只用于说明，不得出现在输出。",
    }),
  },
  {
    id: "MVP-LOCALIZE-01",
    title: "中文护肤海报本地化为英文",
    sourceSection: "本地化 / 母版保持",
    expected: ["母版布局、配色和信息层级保持", "只出现指定英文", "价格、按钮和三项信息可读"],
    prepare: async () => {
      const poster = await svgPng(1024, 1024, `
        <rect width="1024" height="1024" fill="#dbeeff"/><rect x="55" y="55" width="914" height="914" rx="26" fill="#eef7ff" stroke="#2874b8" stroke-width="5"/>
        <text x="95" y="145" font-size="58" font-weight="700" fill="#144f82">焕亮修护精华</text><text x="95" y="205" font-size="28" fill="#2874b8">敏感肌每日护理方案</text>
        <rect x="95" y="285" width="390" height="360" rx="20" fill="#fff"/><rect x="185" y="335" width="150" height="250" rx="34" fill="#8cc8ed"/><text x="210" y="470" font-size="30" fill="#fff">精华</text>
        <circle cx="740" cy="430" r="150" fill="#f4c9b8"/><path d="M615 650 Q740 535 865 650 L900 900 L580 900 Z" fill="#79b8df"/>
        <text x="95" y="735" font-size="34" font-weight="700" fill="#144f82">深层补水 · 舒缓泛红 · 强韧屏障</text><text x="95" y="805" font-size="54" font-weight="700" fill="#144f82">¥199</text>
        <rect x="95" y="840" width="300" height="78" rx="39" fill="#144f82"/><text x="175" y="891" font-size="30" fill="#fff">立即购买</text>`);
      return {
        original: poster,
        annotated: await overlay(poster, { width: 1024, height: 1024 }, `<rect x="70" y="80" width="880" height="850" fill="none" stroke="#ef3d31" stroke-width="10" stroke-dasharray="18 12"/><text x="650" y="250" font-size="34" font-weight="700" fill="#ef3d31">替换人物与文字</text>`),
        references: [],
        prompt: "将这张中文护肤海报本地化为英文。严格保持 1:1 画幅、蓝色配色、产品与人物位置、信息框、字号比例、间距、按钮和装饰。文字只替换为：LUMINOUS REPAIR SERUM；DAILY CARE FOR SENSITIVE SKIN；DEEP HYDRATION · CALM REDNESS · BARRIER SUPPORT；$29；SHOP NOW。不得保留任何中文，不新增元素。第二张图红框和说明不进入输出。",
      };
    },
  },
];

const runStartedAt = new Date().toISOString();
const results = [];
for (const [index, testCase] of cases.entries()) {
  console.log(`[${index + 1}/${cases.length}] ${testCase.id} ${testCase.title}`);
  const directory = path.join(outputRoot, testCase.id);
  await fs.mkdir(directory, { recursive: true });
  const input = await testCase.prepare();
  const inputs = [
    { name: "original.png", bytes: await sharp(input.original).png().toBuffer() },
    { name: "annotated.png", bytes: await sharp(input.annotated).png().toBuffer() },
    ...input.references,
  ];
  await Promise.all(inputs.map((asset) => fs.writeFile(path.join(directory, asset.name), asset.bytes)));
  const started = Date.now();
  const response = await requestEdit(inputs, input.prompt);
  const durationMs = Date.now() - started;
  const outputPath = path.join(directory, "output.png");
  await fs.writeFile(outputPath, response.bytes);
  const outputMetadata = await sharp(response.bytes).metadata();
  if (!outputMetadata.width || !outputMetadata.height) throw new Error(`${testCase.id} returned an invalid image`);
  const difference = await pixelDifference(inputs[0].bytes, response.bytes);
  if (difference < 0.5) throw new Error(`${testCase.id} output is unexpectedly similar to its input (${difference.toFixed(2)})`);
  const result = {
    caseId: testCase.id,
    caseRevision: 1,
    runId: `plan2-${runStartedAt}`,
    fixtureId: "local-programmatic-v1",
    sourceEvidence: [{ sourceUrl: articleUrl, section: testCase.sourceSection, excerptOrImageRef: testCase.title }],
    environment: { appVersion: "0.1.0", os: process.platform, workspaceVersion: 2 },
    provider: baseUrl,
    model,
    protocol: "edits",
    inputAssetHashes: inputs.map((asset) => sha256(asset.bytes)),
    operationTrace: [{ step: 1, action: "send one low-quality edit request", expected: testCase.expected.join("; "), actual: `valid ${outputMetadata.width}x${outputMetadata.height} image; mean pixel difference ${difference.toFixed(2)}`, status: "pass" }],
    capabilityRoute: { edits: true, multiReference: inputs.length > 2, masks: false, structuredRegions: false, layers: false, fallbackUsed: response.route === "single-overlay" ? "overlay" : undefined },
    compiledPrompt: input.prompt,
    compiledPromptHash: sha256(input.prompt),
    params: { prompt: input.prompt, aspectRatio: "1:1", resolution: "1K", size: "1024x1024", quality: "low", outputFormat: "png" },
    startedAt: new Date(started).toISOString(),
    durationMs,
    providerResponseId: response.responseId,
    outputAssetIds: [path.relative(outputRoot, outputPath)],
    assertions: testCase.expected.map((name) => ({ name, status: "not-applicable", note: "等待人工目视核对" })),
    scores: {},
    automated: { meanPixelDifference: Number(difference.toFixed(2)), width: outputMetadata.width, height: outputMetadata.height, route: response.route },
  };
  await fs.writeFile(path.join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  results.push(result);
}

await fs.writeFile(path.join(outputRoot, "report.json"), `${JSON.stringify({ schemaVersion: 1, runStartedAt, completedAt: new Date().toISOString(), baseUrl, model, caseCount: results.length, results }, null, 2)}\n`);
console.log(`Plan 2 real regression completed: ${results.length}/${cases.length} valid outputs`);
console.log(`Artifacts: ${outputRoot}`);

async function overlay(base, size, markup) {
  const svg = Buffer.from(`<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:Arial,"Noto Sans CJK SC",sans-serif}</style>${markup}</svg>`);
  return sharp(base).resize(size.width, size.height, { fit: "fill" }).composite([{ input: svg }]).png().toBuffer();
}

async function svgPng(width, height, markup) {
  return sharp(Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>text{font-family:Arial,"Noto Sans CJK SC",sans-serif}</style>${markup}</svg>`)).png().toBuffer();
}

async function requestEdit(images, prompt) {
  const form = editForm(images, prompt);
  let response = await fetch(`${baseUrl}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  let route = "multi-image";
  if (response.status === 400) {
    const firstError = await response.text();
    const fallbackImages = [images[1]];
    response = await fetch(`${baseUrl}/images/edits`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: editForm(fallbackImages, prompt) });
    route = "single-overlay";
    if (!response.ok) throw new Error(`Edit request failed. Multi-image: ${safeError(firstError)}; fallback: ${safeError(await response.text())}`);
  }
  if (!response.ok) throw new Error(`Edit request failed (${response.status}): ${safeError(await response.text())}`);
  const responseId = response.headers.get("x-request-id") || undefined;
  const payload = await response.json();
  const item = payload?.data?.[0];
  if (item?.b64_json) return { bytes: Buffer.from(item.b64_json, "base64"), responseId: payload.id || responseId, route };
  if (item?.url) {
    const download = await fetch(item.url);
    if (!download.ok) throw new Error(`Image download failed (${download.status})`);
    return { bytes: Buffer.from(await download.arrayBuffer()), responseId: payload.id || responseId, route };
  }
  throw new Error("Edit response did not include image data");
}

function editForm(images, prompt) {
  const form = new FormData();
  form.set("model", model);
  form.set("prompt", prompt);
  form.set("size", "1024x1024");
  form.set("quality", "low");
  form.set("output_format", "png");
  images.forEach((image) => form.append("image[]", new Blob([image.bytes], { type: image.name.endsWith(".webp") ? "image/webp" : "image/png" }), image.name));
  return form;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(value) {
  return value.replaceAll(apiKey, "[redacted]").slice(0, 800);
}

async function pixelDifference(left, right) {
  const leftPixels = await sharp(left).resize(128, 128).removeAlpha().raw().toBuffer();
  const rightPixels = await sharp(right).resize(128, 128).removeAlpha().raw().toBuffer();
  let total = 0;
  for (let index = 0; index < leftPixels.length; index += 1) total += Math.abs(leftPixels[index] - rightPixels[index]);
  return total / leftPixels.length;
}
