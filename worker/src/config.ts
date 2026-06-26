import type { Env } from "./env"

/** 集中管理可调参数，便于统一维护与测试。 */
export function getConfig(env: Env) {
	return {
		domains: env.MAIL_DOMAINS.split(",").map((d) => d.trim()).filter(Boolean),
		attachmentTtlMs: Number(env.ATTACHMENT_TTL_DAYS || "3") * 86_400_000,
		mailRetentionMs: Number(env.MAIL_RETENTION_DAYS || "7") * 86_400_000,
		// 热缓存（KV）保留的最近邮件数
		hotCacheSize: 50,
		// 分级限流阈值（令牌桶，基于 D1 持久化，免费额度可用）
		rateLimits: {
			ip: { capacity: 60, refillPerSec: 1 },
			domain: { capacity: 600, refillPerSec: 10 },
			address: { capacity: 120, refillPerSec: 2 },
			// 站点密码校验：严格限流防爆破（约 5 次突发，之后 ~3 次/分钟）
			site: { capacity: 5, refillPerSec: 0.05 },
		},
		// 滥用打分阈值
		abuse: { blockScore: 80, warnScore: 50 },
		// 单附件最大字节数（默认 10MB），超过则跳过落盘，防止 R2 被塞满
		maxAttachmentBytes: 10 * 1024 * 1024,
	} as const
}
