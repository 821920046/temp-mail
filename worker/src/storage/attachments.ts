/**
 * 附件存储与生命周期管理（P0）。
 * - 写入时打上过期时间戳（custom metadata）。
 * - 由 cron 定时扫描并清理过期对象（见 cron.ts）。
 */
import type { Env } from "../env"
import { getConfig } from "../config"

export async function putAttachment(
	env: Env,
	key: string,
	bytes: Uint8Array,
	contentType: string,
): Promise<void> {
	const ttlMs = getConfig(env).attachmentTtlMs
	const expiresAt = Date.now() + ttlMs
	await env.ATTACHMENTS.put(key, bytes, {
		httpMetadata: { contentType },
		customMetadata: { expiresAt: String(expiresAt) },
	})
}

/** 扫描并删除过期附件/原始邮件。返回删除数量。 */
export async function cleanupExpired(env: Env): Promise<number> {
	let deleted = 0
	let cursor: string | undefined
	const now = Date.now()
	do {
		const page = await env.ATTACHMENTS.list({ cursor, limit: 1000 })
		const toDelete: string[] = []
		for (const obj of page.objects) {
			const exp = Number(obj.customMetadata?.expiresAt ?? 0)
			// 无过期元数据的原始邮件按创建时间 + 保留期判定
			const fallbackExp = obj.uploaded.getTime() + getConfig(env).mailRetentionMs
			if ((exp || fallbackExp) < now) toDelete.push(obj.key)
		}
		if (toDelete.length) {
			await env.ATTACHMENTS.delete(toDelete)
			deleted += toDelete.length
		}
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	return deleted
}
