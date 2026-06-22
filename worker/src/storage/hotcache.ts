/**
 * 热缓存（免费额度）— 用 KV 保存每个邮箱「最近邮件列表」，加速前端读取。
 *
 * 设计：原本计划用标准 Durable Objects 做热存储（付费），现改为
 * 「KV 热缓存 + D1 权威源」的免费方案：读优先走 KV，未命中回源 D1。
 * KV 是最终一致，但对「最近邮件列表」场景完全够用。
 */
import type { Env } from "../env"
import type { MailMeta } from "../mail/types"
import { getConfig } from "../config"

function hotKey(mailbox: string): string {
	return `hot:${mailbox}`
}

/** 追加一封新邮件到热缓存，并保持上限与 TTL。 */
export async function pushHot(env: Env, mailbox: string, meta: MailMeta): Promise<void> {
	const cfg = getConfig(env)
	const key = hotKey(mailbox)
	const list = ((await env.KV.get(key, "json")) as MailMeta[] | null) ?? []
	list.unshift(meta)
	if (list.length > cfg.hotCacheSize) list.length = cfg.hotCacheSize
	await env.KV.put(key, JSON.stringify(list), {
		expirationTtl: Math.max(60, Math.floor(cfg.mailRetentionMs / 1000)),
	})
}

/** 读热缓存（分页）。 */
export async function listHot(
	env: Env,
	mailbox: string,
	limit = 20,
	offset = 0,
): Promise<MailMeta[]> {
	const list = ((await env.KV.get(hotKey(mailbox), "json")) as MailMeta[] | null) ?? []
	return list.slice(offset, offset + limit)
}

/** 清空热缓存。 */
export async function clearHot(env: Env, mailbox: string): Promise<void> {
	await env.KV.delete(hotKey(mailbox))
}
