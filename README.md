# Image2 Studio

Image2 Studio 是一款本地优先的 Windows / macOS 图片生成与可视化修订客户端。它通过 OpenAI 兼容的图片接口完成生成和编辑，并使用固定画布承载圈选、箭头和文字标注，让修改意图与原图位置直接对应。

## 项目状态

当前版本为 `0.1.0`，桌面端 MVP 的核心工作流已经打通：

- [x] 文生图，支持 5 种画面比例、1K / 2K / 4K、3 档质量和 PNG / JPEG / WebP
- [x] 参考图生成，最多添加 4 张图片，支持文件选择和从剪贴板粘贴
- [x] OpenAI 兼容服务配置，可自定义 Base URL 和图片模型
- [x] API Key 写入 macOS Keychain 或 Windows Credential Manager
- [x] 本地灵感库，支持搜索、分类筛选、查看详情、复制提示词和生成同款
- [x] 固定画布标注，可拖动绘制椭圆和箭头，并添加、编辑文字
- [x] 标注对象的选择、移动、缩放、颜色切换、删除、撤销与重做
- [x] 标注文档自动保存，再次打开同一图片时恢复
- [x] 将原图、标注图和修改说明提交给图片编辑接口生成修订版
- [x] 本地版本历史，保留生成图与修订图的父子关系
- [x] 图片预览、导出和删除
- [x] 浏览器演示模式，无需 API Key 即可查看内置月饼案例
- [x] 前端单元测试、Rust 单元测试和真实 API 验证脚本
- [x] Tauri 桌面构建配置及 macOS / Windows 应用图标

尚未包含发行签名、公证和自动更新；当前版本需在目标平台本地构建。

## 使用流程

1. 在设置中填写 OpenAI Base URL、图片模型和 API Key。
2. 在“生成”页输入画面描述，可选添加参考图，再设置比例、分辨率、质量和格式。
3. 生成完成后，从右侧历史列表选择版本，或直接进入“标注修改”。
4. 在画布上拖绘圈选或箭头、添加文字，并填写整体修改说明。
5. 提交修改后，新结果会作为修订版保存，原图和标注文档保持不变。
6. 在预览区或历史列表中导出最终图片。

“灵感”页提供随应用打包的公开提示词快照。选择模板后点击“生成同款”，应用会复制提示词，并把来源站不受支持的比例映射到最接近的生成规格。

## 技术栈

- Tauri 2 与 Rust 后端
- React 19、TypeScript、Vite
- Fabric.js 7 标注编辑器
- `reqwest` 图片接口客户端
- 系统凭证库 `keyring`
- Vitest 与 Testing Library

渲染进程无法读取已保存的 API Key，也不能通过 Tauri 权限发起任意网络请求。图片请求统一由 Rust 后端发送，因此自定义 OpenAI 兼容地址不受浏览器 CORS 限制。远程 Base URL 必须使用 HTTPS，仅 `localhost`、`127.0.0.1` 和 `::1` 允许 HTTP。

## 本地数据

桌面端会把生成图片、历史索引、连接设置和标注文档保存在 Tauri 应用数据目录中；API Key 单独保存在操作系统凭证库中。删除历史版本时，对应图片文件也会从本地删除。

浏览器模式只用于 UI 开发和演示，不能调用图片生成或编辑接口。演示模式中的标注文档保存在浏览器 `localStorage`。

## 开发

环境要求：Node.js 20+、Rust stable，以及当前操作系统所需的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run tauri:dev
```

只启动 Web UI：

```bash
npm run dev
```

浏览器访问 `http://127.0.0.1:1420/?demo=1`，可在不调用 API 的情况下查看内置的月饼生成与修订案例。

## 提示词目录

内置灵感目录是 [image-2.net](https://image-2.net/gpt-image-2-prompts/) 公开提示词模板的本地快照。每项包含来源链接、提示词、分类、画面比例、推荐分辨率和本地缩略图，应用运行时不会抓取来源网站。

刷新本地目录，默认每个来源分类导入 3 项：

```bash
npm run prompts:import
```

导入完整公开目录：

```bash
npm run prompts:import -- --all
```

导入脚本会限制并发并优化缩略图。更新后的目录数据位于 `src/data/prompt-catalog.json`，图片位于 `public/prompt-thumbnails/`。

## 验证

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

真实 API MVP 测试会产生费用，只有显式传入测试密钥时才应运行：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1 \
OPENAI_API_KEY=... \
OPENAI_IMAGE_MODEL=gpt-image-2 \
npm run test:mvp
```

该脚本先生成月饼产品图，再附加红色箭头和圈选标注，请求在底部加入商店地址，最后验证修订结果是有效且发生变化的图片。产物写入已忽略的 `artifacts/mvp-test/` 目录。

## 构建桌面应用

```bash
npm run tauri:build
```

Tauri 会为当前操作系统生成原生安装包。macOS 与 Windows 需要分别在对应平台构建；当前 MVP 未配置发行签名和公证。
