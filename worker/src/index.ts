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
import { getConfig } from "./config"
import { handleEmail } from "./mail/receive"
import { handleScheduled } from "./cron"
import { auth } from "./routes/auth"
import { mailbox } from "./routes/mailbox"
import { admin } from "./routes/admin"

const app = new Hono<{ Bindings: Env }>()

// 统一错误处理：把笼统的 500 变成可读的具体错误，便于排查（如缺表 / 缺 Secret）。
app.onError((err, c) => {
	console.error("[API ERROR]", err)
	return c.json(
		{ error: String((err as Error)?.message ?? err), name: (err as Error)?.name },
		500,
	)
})

app.get("/health", (c) => c.json({ ok: true, name: "temp-mail", version: "2.1.0", tier: "free" }))

// 深度自检：报告关键绑定与初始化状态，便于定位 500。无需鉴权，可直接在浏览器打开。
app.get("/health/deep", async (c) => {
	const out: Record<string, unknown> = {
		jwtSecret: Boolean(c.env.JWT_SECRET),
		adminPassword: Boolean(c.env.ADMIN_PASSWORD),
		mailDomains: c.env.MAIL_DOMAINS ?? null,
		bindings: {
			DB: Boolean(c.env.DB),
			KV: Boolean(c.env.KV),
			ATTACHMENTS: Boolean(c.env.ATTACHMENTS),
			AI: Boolean(c.env.AI),
		},
	}
	try {
		await c.env.DB.prepare("SELECT 1 FROM rate_limits LIMIT 1").all()
		out.rateLimitsTable = true
	} catch (e) {
		out.rateLimitsTable = String((e as Error)?.message ?? e)
	}
	try {
		await c.env.DB.prepare("SELECT 1 FROM mails LIMIT 1").all()
		out.mailsTable = true
	} catch (e) {
		out.mailsTable = String((e as Error)?.message ?? e)
	}
	return c.json(out)
})

// 公开：返回后台配置的可用收件域名（供前端随机生成邮箱地址）。不查 D1，不需鉴权。
app.get("/api/domains", (c) => c.json({ domains: getConfig(c.env).domains }))

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
