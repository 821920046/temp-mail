# temp-mail

> 基于 Cloudflare **纯免费额度** 的临时（一次性）域名邮箱服务 —— 在 [dreamhunter2333/cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email) 架构基础上，融合了 **存储架构优化、反滥用/安全加固、工程化与可观测性** 的优化版本。
>
> ✅ **v2.1 起：完全不依赖任何付费特性**（已移除 Cloudflare Queues 与标准 Durable Objects），仅使用 Workers / D1 / KV / R2 / Email Routing 的免费额度即可运行。

## ✨ 本版本相比原项目的优化点（全部可在免费额度运行）

| 优先级 | 优化 | 免费实现方式 | 落地位置 |
| --- | --- | --- | --- |
| 🔴 P0 | 入站「快收下 + 后台异步处理」，缩短 Email Worker 同步耗时、降低丢件风险 | `ctx.waitUntil()`（替代付费 Queues） | `worker/src/mail/receive.ts`, `worker/src/mail/process.ts` |
| 🔴 P0 | 收件列表热读取加速，D1 作为可查询权威源 | **KV 热缓存 + D1 回源**（替代付费 DO） | `worker/src/storage/hotcache.ts`, `worker/src/storage/d1.ts` |
| 🔴 P0 | R2 附件 **TTL + 定时清理** 生命周期管理 | R2 + Cron Triggers | `worker/src/storage/attachments.ts`, `worker/src/cron.ts` |
| 🟠 P1 | IP/域名/地址三维 **令牌桶分级限流** | **D1 持久化令牌桶**（替代付费 RateLimiterDO） | `worker/src/security/ratelimit.ts` |
| 🟠 P1 | 发件频率/关键词/信誉 **实时滥用打分** 与自动隔离/封禁 | 纯计算 | `worker/src/security/abuse.ts` |
| 🟠 P1 | JWT/凭证 **轮转、过期、一次性 token** | WebCrypto | `worker/src/security/jwt.ts` |
| 🟡 P2 | **一键部署** 向导（交互式 CLI + wrangler 脚本） | — | `scripts/setup.mjs`, `scripts/deploy.sh` |
| 🟡 P2 | **测试体系**（Vitest 单测）与 CI | — | `worker/test/*`, `.github/workflows/ci.yml` |
| 🟡 P2 | **可观测性**：指标埋点（默认 console.log，可选接 Analytics Engine） | 可选 | `worker/src/observability/metrics.ts` |
| 🟢 P3 | **AI 增强**：验证码提取 + 邮件分类/摘要/退订识别 | Workers AI 免费额度，**未绑定时自动降级为正则提取** | `worker/src/ai/extract.ts` |
| 🟢 P3 | 规范 **开放 API + OpenAPI** | — | `worker/src/routes/*`, `openapi.yaml` |

## 🏗️ 架构总览（免费额度）

```
外部发件方
   │  (MX)
   ▼
Cloudflare Email Routing ──► Worker(email handler)
                                   │ 1. 入站限流(D1 令牌桶)
                                   │ 2. 原始邮件快速落盘 R2
                                   │ 3. ctx.waitUntil(后台处理) ──► 立即返回
                                   ▼
                            后台异步流水线 (同一次调用内)
   ┌───────────────┬───────────────┼───────────────┬──────────────────┐
   ▼               ▼               ▼               ▼                  ▼
  解析         AI/正则提取     R2附件落盘(TTL)   KV热缓存+D1归档     Telegram推送
```

## 📦 目录结构

```
temp-mail/
├── worker/                 # Cloudflare Workers 后端（TypeScript）
│   ├── src/
│   │   ├── index.ts        # 入口：fetch / email / scheduled
│   │   ├── mail/           # 收件 / 后台处理 / 解析 / 发件 / 推送 / 类型
│   │   ├── security/       # 限流(D1) / 反滥用 / JWT
│   │   ├── storage/        # R2 附件 / D1 归档 / KV 热缓存
│   │   ├── ai/             # Workers AI 信息提取(可降级)
│   │   ├── observability/  # 指标埋点
│   │   └── routes/         # REST API
│   └── test/               # Vitest 单测
├── frontend/               # Vue 3 + Vite 前端脚手架
├── smtp_proxy_server/      # (可选, 自托管) Python SMTP/IMAP 代理
├── db/                     # D1 schema 与迁移
├── scripts/                # 一键部署 / 交互式初始化
└── .github/workflows/      # CI
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
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PASSWORD

# 5. 本地开发 / 部署
pnpm --filter worker dev
pnpm --filter worker deploy
```

> 📖 **不想用命令行？** 见 `docs/cloudflare-dashboard-deploy.md` 或 Notion 中的《Cloudflare 网页端部署详解》章节，提供全程网页点击式部署步骤。

## 💸 免费额度说明

| 服务 | 免费额度（个人足够） |
| --- | --- |
| Workers | 10 万请求/天 |
| D1 | 5GB 存储，5百万行读/天，10万行写/天 |
| KV | 10 万读/天，1000 写/天 |
| R2 | 10GB 存储，免出口费 |
| Email Routing | 免费 |
| Workers AI | 每日免费 Neurons 额度（可选，超出/未绑定自动降级正则） |

## 许可证

MIT。本项目仅供学习与个人用途，请勿用于任何违法行为。
