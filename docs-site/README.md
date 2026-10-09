# celld 中文文档站

中文译文位于仓库的 `docs/`，对应上游 `denoland/celld` 的 v0.6.2，源码提交为 `90b43017241f81189453d326d05948f388b34652`。全部 20 篇 Markdown、表格、导航、图片说明及两张 SVG 流程图已翻译为简体中文。翻译由当前会话的 LLM 直接完成，没有调用翻译接口。

上游仓库提供 Markdown 文档和 `celld-example` 示例占位标记，没有文档网站的构建器或启动脚本。运行文档站不需要编译 Rust 或启动 celld 引擎。本目录使用 Node.js、Marked 和 highlight.js，将 `docs/` 构建成静态 HTML，再用 Node.js HTTP 服务提供页面。所有前端资源都来自本地，不依赖 CDN。

在仓库根目录运行：

```sh
npm ci --prefix docs-site
npm start --prefix docs-site
```

浏览器访问 <http://127.0.0.1:4173/>。端口可以通过 `PORT` 修改：

```sh
PORT=4180 npm start --prefix docs-site
```

文档页面包含中文导航、本页目录、全文搜索（⌘K / Ctrl+K）、代码高亮和复制按钮，支持系统深色模式。原有英文章节锚点保留，跨文档链接仍可使用。示例标记会从 `examples/` 读取配置与源码并嵌入页面，另提供 15 个本地示例源码页面。示例说明性注释在展示时翻译，源代码文件保持原样。

命令、API 名称、配置键、错误原文和示例输出保留原始写法，避免改变操作方法或示例行为。文档代码中仅三条 SQL 注释翻译成中文。

修改译文或站点文件后，需要重新构建并刷新浏览器；服务器可以继续运行：

```sh
npm run build --prefix docs-site
```

完整性检查：

```sh
npm run check --prefix docs-site
```

该命令会重新构建，随后对照固定的上游提交，检查全部文档的标题数量、列表项、表格行、可执行代码、占位符、英文正文残留、锚点唯一性、所有本地链接与搜索索引。结果保存在 `validation.json`。实际浏览器逐页检查结果保存在 `browser-validation.json`。

构建输出位于 `dist/`，已加入 Git 忽略规则。依赖版本与 `package-lock.json` 固定并纳入源码。

## Cloudflare 发布

线上地址：<https://celld.genhub.me/>，首页直接展示概览，所有文档使用根路径。旧 `/docs/` 和 `/docs/*` 地址会永久跳转到对应的新路径。

站点使用 Cloudflare Workers 静态资源托管，无 Worker 后端脚本。部署设置保存在 `wrangler.jsonc`，指定静态输出目录、中文 404 页面和自定义域名。Cloudflare 自动配置该域名的 DNS 和 HTTPS 证书。

在仓库根目录运行：

```sh
npm ci --prefix docs-site
npm exec --prefix docs-site -- wrangler login
npm run check --prefix docs-site
npm run deploy --prefix docs-site
```

需要使用拥有目标 Cloudflare 账户及 `genhub.me` 域名权限的登录。凭据仅保存在本机 Wrangler 配置中，不写入仓库。GitHub Actions 会在文档变更时检查译文完整性与站内链接；发布使用上述部署命令。

如迁移到其他账户或域名，请修改 `wrangler.jsonc` 中的账户、项目名和域名，并同步修改 `build.mjs` 中的 canonical 域名。
