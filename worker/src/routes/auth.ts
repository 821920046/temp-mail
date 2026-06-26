import { Hono } from "hono"
import type { Env } from "../env"
import { signSession, signOneTime, verifyToken } from "../security/jwt"
import { checkRateLimits } from "../security/ratelimit"
import { getConfig } from "../config"

export const auth = new Hono<{ Bindings: Env }>()

/** 凭证登录：返回会话 token。 */
auth.post("/login", async (c) => {
	const ip = c.req.header("cf-connecting-ip") ?? "unknown"
	const rl = await checkRateLimits(c.env, { ip })
	if (!rl.allowed) return c.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, 429)

	const body = await c.req.json<{ mailbox: string }>()
	const mailbox = (body.mailbox ?? "").trim().toLowerCase()
	if (!mailbox) return c.json({ error: "mailbox required" }, 400)
	// 仅允许签发属于自有域名的地址，缩小攻击面（且与入站小写归一保持一致）。
	const domain = mailbox.split("@")[1] ?? ""
	const allowed = getConfig(c.env).domains.map((d) => d.toLowerCase())
	if (!domain || !allowed.includes(domain)) return c.json({ error: "domain not allowed" }, 400)
	const token = await signSession(c.env, { mailbox })
	return c.json({ token })
})

/** 签发一次性自动登录链接。 */
auth.post("/one-time", async (c) => {
	const body = await c.req.json<{ mailbox: string }>()
	const mailbox = (body.mailbox ?? "").trim().toLowerCase()
	if (!mailbox) return c.json({ error: "mailbox required" }, 400)
	const domain = mailbox.split("@")[1] ?? ""
	const allowed = getConfig(c.env).domains.map((d) => d.toLowerCase())
	if (!domain || !allowed.includes(domain)) return c.json({ error: "domain not allowed" }, 400)
	const token = await signOneTime(c.env, mailbox)
	// 用 hash 片段而非 query，避免 token 进入 Referer / 服务器访问日志。
	return c.json({ token, url: `/#token=${token}` })
})

/** 校验 token。 */
auth.get("/me", async (c) => {
	const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
	if (!token) return c.json({ error: "no token" }, 401)
	try {
		const claims = await verifyToken(c.env, token)
		return c.json(claims)
	} catch (e) {
		return c.json({ error: String(e) }, 401)
	}
})
