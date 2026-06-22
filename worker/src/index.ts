/**
 * temp-mail Worker 入口（全免费额度架构）
 * - fetch:     REST API（Hono）
 * - email:     入站邮件（快收下 + ctx.waitUntil 后台异步处理）
 * - scheduled: 定时清理
 *
 * 说明：不使用 Cloudflare Queues / 标准 Durable Objects 等付费特性。
 */
import { Hono } from "hono"
import type { Env } from "./env"
import { handleEmail } from "./mail/receive"
import { handleScheduled } from "./cron"
import { auth } from "./routes/auth"
import { mailbox } from "./routes/mailbox"
import { admin } from "./routes/admin"

const app = new Hono<{ Bindings: Env }>()

app.get("/health", (c) => c.json({ ok: true, name: "temp-mail", version: "2.1.0", tier: "free" }))
app.route("/api/auth", auth)
app.route("/api/mailbox", mailbox)
app.route("/api/admin", admin)

export default {
	fetch: app.fetch,

	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		await handleEmail(message, env, ctx)
	},

	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(handleScheduled(env))
	},
}
