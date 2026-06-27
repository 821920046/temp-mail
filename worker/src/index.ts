/**
 * temp-mail Worker 入口（全免费额度架构）
 * - fetch:     REST API（Hono）
 * - email:     入站邮件（快收下 + ctx.waitUntil 后台异步处理）
 * - scheduled: 定时清理
 *
 * 说明：不使用 Cloudflare Queues / 标准 Durable Objects 等付费特性。
 */
import { Hono } from "hono"
import type { Context, Next } from "hono"
import type { Env } from "./env"
import { getConfig } from "./config"
import { handleEmail } from "./mail/receive"
import { handleScheduled } from "./cron"
import { auth } from "./routes/auth"
import { mailbox } from "./routes/mailbox"
import { admin } from "./routes/admin"
import { safeEqual } from "./security/compare"
import { checkSiteLoginLimit } from "./security/ratelimit"

const app = new Hono<{ Bindings: Env }>()

type Ctx = Context<{ Bindings: Env }>

function getSitePassword(c: Ctx): string | undefined {
	// 站点入口密码优先使用独立的 SITE_PASSWORD；未设置时回退到 ADMIN_PASSWORD（向后兼容）。
	// 同时去掉首尾空格/换行，避免复制 Secret 时带入不可见字符导致 401。
	return (c.env.SITE_PASSWORD?.trim() || c.env.ADMIN_PASSWORD?.trim()) || undefined
}

function sitePasswordOk(c: Ctx): boolean {
	const expected = getSitePassword(c)
	if (!expected) return false
	const headerPassword = c.req.header("x-site-password")?.trim()
	return !!headerPassword && safeEqual(headerPassword, expected)
}

// 管理员鉴权：仅使用 ADMIN_PASSWORD，恒定时间比较。
function adminOk(c: Ctx): boolean {
	const expected = c.env.ADMIN_PASSWORD?.trim()
	if (!expected) return false
	const pw = c.req.header("x-admin-password")?.trim()
	return !!pw && safeEqual(pw, expected)
}

// 反向代理守卫：设置了 PROXY_SECRET 时，仅接受携带正确 X-Proxy-Secret 的请求，
// 堵死直接访问 workers.dev 绕过 Pages 密码门的路径。未设置则不强制（避免误锁）。
async function proxyGuard(c: Ctx, next: Next) {
	const expected = c.env.PROXY_SECRET?.trim()
	if (expected) {
		const got = c.req.header("x-proxy-secret")?.trim()
		if (!got || !safeEqual(got, expected)) {
			return c.json({ error: "direct access denied" }, 403)
		}
	}
	await next()
}

// 站点密码中间件：保护“签发 token”与“读邮件”的所有接口。
async function requireSitePassword(c: Ctx, next: Next) {
	if (!sitePasswordOk(c)) return c.json({ error: "site password required" }, 401)
	await next()
}

// 统一错误处理：把笼统的 500 变成可读的具体错误，便于排查（如缺表 / 缺 Secret）。
app.onError((err, c) => {
	console.error("[API ERROR]", err)
	// 默认返回笼统错误，避免泄露内部细节（DB / Secret 等）。
	// 排查期可设 Var DEBUG_ERRORS="1" 返回详细信息。
	const debug = c.env.DEBUG_ERRORS === "1" || c.env.DEBUG_ERRORS === "true"
	if (debug) {
		return c.json(
			{ error: String((err as Error)?.message ?? err), name: (err as Error)?.name },
			500,
		)
	}
	return c.json({ error: "internal error" }, 500)
})

app.get("/", (c) => c.json({
	ok: true,
	name: "temp-mail",
	message: "Worker is running. Frontend lives on Cloudflare Pages.",
	endpoints: ["/health", "/health/deep", "/api/site/login", "/api/domains", "/api/auth/login", "/api/mailbox/mails"],
}))

app.get("/health", (c) => c.json({ ok: true, name: "temp-mail", version: "2.2.0", tier: "free" }))

// 深度自检：报告关键绑定与初始化状态，便于定位 500。需管理员密码（X-Admin-Password）。
app.get("/health/deep", async (c) => {
	if (!adminOk(c)) return c.json({ error: "forbidden" }, 403)
	const out: Record<string, unknown> = {
		jwtSecret: Boolean(c.env.JWT_SECRET),
		adminPassword: Boolean(c.env.ADMIN_PASSWORD),
		sitePassword: Boolean(c.env.SITE_PASSWORD || c.env.ADMIN_PASSWORD),
		sitePasswordSource: c.env.SITE_PASSWORD ? "SITE_PASSWORD" : c.env.ADMIN_PASSWORD ? "ADMIN_PASSWORD" : null,
		proxySecret: Boolean(c.env.PROXY_SECRET),
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

// 全局 /api 守卫：反代密钥校验（设置 PROXY_SECRET 后生效）。
app.use("/api/*", proxyGuard)
// “签发 token”与“读邮件”的接口必须先过站点密码门。
app.use("/api/auth/*", requireSitePassword)
app.use("/api/mailbox/*", requireSitePassword)

// 站点入口密码验证（独立 SITE_PASSWORD，回退 ADMIN_PASSWORD）+ 严格限流防爆破。
app.post("/api/site/login", async (c) => {
	const ip = c.req.header("cf-connecting-ip") ?? "unknown"
	const rl = await checkSiteLoginLimit(c.env, ip)
	if (!rl.allowed) return c.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, 429)
	const { password } = await c.req.json<{ password?: string }>()
	const expected = getSitePassword(c)
	if (!expected) return c.json({ error: "site password not configured" }, 500)
	if (!password || !safeEqual(password.trim(), expected)) return c.json({ error: "invalid password" }, 401)
	return c.json({ ok: true })
})

// 返回后台配置的可用收件域名（供前端生成页选择）。需先通过站点密码验证。
app.get("/api/domains", (c) => {
	if (!sitePasswordOk(c)) return c.json({ error: "site password required" }, 401)
	return c.json({ domains: getConfig(c.env).domains })
})

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
