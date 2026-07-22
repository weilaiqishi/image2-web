# 里程碑：结构化编辑与灵感目录

完成日期：2026-07-16  
代表提交：`dcef477`（`feat: complete prompt catalog and structured image editing`）

## 交付结果

Image2 Studio 从基础对话式图片工作区扩展为可定位、可引用、可追溯的编辑流程，同时建立可更新的多来源灵感目录。

### 精准编辑

- 标注对象获得稳定业务 ID，支持 Mark、Region、Mask、Move 和 Note。
- Composer 可以插入 `@Mark01`、`@Region01` 等结构化 Token，并检查失效引用。
- 图片附件可以声明人物、产品、动作、构图、材质、色卡、风格和版式等角色。
- 编辑请求将原图、标注合成图、结构化对象与保持约束编译为 Provider 可用输入。
- 生成资产保留父子关系，支持从已有结果继续编辑和形成版本分支。
- Workspace 增加迁移与恢复路径，标注草稿和本地状态不会因刷新直接丢失。

### 灵感目录

- 接入 image-2.net、Awesome GPT-4o Images、Awesome Prompts 和 OpenAI Cookbook Adapter。
- 聚合器输出版本化 Manifest、数据分片、校验值和 WebP 缩略图。
- 模板记录来源、授权、署名、内容哈希及归档状态。
- IndexedDB 分离远程模板与本地覆盖层，收藏、置顶、隐藏、备注、改写和使用记录不被目录更新覆盖。
- 单来源失败时保留上次成功快照；来源移除的条目采用归档而非物理删除。
- GitHub Workflow 支持周期性刷新目录。

## 变更规模

代表提交涉及 86 个文件，新增 8,542 行、删除 506 行。主要变更位于：

- `src/components/AnnotationDialog.tsx`、`AnnotationEditor.tsx` 与 `StructuredComposer.tsx`
- `src/lib/annotationModel.ts`、`promptCompiler.ts`、`promptCatalogStore.ts` 与 `workspaceStore.ts`
- `scripts/aggregate-prompts.mjs` 与 `scripts/prompt-sources/`
- `public/prompt-catalog/` 与 `src/data/prompt-catalog-v2.json`
- `src-tauri/src/lib.rs`

## 验证资产

- Adapter、目录产物、状态存储、标注模型、Prompt 编译和 Agent Runtime 单元测试。
- `scripts/plan2-real-regression.mjs` 提供显式真实 API 回归入口；运行会产生外部调用费用。
- `tests/fixtures/mvp-image-cases/` 保存代表性图片任务用例。

常规验证：

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 保留边界

- 不宣称 Provider 原生支持图层分离；只有获得明确图层或蒙版协议后才接入。
- 第三方内容必须继续保留来源、License 与 Attribution。
- 桌面 WebView 不直接抓取第三方站点，目录更新仍通过规范化发布物完成。
