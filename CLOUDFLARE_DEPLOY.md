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
├── ads.txt             # 只包含经过校验的广告平台卖方记录
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

## 广告提供商与隐私边界

`AD_PROVIDER` 只接受 `none`、`adsense` 或 `adsterra`，预览默认值是 `none`，当前生产值是 `adsterra`。一次构建最多启用一个广告提供商，不做自动失败回退，也不会在同一广告位并发加载两个平台。生产构建保留公开的 AdSense 发布商 ID 和卖方验证记录，但 `AD_PROVIDER=adsterra` 时不会包含或加载 AdSense 广告脚本和广告位。

所有广告页面先输出隐藏且无子节点的 `[data-ad-unit]`。只有配置完整、页面不是 `data-no-ads`，并且用户明确同意后，运行时才会向选定提供商插入广告标签。拒绝或尚未选择时不会产生广告平台请求。隐私、关于和 404 页面永不投放，但隐私页可以管理或撤回已有选择。

同意记录使用 `image2.ads.consent.v2`，接受状态会绑定到具体广告提供商。从旧版本升级或切换提供商时，旧的拒绝会继续生效；旧的同意不会自动授权新增或替换后的广告提供商，用户需要重新选择。

项目所有者已决定对宣传站的所有构建都省略 `Content-Security-Policy` 响应头，包括默认/`none`、Adsterra 和 AdSense；也不使用 `Content-Security-Policy-Report-Only` 或 meta CSP。这个决定仅适用于当前静态宣传站：它没有用户账户、登录状态、传输秘密的表单，也不提供在线图片生成或 API Key 输入。Adsterra 素材会使用平台动态分配且可能轮换的域名，静态 CSP Origin 列表无法准确描述实际资源集合。

省略 CSP 不改变广告授权边界。构建仍只接受固定在源码中的已批准 Adsterra Tag 和与其精确匹配的 placement ID，运行时也不接受任意脚本 URL；Adsterra 和 AdSense 仍只在用户明确同意后请求，拒绝保持零广告请求，`data-no-ads` 页面保持无广告。`_headers` 继续设置 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin` 和限制性的 `Permissions-Policy`。

### Google AdSense

接入分为两个阶段：

1. 站点验证：账号所有者确认 AdSense 条款并取得发布商 ID 后，只配置 `ADSENSE_CLIENT=ca-pub-...`。构建会生成官方 `google-adsense-account` meta 与 `ads.txt` 记录，但不会包含广告脚本、广告位或同意条，也不会请求 Google 广告。由于本项目的 `wrangler.toml` 含 `pages_build_output_dir`，该文件是 Pages 配置的唯一来源；Dashboard 中同名文本变量不会覆盖它。生产值写在 `[env.production.vars]`，顶层 `[vars]` 保持空值，避免预览部署携带验证标记。
2. 开始投放：`image2-studio.pages.dev` 通过站点审核、真实广告位创建、Google 认证 CMP 配置并验证后，再配置 `ADSENSE_SLOT=...` 与 `ADSENSE_CMP_CERTIFIED=true`。三个值全部有效时才会启用广告代码。

`ADSENSE_CMP_CERTIFIED=true` 只是防止误部署的人工闸门，不会安装或替代 CMP。启用前还必须完成隐私页、撤回入口、`ads.txt` 和真实流量回归。

`ADSENSE_CLIENT` 和 `ADSENSE_SLOT` 会按 AdSense 规范公开在浏览器广告标记中，不是密钥；不要把它们误写成中转站 API Key。广告采用显式同意后加载，并默认请求非个性化广告。非个性化广告仍可能让 Google 处理 IP、设备、页面、衡量、安全和反作弊所需数据，因此不得宣称“AdSense 完全不获取用户信息”。用户拒绝时，本站不加载 AdSense 脚本，也不向 Google 发起展示广告请求。

### Adsterra Display Banner

2026 年 7 月 21 日核验的官方资料：

- [发布商页面](https://adsterra.com/publishers/)列出 Banner、Native Banner、Popunder、Social Bar 与 Smartlink 等格式，并公开宣称无流量门槛和较快审核；这些是平台自身陈述，不是本站对审核结果的保证。
- [Banner 官方页面](https://adsterra.com/banner-ads/)确认普通 Display Banner，并要求先添加网站、创建广告单元，再复制后台生成的代码。当前实现只允许这一低干扰展示格式。
- [发布商条款](https://adsterra.com/publishers-terms-managed/)第 4.5 条说明网站批准后才提供 Ad Tag；第 4.7 条禁止未经书面同意修改 Ad Tag 或放入 iframe；第 4.9 条要求披露数据处理，并在使用 Cookie 时提供同意提示。
- [隐私政策](https://adsterra.com/privacy-policy-managed/)说明技术数据可能包含 IP 地址、浏览器、时区和位置、操作系统、访问 URL、页面互动和广告详情。
- 官方发布商页只明确写明 Paxum 的最低余额可为 5 美元；没有在本次核验材料中确认“PayPal 最低 25 美元”，因此项目文档和界面不采用该说法。

生产投放只使用账号后台为 `image2-studio.pages.dev` 批准的真实 Display Banner Tag，并完成以下公开配置：

```text
AD_PROVIDER=adsterra
ADSTERRA_PLACEMENT_ID=后台已批准的 image2-studio.pages.dev 300x250 Banner placement ID
ADSTERRA_ADS_TXT_RECORD=可选；仅在 Adsterra 后台或支持团队明确提供时填写完整卖方记录
ADSTERRA_POLICY_REVIEWED=true
```

完整 Banner Tag、其中的公开广告位 key、脚本地址和 `ads.txt` 行会出现在公开网页或公开标准文件中，不是密码。真实 Tag 已按后台原文固定在构建配置中；环境变量只选择与该 Tag 精确匹配的 placement ID，不能传入任意脚本。不得提供或写入账户密码、Cookie、Token 或登录会话。

当前适配器只接受本次已批准网站后台生成的两段式 300x250 Display Banner Tag：第一段是未经修改的 `atOptions`，第二段是匹配同一公开 key 的 HTTPS loader。构建会严格校验已批准的 placement ID、尺寸、iframe 格式、loader 主机和 key 一致性；任一处缺失或不匹配都会自动保持 `AD_PROVIDER=none`。运行时只在用户明确同意后，按原顺序创建这两段脚本，不接受任意 HTML 或脚本配置。

Adsterra 的固定 loader 可以继续加载由平台选择的 iframe 和其他资源域名；这些 creative 域名是动态的，可能随时间、地区、素材和投放响应变化。历史上观察到某个域名只说明一次广告响应使用过它，不表示该域名可作为长期固定清单，也不会让项目把它接受为运行时 loader 配置。Adsterra 当前不强制 `ads.txt`，因此缺失记录不会阻止 Banner；若后台明确提供卖方记录，项目只发布完整匹配标准格式的原文，畸形内容会被忽略，绝不猜测。

同意后，Adsterra 广告位通过 `data-ad-state` 暴露非敏感运行状态：`loading`、`rendered`、`no-fill` 或 `loader-error`。loader 报错或 10 秒内没有创建 iframe 时，页面会隐藏损坏的广告位并在控制台输出一次警告，不会重试或请求其他提供商。监视器仍会接受 no-fill 或 loader-error 后稍晚到达的 iframe，并将广告位恢复为 `rendered`。

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
6. 未配置广告时，HTML 与 JavaScript 都不含广告平台域名；`/ads.txt` 只保留独立验证通过的公开卖方记录（当前为 Google 发布商验证记录）。
7. Cloudflare 响应不包含 CSP 或 CSP Report-Only，并包含 `_headers` 中的 `nosniff`、`DENY`、Referrer Policy 与 Permissions Policy。
8. Git 仓库、完整 Git 历史和构建日志中不存在任何 API Key。
