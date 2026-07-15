# Image2 灵感模块实施规划

## 目标

- 将现有单一 `image-2.net` 静态目录升级为多来源灵感库。
- 支持手动更新和可配置的自动更新策略。
- 提示词、缩略图、收藏、备注、改写和使用记录保存在客户本机。
- 远程更新不能覆盖客户的本地修改，也不能删除已经收藏或使用过的模板。
- 所有模板保留来源、授权和署名信息。

## 默认边界

- Tauri WebView 不直接爬取第三方网站，避免 CORS、限流、页面结构变化和任意网络访问风险。
- 爬虫运行在 Node.js 导入脚本或定时 GitHub Action 中。
- 桌面客户端只从固定白名单地址下载规范化后的目录 Manifest 和缩略图。
- TypeScript 负责目录合并、更新状态、筛选和客户本地数据逻辑。
- Rust 只负责固定地址下载、校验和本地缩略图文件持久化，不参与内容解析和推荐决策。
- 商业图库在未确认服务条款或获得 API 授权前不直接采集。

## 数据源

| 优先级 | 数据源 | 采集方式 | 授权与处理 |
| --- | --- | --- | --- |
| P0 | [image-2.net](https://image-2.net/gpt-image-2-prompts/) | 现有 HTML Adapter | 继续保留，记录模板原始链接与出处 |
| P0 | [awesome-gpt4o-images](https://github.com/jamez-bondos/awesome-gpt4o-images) | GitHub Cases、Markdown、Attribution 文件 | CC BY 4.0，界面和导出数据必须保留署名 |
| P0 | [awesome-prompts](https://github.com/songtianlun/awesome-prompts) | Markdown 目录 | MIT，与其他镜像内容去重 |
| P0 | [OpenAI Cookbook](https://github.com/openai/openai-cookbook) | Notebook 结构化提取 | MIT，作为低数量、高可信官方样例 |
| P1 | [gpt4o-image-examples](https://github.com/StevenSong-sTs/gpt4o-image-examples) | Markdown 和图片目录 | MIT，作为社区补充源 |
| 暂缓 | [gpt4o-image-prompts](https://github.com/songguoxs/gpt4o-image-prompts) | `data/prompts.json` | 数据量大但授权不明确，只做链接索引或取得授权后导入正文与图片 |

PromptHero、OpenArt、Krea 等商业图库不进入首批采集范围。后续只有在官方 API、服务条款或书面授权允许时才增加 Adapter。

## 更新架构

```text
第三方来源
    |
    v
Source Adapter
    |
    v
GitHub Action / 本地 Node.js 聚合器
    |  解析、规范化、校验、去重、生成版本
    v
catalog-manifest.json + 数据分片 + 缩略图
    |  固定白名单地址
    v
Tauri 更新服务
    |
    +--> IndexedDB：模板元数据、来源状态、客户本地状态
    +--> Rust 应用数据目录：缩略图文件
```

目录发布物使用版本号和校验值：

```ts
interface PromptCatalogManifest {
  schemaVersion: 1;
  catalogVersion: string;
  generatedAt: string;
  checksum: string;
  sources: PromptSourceSnapshot[];
  shards: Array<{
    id: string;
    url: string;
    checksum: string;
    itemCount: number;
  }>;
}
```

## Source Adapter

将现有 `scripts/import-prompts.mjs` 拆成统一 Adapter：

```ts
interface PromptSourceAdapter {
  id: string;
  fetchIndex(cursor?: string): Promise<RawPrompt[]>;
  normalize(input: RawPrompt): PromptTemplateRecord;
  attribution(): SourceAttribution;
}
```

建议目录：

```text
scripts/prompt-sources/
  image2Net.ts
  awesomeGpt4oImages.ts
  awesomePrompts.ts
  openaiCookbook.ts
  gpt4oExamples.ts
```

每个 Adapter 必须提供固定测试样本，页面结构变化时测试应明确指出失败来源，不能输出空目录覆盖上一版本。

## 标准模板模型

```ts
interface PromptTemplateRecord {
  id: string; // sourceId:sourceKey
  sourceId: string;
  sourceKey: string;
  sourceUrl: string;
  sourceRevision?: string;
  license?: string;
  attribution?: string;
  title: string;
  description: string;
  prompt: string;
  language: string;
  category: string;
  tags: string[];
  modelFamilies: string[];
  aspectRatio?: string;
  resolution?: string;
  bestFor?: string;
  previewUrl?: string;
  cachedThumbnailPath?: string;
  promptHash: string;
  publishedAt?: string;
  upstreamUpdatedAt?: string;
  importedAt: string;
  archivedAt?: string;
}
```

## 客户本地数据

升级 IndexedDB，灵感数据不混入当前单一 Workspace 状态：

- `promptTemplates`：已下载的标准模板元数据。
- `promptSources`：来源开关、版本、更新时间和错误状态。
- `promptLocalState`：收藏、置顶、隐藏、备注和客户改写。
- `promptUsage`：使用次数、最后使用时间和关联会话。
- `promptSyncRuns`：每次更新的新增、修改、归档和失败记录。

缩略图由 Rust 保存到应用数据目录，IndexedDB 只保存路径或文件句柄，不保存大量 Base64。

客户本地覆盖层：

```ts
interface PromptLocalState {
  templateId: string;
  favorite: boolean;
  pinned: boolean;
  hidden: boolean;
  customTitle?: string;
  customPrompt?: string;
  customTags: string[];
  note?: string;
  useCount: number;
  lastUsedAt?: string;
  lastConversationId?: string;
  createdAt: string;
  updatedAt: string;
}
```

远程模板和本地覆盖层分开存储。更新时只能修改 `PromptTemplateRecord`，不能修改 `PromptLocalState`。

## 更新选项

灵感库增加“更新”菜单：

- 立即检查全部来源。
- 单独更新指定来源。
- 自动更新：关闭、每次启动、每天、每周。
- 更新策略：仅新增、新增并更新。
- 缩略图策略：立即下载、浏览时懒加载。
- 每个来源启用或停用。
- 查看新增、修改、归档和失败详情。
- 取消正在执行的更新。
- 导入或导出本地灵感库 JSON/ZIP。

更新过程中显示每个来源的状态。单个来源失败不能阻塞其他来源，也不能删除当前可用目录。

## 增量更新算法

1. 根据 ETag、Git Commit SHA 或来源更新时间判断是否需要下载。
2. 下载并校验 Manifest、数据分片和校验值。
3. 以 `sourceId:sourceKey` 匹配已有模板。
4. 新模板写入 `promptTemplates`。
5. `promptHash` 或来源 Revision 变化时更新远程模板字段。
6. 来源中消失的模板标记为 `archivedAt`，不物理删除。
7. 已收藏、改写、使用过的归档模板继续显示在客户本地库。
8. 在一个 IndexedDB Transaction 内提交更新，失败时保持旧版本。

## 去重与质量规则

- 规范化 Prompt 后计算 Hash，完全相同内容合并展示但保留全部来源引用。
- 相似 Prompt 只建立聚类，不自动删除或覆盖。
- 分类统一映射到项目现有分类体系。
- 比例和分辨率使用现有规范化函数映射到支持值。
- 无 Prompt、无原始链接、解析异常或缩略图无效的数据不进入正式目录。
- 模板必须保留来源、License 和 Attribution。
- 缩略图统一转 WebP，并限制尺寸和文件大小。
- Adapter 失败时保留上一份成功快照。

## 界面规划

灵感页面保留当前三栏结构，并增加：

- 左栏：来源筛选、收藏、最近使用、本地改写和更新入口。
- 中栏：来源标识、更新状态、新增标记和归档标记。
- 右栏：来源、License、更新时间、客户备注和“保存为本地版本”。
- 更新 Dialog：来源列表、上次更新时间、自动更新策略和更新预览。
- 模板操作：收藏、复制、改写、生成同款、隐藏、查看原始出处。

客户修改模板时创建本地覆盖层或本地副本，不直接修改远程记录。

## 测试

- 每个 Adapter 使用固定 HTML、Markdown、JSON 或 Notebook Fixture 测试。
- 来源结构变化、限流、超时和空结果不能覆盖旧目录。
- Manifest 和分片校验失败时完整回滚。
- 完全重复模板正确合并来源。
- 远程更新不覆盖收藏、备注和客户 Prompt 改写。
- 来源下架后已收藏模板仍可访问。
- 自动更新频率、来源开关和缩略图懒加载正确。
- 多次更新具有幂等性，不重复创建模板。
- 导入和导出能够恢复本地灵感状态。

## 实施阶段

### 第一阶段：多源目录 MVP

- 重构现有导入脚本为 Source Adapter。
- 接入四个 P0 来源。
- 生成版本化 Manifest 和数据分片。
- 增加模板 Hash、来源、License 和 Attribution。
- 完成来源级 Fixture 测试和聚合器回滚保护。

### 第二阶段：客户本地资料层

- IndexedDB 增加灵感相关 Store。
- 增加收藏、备注、隐藏、本地改写和使用记录。
- 远程模板与本地覆盖层分离。
- Rust 增加缩略图文件缓存接口。

### 第三阶段：应用内更新

- 增加手动更新、来源开关和更新结果 Dialog。
- 支持仅新增、新增并更新、懒加载缩略图。
- 固定白名单目录下载和校验。
- 更新失败保留旧版本。

### 第四阶段：自动更新与迁移

- 支持启动时、每天和每周更新。
- 增加 JSON/ZIP 导入导出。
- 增加来源健康状态和更新历史。
- 评估取得授权后的 P1 数据源。

## MVP 验收标准

1. 灵感库同时展示至少四个 P0 来源。
2. 每条模板都能查看来源、原始链接和授权信息。
3. 用户可以按来源、分类和关键词筛选。
4. 用户可以收藏、备注和改写模板。
5. 点击“检查更新”能展示新增、修改和归档数量。
6. 一个来源失败时，其他来源仍能完成更新。
7. 更新后客户收藏、备注和改写内容保持不变。
8. 来源删除的已收藏模板仍保留在本机。
9. 缩略图保存在本地文件系统，离线后已缓存内容可浏览。
10. 应用不会向任何服务器上传客户的收藏、备注、改写和使用历史。

