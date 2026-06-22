/**
 * 定时任务（P0）— 清理过期附件 / 历史邮件 / 限流计数行。
 */
import type { Env } from "./env"
import { cleanupExpired } from "./storage/attachments"
import { purgeOldMails, purgeStaleRateLimits } from "./storage/d1"
import { getConfig } from "./config"

export async function handleScheduled(env: Env): Promise<void> {
	const deletedObjects = await cleanupExpired(env)
	const purgedRows = await purgeOldMails(env, getConfig(env).mailRetentionMs)
	const purgedRl = await purgeStaleRateLimits(env)
	console.log(`[cron] cleaned ${deletedObjects} objects, purged ${purgedRows} mails, ${purgedRl} rate rows`)
}
