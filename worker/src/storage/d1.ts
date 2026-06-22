/**
 * D1 权威源（免费额度）— 热数据在 KV 缓存，D1 存可查询的完整历史记录。
 */
import type { Env } from "../env"
import type { MailMeta } from "../mail/types"

export async function archiveMail(env: Env, mailbox: string, meta: MailMeta, rawKey: string): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO mails (id, mailbox, sender, subject, preview, has_attachment, code, category, raw_key, received_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			meta.id,
			mailbox,
			meta.from,
			meta.subject,
			meta.preview,
			meta.hasAttachment ? 1 : 0,
			meta.code ?? null,
			meta.category ?? null,
			rawKey,
			meta.receivedAt,
		)
		.run()
}

/** 读取某个邮箱的历史邮件（热缓存未命中时回源）。 */
export async function listMailsFromD1(
	env: Env,
	mailbox: string,
	limit = 20,
	offset = 0,
): Promise<MailMeta[]> {
	const rows = await env.DB.prepare(
		`SELECT id, sender AS "from", subject, preview, has_attachment, code, category, received_at
		 FROM mails WHERE mailbox = ? ORDER BY received_at DESC LIMIT ? OFFSET ?`,
	)
		.bind(mailbox, limit, offset)
		.all<{
			id: string
			from: string
			subject: string
			preview: string
			has_attachment: number
			code: string | null
			category: string | null
			received_at: number
		}>()
	return (rows.results ?? []).map((r) => ({
		id: r.id,
		from: r.from,
		subject: r.subject,
		preview: r.preview,
		hasAttachment: !!r.has_attachment,
		receivedAt: r.received_at,
		code: r.code ?? undefined,
		category: r.category ?? undefined,
	}))
}

/** 删除过期历史邮件（cron 调用）。 */
export async function purgeOldMails(env: Env, olderThanMs: number): Promise<number> {
	const cutoff = Date.now() - olderThanMs
	const res = await env.DB.prepare(`DELETE FROM mails WHERE received_at < ?`).bind(cutoff).run()
	return res.meta.changes ?? 0
}

/** 清理过期的限流计数行（cron 调用，避免 rate_limits 表无限增长）。 */
export async function purgeStaleRateLimits(env: Env, idleMs = 86_400_000): Promise<number> {
	const cutoff = Date.now() - idleMs
	const res = await env.DB.prepare(`DELETE FROM rate_limits WHERE updated_at < ?`).bind(cutoff).run()
	return res.meta.changes ?? 0
}
