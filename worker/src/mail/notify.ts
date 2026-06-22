/**
 * 推送（Telegram / Webhook）— 在后台处理流水线中异步执行。
 */
import type { Env } from "../env"
import type { MailMeta } from "./types"
import type { MailInsights } from "../ai/extract"
import { recordMetric } from "../observability/metrics"

export async function pushNotification(
	env: Env,
	mailbox: string,
	meta: MailMeta,
	insights: MailInsights,
): Promise<void> {
	const chatId = await env.KV.get(`tg:${mailbox}`)
	if (!chatId || !env.TELEGRAM_BOT_TOKEN) return
	const text =
		`📨 ${mailbox}\n` +
		`From: ${meta.from}\n` +
		`主题: ${meta.subject}\n` +
		(insights.code ? `🔑 验证码: ${insights.code}\n` : "") +
		`📝 ${insights.summary}`
	const api = "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage"
	try {
		const res = await fetch(api, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, text }),
		})
		recordMetric(env, res.ok ? "push_sent" : "push_failed")
	} catch {
		recordMetric(env, "push_failed")
	}
}
