# Changelog

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
