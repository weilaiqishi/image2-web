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

## Wrangler 可选部署

仓库包含 `wrangler.toml`，已经把 Pages 输出目录设为 `dist-site`。需要命令行部署时：

```bash
npm run build:site
npx wrangler pages deploy dist-site --project-name image2-studio
```

Wrangler 登录、项目创建和生产发布会改变 Cloudflare 账户状态，应由项目所有者在自己的终端完成。

## 免费套餐边界

当前站点是静态文件，不使用数据库、R2、KV、D1 或 Pages Functions。对个人项目起步，Cloudflare Pages 免费档通常足够；具体额度和条款可能变化，请以 Cloudflare 当前官方说明为准。

宣传站不提供 Web 生成。如果以后要通过浏览器直接进行真实生图，不能把 Key 改成前端变量。需要单独增加同源 Worker 或 Pages Function，并至少完成：

- 把中转 Base URL 与 Key 保存为 Worker Secret。
- 用 Cloudflare Access 邮箱白名单保护家庭入口。
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
5. Cloudflare 响应包含 `_headers` 中的 CSP、`nosniff`、Referrer Policy 与 Permissions Policy。
6. Git 仓库和构建日志中不存在任何 API Key。
