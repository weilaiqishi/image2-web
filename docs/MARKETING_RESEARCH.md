# Image2 Studio 宣传站参考调研

调研日期：2026-07-18 至 2026-07-19

调研方式：使用 Microsoft Edge 阅读公开首页的首屏、主导航、生成入口、案例、定价和 FAQ。没有登录、创建账户或绕过网站安全验证。

## 参考站点

### [Image-2](https://image-2.net/)

- 首屏直接放可操作的 Text to Image / Image to Image 生成器，而不是先讲品牌故事。
- 比例、分辨率、输出格式和参考图在同一操作面，降低第一次生成的跳转成本。
- 模板、How it works、Benefits、教程和 FAQ 形成完整的搜索落地页结构。
- 页面检测浏览器语言并提供切换，但英文首页与中文提示混在同一 URL，国际 SEO 仍可进一步拆分。

Image2 Studio 借鉴“先让用户看到真实产品”和完整 FAQ，不复制它以模型、免费额度为核心的定位。

### [Leonardo.Ai](https://leonardo.ai/)

- 用全屏动态视觉和极强的品牌字形建立第一印象，H1 直接定义为 creator-first platform。
- 后续按 Create、Motion、Edit、Upscale 分区，并按设计师、动画师、摄影师、营销人员和开发者切换场景。
- 大量真实结果、艺术家故事与企业案例承担信任证明。

Image2 Studio 借鉴“首屏只讲一个定位”和真实结果证明，但收敛动画与企业叙事，把视觉重点集中在案例画廊和清晰的网关状态信号。

### [AI GPT Image](https://aigptimage.com/)

- 首屏和主体内容优先展示实际生成结果，案例本身承担产品说明与质量证明。
- 图片保留自然横竖比例，并通过紧凑画廊提高单位屏幕的信息量。
- 点击案例后进入大图查看，浏览路径短，不要求用户先理解复杂功能分类。

Image2 Studio 借鉴“案例优先、混合比例、全屏灯箱”，但不复制在线生成入口、促销浮层或冗长 SEO 内容；宣传站仍只负责展示结果并引导到 GitHub 下载。

### [Recraft](https://www.recraft.ai/)

- 首屏使用高质量结果图作为主体，文案强调审美而不是参数数量。
- 导航与页脚为 Image Generator、Vector、Editor、Mockup 等高意图关键词提供独立落地页。
- 大图、短句和明确 CTA 的层级非常直接。

Image2 Studio 借鉴结果先行与高意图信息架构，不照搬黑底霓虹或时尚大片语气。

### [Krea](https://www.krea.ai/)

- 首屏一句话说明完整 Creative AI Suite，并同时提供 Start for free 与 Launch App。
- 用真实输出、模型清单、品牌客户、功能演示和公开价格逐层回答“能做什么、为什么可信、多少钱”。
- “Dead simple UI. No tutorials needed.” 说明复杂模型能力也可以通过短路径连接和清晰默认值降低门槛。

Image2 Studio 借鉴“无需教程”的承诺，但把原因具体化为一次中转配置、自然语言输入、灵感库和串行任务。

### [Ideogram](https://ideogram.ai/)

Edge 访问时出现 Cloudflare 安全验证。调研没有尝试绕过验证，因此没有把当次页面状态作为视觉或交互依据。

## 最终设计取舍

- **核心受众**：已经拥有或准备使用 OpenAI 兼容中转站，希望用网关 Base URL 与 Key 直接使用 `gpt-image-2` 的个人创作者和小团队。
- **页面唯一任务**：让用户理解“填入自己的网关、Key 和模型名，即可获得本地桌面生图工作流”，然后前往 GitHub 下载。
- **首屏信号**：H1 使用产品名 `Image2 Studio`，真实工作区截图全屏铺底，避免概念插画代替产品。
- **记忆点**：`Gateway → Credential Vault → gpt-image-2 → Serial Queue`，把连接、安全和生成路径合并为一个可扫描的产品承诺。
- **双语 SEO**：中文根页面与 `/en/` 英文页面分别输出静态 HTML、canonical、双向 hreflang、Open Graph、FAQ 与 SoftwareApplication JSON-LD。
- **可信边界**：宣传站不接收 Key、不提供在线生成；真实 Key 只保存在桌面系统凭证库，不把未来功能写成已经上线。
- **低成本部署**：Cloudflare Pages 只托管静态宣传页、案例和产品截图，不引入数据库、R2 或 Worker。
