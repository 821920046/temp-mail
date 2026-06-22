import { Hono } from "hono"
import type { Env } from "../env"

export const admin = new Hono<{ Bindings: Env }>()

function checkAdmin(c: any): boolean {
	const pw = c.req.header("x-admin-password")
	return !!pw && pw === c.env.ADMIN_PASSWORD
}

/** 统计概览。 */
admin.get("/stats", async (c) => {
	if (!checkAdmin(c)) return c.json({ error: "forbidden" }, 403)
	const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM mails`).first<{ n: number }>()
	const mailboxes = await c.env.DB.prepare(
		`SELECT COUNT(DISTINCT mailbox) AS n FROM mails`,
	).first<{ n: number }>()
	return c.json({ totalMails: total?.n ?? 0, mailboxes: mailboxes?.n ?? 0 })
})

/** 手动触发清理。 */
admin.post("/cleanup", async (c) => {
	if (!checkAdmin(c)) return c.json({ error: "forbidden" }, 403)
	const { cleanupExpired } = await import("../storage/attachments")
	const { purgeOldMails } = await import("../storage/d1")
	const { getConfig } = await import("../config")
	const objects = await cleanupExpired(c.env)
	const rows = await purgeOldMails(c.env, getConfig(c.env).mailRetentionMs)
	return c.json({ deletedObjects: objects, purgedRows: rows })
})
