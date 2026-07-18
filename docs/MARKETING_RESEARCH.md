# Image2 Studio 宣传站参考调研

调研日期：2026-07-18

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

Image2 Studio 借鉴“首屏只讲一个定位”和真实结果证明，但收敛动画与企业叙事，把视觉风险集中在家庭接力带。

### [Recraft](https://www.recraft.ai/)

- 首屏使用高质量结果图作为主体，文案强调审美而不是参数数量。
- 导航与页脚为 Image Generator、Vector、Editor、Mockup 等高意图关键词提供独立落地页。
- 大图、短句和明确 CTA 的层级非常直接。

Image2 Studio 借鉴结果先行与高意图信息架构，不照搬黑底霓虹或时尚大片语气。

### [Krea](https://www.krea.ai/)

- 首屏一句话说明完整 Creative AI Suite，并同时提供 Start for free 与 Launch App。
- 用真实输出、模型清单、品牌客户、功能演示和公开价格逐层回答“能做什么、为什么可信、多少钱”。
- “Dead simple UI. No tutorials needed.” 与家庭低门槛场景高度相关。

Image2 Studio 借鉴“无需教程”的承诺，但把原因具体化为一次中转配置、自然语言输入、灵感库和串行任务。

### [Ideogram](https://ideogram.ai/)

Edge 访问时出现 Cloudflare 安全验证。调研没有尝试绕过验证，因此没有把当次页面状态作为视觉或交互依据。

## 最终设计取舍

- **唯一受众**：已经购买或维护 OpenAI 兼容中转、想替家人处理技术配置的人。
- **页面唯一任务**：让他理解“在家人的电脑上配置一次，以后家人只面对日常语言和图片结果”，然后进入演示或 GitHub。
- **首屏信号**：H1 使用产品名 `Image2 Studio`，真实工作区截图全屏铺底，避免概念插画代替产品。
- **记忆点**：`Relay → Vault → Family → Image` 家庭接力带，把系统边界和用户旅程合并为一个可扫描组件。
- **双语 SEO**：中文根页面与 `/en/` 英文页面分别输出静态 HTML、canonical、双向 hreflang、Open Graph、FAQ 与 SoftwareApplication JSON-LD。
- **可信边界**：公开 Web 版本明确标记为模拟演示；真实 Key 只保存在桌面系统凭证库，不把未来功能写成已经上线。
- **低成本部署**：Cloudflare Pages 只托管静态宣传站和 Demo，不引入数据库、R2 或 Worker。
