/**
 * 入站邮件处理（Email Worker handler）— 核心优化点：“快收下 + 后台异步处理”。
 *
 * 免费额度方案：不使用付费的 Queues，而是用 `ctx.waitUntil()` 在同一次调用
 * 的生命周期内后台完成耗时任务，让 email() 快速返回、降低超时丢件风险。
 *
 * 1. 入站限流（P1，D1 令牌桶）
 * 2. 原始邮件快速落盘到 R2（临时 key）
 * 3. ctx.waitUntil(后台处理)，立即返回
 */
import type { Env } from "../env"
import { checkRateLimits } from "../security/ratelimit"
import { recordMetric } from "../observability/metrics"
import { processMail } from "./process"

export async function handleEmail(
	message: ForwardableEmailMessage,
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	const mailbox = message.to.toLowerCase()
	const domain = mailbox.split("@")[1] ?? ""
	const from = message.from.toLowerCase()

	// 1) 入站限流
	const rl = await checkRateLimits(env, { domain, address: mailbox })
	if (!rl.allowed) {
		recordMetric(env, "mail_rejected", { reason: "rate_limit", domain })
		message.setReject("Rate limit exceeded")
		return
	}

	// 2) 原始邮件落盘 R2
	const rawKey = `raw/${mailbox}/${Date.now()}-${crypto.randomUUID()}.eml`
	const raw = await new Response(message.raw).arrayBuffer()
	await env.ATTACHMENTS.put(rawKey, raw, {
		httpMetadata: { contentType: "message/rfc822" },
	})
	recordMetric(env, "mail_received", { domain })

	// 3) 后台异步处理（不阻塞返回）
	ctx.waitUntil(
		processMail(env, { rawKey, mailbox, from, receivedAt: Date.now() }).catch((err) => {
			console.error("[processMail] failed:", err)
			recordMetric(env, "parse_failed", { reason: String(err) })
		}),
	)
}
