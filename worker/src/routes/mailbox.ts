import { Hono } from "hono"
import type { Env } from "../env"
import { verifyToken } from "../security/jwt"
import { listHot } from "../storage/hotcache"
import { listMailsFromD1 } from "../storage/d1"

export const mailbox = new Hono<{ Bindings: Env }>()

async function requireAuth(c: any): Promise<string | null> {
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
		const hot = await listHot(c.env, addr, limit, 0)
		if (hot.length > 0) return c.json({ source: "hot", mails: hot })
	}

	// 回源 D1
	const mails = await listMailsFromD1(c.env, addr, limit, offset)
	return c.json({ source: "cold", mails })
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
