# Image2 交互式精准编辑实施规划

## 1. 背景与目标

本文档基于 2026-07-14 发布的知乎文章[《Seedream 5.0 Pro你有点低调了，精准编辑这么好的功能不早说！》](https://zhuanlan.zhihu.com/p/2060433719106834734)、文章中的 Lumina 实际操作截图，以及 Image2 Studio 当前实现制定。

文章验证的核心价值不是增加更多绘图工具，而是把三类信息连接起来：

- 图片中的具体对象或区域。
- 用户在画布上的点选、框选、涂抹和方向指示。
- 提示词中可复用的 `@Mark01`、`@Region01` 等结构化引用。

Image2 Studio 已有 Fabric.js 标注 Dialog、附件、图片编辑请求、多轮 Agent 和父子图片关系。本规划在这些基础上建立“标注对象 -> 提示词引用 -> 图片编辑 -> 版本继续”的完整闭环。

目标：

1. 用户不需要用“左下角那一块”“人物后面的区域”等模糊语言描述修改位置。
2. 每个标注对象拥有稳定 ID，可以在提示词、任务、历史消息和后续版本中引用。
3. 多张参考图拥有明确用途，模型能区分人物、产品结构、动作、材质、色卡、构图和风格。
4. 生成结果可以继续成为下一次编辑的起点，形成可追溯版本链。
5. 即使图片 Provider 不原生支持 Region/Mark，客户端也能将结构化操作编译为兼容的图片和文本输入。

## 2. 调研结论

### 2.1 文章中已经实际展示的操作

#### 从附件进入 Draw

- 图片作为附件出现在生成输入框上方。
- 鼠标悬停附件缩略图时，顶部出现 `Draw` 操作。
- 点击后打开全尺寸编辑界面，不需要先进入独立资产管理页。
- 编辑界面保留原图片、模型、尺寸等生成上下文。

对 Image2 的启发：标注入口应同时存在于 Composer 附件和生成结果图片上，不能只放在结果卡片底部的小图标中。

#### 画布导航

- 手掌工具用于移动画布。
- 鼠标滚轮用于连续缩放。
- 左下角提供缩放百分比、加减按钮和适配视图。
- 编辑器是覆盖当前工作流的 Dialog，退出后回到原来的生成上下文。

#### 点选 Mark

- 点击图片中的元素，平台识别目标并创建一个可引用对象。
- 对象使用 `Mark01`、`Mark02` 等编号。
- 适合指代人物、商品、地毯、灯具或其他相对独立的对象。
- Mark 可以与多张参考图中的具体素材建立关系，例如“`Mark01` 使用 Image002 的 1 号材质球”。

#### 框选 Region

- 拖动矩形框选择一个块面，自动创建 `Region01`、`Region02` 等编号。
- Region 标签同时显示在画布区域和底部提示词中。
- 适合替换背景、修改一个版面区块、增加装饰或指定材质覆盖范围。

#### 画笔与涂鸦

- 画笔可以圈出或涂满不规则区域。
- 用户随后在提示词中描述该区域应该如何修改。
- 文章还展示了直接在图片上写写画画，让模型把涂鸦理解成最终视觉标注的场景。

#### 箭头

- 箭头表达从 A 到 B 的方向、移动关系或指向关系。
- 它不是单纯装饰图形，需要和起点对象、终点位置以及提示词共同保存。

#### `@` 召唤标注对象

- 标注完成后，对象成为提示词中的可插入 Token。
- 示例包括 `@Region01`、`@Region02` 和 `Mark01`。
- Token 以 Chip 形式存在，用户不需要记住编号。
- 发送前，画布上的标签、提示词 Token 和附件必须能互相定位。

#### Hex 色值

- 用户可以要求“将地毯 `Mark01` 的颜色改成 `#C59A3A`”。
- 色值是强约束，不应被当作普通描述词处理。
- 输入过程中应识别合法 Hex，并提供色块预览。

#### 多图融合与参考图分工

文章中的参考图承担不同约束：

- 人物身份和面部一致性。
- 产品外观、骨架、比例和材质。
- 动作和姿势。
- 草图构图。
- 色卡。
- 材质球集合。
- 摄影风格、排版和视觉气质。
- 品牌 Logo、角色 IP 和既有版式。

文章强调冲突优先级，例如“产品细节以图一为准，图二只作为摄影风格和排版参考”。因此附件不能继续只是无语义的图片数组。

#### 连续版本工作流

- 初次生成不是终点，而是后续精准编辑的素材。
- 上一步结果可以作为下一步的原图、参考图或品牌延展输入。
- 用户需要区分“重新抽卡”“基于此图继续”“只修改选中区域”。
- 多方案应该共享同一个父版本，便于比较不同颜色、材质或布置。

### 2.2 文章提到但没有实测的能力

图层分离在文章测试时尚未正式上线。作者引用的官方说明包括：

- 主体、背景、文字和装饰元素拆为独立图层。
- 图层可以拖拽、缩放、隐藏、替换和重组。
- 支持透明 PNG。

该能力不进入第一阶段验收。只有 Provider 明确返回图层或蒙版协议后再接入，不能通过客户端伪造“模型原生图层分离”。

### 2.3 文章案例归纳出的提示结构

复杂编辑提示通常包含以下层次：

1. 参考约束：哪个 Image 负责人物、产品、动作、色卡或风格。
2. 保持约束：哪些五官、结构、比例、文字层级或构图不得变化。
3. 局部操作：哪个 Mark/Region 要替换、移动、上色或添加材质。
4. 全局风格：光线、摄影、材质、排版和氛围。
5. 输出约束：比例、分辨率、文字、禁止项。

Composer 和 Agent 应保留这五层语义，而不是把全部内容压成不可检查的一段字符串。

## 3. 当前实现与差距

### 3.1 已有基础

- `AnnotationDialog` 已支持在同一 WebView 中编辑图片。
- `AnnotationEditor` 已有选择、椭圆、箭头、文字、撤销、重做、缩放和本地保存。
- `AnnotationAttachment` 已保存原资产、Fabric JSON、标注合成图和修改指令。
- `EditInput` 已同时传递原图、标注图和提示词。
- `AssetRecord.parentId` 已能表达简单父子版本关系。
- Agent 工具已能为 edit 任务指定 `annotationId`。
- 全局 FIFO 队列、失败重试和中断恢复已经可用。

### 3.2 关键缺口

- Fabric 对象没有业务 ID，提示词无法稳定引用具体标注。
- 当前椭圆、箭头和文字只是视觉图形，没有 Mark/Region/Move 等语义。
- 缺少手掌、点标、矩形框和自由画笔。
- 标注提示词位于右侧 Inspector，与文章中的同屏底部编辑闭环不同。
- Composer 仍使用纯 `textarea`，不能插入不可拆分的 `@` Token。
- 附件没有角色，Agent 只能看到无差别 reference ID。
- 一个资产只按 `assetId` 保存一份 Annotation JSON，无法保留多个编辑草稿。
- Workspace 固定为 version 1，没有迁移机制。
- `parentId` 只能表达直接父级，界面没有版本树、分支和对比。
- Provider 请求没有标注编译层，直接依赖模型理解一张涂画后的图片。
- 当前结果卡只在 Caption 放标注按钮，没有附件悬停 `Draw`。

## 4. 产品原则

### 4.1 先标位置，再说动作

画布操作负责“改哪里”，提示词负责“怎么改”。系统不应要求用户在画布工具中填写大量自然语言，也不应让提示词承担所有空间定位。

### 4.2 标注是结构化数据，合成图只是传输产物

Fabric JSON、归一化坐标、业务对象 ID 和提示词引用是事实来源。带红框的合成图只用于向不支持结构化区域的图片模型传递信息。

### 4.3 显式保持约束

编辑任务默认继承“未标注区域保持不变”。涉及人像、商品或品牌时，用户可以进一步锁定身份、产品结构、文字版式或品牌色。

### 4.4 可恢复、可追溯、不会意外计费

- 标注草稿本地自动保存。
- 关闭脏草稿需要确认。
- 提交标注不产生图片费用。
- 只有用户点击发送并创建任务后才调用图片 API。
- 应用重启后仍由用户手动恢复未完成任务。

## 5. 目标交互流程

### 5.1 从生成结果继续编辑

1. 用户悬停结果图片。
2. 图片顶部显示预览、Draw、继续生成和导出图标。
3. 点击 Draw，打开精准编辑 Dialog。
4. 用户创建 Mark、Region、Mask 或 Arrow。
5. 系统自动为对象编号并插入或提示插入 Token。
6. 用户在底部 Composer 描述修改内容。
7. 点击“添加到对话”，关闭 Dialog，并把结构化标注附件和文本带回当前草稿。
8. 用户检查模型、比例、质量后发送。
9. Agent 创建 edit 任务，新结果的 `parentId` 指向原资产。

### 5.2 从 Composer 附件进入编辑

1. 用户上传参考图或从历史资产选择图片。
2. 悬停附件缩略图出现 Draw。
3. 对于临时上传图片，先写入本地资产存储并得到稳定 `assetId`。
4. 完成标注后，原附件升级为 Annotation Attachment，不重复附加原图。
5. 删除附件时只从草稿移除，不删除本地资产和标注文档。

### 5.3 从历史版本继续

1. 用户在结果卡选择“基于此版本继续”。
2. 系统将该资产设为当前编辑基线。
3. Composer 显示父版本缩略图和版本号。
4. 新生成结果作为子版本保存。
5. 同一个父版本发起多个方案时形成分支，而不是覆盖上一结果。

## 6. 精准编辑器设计

### 6.1 布局

桌面端采用三段式布局：

- 左侧 64px 工具栏：移动、点选、框选、画笔、箭头、文字、撤销、重做。
- 中央画布：图片、标注对象、对象标签和缩放控件。
- 底部 Composer：附件缩略图、Mark/Region Token、自然语言指令和提交操作。

右侧 Inspector 只在选中对象时按需展开，用于重命名、颜色、备注、删除和坐标信息。默认不长期占据 320px，避免压缩画布。

移动端采用：顶部横向工具栏、中央画布、底部可折叠 Composer。对象 Inspector 使用 Bottom Sheet。

### 6.2 工具语义

| 工具 | 业务对象 | 默认编号 | 数据 | 用途 |
| --- | --- | --- | --- | --- |
| 移动 | 无 | 无 | viewport | 平移画布 |
| 点选 | `point` | `Mark01` | x/y、可选轮廓 | 指代独立对象 |
| 框选 | `rect` | `Region01` | x/y/w/h | 块面替换与局部修改 |
| 画笔 | `mask` | `Region01` | path、brushWidth | 不规则区域与涂抹 |
| 箭头 | `arrow` | `Move01` | start/end、关联对象 | 移动和方向关系 |
| 文字 | `note` | `Note01` | x/y/text | 画面内备注或期望文字 |

第一阶段的“点选”只创建一个点标和可选备注，不承诺自动分割轮廓。自动识别对象需要 Provider 的视觉理解或分割能力，作为增强功能单独灰度上线。

### 6.3 编号规则

- 每个 Annotation Document 内按类型递增编号。
- 删除 `Region02` 后不复用 02，避免历史提示词指向错误对象。
- 展示名可以修改，但不可变 ID 不变化。
- 复制对象会得到新编号。
- Token 使用显示名，底层保存 `annotationObjectId`。
- 序列化前校验 Token 引用的对象仍然存在。

### 6.4 坐标与缩放

- 所有几何数据以原图尺寸归一化为 0 到 1。
- Fabric 对象只负责当前 viewport 的绘制。
- 图片缩放、窗口变化和 HiDPI 不得修改归一化数据。
- 导出标注合成图时按原图尺寸重新渲染，不能截取低分辨率画布。
- 画笔宽度同时保存屏幕宽度和相对原图宽度。

### 6.5 Token 交互

- 在底部 Composer 输入 `@` 打开对象菜单。
- 菜单按 Mark、Region、Move、Note 分组并显示小型预览。
- 点击画布对象时，高亮提示词中对应 Token。
- 点击 Token 时，画布平移并聚焦对应对象。
- 删除对象时，如果提示词仍引用它，显示阻断式校验并提供“删除引用”。
- 复制粘贴文本时，Token 降级为 `@Region01` 文本；内部状态仍保存结构化引用。

第一阶段可以使用受控文本模型加 Token spans；不建议直接在原生 `textarea` 中伪造不可拆分 Chip。优先采用 `contenteditable` + 明确的序列化层，或成熟的轻量富文本方案。

## 7. 多参考图设计

### 7.1 参考角色

```ts
type ReferenceRole =
  | "base"
  | "identity"
  | "product"
  | "pose"
  | "composition"
  | "material"
  | "palette"
  | "style"
  | "layout"
  | "logo"
  | "other";
```

### 7.2 附件交互

- 上传后自动显示 `Image001`、`Image002`。
- 每张附件提供角色菜单，使用图标加文字，不用颜色代替语义。
- 一个附件可以有多个角色，但必须有一个主角色。
- Agent 可以建议角色，用户确认前不自动覆盖。
- Composer 中输入 `@Image` 可以插入附件 Token。
- 引用冲突时允许设置优先级，例如“产品结构以 Image001 为准，风格以 Image002 为准”。

### 7.3 默认冲突规则

1. 用户明确写出的优先级。
2. `base` 原图的未标注区域保持约束。
3. `identity`、`product` 和 `logo` 等保真约束。
4. `pose`、`composition` 和 `layout`。
5. `material`、`palette` 和 `style`。

发送前把该规则渲染为可检查摘要，避免模型静默混合冲突素材。

## 8. 数据模型

### 8.1 标注对象

```ts
type AnnotationObjectKind = "point" | "rect" | "mask" | "arrow" | "note";

interface AnnotationObjectRecord {
  id: string;
  documentId: string;
  kind: AnnotationObjectKind;
  displayName: string;
  sequence: number;
  geometry: NormalizedGeometry;
  color: string;
  note?: string;
  sourceObjectId?: string;
  createdAt: string;
  updatedAt: string;
}

interface AnnotationToken {
  id: string;
  kind: "annotation" | "reference" | "color";
  targetId: string;
  displayText: string;
  start: number;
  end: number;
}
```

### 8.2 标注文档

```ts
interface AnnotationDocumentV2 {
  id: string;
  sourceAssetId: string;
  conversationId: string;
  sourceWidth: number;
  sourceHeight: number;
  fabricJson: string;
  objects: AnnotationObjectRecord[];
  promptText: string;
  promptTokens: AnnotationToken[];
  status: "draft" | "attached" | "submitted";
  createdAt: string;
  updatedAt: string;
}
```

一个资产允许拥有多个 Annotation Document。现有按 `assetId` 单例保存的接口需要改为按 `documentId` 保存，并增加按资产列出文档的能力。

### 8.3 附件扩展

```ts
interface ReferenceDescriptor {
  label: string; // Image001
  roles: ReferenceRole[];
  priority: number;
  preserve: string[];
}

interface AnnotationAttachmentV2 {
  id: string;
  kind: "annotation";
  sourceAssetId: string;
  documentId: string;
  objectIds: string[];
  compiledOverlayAssetId: string;
  instruction: string;
  tokens: AnnotationToken[];
  createdAt: string;
}
```

不要继续把大型 `annotatedDataUrl` 放进 IndexedDB Workspace。合成图保存到 Tauri 应用数据目录，Workspace 只保存 Asset ID。

### 8.4 版本关系

扩展 `AssetRecord`：

```ts
interface AssetLineage {
  parentId?: string;
  rootId: string;
  revision: number;
  branchLabel?: string;
  sourceTaskId?: string;
  sourceDocumentId?: string;
}
```

保留现有 `parentId` 兼容字段。删除父资产前检查子版本；默认只从索引隐藏，不级联删除子资产。

### 8.5 Workspace 迁移

- Workspace `version` 从 1 升级到 2。
- 添加纯函数 `migrateWorkspace(input): WorkspaceStateV2`。
- 旧 Annotation Attachment 转换为一个只有合成图、没有结构化对象的 legacy 文档。
- 旧附件自动分配 `Image001` 等标签，角色设为 `other`。
- 迁移失败时保留原始状态备份并回退只读，不写入半迁移数据。

## 9. 标注编译与 Provider 适配

### 9.1 为什么需要编译层

当前 OpenAI-compatible Images API 不保证理解客户端内部的 `Region01` 或归一化坐标。只发送以下文本是不可靠的：

```text
把 @Region01 改成红色
```

客户端需要生成 Provider 可理解的输入组合：

1. 无标注原图。
2. 带高对比标注和标签的 overlay 图片。
3. 展开的自然语言说明。
4. 多参考图及其角色说明。

### 9.2 Prompt Compiler

新增纯函数层：

```ts
interface CompiledEditRequest {
  originalAssetId: string;
  overlayAssetId: string;
  prompt: string;
  referenceAssetIds: string[];
  diagnostics: PromptDiagnostic[];
}

compileEditRequest(document, attachments, params): CompiledEditRequest
```

编译结果示例：

```text
根据第二张带标注的示意图修改第一张原图。
- Region01：归一化矩形 x=0.04, y=0.02, w=0.92, h=0.31；改为中古红色背景。
- Region02：归一化矩形 x=0.05, y=0.62, w=0.90, h=0.20；加入菱形双色厚绒地毯。
- Image002：材质参考，只使用其材质，不改变原图主体结构。
保持未标注区域、人物身份和整体构图不变。
输出比例 3:4。
```

### 9.3 Overlay 规范

- Mark 使用编号圆点和引线。
- Region 使用半透明填充、清晰边框和外置标签。
- Mask 使用半透明斜线或色块，避免完全遮住原图内容。
- Arrow 使用起点圆点、箭头和 `MoveNN` 标签。
- 不同对象使用可区分的颜色，但编号仍是主要识别方式。
- 标签不能超出画布；靠近边缘时自动内移。
- 合成图必须包含图例，说明颜色和编号只是编辑标注，不是最终画面元素。

### 9.4 Provider 能力分级

```ts
interface ImageProviderCapabilities {
  supportsEdit: boolean;
  supportsMultipleReferences: boolean;
  supportsMask: boolean;
  supportsStructuredRegions: boolean;
  supportsLayers: boolean;
}
```

- 基础 Provider：原图 + overlay + 编译提示词。
- 支持 Mask：将 mask 单独发送，不把涂抹颜色烘焙到参考图。
- 支持结构化 Region：直接发送坐标，同时保留文本摘要。
- 支持图层：接收并本地保存真实图层资产。

UI 只展示 Provider 已声明支持的能力。

## 10. Agent Runtime 改造

### 10.1 工具 Schema

扩展 `create_image_tasks`：

```ts
interface PlannedImageTaskV2 {
  title: string;
  prompt: string;
  operation: "generate" | "edit";
  referenceIds: string[];
  annotationDocumentId?: string;
  annotationObjectIds?: string[];
  baseAssetId?: string;
  preserve?: string[];
  variantGroupId?: string;
}
```

### 10.2 Agent 上下文

Agent 接收附件时不发送 Fabric JSON。只发送以下紧凑摘要：

- `Image001`、资产 ID、角色和保留约束。
- Annotation Document ID。
- Region/Mark 名称、类型、备注和归一化位置。
- 用户提示词中的结构化引用。

### 10.3 校验

- edit 任务必须有 `baseAssetId`。
- 所有 `annotationObjectIds` 必须属于指定文档。
- 提示词引用不存在的对象时拒绝创建任务。
- 任务引用不存在的 Image 时拒绝创建任务。
- 图片数量和总大小继续遵守现有限制。
- 多方案任务仍进入全局 FIFO，不提高图片生成并发。

## 11. 组件改造

### 11.1 新增组件

- `AnnotationComposer`：底部提示词、Token 和发送前诊断。
- `AnnotationObjectOverlay`：对象标签与选中状态。
- `AnnotationInspector`：按需显示对象属性。
- `MentionMenu`：`@` 引用 Mark、Region 和 Image。
- `ReferenceRoleMenu`：附件角色与优先级。
- `AssetHoverActions`：预览、Draw、继续、导出。
- `VersionTrail`：父版本、当前版本和子分支。
- `BeforeAfterCompare`：拖动或并排比较父子结果。

### 11.2 调整现有组件

- `AnnotationEditor`：拆出工具状态、几何模型和渲染适配器，避免继续把所有逻辑放在单组件内。
- `AnnotationDialog`：接收 `conversationId`、可选 draft document 和提交模式。
- `AgentWorkspace`：附件卡增加 Draw、角色和 Mention；结果卡增加继续编辑与版本入口。
- `ImagePreviewDialog`：增加“基于此图继续”和前后对比。
- `workspaceStore`：版本 2、迁移和 Annotation Document 索引。
- `bridge`：保存/读取/列出/删除标注文档和 overlay 资产。
- Rust：按 document ID 持久化标注文档，原子写入索引和合成图。

## 12. 实施阶段

### 第一阶段：结构化 Region/Mark MVP

- Workspace v2 和迁移。
- Annotation Document V2 与多文档存储。
- 手掌、点标、矩形框、画笔和箭头。
- 稳定编号、归一化坐标和对象标签。
- 底部 Annotation Composer。
- `@` 菜单和 Token 双向聚焦。
- 原图尺寸 overlay 导出。
- Prompt Compiler 基础版。
- 结果卡与附件悬停 Draw。

第一阶段不包含自动对象分割和图层分离。

### 第二阶段：多参考图与保持约束

- `Image001` 标签。
- 参考角色和优先级。
- Hex 色值识别与色块。
- 保持人物、产品结构、构图和未标注区域的约束模板。
- Agent Schema V2 和严格引用校验。
- Provider capability 配置。

### 第三阶段：版本链与方案比较

- 父子版本轨迹。
- 基于指定结果继续。
- 同父版本多方案分支。
- 前后对比。
- 版本重命名、隐藏和导出。
- 从历史消息恢复对应 Annotation Document。

### 第四阶段：增强识别与真实图层

- 点选后的视觉对象命名建议。
- Provider 支持时启用语义分割或独立 Mask。
- Provider 支持时接入真实图层文件。
- 图层列表、隐藏、重排和透明 PNG 导出。

第四阶段必须建立在真实 Provider 能力上，不作为本地 UI 模拟功能。

## 13. 测试计划

### 13.1 单元测试

- 各工具生成正确类型和稳定编号。
- 删除对象后编号不复用。
- 坐标在缩放和窗口变化后保持一致。
- Token 序列化、复制、删除和失效诊断正确。
- Hex 色值解析只接受合法格式。
- Prompt Compiler 正确展开 Region、Mark、Image 和 preserve 约束。
- Workspace v1 到 v2 迁移幂等。
- 引用不存在对象时任务校验失败。
- 父子版本和分支 revision 正确。

### 13.2 组件测试

- 悬停附件显示 Draw，键盘聚焦时也能访问相同操作。
- 点击画布对象高亮对应 Token。
- 点击 Token 聚焦画布对象。
- 删除被引用对象时出现校验。
- 脏草稿关闭确认和自动恢复。
- 参考角色菜单可通过键盘操作。
- 移动端工具栏和 Composer 不遮挡画布。

### 13.3 集成测试

- 上传图片 -> Draw -> Region -> `@Region01` -> 添加到草稿 -> 创建 edit 任务。
- 两张图片分别设为产品与风格参考，Agent 输出正确 reference ID。
- 失败任务重试后仍引用原 Annotation Document。
- 应用重启后标注草稿存在，运行任务保持中断状态。
- 生成子版本后可以基于父版本创建第二个方案。
- 删除父版本不会破坏子版本索引。

### 13.4 Rust 测试

- document ID 和路径校验，防止目录穿越。
- 标注文档与 overlay 原子写入。
- 索引损坏时保留可恢复文件。
- 删除文档不会误删源资产。
- 大图 overlay 保存和读取不进入凭证或网络代理路径。

### 13.5 真实 Provider 验证

仅在显式传入付费测试密钥时运行：

1. 两个 Region 的背景和地毯修改。
2. 一个 Mark 的 Hex 颜色修改。
3. 原图 + 色卡的灰阶上色。
4. 产品原图 + 风格参考，验证产品结构保持。
5. 人像局部背景修改，验证身份保持。

结果由人工记录以下指标：目标区域命中、未标注区域保持、身份/产品一致性、文本正确率和重试次数。

### 13.6 文章操作案例 MVP 测试目录

本目录记录文章出现的全部操作案例。测试分为三类：

- `UI`：使用浏览器 Demo 或 Mock Provider，不产生图片费用，进入常规 CI。
- `REAL`：调用真实图片 Provider，会产生费用，只在显式提供测试密钥时运行。
- `DEFERRED`：文章未实测或当前产品能力不支持，只记录预期，不进入 MVP 阻断项。

每次 `REAL` 测试必须保存 Provider、模型、参数、输入资产 Hash、编译后提示词、输出资产 ID、耗时、费用和人工评分。真实模型输出不使用像素快照断言。

#### 13.6.1 覆盖基线与执行规则

2026-07-15 使用外部 Microsoft Edge 逐段核对文章正文、操作截图说明和原始提示词后，目录基线为 46 条：

- 12 条无费用 `UI` 操作闭环。
- 30 条文章正向生图/编辑 `REAL` 案例。
- 2 条文章提及但当前不可验收的 `DEFERRED` 案例。
- 2 条由正向流程推导出的 `NEGATIVE` 发送保护案例。

覆盖范围从“上传图片 -> Hover Draw -> 标注 -> `@` 引用 -> 编译 -> 发送”开始，包含多参考图分工、局部编辑、连续版本、商品/品牌、信息图、人像和多语种本地化，最后覆盖失败恢复和 Provider 不支持原生结构化标注时的降级路径。文章正文后续增加案例时，必须新增稳定 case ID，不能覆盖或复用旧编号。

每条用例执行时都必须记录：前置 Workspace/资产、逐步操作、每步预期、实际结果、截图或录屏证据、编译输入、Provider 路由、输出资产和父子版本。用例中写明“人工核对”的断言不得被自动化结果代替。

#### A. Draw 与结构化标注

##### MVP-UI-01：从附件悬停进入 Draw

- 类型：`UI`，MVP 阻断。
- 前置：Composer 中已有一张上传图片或历史资产。
- 操作：鼠标悬停附件缩略图，点击 `Draw`；再使用键盘聚焦附件并触发同一操作。
- 断言：Draw 只在 Hover/Focus 时出现；打开编辑器后原附件、模型、比例和草稿文本不丢失；关闭后焦点回到触发按钮。
- 对应文章：Lumina 附件卡顶部悬停出现 `Draw`。

##### MVP-UI-02：画布移动、缩放与适配

- 类型：`UI`，MVP 阻断。
- 操作：选择手掌拖动画布；滚轮缩放；使用加、减和适配视图。
- 断言：缩放范围受限；缩放中心合理；画布移动不改变对象的归一化坐标；100% 与适配状态显示正确。
- 对应文章：左侧手掌工具，滚轮缩放，左下角缩放控件。

##### MVP-UI-03：点选创建 Mark

- 类型：`UI`，MVP 阻断。
- 操作：使用点选工具依次点击两个对象区域。
- 断言：创建 `Mark01`、`Mark02`；标签和对象 ID 稳定；删除 `Mark01` 后下一个对象为 `Mark03`；第一阶段不伪造像素级轮廓。
- 对应文章：点击元素后识别并转译为可引用 Mark。

##### MVP-UI-04：框选创建 Region

- 类型：`UI`，MVP 阻断。
- 操作：拖动创建上下两个矩形区域。
- 断言：创建 `Region01`、`Region02`；坐标按原图归一化；缩放和重开文档后区域位置不漂移。
- 对应文章：框选背景和地毯块面。

##### MVP-UI-05：画笔创建不规则 Mask

- 类型：`UI`，MVP 阻断。
- 操作：改变画笔宽度，圈画和涂满两个不规则区域。
- 断言：路径连续；保存相对画笔宽度；合成图仍能看清底图；撤销和重做以一次笔画为单位。
- 对应文章：涂抹需要修改的区域，再在提示词中说明要求。

##### MVP-UI-06：箭头表达移动关系

- 类型：`UI`，MVP 阻断。
- 操作：从一个 Mark 拖出箭头到目标位置，并添加“移动到此处”的备注。
- 断言：创建 `Move01`；保存起点、终点和关联 Mark；改变缩放后箭头方向不变；编译提示词包含起终点关系。
- 对应文章：使用箭头表达从 A 移动到 B。

##### MVP-UI-07：Region/Mark 与提示词双向引用

- 类型：`UI`，MVP 阻断。
- 操作：输入 `@`，依次插入 `@Region01`、`@Mark01` 和 `@Image002`；点击 Token；点击画布对象。
- 断言：Mention 菜单分组正确；点击 Token 聚焦对象；点击对象高亮 Token；删除被引用对象时阻止发送并提示删除引用。
- 对应文章：通过 `@` 召唤指定对象并给出指令。

##### MVP-UI-08：标注草稿与合成图

- 类型：`UI`，MVP 阻断。
- 操作：创建多个对象后关闭、恢复并添加到对话。
- 断言：脏草稿关闭前确认；重启后恢复；合成图按原图尺寸渲染；Workspace 只保存 overlay Asset ID，不保存大型 Data URL。

##### MVP-UI-09：多附件稳定编号、排序与参考角色

- 类型：`UI`，MVP 阻断。
- 前置：Composer 中依次加入人物、产品、动作线稿、色卡和风格图，随后移除第二张并再加入一张图片。
- 操作：为附件设置 `identity`、`product`、`pose`、`palette`、`style/layout` 角色和显式优先级；改变显示顺序；在提示词中插入各 `@ImageNNN` Token。
- 断言：Image ID 在文档生命周期内稳定且删除后不复用；排序只改变输入顺序，不静默改变 ID 或角色；Token、缩略图和编译摘要双向对应；同一附件可承担兼容的多个角色，但冲突角色必须提示。
- 对应文章：材质球、色卡、人物与服装、动作线稿、产品与风格参考的多图分工案例。

##### MVP-UI-10：发送前编译预览与计费边界

- 类型：`UI`，MVP 阻断。
- 前置：存在原图、overlay、两个 Region、一个 Mark、两张参考图和未发送的 Prompt。
- 操作：打开编译预览，检查原图、overlay、展开后的自然语言、引用角色摘要和 Provider capability 路由；关闭预览后发送；在任务真正创建前取消一次。
- 断言：添加标注和打开预览不调用付费 API；所有 Token 都展开为可检查文本；Provider 支持 Mask 时发送独立 Mask，不支持时发送 overlay；取消发生在 IndexedDB/任务提交前时不得产生任务或费用；最终发送只创建一次任务。
- 对应文章：通过 Region、Mark、多张参考图和文字指令共同减少重新抽卡，并把生成结果接入长期工作流。

##### MVP-UI-11：基于结果继续、同父多方案与前后对比

- 类型：`UI`，MVP 阻断。
- 前置：已有一个成功生成的父资产及其 Annotation Document。
- 操作：分别执行“重新生成”“基于此图继续”“只修改选中区域”；从同一父图创建两个颜色或材质方案；打开父子前后对比和兄弟方案切换。
- 断言：三种动作生成的任务语义不同；继续编辑继承正确原图和上下文；两个方案共享同一 `parentId` 且各自保留参数、标注和 Prompt；对比视图不修改资产；删除/隐藏父图前明确显示对子版本的影响。
- 对应文章：生成后继续精准修改，以及 B 端团队为色号、皮质和摆放位置运行多个方案再拍板。

##### MVP-UI-12：失败重试、任务恢复与引用冻结

- 类型：`UI`，MVP 阻断。
- 前置：创建一个包含 Annotation Document 和多个参考角色的编辑任务，使用 Mock Provider 让首次调用失败。
- 操作：重试任务；在运行中重启应用；恢复后再次执行或取消。
- 断言：重试和恢复始终引用创建任务时冻结的 document ID、object IDs、Image IDs、角色、编译 Prompt 和父版本；后续编辑草稿不会污染已排队任务；运行中的任务重启后保持中断状态并由用户手动恢复；取消不会删除源资产和标注草稿。
- 对应文章：连续生产工作流需要可追溯、可恢复，不能因重新抽卡或上下文漂移丢失精准控制条件。

#### B. 精准局部编辑

##### MVP-EDIT-01：两个 Region 修改背景与地毯

- 类型：`REAL`，MVP 阻断。
- 输入：一张上下分区明显的人像或海报原图；`Region01` 框选上部背景，`Region02` 框选下部地面。
- 提示：`@Region01 改为中古红色背景；@Region02 加入菱形双色厚绒质感地毯；上下文字改为金色花体字和花体装饰。`
- 断言：两个目标区域均发生对应变化；人物主体位置不变；未标注区域无明显重绘；任务保存两个 object ID。
- 对应文章：精准编辑章节第一个完整 Region 示例。

##### MVP-EDIT-02：多 Mark/Region 映射材质球

- 类型：`REAL`，扩展验收。
- 输入：Image001 为手绘室内插画；Image002 为编号材质球集合；至少创建 7 个 Mark 和 1 个 Region。
- 提示：分别把 Image002 中指定材质映射到 `Mark01` 至 `Mark07` 和 `Region01`，同时把文字变成立体字、背景变成米色墙面漆，输出 3:4。
- 断言：每个 Token 均能编译到对应材质引用；不同 Mark 不串位；主要物体结构保持；缺失或重复编号在发送前报错。
- 对应文章：材质球批量映射案例。

##### MVP-EDIT-03：Hex 品牌色精准替换

- 类型：`REAL`，MVP 阻断。
- 输入：带地毯或明确色块的原图；地毯标记为 `Mark01`。
- 提示：`按照贴图修改图片，并将地毯 @Mark01 的颜色改成 #C59A3A。`
- 断言：Composer 将 Hex 显示为色块；编译结果保留大写 Hex；输出区域色彩接近目标色；其他材质和构图保持。
- 人工指标：目标区域取样色与 `#C59A3A` 的 Delta E，记录但不作为跨 Provider 的硬阈值。

##### MVP-EDIT-04：色卡迁移到灰阶线稿

- 类型：`REAL`，MVP 阻断。
- 输入：Image001 为灰阶人物线稿，角色 `base`；Image002 为色卡，角色 `palette`。
- 提示：使用 Image002 色卡为 Image001 上色，保留清晰线稿；加入左上主光、右侧环境补光；皮肤、头发、金属和布料使用不同明暗与高光规则。
- 断言：线稿结构保持；色彩来自色卡；附件角色和优先级进入编译结果；不会把色卡版式复制进成图。

##### MVP-EDIT-05：画笔涂鸦局部修改

- 类型：`REAL`，MVP 阻断。
- 输入：任意有明确可修改局部的图片；用 Mask 涂满目标范围。
- 操作：在提示词中只描述 Mask 区域变化，并明确未涂抹区域保持不变。
- 断言：Provider 支持 Mask 时发送独立 Mask；否则发送 overlay；目标范围命中；未涂抹区域变化受控。
- 对应文章：画笔涂抹后用提示词继续修改。

##### MVP-EDIT-06：模型在原图上生成知识标注

- 类型：`REAL`，扩展验收。
- 输入：猫咪线稿。
- 提示：保持线稿、姿势和构图，标出适合抚摸的区域；使用红色手写体、红色虚线和手绘箭头；文字放不下时移到留白处；输出 1:1。
- 断言：原线稿保持；标注具有区域和箭头关系；没有无关元素；事实内容由人工核对，不把模型答案当作权威知识。

##### MVP-EDIT-07：人像背景色修改与身份保持

- 类型：`REAL`，MVP 阻断。
- 输入：人像封面图，框选背景区域。
- 操作：只加深背景蓝色，明确保持面部细节、五官比例、发型和人物位置。
- 断言：背景变化命中；人脸身份相似度由人工评分；输出与父版本建立 lineage。
- 对应文章：GPT Image 2 与 Seedream 5.0 Pro 人像精准编辑对比案例。

#### C. 多图融合、草图和动作控制

##### MVP-REF-01：两只猫融入插画

- 类型：`REAL`，MVP 阻断。
- 输入：两张猫咪参考图和一张目标插画；猫咪角色为 `identity`，插画为 `base/style`。
- 提示：`把两只猫融入目标插画，比例 3:4，两只猫的色调可以浅一点。`
- 断言：两只猫均出现且可区分；风格与插画融合；猫的主要花色特征保持；附件标签不串位。

##### MVP-REF-02：未抠图素材融入新空间并校正透视

- 类型：`REAL`，扩展验收。
- 输入：未抠图的家具或地毯素材与一个室内空间。
- 操作：把素材放入目标区域，要求自然抠图、光线融合和正确透视。
- 断言：没有明显原背景边框；接触阴影合理；透视方向与空间一致；原产品结构保持。
- 对应文章：地毯放入另一空间并自动调整透视。

##### MVP-REF-03：草图加菜品生成宣传海报

- 类型：`REAL`，扩展验收。
- 输入：Image001 为构图草图；其余图片为独立菜品照片。
- 操作：按草图位置生成新品宣传海报，保持每道菜的可识别细节。
- 断言：主要布局遵循草图；所有指定菜品出现；菜品不相互融合；可选预处理不得覆盖原附件。
- 对应文章：草图加菜品照片生成海报，无完整原文提示词。

##### MVP-REF-04：简笔画转魔幻现实主义旅行影像

- 类型：`REAL`，MVP 阻断。
- 输入：构图简笔画，角色 `composition`。
- 提示：`根据草图生成魔幻现实主义旅行影像，略带复古感，比例 3:4。`
- 断言：主体位置、视线方向和主要块面遵循草图；风格发生转换；草图线条不应残留为无意元素。

##### MVP-REF-05：标注构图、人物保真和服装替换

- 类型：`REAL`，扩展验收。
- 输入：Image001 为人物，Image002 为服装鞋子，另有构图标注。
- 提示：保持 Image001 面部和发型；替换为 Image002 服装鞋子；按标注增加猫耳发箍、气球花和左上标题 `Seedream`；使用 Y2K、Kidcore、Neo-Pop 3D 视觉；输出 9:16。
- 断言：人物身份保持；服装来源正确；标注构图命中；标题位置和文本正确；参考角色冲突时人物保真优先。

##### MVP-REF-06：动作线稿迁移

- 类型：`REAL`，MVP 阻断。
- 输入：Image001 为人物、场景和产品基线；Image002 为动作线稿，角色 `pose`。
- 提示：`保持 Image001 的人物、场景和产品，只改变动作；动作参考 Image002；比例 3:4。`
- 断言：姿势明显接近线稿；人物身份、产品和场景保持；Image002 的线稿风格不进入成图。

#### D. 商品、品牌和版式工作流

##### MVP-DESIGN-01：运动节文生图主视觉

- 类型：`REAL`，基础生成回归。
- 输入：无参考图。
- 提示要点：16:9；钴蓝背景和珊瑚红街区；两位运动女孩和拟人交通锥；主标题“城市动起来”；三个底部信息区；禁止其他文字、Logo 和水印。
- 断言：主要人物、标题和三组底部信息齐全；中文主标题可读；没有额外品牌；复杂布局不会导致任务参数遗漏。

##### MVP-DESIGN-02：白底台灯转复古家居海报

- 类型：`REAL`，MVP 阻断。
- 输入：唯一台灯产品参考，角色 `product`。
- 提示要点：严格保持灯罩、灯杆、底座、比例、材质和颜色；暖琥珀夜景；指定三组英文；比例 3:4；禁止其他灯具和 Logo。
- 断言：产品结构保真；只出现一个台灯；2700K 暖光氛围；指定文字与禁止文字分别核验。

##### MVP-DESIGN-03：单椅暗场发布海报

- 类型：`REAL`，扩展验收。
- 输入：AZHEN Orbit Lounge Chair 产品图。
- 提示要点：保持胡桃木框架、奶油色软包、悬浮靠背和黄铜连接件；黑到冷灰背景；指定日期、标题和产品文案；3:4。
- 断言：结构和材质保持；排版层级正确；没有人物、价格或促销内容。

##### MVP-DESIGN-04：产品与风格参考冲突优先级

- 类型：`REAL`，MVP 阻断。
- 输入：Image001 为单椅产品，角色 `product` 且优先级最高；Image002 为摄影、配色、构图和排版参考，角色 `style/layout`。
- 操作：生成 2:3 商品详情海报，明确任何产品差异均以 Image001 为准。
- 断言：编译摘要显示冲突优先级；产品骨架不被 Image002 替换；风格和版式来自 Image002；标题、卖点、三栏详情和品牌文案形成清晰层级。

##### MVP-DESIGN-05：包袋骨架保持与材质方案批量变化

- 类型：`REAL`，扩展验收。
- 输入：包袋线稿、多个皮料和五金参考。
- 操作：以同一线稿生成至少 3 个材质方案，只改变皮肤和五金。
- 断言：各方案包袋骨架和比例一致；背景色和构图一致；材质与五金组合可区分；任务形成同父版本分支。
- 对应文章：多张包袋图分别生成但保持骨架和背景一致，无完整原文提示词。

##### MVP-DESIGN-06：品牌插画与 Logo 延展到标注样机

- 类型：`REAL`，扩展验收。
- 输入：Image001 品牌插画、Image002 Logo、Image003 标注的样机清单或布局。
- 提示：`根据 Image001 和 Image002，生成 Image003 标注的所有样机，在一张图中显示，不要说明文字，比例 3:4。`
- 断言：所有标注样机均出现；Logo 与插画身份保持；输出没有额外说明文字；三个附件角色和引用正确。

##### MVP-DESIGN-07：实验性牛奶品牌拼贴海报

- 类型：`REAL`，扩展验收。
- 输入：ZHEN MILK 牛奶盒产品图。
- 提示要点：3:4 二维数字拼贴；钴蓝背景；同一包装的 4 至 5 个裁切碎片；保留设计软件选框和控制点；加入局部折射、指定英文排版；禁止写实摄影和电商陈列。
- 断言：二维拼贴而非摄影场景；产品身份一致；指定文字存在；选框是设计内容而非应用真实 UI；禁止项未出现。

##### MVP-DESIGN-08：九格品牌故事漫画

- 类型：`REAL`，扩展验收。
- 输入：ZHEN MILK 品牌女孩 IP、Logo 和包装参考。
- 提示要点：3:4；9 格不规则漫画；角色发型、服装和配色保持；九格按品牌起源故事推进；中英文旁白与对白；禁止水彩、写实和挤奶动作。
- 断言：恰好 9 个主要分镜；角色跨格一致；故事顺序可辨；关键中英文可读；禁画内容未出现。

#### E. 复杂信息可视化

##### MVP-INFO-01：从可可豆到巧克力流程图

- 类型：`REAL`，基础生成回归。
- 输入：无参考图。
- 提示：按采摘、开果、发酵、日晒、烘焙、研磨、调温、成型展示流程，并对比三类巧克力；16:9、2K。
- 断言：8 个阶段顺序完整；三类巧克力对比存在；中文可读；原文重复了一遍提示词，Fixture 中应去重后只发送一次。

##### MVP-INFO-02：客户旅程地图

- 类型：`REAL`，基础生成回归。
- 提示：展示了解产品、申请试用、首次配置、正式使用、续费推荐五阶段；每阶段包含客户动作、企业触点、关键指标和风险提醒；16:9。
- 断言：5 阶段和 4 个信息维度结构完整；标题正确；阅读路径清晰。

##### MVP-INFO-03：珊瑚白化与海洋酸化科普图

- 类型：`REAL`，扩展验收。
- 提示要点：健康、白化、死亡、骨骼侵蚀四阶段；温度曲线；CO2 酸化链；生物多样性对比；16:9、2K。
- 断言：流程和化学链视觉结构完整；所有科学事实必须由人工核对；测试通过只表示版式能力，不表示内容科学正确。

##### MVP-INFO-04：情绪急救包长图

- 类型：`REAL`，扩展验收。
- 提示要点：识别情绪、身体降温、写下念头、连接他人、决定下一步五模块；专业帮助提醒；柔和且不医疗化。
- 断言：五模块完整且顺序明确；提醒栏存在；建议由人工核对。
- 来源差异：文章正文称最长测试到 1:8，但展示提示写成 16:9。MVP Fixture 使用项目当前支持的 9:16；真正 1:8 归入 `MVP-DEFERRED-02`。

#### F. 人像和本地化

##### MVP-PORTRAIT-01：月夜花园电影人像

- 类型：`REAL`，基础生成回归。
- 提示要点：黑色长发俄罗斯女性、深紫丝绒礼服、夜光蝴蝶、冷暖双侧光、85mm、16:9；禁止文字和水印。
- 断言：主体和关键材质存在；丝绒、银饰、皮肤、头发和透明花瓣质感可区分。

##### MVP-PORTRAIT-02：模特抱猫童趣时尚人像

- 类型：`REAL`，基础生成回归。
- 提示要点：红棕卷发雀斑模特、薰衣草格纹西装、橘白猫、云朵和彩虹、50mm、16:9。
- 断言：人物和猫均完整；毛发、格纹和云朵材质可区分；没有文字、Logo 和水印。

##### MVP-PORTRAIT-03：复古电视室内电影人像

- 类型：`REAL`，基础生成回归。
- 提示要点：中国女性、圆框眼镜、白衬衫裙、泛黄纸张、CRT 电视、龟背竹、50mm 暖侧光、16:9。
- 断言：关键道具位置关系正确；镜片、纸张、显像管和叶片材质可区分。

##### MVP-PORTRAIT-04：上传人像转真实棚拍头像

- 类型：`REAL`，MVP 阻断。
- 输入：唯一人物参考，角色 `identity`。
- 提示要点：白到浅灰背景、85 至 100mm、正面柔光、短波波头、自然妆容；严格保持脸型、五官、骨相、年龄感和真实皮肤；禁止换脸、过度磨皮和通用网红脸。
- 断言：身份保持优先于风格；保留真实皮肤纹理；构图和光线变化命中；不产生明显年龄漂移。

##### MVP-LOCALIZE-01：中文护肤海报本地化为英文

- 类型：`REAL`，MVP 阻断。
- 输入：中文护肤海报母版，角色 `base/layout`。
- 操作：只替换右侧人物和指定英文文字，保持 1:1 画幅、蓝色配色、人物位置、信息框、图标、按钮、字号比例、间距、光影和装饰。
- 断言：版式结构保持；人物替换但姿态、大小和光影一致；只出现指定英文；价格 `$29`、按钮和底部三项信息可读；没有残留中文或新增元素。

#### G. 延期与负向能力测试

##### MVP-DEFERRED-01：真实图层分离

- 类型：`DEFERRED`，不阻断 MVP。
- 原因：文章作者明确说明测试时尚未正式上线，只展示官方动图。
- 启用条件：Provider 明确返回独立图层、透明通道和图层元数据。
- 未来断言：主体、背景、文字和装饰可独立隐藏、移动、缩放、替换和导出透明 PNG；不得用客户端复制平面图伪装图层。

##### MVP-DEFERRED-02：1:8 超长图

- 类型：`DEFERRED`，不阻断 MVP。
- 原因：当前项目只支持 1:1、4:3、16:9、3:4 和 9:16；文章文字与示例提示比例也不一致。
- 当前断言：输入 1:8 时不能静默映射成 16:9；UI 应明确提示不支持或由 Provider capability 开启。

##### MVP-NEGATIVE-01：非法与失效引用

- 类型：`UI`，MVP 阻断。
- 输入：提示词包含不存在的 `@Region99`、属于另一文档的 `@Mark01`、已删除的 `@Image003` 和非法 Hex `#12GG00`。
- 断言：发送前逐项报告；Agent 不创建任务；不得自动把失效引用当作普通文本继续付费生成。

##### MVP-NEGATIVE-02：参考角色冲突

- 类型：`UI`，MVP 阻断。
- 输入：两张附件同时声明为最高优先级产品结构参考，且结构明显冲突。
- 断言：发送前要求用户或 Agent 产生显式优先级；编译摘要不允许无提示地合并冲突约束。

### 13.7 MVP 最小付费回归集

文章案例全部保留，但每次发布不需要运行所有付费测试。默认最小集选择能覆盖不同协议面的 8 条：

1. `MVP-EDIT-01`：Region 精准编辑。
2. `MVP-EDIT-03`：Mark + Hex 色值。
3. `MVP-EDIT-04`：色卡与多参考角色。
4. `MVP-REF-04`：草图构图控制。
5. `MVP-REF-06`：人物一致性与动作迁移。
6. `MVP-DESIGN-04`：产品与风格冲突优先级。
7. `MVP-PORTRAIT-04`：人像身份保持。
8. `MVP-LOCALIZE-01`：母版结构与多语种文字替换。

其余 `REAL` 案例在模型升级、Provider 变更、Prompt Compiler 修改或手动全量验收时运行。

### 13.8 测试结果记录模板

```ts
interface MvpImageCaseResult {
  caseId: string;
  caseRevision: number;
  runId: string;
  fixtureId: string;
  sourceEvidence: Array<{
    sourceUrl: string;
    section: string;
    excerptOrImageRef: string;
  }>;
  environment: {
    appVersion: string;
    os: string;
    browser?: string;
    workspaceVersion: number;
  };
  provider: string;
  model: string;
  protocol: "generations" | "edits";
  inputAssetHashes: string[];
  annotationDocumentId?: string;
  operationTrace: Array<{
    step: number;
    action: string;
    expected: string;
    actual: string;
    status: "pass" | "fail" | "blocked" | "not-applicable";
    evidenceAssetId?: string;
  }>;
  capabilityRoute: {
    edits: boolean;
    multiReference: boolean;
    masks: boolean;
    structuredRegions: boolean;
    layers: boolean;
    fallbackUsed?: "overlay" | "expanded-prompt";
  };
  compiledPrompt: string;
  compiledPromptHash: string;
  params: GenerationParams;
  startedAt: string;
  durationMs: number;
  estimatedCost?: number;
  providerResponseId?: string;
  outputAssetIds: string[];
  assertions: Array<{
    name: string;
    status: "pass" | "fail" | "not-applicable";
    note?: string;
  }>;
  scores: {
    targetAccuracy?: 1 | 2 | 3 | 4 | 5;
    preservation?: 1 | 2 | 3 | 4 | 5;
    identityOrProductConsistency?: 1 | 2 | 3 | 4 | 5;
    textAccuracy?: 1 | 2 | 3 | 4 | 5;
    visualQuality?: 1 | 2 | 3 | 4 | 5;
  };
  reviewer?: string;
  reviewedAt?: string;
}
```

测试 Fixture 后续应放入 `tests/fixtures/mvp-image-cases/`，每个目录包含 `case.json`、已获授权的输入图片、Annotation Document 和预期结构断言。不得直接下载并提交文章中的人物、品牌或产品图片，除非确认获得再分发授权。

### 13.9 2026-07-15 MVP 执行记录

本轮使用外部 Microsoft Edge 验证桌面与 `390x844` 移动视口，使用 Demo Provider 覆盖无费用 UI 流程，并使用 `gpt-image-2` 完成最小付费回归集。真实密钥未写入 Workspace、Fixture、报告或源码。

- 46 条稳定 MVP Case 已记录在 `tests/fixtures/mvp-image-cases/cases.json`，每条都能映射到本节的详细定义。
- Edge 已验证附件角色键盘操作、Draw、单点 Mask、可调画笔宽度、Mark 起点箭头、失效引用清理、编译预览、重新生成、同父分支、兄弟方案切换和移动端布局。
- 自动化结果：Vitest 64 条通过；Rust 7 条通过；生产构建通过。
- 真实 API：8/8 返回有效图片并使用多图编辑路由，未触发单 overlay 回退；人工语义判定 6/8 通过。

| Case | 人工结论 | 关键记录 |
| --- | --- | --- |
| `MVP-EDIT-01` | 通过 | 两个 Region 命中；主体保持分 4/5 |
| `MVP-EDIT-03` | 未通过 | 金色扩散到整张桌面，Mark 局部命中分 1/5 |
| `MVP-EDIT-04` | 通过 | 色卡、结构和干净输出均命中 |
| `MVP-REF-04` | 通过 | 山体、道路、人物和太阳构图命中 |
| `MVP-REF-06` | 通过 | 动作迁移命中；人物一致性分 4/5 |
| `MVP-DESIGN-04` | 未通过 | 产品结构保持，但第三张图的版式和视觉气质未命中 |
| `MVP-PORTRAIT-04` | 通过 | 身份、棚拍背景和皮肤纹理均命中 |
| `MVP-LOCALIZE-01` | 通过 | 版式保持、英文和价格全部可读，无中文残留 |

完整请求参数、输入 Hash、Provider 响应 ID、逐项人工断言和 1 至 5 分保存在本机 `artifacts/plan2-real-regression/report.json`。API 成功与人工语义通过分开记录，避免把 HTTP 200 当作视觉验收通过。

## 14. 验收标准

### 第一阶段验收

1. 用户能从结果图片和 Composer 附件悬停进入 Draw。
2. 可以创建 Mark、Region、Mask 和 Arrow，并得到稳定编号。
3. 画布标签与提示词 Token 可以双向定位。
4. 标注以原图分辨率输出，不因窗口尺寸降低质量。
5. Provider 不支持结构化 Region 时，仍能收到原图、overlay 和编译提示词。
6. 标注草稿重启后可恢复。
7. 旧 Workspace 数据无损迁移。

### 完整功能验收

1. 最多 6 张附件都拥有稳定 Image 标签和角色。
2. 用户能明确产品、人物、动作、材质、色卡、构图和风格来源。
3. Agent 不能创建引用失效对象的任务。
4. 编辑结果保留父版本并能继续产生子版本。
5. 同一父版本可以创建并比较多个方案。
6. 任务失败、重试和恢复不会丢失标注上下文。
7. 客户原图、标注、版本和参考角色全部只保存在本机。

## 15. 非目标

- 第一阶段不实现 Photoshop 级图层系统。
- 不承诺通过点选自动得到像素级主体蒙版。
- 不增加并行生图。
- 不让 Agent 在用户未发送时自动发起付费图片请求。
- 不把客户图片、标注或版本历史上传到目录服务。
- 不为了模仿 Lumina 而改变 Image2 Studio 的本地优先和安全代理边界。

## 16. 风险与决策

### Provider 对 Region/Mark 的理解不稳定

决策：结构化对象保留在客户端，始终提供 overlay 和展开文本；真实 Mask/Region 协议按 Provider 能力渐进启用。

### 自动点选可能被误认为已完成分割

决策：第一阶段点选使用可见点标和备注，界面不展示虚假轮廓。只有得到实际 Mask 后才展示分割边界。

### Fabric JSON 与业务模型耦合

决策：Annotation Object Record 是业务事实来源，Fabric JSON 是可重建的渲染缓存。迁移和测试围绕业务模型进行。

### Workspace 体积继续增长

决策：Data URL、overlay 和大型 Fabric 快照移入 Tauri 文件存储；IndexedDB 只保存索引、文本和轻量几何数据。

### 复杂 Composer 的可访问性

决策：Token 必须有完整可访问名称，支持键盘选择和删除；提供“查看纯文本编译结果”，不能只依赖颜色和画布位置。

### 版本链删除语义复杂

决策：默认隐藏而不是物理删除带子版本的资产。物理删除必须展示受影响版本并由用户明确确认。

## 17. 推荐实施顺序

1. 先完成 Annotation Document V2、Workspace 迁移和原图坐标模型。
2. 再实现工具和稳定编号，确保标注数据可靠。
3. 接入 Annotation Composer、Mention Token 和双向定位。
4. 完成 Prompt Compiler 与 Provider capability 层。
5. 将 Draw 入口接到结果和附件。
6. 增加参考角色、保持约束和 Agent Schema V2。
7. 最后实现版本分支、比较与增强识别。

这个顺序保证每一阶段都能形成可测试的闭环，并避免先做漂亮的交互外壳、后补不可迁移的数据基础。
