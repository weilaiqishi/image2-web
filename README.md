# Image2 Studio

Image2 Studio 是一款本地优先的 Windows / macOS 图片任务 Agent。用户通过多轮对话提交目标和参考图，Agent 将目标拆成独立生图任务，再由桌面端严格串行执行。

典型流程：上传一张化妆参考图并输入“保持妆容一致，生成三视图”，Agent 会根据对象和用途决定三个有价值的视角，创建三个不同提示词的任务，并逐张生成结果。

使用说明：[Image2 Studio 操作手册](USER_GUIDE.md)（含界面截图、精准标注和真实编辑案例）。

产品宣传站提供独立的中文与英文静态页面、SEO 元数据、真实界面示例和在线模拟演示。它与 Tauri 桌面产物分开构建：

```bash
npm run build:site
npm run preview:site
```

Cloudflare Pages 部署说明见 [CLOUDFLARE_DEPLOY.md](CLOUDFLARE_DEPLOY.md)，同类生图站调研与设计取舍见 [docs/MARKETING_RESEARCH.md](docs/MARKETING_RESEARCH.md)。公开演示不会接受真实 API Key，也不会发送真实图片请求。

## 已完成功能

- [x] Codex 式多会话工作区、聊天时间线和任务轨道
- [x] Responses API 与 Chat Completions 双协议 Agent Provider
- [x] `create_image_tasks` 结构化工具调用，单批最多 8 项
- [x] 全局 FIFO 图片队列，最大生成并发固定为 1
- [x] 任务停止、中断恢复、失败继续和单项重试
- [x] IndexedDB 本地保存会话、消息、草稿、批次和任务
- [x] 参考图、历史素材和标注修改附件
- [x] 1K / 2K / 4K、5 种比例、3 档质量和 PNG / JPEG / WebP 参数标签
- [x] 同一 WebView 内的 Fabric.js 标注 Dialog
- [x] 本地图片历史、导出和删除
- [x] 自定义 OpenAI 兼容 Base URL、Agent 模型和图片模型
- [x] API Key 写入 macOS Keychain 或 Windows Credential Manager
- [x] macOS Apple Silicon、macOS Intel 和 Windows 10 x64 GitHub Actions 打包

MVP 不包含自动审图、自治循环、并行生图、多套网关凭证、云同步、节点画布、发行签名和自动更新。

## 架构边界

Agent Runtime 全部运行在 Tauri WebView 的 TypeScript 中，包括：

- 多轮上下文和工具定义
- Responses / Chat Completions 请求适配
- 任务校验、串行调度和状态机
- 会话与任务持久化

Rust 后端不参与任务拆解或 Agent 决策，只负责系统能力：

- 从凭证库读取 API Key
- 转发白名单内的 `/responses`、`/chat/completions`、`/images/generations` 和 `/images/edits`
- 构建 multipart 图片请求并标准化服务错误
- 保存、读取和导出本地图片与标注文档

渲染进程无法读取 API Key，也不能指定任意代理路径、HTTP 方法或认证头。远程 Base URL 必须使用 HTTPS，只有 `localhost`、`127.0.0.1` 和 `::1` 允许 HTTP。

## 代理网关要求

Agent 与图片模型共用同一个 Base URL 和 API Key。网关至少需要实现所选 Agent 协议以及 OpenAI 兼容 Images API：

- Responses 模式：`POST /responses`
- Chat Completions 模式：`POST /chat/completions`
- 文生图：`POST /images/generations`
- 参考图生成和编辑：`POST /images/edits`

默认 Agent 模型为 `gpt-5.6`，图片模型为 `gpt-image-2`，均可在设置中修改。多轮上下文由应用本地维护，不要求网关保存 `previous_response_id`。

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

浏览器模式会使用本地模拟 Agent 展示三视图任务拆解，但不会发送真实图片请求。桌面端才会通过 Rust 安全网关调用 API。

## 验证

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

测试覆盖双协议工具解析、任务上限、非法附件引用、严格串行执行、失败后继续、尺寸约束、UI 工作流和 Rust 代理端点白名单。

真实 API MVP 测试会产生费用，只有显式传入测试密钥时才应运行：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1 \
OPENAI_API_KEY=... \
OPENAI_IMAGE_MODEL=gpt-image-2 \
npm run test:mvp
```

## 本地数据

- IndexedDB：会话、消息、Composer 草稿、任务批次和队列状态
- Tauri 应用数据目录：生成图片、历史索引、连接设置和 Fabric 标注文档
- 系统凭证库：API Key

应用重启时，尚未完成的排队或运行任务会标记为“已中断”，必须由用户手动恢复，避免意外产生新的付费请求。

## 桌面构建

```bash
npm run tauri:build
```

GitHub 工作流 `.github/workflows/desktop-build.yml` 会在推送到 `main`、推送 `v*` 标签或手动触发时生成：

- `image2-studio-macos-arm64`
- `image2-studio-macos-x64`
- `image2-studio-windows10-x64`

Actions Artifacts 默认保留 14 天。当前安装包未签名，正式分发前仍需配置 macOS 和 Windows 代码签名。

## 本地灵感库

灵感库聚合 image-2.net、Awesome GPT-4o Images、Awesome Prompts 和 OpenAI Cookbook。桌面端不会直接抓取第三方网站，只从仓库固定白名单地址下载带校验值的 Manifest、分片和 WebP 缩略图。

收藏、置顶、隐藏、备注、本地改写和使用记录保存在独立 IndexedDB Store，不会上传，也不会被远程目录更新覆盖。来源下架的模板采用归档标记；已经收藏、改写或使用过的内容仍可访问。

```bash
npm run prompts:import
npm run prompts:aggregate -- --limit=12
```

聚合器为四个来源提供独立 Adapter 和固定 Fixture，输出到 `public/prompt-catalog/` 及 `src/data/prompt-catalog-v2.json`。`.github/workflows/prompt-catalog.yml` 每周检查并发布新快照。应用内支持全部或单来源检查、自动更新频率、更新策略、缩略图策略，以及本地资料 JSON/ZIP 导入导出。
