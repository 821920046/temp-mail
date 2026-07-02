import { Hono } from "hono"
import type { Context } from "hono"
import type { Env } from "../env"
import type { MailMeta } from "../mail/types"
import { verifyToken } from "../security/jwt"
import { listHot } from "../storage/hotcache"
import { listMailsFromD1, getMailById } from "../storage/d1"
import { sendMail } from "../mail/send"
import { checkSendLimit } from "../security/ratelimit"

export const mailbox = new Hono<{ Bindings: Env }>()

type Ctx = Context<{ Bindings: Env }>

async function requireAuth(c: Ctx): Promise<string | null> {
	const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
	if (!token) return null
	try {
		const claims = await verifyToken(c.env, token)
		return claims.mailbox
	} catch {
		return null
	}
}

/** 读取邮箱列表（优先 KV 热缓存，未命中回源 D1）。 */
mailbox.get("/mails", async (c) => {
	const addr = await requireAuth(c)
	if (!addr) return c.json({ error: "unauthorized" }, 401)
	const limit = Number(c.req.query("limit") ?? "20")
	const offset = Number(c.req.query("offset") ?? "0")

	// 热缓存（仅首页）
	if (offset === 0) {
		// 合并 KV 热缓存与 D1 首页结果并按 id 去重：既享受热缓存加速，
		// 又避免 KV 读-改-写竞态导致的“丢信不可见”。
		const [hot, cold] = await Promise.all([
			listHot(c.env, addr, limit, 0),
			listMailsFromD1(c.env, addr, limit, 0),
		])
		const merged = mergeById(hot, cold).slice(0, limit)
		return c.json({ source: hot.length ? "hot+cold" : "cold", mails: merged })
	}

	// 回源 D1
	const mails = await listMailsFromD1(c.env, addr, limit, offset)
	return c.json({ source: "cold", mails })
})

/**
 * 回复某封收到的邮件（通过 Resend 发件）。
 * 安全设计（仅回复，不允许任意发信）：
 *  - from 强制为当前登录的临时邮箱（取自 JWT），永不信任客户端传入的 from。
 *  - to 由服务端从 D1 中该邮件的原始发件人解析，客户端只能传 id / 正文 / 可选主题。
 *  - 因此只能“回复曾经给你写信的人”，从根源上杜绝把临时邮箱当垃圾邮件网关。
 */
mailbox.post("/reply", async (c) => {
	const addr = await requireAuth(c)
	if (!addr) return c.json({ error: "unauthorized" }, 401)

	// 仅在配置了 Resend 时开放发件
	if (c.env.SEND_PROVIDER !== "resend") {
		return c.json({ error: "sending_disabled", detail: "SEND_PROVIDER 未设置为 resend" }, 400)
	}
	if (!c.env.RESEND_API_KEY) {
		return c.json({ error: "not_configured", detail: "缺少 RESEND_API_KEY" }, 400)
	}

	// 发件限流：防止把临时邮箱当作垃圾邮件网关、避免烧穿 Resend 额度
	const rl = await checkSendLimit(c.env, addr)
	if (!rl.allowed) return c.json({ error: "rate_limited", retryAfterMs: rl.retryAfterMs }, 429)

	const body = await c.req
		.json<{ id?: string; text?: string; html?: string; subject?: string }>()
		.catch(() => ({}) as { id?: string; text?: string; html?: string; subject?: string })
	const id = (body.id ?? "").trim()
	const text = (body.text ?? "").trim()
	if (!id) return c.json({ error: "id_required" }, 400)
	if (!text && !body.html) return c.json({ error: "empty_body" }, 400)

	// 只能回复“确实发给当前邮箱”的邮件：从 D1 取原始发件人，杜绝任意发信
	const original = await getMailById(c.env, addr, id)
	if (!original) return c.json({ error: "mail_not_found" }, 404)

	const to = extractEmail(original.from)
	if (!to) return c.json({ error: "invalid_recipient" }, 400)

	const subject = (body.subject ?? "").trim() || withRePrefix(original.subject)

	try {
		await sendMail(c.env, {
			from: addr,
			to,
			subject,
			text: text || " ",
			html: body.html,
			replyTo: addr,
			inReplyTo: original.messageId,
			references: original.messageId,
		})
	} catch (e) {
		const detail = c.env.DEBUG_ERRORS ? String(e) : undefined
		return c.json({ error: "send_failed", detail }, 502)
	}

	return c.json({ ok: true, to, subject })
})

/** 下载附件。 */
mailbox.get("/attachment/*", async (c) => {
	const addr = await requireAuth(c)
	if (!addr) return c.json({ error: "unauthorized" }, 401)
	let key = c.req.path.replace(/^.*\/attachment\//, "")
	// 文件名可能含空格 / 中文等，前端会对 key 进行编码，这里解码还原。
	try {
		key = decodeURIComponent(key)
	} catch {
		// 保留原始值
	}
	if (!key.startsWith(`att/${addr}/`)) return c.json({ error: "forbidden" }, 403)
	const obj = await c.env.ATTACHMENTS.get(key)
	if (!obj) return c.json({ error: "not found" }, 404)
	const filename = key.slice(key.lastIndexOf("/") + 1)
	const rawType = obj.httpMetadata?.contentType ?? "application/octet-stream"
	// 对可内嵌脚本的类型（HTML / SVG / XHTML）强制以二进制下发，杜绝同源存储型 XSS。
	const risky = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml)/i.test(rawType)
	const safeType = risky ? "application/octet-stream" : rawType
	return new Response(obj.body, {
		headers: {
			"content-type": safeType,
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
			"x-content-type-options": "nosniff",
		},
	})
})

/** 按 id 合并两个邮件列表并去重，偏好携带附件清单的版本，按时间倒序。 */
function mergeById(a: MailMeta[], b: MailMeta[]): MailMeta[] {
	const map = new Map<string, MailMeta>()
	for (const m of [...a, ...b]) {
		const existing = map.get(m.id)
		if (!existing || (!existing.attachments && m.attachments)) map.set(m.id, m)
	}
	return [...map.values()].sort((x, y) => y.receivedAt - x.receivedAt)
}

/** 从 "Name <a@b>" 或 "a@b" 中提取纯邮箱地址；无法识别则返回空串。 */
function extractEmail(from: string): string {
	const m = /<([^>]+)>/.exec(from || "")
	const raw = (m ? m[1] : from || "").trim()
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : ""
}

/** 主题加 Re: 前缀（已有则不重复）。 */
function withRePrefix(subject: string): string {
	const s = (subject || "").trim()
	if (!s) return "Re:"
	return /^re:/i.test(s) ? s : `Re: ${s}`
}
