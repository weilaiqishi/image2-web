# 里程碑：隐私门控广告发布

完成日期：2026-07-22  
来源分支：`codex/adsense-privacy`（现已合入本地 `main`）
代表提交：`4fc12bb`（`feat: deploy privacy-gated Adsterra banner`）

## 合并前相对 main 更新量

比较范围为合并前的本地 `main`（`202f3b0`）到来源分支功能提交（`4fc12bb`）：

| 指标 | 数量 |
| --- | ---: |
| 领先提交 | 1 |
| 变更文件 | 11 |
| 新增文件 | 3 |
| 修改文件 | 8 |
| 新增行 | 728 |
| 删除行 | 110 |
| 净增行 | 618 |

新增文件均为广告配置或测试：

- `scripts/ad-config.mjs`
- `scripts/ad-config.test.ts`
- `scripts/ad-runtime.test.ts`

其余变更覆盖站点构建与验证、浏览器广告运行时、中英文隐私页、`ads.txt`、Cloudflare 配置和部署文档。

合并前 `origin/main` 位于 `417c28b`，比当时的本地 `main` 多一个提示词目录刷新提交。来源分支与 `origin/main` 从 `202f3b0` 分叉，各自领先 1 个提交；本里程碑只统计广告功能，不把远端目录刷新算入。实际合并时，本地 `main` 已先快进纳入该目录刷新，再合并来源分支。

## 交付结果

### 单提供商构建配置

- `AD_PROVIDER` 只接受 `none`、`adsense` 或 `adsterra`。
- 每次构建最多启用一个提供商，不并发加载，也不自动跨平台回退。
- 配置不完整、值不合法或政策复核标记缺失时，广告自动降级为 `none`。
- `ads.txt` 只输出格式校验通过的公开卖方记录。

### Adsterra 受限接入（2026-08-05 更新）

- 仅允许已批准站点对应的 300x250 Display Banner。
- Placement ID 必须与源码中的固定 Tag 精确匹配，并要求 `ADSTERRA_POLICY_REVIEWED=true`。
- 构建器只把硬编码 Tag 写入中英文首页、指南、案例和排障文章的 8 个既有广告位，不接受任意 HTML、任意脚本 URL 或运行时注入配置。
- 当前不接入 Popunder、Push、Direct Link 或 Social Bar。

### 加载与隐私（2026-08-05 更新）

- Adsterra 两段式 Tag 直接存在于 8 个生产广告页 HTML 中，并在页面解析时立即加载。
- Adsterra 不使用站点同意条、本地存储闸门或重置控件；保留的同意运行时只属于未投产的 AdSense 路径。
- 隐私、关于和 404 页面永久禁止广告。
- 中英文隐私页分别披露 AdSense 与 Adsterra 可能处理的数据及外部政策链接。

### 安全和回归测试

- 配置测试覆盖非法 Provider、Placement、CSP Origin、卖方记录和政策复核状态。
- 运行时测试证明 `site.js` 不含 Adsterra 插入、监视或折叠逻辑，并继续覆盖 AdSense 同意路径。
- 构建验证检查 8 个广告页中的精确 Tag、其他页面零第三方广告资源、无 CSP、模板占位符和 `ads.txt` 输出的一致性。

## 文件分布

| 区域 | 主要变化 |
| --- | --- |
| `scripts/` | 6 个文件受影响，约占变更文件的 45.4%；新增配置解析与两组测试 |
| `site/assets/site.js` | 仅保留未投产 AdSense 路径的版本化同意记录及按需加载运行时 |
| `site/*/privacy/` | 中英文广告提供商披露和加载方式说明 |
| `wrangler.toml` | 预览默认禁用，生产选择经过复核的 Adsterra 配置 |
| `CLOUDFLARE_DEPLOY.md` | 部署变量、合规边界与上线核对项 |

## 验证命令

```bash
npm test
npm run build:site
```

生产上线仍需检查页面源码和浏览器网络面板：两篇排障文章解析时立即请求已批准 Adsterra loader，其他页面不请求广告资源，响应中没有 CSP 且保留其余四个安全响应头。
