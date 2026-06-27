/**
 * D1 权威源（免费额度）— 热数据在 KV 缓存，D1 存可查询的完整历史记录。
 */
import type { Env } from "../env"
import type { MailMeta, AttachmentMeta } from "../mail/types"

export async function archiveMail(env: Env, mailbox: string, meta: MailMeta, rawKey: string): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO mails (id, mailbox, sender, subject, preview, has_attachment, code, category, attachments, raw_key, received_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			meta.attachments && meta.attachments.length ? JSON.stringify(meta.attachments) : null,
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
		`SELECT id, sender AS "from", subject, preview, has_attachment, code, category, attachments, received_at
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
			attachments: string | null
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
		attachments: parseAttachments(r.attachments),
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

/** 安全解析 D1 中存储的附件 JSON 列。 */
function parseAttachments(raw: string | null): AttachmentMeta[] | undefined {
	if (!raw) return undefined
	try {
		const arr = JSON.parse(raw)
		return Array.isArray(arr) ? (arr as AttachmentMeta[]) : undefined
	} catch {
		return undefined
	}
}

/** 统计某发件人在最近时间窗内的来信数量（用于滥用打分）。 */
export async function countRecentFromSender(env: Env, sender: string, withinMs: number): Promise<number> {
	const cutoff = Date.now() - withinMs
	const row = await env.DB
		.prepare(`SELECT COUNT(*) AS n FROM mails WHERE sender = ? AND received_at >= ?`)
		.bind(sender, cutoff)
		.first<{ n: number }>()
	return row?.n ?? 0
}

/** 记录被使用过的邮箱地址（统计/未来归属管理用）；已存在则忽略。 */
export async function recordAddress(env: Env, address: string, userId?: string): Promise<void> {
	await env.DB
		.prepare(`INSERT INTO addresses (address, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(address) DO NOTHING`)
		.bind(address, userId ?? null, Date.now())
		.run()
}

/** 读取黑名单规则（消费 blocklist 表）。 */
export async function loadBlocklistPatterns(env: Env): Promise<Array<{ pattern: string; reason: string | null }>> {
	const rows = await env.DB
		.prepare(`SELECT pattern, reason FROM blocklist`)
		.all<{ pattern: string; reason: string | null }>()
	return rows.results ?? []
}
