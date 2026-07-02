# temp-mail

> 基于 Cloudflare **纯免费额度** 的临时（一次性）域名邮箱服务 —— 在 [dreamhunter2333/cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email) 架构基础上，融合了 **存储架构优化、反滥用 / 安全加固、工程化与可观测性** 的优化版本。
>
> ✅ **完全不依赖任何付费特性**：仅使用 Workers / D1 / KV / R2 / Email Routing 的免费额度即可运行（已移除 Cloudflare Queues 与标准 Durable Objects）。

- 在线演示（自部署示例）：收件域名如 `@agent.kdns.fr` 等
- 前端：Vue 3 + Vite + Tailwind（本地编译，无 CDN 依赖）
- 后端：Cloudflare Workers（Hono + TypeScript）

## ✨ 优化点总览（全部可在免费额度运行）

### 基础架构与安全（v2.1）

| 优先级 | 优化 | 免费实现方式 | 落地位置 |
| --- | --- | --- | --- |
| 🔴 P0 | 入站「快收下 + 后台异步处理」，缩短 Email Worker 同步耗时、降低丢件风险 | `ctx.waitUntil()`（替代付费 Queues） | `worker/src/mail/receive.ts`, `worker/src/mail/process.ts` |
| 🔴 P0 | 收件列表热读取加速，D1 作为可查询权威源 | **KV 热缓存 + D1 回源**（替代付费 DO） | `worker/src/storage/hotcache.ts`, `worker/src/storage/d1.ts` |
| 🔴 P0 | R2 附件 **TTL + 定时清理** 生命周期管理 | R2 + Cron Triggers | `worker/src/storage/attachments.ts`, `worker/src/cron.ts` |
| 🟠 P1 | IP / 域名 / 地址三维 **令牌桶分级限流** | **D1 持久化令牌桶**（替代付费 RateLimiterDO） | `worker/src/security/ratelimit.ts` |
| 🟠 P1 | 发件频率 / 关键词 / 信誉 **实时滥用打分** 与自动隔离 / 封禁 | 纯计算 | `worker/src/security/abuse.ts` |
| 🟠 P1 | JWT / 凭证 **轮转、过期、一次性 token** | WebCrypto | `worker/src/security/jwt.ts` |
| 🟡 P2 | **一键部署** 向导（交互式 CLI + wrangler 脚本） | — | `scripts/setup.mjs`, `scripts/deploy.sh` |
| 🟡 P2 | **测试体系**（Vitest 单测）与 CI | — | `worker/test/*`, `.github/workflows/ci.yml` |
| 🟡 P2 | **可观测性**：指标埋点（默认 console.log，可选接 Analytics Engine） | 可选 | `worker/src/observability/metrics.ts` |
| 🟢 P3 | **AI 增强**：验证码提取 + 邮件分类 / 摘要 / 退订识别 | Workers AI 免费额度，**未绑定时自动降级为正则提取** | `worker/src/ai/extract.ts` |
| 🟢 P3 | 规范 **开放 API + OpenAPI** | — | `worker/src/routes/*`, `openapi.yaml` |

### 安全加固与稳定性（v2.2 新增）

| 类别 | 优化 | 落地位置 |
| --- | --- | --- |
| 🔐 安全 | 密码 / 密钥比较改为 **恒定时间比较**，杜绝时序侧信道 | `worker/src/security/compare.ts` |
| 🔐 安全 | 可选 **站点访问密码（SITE_PASSWORD）** 与 **反代共享密钥（PROXY_SECRET）**，前端先按密码哈希校验 | `worker/src/index.ts`, `frontend/functions/api/[[path]].js` |
| 🔐 安全 | 附件对 HTML / SVG / XHTML 等可内联脚本类型 **强制以二进制下发** + `nosniff`，杜绝存储型 XSS | `worker/src/routes/mailbox.ts` |
| 🔐 安全 | **黑名单（blocklist）发件人拦截**（支持 `*` 通配）+ 发件人频率信号纳入滥用打分 | `worker/src/security/abuse.ts`, `worker/src/storage/d1.ts` |
| 🔐 安全 | 验证码提取 **移除「任意 4–8 位数字」裸兜底**，仅按关键词匹配，避免误判订单号 / 金额 | `worker/src/ai/extract.ts` |
| 📥 数据 | **附件清单持久化到 D1**（`mails.attachments` 列），邮件被热缓存淘汰后仍可列出 / 下载附件 | `worker/src/storage/d1.ts`, `db/migrations/0002_add_attachments.sql` |
| 📥 数据 | 收件箱首页 **KV 热缓存 + D1 合并去重**，修复 KV 读-改-写竞态导致的「丢信不可见」 | `worker/src/routes/mailbox.ts` |
| 📥 数据 | 附件 R2 key **文件名清洗 + 自增序号防碰撞**（前端下载名不受影响） | `worker/src/mail/process.ts` |
| 📥 数据 | 登录成功 **登记地址（addresses 表）**，管理后台 `/stats` 增加 `knownAddresses` 统计 | `worker/src/routes/auth.ts`, `worker/src/routes/admin.ts` |
| 🛠️ 工程 | CI 增加 **前端类型检查** 与 **部署前 `tsc` 门禁**（堵住 esbuild 跳过类型检查直接上线） | `.github/workflows/ci.yml` |
| 🛠️ 工程 | 中间件 / 路由从 `c: any` 收紧为 **Hono 强类型 `Context`** | `worker/src/index.ts` 等 |
| 🛠️ 工程 | 新增 **MIME 解析 / 恒定时间比较单测** | `worker/test/parse.test.ts`, `worker/test/compare.test.ts` |
| 🎨 前端 | Tailwind 由 **CDN 改为 PostCSS 本地编译**，并补齐 `tsconfig.json` 使 `vue-tsc` 类型检查可用 | `frontend/tailwind.config.cjs`, `frontend/postcss.config.cjs`, `frontend/tsconfig.json` |

### 发件 / 回复（v2.3 新增）

| 类别 | 优化 | 落地位置 |
| --- | --- | --- |
| ✉️ 功能 | 临时邮箱收到邮件后可 **直接回复原发件人**（经 Resend 发件） | `worker/src/routes/mailbox.ts`（`POST /reply`）, `worker/src/mail/send.ts`, `frontend/src/App.vue` |
| 🔐 安全 | **仅回复**设计：`from` 强制为当前登录邮箱，`to` 由服务端从原邮件解析，客户端无法任意发信 | `worker/src/routes/mailbox.ts` |
| 🔐 安全 | 按邮箱地址的 **发件限流**（`send` 令牌桶），防滥用 / 保护 Resend 额度 | `worker/src/security/ratelimit.ts`, `worker/src/config.ts` |
| 🧵 体验 | 回复通过 `In-Reply-To` / `References` **串联原会话**（新增 `mails.message_id` 列） | `worker/src/mail/parse.ts`, `db/migrations/0003_add_message_id.sql` |

> 启用方式：将 `worker/wrangler.toml` 的 `SEND_PROVIDER` 设为 `"resend"`，`wrangler secret put RESEND_API_KEY`，并在 Resend 中为每个发件域名完成 SPF/DKIM 验证。部署前记得先跑迁移 `0003_add_message_id.sql`。

## 🏗️ 架构总览（免费额度）

```
外部发件方
   │  (MX)
   ▼
Cloudflare Email Routing ──► Worker(email handler)
                                   │ 1. 入站限流(D1 令牌桶) + 黑名单拦截
                                   │ 2. 原始邮件快速落盘 R2
                                   │ 3. ctx.waitUntil(后台处理) ──► 立即返回
                                   ▼
                            后台异步流水线 (同一次调用内)
   ┌───────────────┬───────────────┼───────────────┬──────────────────┐
   ▼               ▼               ▼               ▼                  ▼
  解析         AI/正则提取     R2附件落盘(TTL)   KV热缓存+D1归档     Telegram推送
                                              (附件清单同步入 D1)
```

## 📦 目录结构

```
temp-mail/
├── worker/                 # Cloudflare Workers 后端（Hono + TypeScript）
│   ├── src/
│   │   ├── index.ts        # 入口：fetch / email / scheduled，含站点密码 / 反代守卫
│   │   ├── mail/           # 收件 / 后台处理 / 解析(MIME) / 发件 / 推送 / 类型
│   │   ├── security/       # 限流(D1) / 反滥用+黑名单 / JWT / 恒定时间比较
│   │   ├── storage/        # R2 附件 / D1 归档 / KV 热缓存
│   │   ├── ai/             # Workers AI 信息提取(可降级正则)
│   │   ├── observability/  # 指标埋点
│   │   ├── cron.ts         # 定时清理（附件 / 邮件 / 限流计数）
│   │   └── routes/         # REST API（auth / mailbox / admin）
│   └── test/               # Vitest 单测（abuse / ratelimit / parse / compare）
├── frontend/               # Vue 3 + Vite + Tailwind(本地编译) 前端
│   ├── tsconfig.json       # 前端类型检查配置（vue-tsc）
│   ├── tailwind.config.cjs / postcss.config.cjs
│   └── functions/          # Cloudflare Pages 反代函数（注入 PROXY_SECRET）
├── smtp_proxy_server/      # (可选, 自托管) Python SMTP/IMAP 代理
├── db/                     # D1 schema 与迁移
│   ├── schema.sql
│   └── migrations/         # 0001_init / 0002_add_attachments
├── scripts/                # 一键部署 / 交互式初始化
└── .github/workflows/      # CI（类型检查 + 测试 + 部署门禁）
```

## 🚀 快速开始（CLI）

```bash
# 1. 安装依赖（pnpm monorepo）
pnpm install

# 2. 创建免费资源并写入 wrangler.toml
npx wrangler d1 create temp-mail
npx wrangler kv namespace create KV
npx wrangler r2 bucket create temp-mail-attachments

# 3. 初始化 D1 表结构
npx wrangler d1 execute temp-mail --remote --file db/schema.sql

# 4. 配置 Secret
npx wrangler secret put JWT_SECRET        # openssl rand -hex 32
npx wrangler secret put ADMIN_PASSWORD
# 可选：私��站点 / 反代加固
# npx wrangler secret put SITE_PASSWORD
# npx wrangler secret put PROXY_SECRET

# 5. 配置收件域名（重要！见下方说明）——写入 worker/wrangler.toml 的 [vars]
#    MAIL_DOMAINS = "yourdomain1.com,yourdomain2.com"

# 6. 本地开发 / 部署
pnpm --filter worker dev
pnpm --filter worker deploy
```

> 📖 **不想用命令行？** 见 `docs/cloudflare-dashboard-deploy.md`，提供全程网页点击式部署步骤。

## ⚙️ 关键配置说明

### 收件域名 `MAIL_DOMAINS`（必须写进 wrangler.toml）

`MAIL_DOMAINS` 是**明文变量（Vars）**。`wrangler deploy` 会以 `worker/wrangler.toml` 的 `[vars]` 为**唯一真相来源**覆盖线上配置——因此**不要只在 Dashboard 里手填**，否则每次部署都会被重置。请直接写进 `wrangler.toml`：

```toml
[vars]
MAIL_DOMAINS = "yourdomain1.com,yourdomain2.com"
SEND_PROVIDER = "none"
ATTACHMENT_TTL_DAYS = "3"
MAIL_RETENTION_DAYS = "7"
```

> 注意：通过 `wrangler secret put` 设置的 **Secret（如 `JWT_SECRET` / `ADMIN_PASSWORD`）不会**被部署覆盖，仅明文 Vars 会。

### 环境变量 / Secret 一览

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | Secret（必填） | 会话签名密钥，建议 ≥32 字节随机值 |
| `ADMIN_PASSWORD` | Secret（必填） | 管理后台 `/api/admin/*` 与 `/health/deep` |
| `SITE_PASSWORD` | Secret（可选） | 私人站点访问密码；留空则站点公开 |
| `PROXY_SECRET` | Secret（可选） | Pages 反代与 Worker 间共享密钥；**需同时在 Pages 与 Worker 设置** |
| `MAIL_DOMAINS` | Vars（必填） | 收件域名，英文逗号分隔 |
| `SEND_PROVIDER` | Vars | `resend` 或 `none`（仅收不发） |
| `RESEND_API_KEY` / `TELEGRAM_BOT_TOKEN` | Secret（可选） | 发件 / 推送 |
| `ATTACHMENT_TTL_DAYS` / `MAIL_RETENTION_DAYS` | Vars | 附件 / 邮件保留天数 |

## 🔁 升级 / 数据库迁移

> ⚠️ **凡是升级到包含数据库结构变更的版本，务必「先跑迁移，再部署 Worker」**，否则新代码引用尚不存在的列会导致接口 500。

**v2.3** 新增了 `mails.message_id` 列（用于回复时的会话串联）。从旧版本升级时，**部署新 Worker 之前**先执行：

```bash
npx wrangler d1 execute temp-mail --file db/migrations/0003_add_message_id.sql --remote
```

**v2.2** 新增了 `mails.attachments` 列。从更早的版本升级时，**部署新 Worker 之前**先执行：

```bash
npx wrangler d1 execute temp-mail --file db/migrations/0002_add_attachments.sql --remote
```

或在 Cloudflare 控制台 D1 → `temp-mail` → Console 执行：

```sql
ALTER TABLE mails ADD COLUMN attachments TEXT;
ALTER TABLE mails ADD COLUMN message_id TEXT;
```

## 💸 免费额度说明

| 服务 | 免费额度（个人足够） |
| --- | --- |
| Workers | 10 万请求/天 |
| D1 | 5GB 存储，5 百万行读/天，10 万行写/天 |
| KV | 10 万读/天，1000 写/天 |
| R2 | 10GB 存储，免出口费 |
| Email Routing | 免费 |
| Workers AI | 每日免费 Neurons 额度（可选，超出 / 未绑定自动降级正则） |

## 🤖 AI Agent 集成

内置对 AI Agent 友好的接口（详见 `AGENTS.md`）：

- `POST /api/auth/one-time` — 为指定邮箱生成一次性访问 token（默认 10 分钟过期、用后即焦）。
- `GET  /api/mailbox/mails` — 拉取最新邮件，含 AI / 正则提取的 `code`（验证码）/ `category` 等字段。

## 许可证

MIT。本项目仅供学习与个人用途，请勿用于任何违法行为。
