# Image2 Studio Cloudflare Pages 部署

这个方案面向个人开发者，目标是让产品宣传站保持零运维：

- Cloudflare Pages 托管中英文宣传页、原创案例与 SEO 文件。
- GitHub 托管源码与桌面安装包。
- 真实图片请求仍由桌面端直接发送到用户配置的 OpenAI 兼容中转。
- API Key 不进入 Pages 环境变量、HTML、JavaScript 包或 GitHub 仓库。

## 构建产物

```bash
npm ci
npm run build:site
```

输出目录为 `dist-site/`：

```text
dist-site/
├── index.html          # 中文宣传页
├── en/index.html       # English landing page
├── cases/              # 中文案例页
├── guide/              # 中文图文操作指南
├── about/              # 项目边界与联系方式
├── privacy/            # 隐私、Cookie 与广告选择说明
├── 404.html            # 真实静态 404，避免 SPA 软回退
├── ads.txt             # 未配置 AdSense 时只有说明注释
├── images/             # Image2 生成案例、产品截图与社交分享图
├── robots.txt
├── sitemap.xml
├── _headers            # Pages 安全响应头
└── _redirects          # 静态站说明
```

`npm run build` 仍输出桌面应用使用的 `dist/`，不会被宣传站替换。

## Cloudflare Pages Git 集成

在 Cloudflare Dashboard 创建 Pages 项目并连接 `weilaiqishi/image2-web`：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build:site` |
| Build output directory | `dist-site` |
| Root directory | `/` |
| Node.js version | `20` |

添加公开的构建变量：

```text
SITE_ORIGIN=https://你的域名
```

`SITE_ORIGIN` 只用于生成 canonical、hreflang、Open Graph 和 sitemap 地址，必须是没有路径和末尾斜杠的 HTTPS Origin，例如 `https://image.example.com`。它不是密钥。

不要创建 `VITE_OPENAI_API_KEY`、`OPENAI_API_KEY` 或任何包含中转密钥的 Pages 变量。Vite 前缀变量会进入浏览器包。

## AdSense 隐私边界

当前生产部署只设置公开的 AdSense 发布商 ID，用于站点验证。构建不会包含 Google 广告脚本地址、广告位 ID 或 Google 广告域名 CSP，也不会显示广告同意控件。

接入分为两个阶段：

1. 站点验证：账号所有者确认 AdSense 条款并取得发布商 ID 后，只配置 `ADSENSE_CLIENT=ca-pub-...`。构建会生成官方 `google-adsense-account` meta 与 `ads.txt` 记录，但不会包含广告脚本、广告位或同意条，也不会请求 Google 广告。由于本项目的 `wrangler.toml` 含 `pages_build_output_dir`，该文件是 Pages 配置的唯一来源；Dashboard 中同名文本变量不会覆盖它。生产值写在 `[env.production.vars]`，顶层 `[vars]` 保持空值，避免预览部署携带验证标记。
2. 开始投放：`image2-studio.pages.dev` 通过站点审核、真实广告位创建、Google 认证 CMP 配置并验证后，再配置 `ADSENSE_SLOT=...` 与 `ADSENSE_CMP_CERTIFIED=true`。三个值全部有效时才会启用广告代码。

`ADSENSE_CMP_CERTIFIED=true` 只是防止误部署的人工闸门，不会安装或替代 CMP。启用前还必须完成隐私页、撤回入口、`ads.txt` 和真实流量回归。Google 当前只支持为 AdSense 使用每次响应随机 nonce 的严格 CSP；纯静态 Pages 无法安全地产生这种 nonce，因此广告启用构建会移除 CSP 响应头，其他安全响应头仍保留。广告禁用和仅验证发布商的构建继续使用 self-only CSP。

`ADSENSE_CLIENT` 和 `ADSENSE_SLOT` 会按 AdSense 规范公开在浏览器广告标记中，不是密钥；不要把它们误写成中转站 API Key。广告采用显式同意后加载，并默认请求非个性化广告。非个性化广告仍可能让 Google 处理 IP、设备、页面、衡量、安全和反作弊所需数据，因此不得宣称“AdSense 完全不获取用户信息”。用户拒绝时，本站不加载 AdSense 脚本，也不向 Google 发起展示广告请求。

## Wrangler 可选部署

需要命令行部署时，可以显式指定构建目录：

```bash
npm run build:site
npx wrangler pages deploy dist-site --project-name image2-studio
```

Wrangler 登录、项目创建和生产发布会改变 Cloudflare 账户状态，应由项目所有者在自己的终端完成。

## 免费套餐边界

当前站点是静态文件，不使用数据库、R2、KV、D1 或 Pages Functions。对个人项目起步，Cloudflare Pages 免费档通常足够；具体额度和条款可能变化，请以 Cloudflare 当前官方说明为准。

宣传站不提供 Web 生成。如果以后要通过浏览器直接进行真实生图，不能把 Key 改成前端变量。需要单独增加同源 Worker 或 Pages Function，并至少完成：

- 把中转 Base URL 与 Key 保存为 Worker Secret。
- 用 Cloudflare Access 邮箱白名单保护受控入口。
- 只允许 `/responses`、`/chat/completions`、`/images/generations` 和 `/images/edits`。
- 增加单用户额度、速率限制、请求大小限制和审计日志。
- 明确浏览器图片持久化、跨用户隔离和串行队列语义。

这些能力不在当前静态宣传站中。

## 上线检查

部署完成后检查：

1. `/` 为中文页面，`/en/` 为英文页面，语言链接可互相切换。
2. 所有主 CTA 都指向 GitHub Releases 或仓库，不出现在线生成入口。
3. `robots.txt`、`sitemap.xml`、8 张生成案例和社交分享图返回 `200`。
4. 页面源码中的 canonical 与实际生产域名一致。
5. 任意不存在的路径返回真实 `404`，不以首页内容和 `200` 伪装成功。
6. 未配置广告时，`/ads.txt` 不含卖方记录，HTML、JavaScript 与 CSP 都不含 Google 广告域名。
7. Cloudflare 响应包含 `_headers` 中的 CSP、`nosniff`、Referrer Policy 与 Permissions Policy。
8. Git 仓库、完整 Git 历史和构建日志中不存在任何 API Key。
