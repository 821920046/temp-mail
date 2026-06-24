# Cloudflare 网页端（Dashboard）部署详解（纯免费额度）

> 本文面向不想用命令行的用户，全程在 Cloudflare 后台网页点击完成。所有步骤仅用免费额度。

## 0. 准备
- 一个 Cloudflare 账号（免费）。
- 一个已接入 Cloudflare 的域名（Email Routing 需要域名的 MX 指向 Cloudflare）。
- 代码已推送到 GitHub 仓库（用于 Workers Builds / Pages 自动部署）。

## 1. 创建 D1 数据库
1. Dashboard → **Storage & Databases → D1** → **Create**。
2. 名称填 `temp-mail` → 创建。
3. 进入该数据库 → **Console** 选项卡 → 粘贴 `db/schema.sql` 全部内容 → **Execute** 初始化表结构。

## 2. 创建 KV 命名空间
1. Dashboard → **Storage & Databases → KV** → **Create a namespace**。
2. 名称填 `temp-mail-kv` → 创建。

## 3. 创建 R2 存储桶
1. Dashboard → **R2** → **Create bucket**。
2. 名称填 `temp-mail-attachments` → 创建（免费 10GB）。

## 4. 创建 Worker 并连接 GitHub（Workers Builds）
1. Dashboard → **Workers & Pages → Create → Workers → Import a repository**。
2. 授权并选择你的 GitHub 仓库。
3. 构建配置：
   - Root directory: `worker`
   - Build command: `npm install`（或留空）
   - Deploy command: `npx wrangler deploy`
4. 保存并首次部署。

## 5. 绑定资源（Settings → Bindings）
进入 Worker → **Settings → Bindings → Add**，依次添加：

| 类型 | Variable name | 指向 |
| --- | --- | --- |
| D1 database | `DB` | `temp-mail` |
| KV namespace | `KV` | `temp-mail-kv` |
| R2 bucket | `ATTACHMENTS` | `temp-mail-attachments` |
| Workers AI（可选） | `AI` | — |

> 不需要绑定 Queues 或 Durable Objects——本版本已完全移除这些付费特性。

## 6. 配置环境变量与 Secret（Settings → Variables and Secrets）
- **明文变量（Plaintext）**：`MAIL_DOMAINS`=你的域名、`SEND_PROVIDER`=`none`、`ATTACHMENT_TTL_DAYS`=`3`、`MAIL_RETENTION_DAYS`=`7`。
- **加密 Secret（Encrypt）**：`JWT_SECRET`（强随机）、`ADMIN_PASSWORD`；可选 `RESEND_API_KEY`、`TELEGRAM_BOT_TOKEN`。

## 7. 配置定时触发器（Cron）
- Worker → **Settings → Triggers → Cron Triggers → Add** → 填 `0 */6 * * *`（每 6 小时清理一次）。

## 8. 配置 Email Routing（收件核心）
1. 进入你的域名 → **Email → Email Routing**，按提示添加 MX/SPF 记录并启用。
2. **Email Routing → Routing rules → Catch-all address**。
3. Action 选 **Send to a Worker**，选择你的 `temp-mail` Worker → 保存。
   这样所有发往 `*@你的域名` 的邮件都会进入 Worker 的 `email()` 处理器。

## 9. 部署前端（Cloudflare Pages）
1. Dashboard → **Workers & Pages → Create → Pages → Connect to Git**。
2. 选仓库，构建配置：
   - Framework preset: `Vue`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
3. 环境变量 `VITE_API_BASE` 填你的 Worker 访问域名 → 部署。

## 10. 验证
- 访问 `https://<worker>.workers.dev/health` 应返回 `{ ok: true, tier: "free" }`。
- 向 `任意@你的域名` 发一封测试邮件，几秒后在前端登录该地址应能看到邮件。

## 常见问题
- **收不到邮件**：检查 Email Routing 是否启用、MX 记录是否生效、Catch-all 是否选了 *Send to a Worker*。
- **AI 不可用**：未绑定 `AI` 也没关系，会自动降级为正则提取验证码/分类。
- **限流误伤**：在 `worker/src/config.ts` 调高 `rateLimits` 容量。
