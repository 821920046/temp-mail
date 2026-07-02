# Changelog

## v2.3.0 — 发件 / 回复功能（Resend）

### 功能
- 新增 **回复收到的邮件** 能力：随机生成临时邮箱并收到邮件后，可直接在详情页回复。
- 通过 **Resend API** 发件（`SEND_PROVIDER=resend` + `RESEND_API_KEY`）；`none` 时仅收不发，零成本。
- 新增后端接口 `POST /api/mailbox/reply`：**仅回复**，服务端强制 `from = 当前登录临时邮箱`，`to` 从 D1 原邮件发件人解析，客户端无法指定任意收发地址（反垃圾邮件设计）。
- 回复通过 `In-Reply-To` / `References` 头 **串联原邮件会话**（新增 `mails.message_id` 列 + 迁移 `0003_add_message_id.sql`，并在解析阶段提取原始 `Message-ID`）。
- 新增按邮箱地址的 **发件限流**（令牌桶 `send` 维度），避免临时邮箱被当作垃圾邮件网关、烧穿 Resend 免费额度。

### 前端
- 邮件详情页新增 **「写回复」** 面板（主题 + 正文），含发送状态与结果提示。

### 部署注意
- 部署前先执行迁移：`npx wrangler d1 execute temp-mail --file db/migrations/0003_add_message_id.sql --remote`。
- 在 Resend 中为每个用作发件人的 `MAIL_DOMAINS` 域名完成 **SPF / DKIM 验证**，否则发件会失败。

## v2.2.0 — 安全加固 + 稳定性与工程化优化

### 安全
- 密码 / 密钥比较统一改为 **恒定时间比较**（`security/compare.ts`），消除时序侧信道。
- 新增可选 **站点访问密码 `SITE_PASSWORD`** 与 **反代共享密钥 `PROXY_SECRET`**；前端按密码哈希优先校验，Pages 反代注入 `X-Proxy-Secret`。
- 附件对 HTML / SVG / XHTML 等可内联脚本类型 **强制二进制下发** 并加 `nosniff`，杜绝同源存储型 XSS。
- 新增 **黑名单（blocklist）发件人拦截**（支持 `*` 通配），并将发件人频率信号纳入滥用打分。
- 验证码提取 **移除「任意 4–8 位数字」裸兜底**，仅按关键词匹配，避免把订单号 / 金额误判为验证码。
- JWT 会话默认有效期收敛为 6 小时；管理 / 站点登录增加专用限流。

### 数据 / 功能
- **附件清单持久化到 D1**（新增 `mails.attachments` 列 + 迁移 `0002_add_attachments.sql`），邮件被热缓存淘汰后仍可列出 / 下载附件。
- 收件箱首页改为 **KV 热缓存 + D1 合并去重**，修复 KV 读-改-写竞态导致的「丢信不可见」。
- 附件 R2 key 增加 **文件名清洗 + 自增序号防碰撞**（前端下载名不受影响）。
- 登录成功 **登记地址到 `addresses` 表**；管理后台 `/stats` 增加 `knownAddresses` 统计。

### 工程 / 前端
- CI 增加 **前端类型检查** 与 **部署前 `tsc` 门禁**；补齐 `frontend/tsconfig.json` 使 `vue-tsc` 可用。
- Worker 中间件 / 路由从 `c: any` 收紧为 **Hono 强类型 `Context`**。
- 新增 **MIME 解析 / 恒定时间比较单测**（`test/parse.test.ts`、`test/compare.test.ts`）。
- 前端 Tailwind 由 **CDN 改为 PostCSS 本地编译**（`tailwind.config.cjs` / `postcss.config.cjs`）。
- `wrangler.toml` 增加 R2 Object lifecycle 建议注释，明确 `MAIL_DOMAINS` 应以 `[vars]` 为源头。

### 升级提示
- **先跑迁移再部署**：`npx wrangler d1 execute temp-mail --file db/migrations/0002_add_attachments.sql --remote`。

## v2.1.0 — 纯免费额度重构（移除一切付费特性）

### 重大变更
- **移除 Cloudflare Queues**（付费）：入站邮件改为「快收下 + `ctx.waitUntil()` 后台异步处理」，在同一次调用生命周期内完成解析/AI/附件/归档/推送，零额外成本、不阻塞返回。
- **移除标准 Durable Objects**（付费）：
  - 热数据收件列表改为 **KV 热缓存 + D1 回源**（`storage/hotcache.ts`）。
  - 限流器改为 **D1 持久化令牌桶**（`security/ratelimit.ts`），替代 `RateLimiterDO`。
- **Analytics Engine 改为可选**：默认不绑定，指标降级为 `console.log`；如需看板可在 `wrangler.toml` 取消注释启用。
- **Workers AI 改为可选**：未绑定或调用失败时自动降级为正则提取（验证码/分类/退订），保证纯免费环境可用。
- 新增 `rate_limits` 表（D1）并由 Cron 定期清理过期计数行。

### 结果
- 全部功能仅依赖 Cloudflare **免费额度**：Workers / D1 / KV / R2 / Email Routing（+ 可选免费 Workers AI）。

## v2.0.0 — temp-mail 优化版（基于 cloudflare_temp_email 改造）

### 架构（P0）
- 引入 `MailboxDO`（Durable Object）作为热数据强一致存储，D1 降级为冷归档。
- 引入 Cloudflare Queues，将邮件解析、AI 提取、附件落盘、推送全部异步化。
- 附件增加 TTL 与 `scheduled` 定时清理，避免存储无限增长。

### 安全（P1）
- 新增基于 Durable Object 的 IP/域名/地址三维令牌桶限流。
- 新增实时滥用打分（频率 + 关键词 + 信誉）与自动封禁。
- JWT 支持轮转、过期与一次性 token。

### 工程（P2）
- 新增交互式初始化脚本与一键部署脚本。
- 新增 Vitest 单测与 GitHub Actions CI。
- 新增 Analytics Engine 指标埋点。

### 产品（P3）
- AI 在验证码提取之外，增加邮件分类、摘要、退订识别。
- 提供规范的 REST API 与 OpenAPI 描述。
