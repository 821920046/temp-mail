/**
 * 发件（免费额度：默认不启用；Resend 有免费额度可选）。
 * 说明：Cloudflare Email Routing 本身不提供任意发件；如需发件可接 Resend
 * （免费额度 100 封/天）。SEND_PROVIDER=none 时仅收不发，零成本。
 */
import type { Env } from "../env"

export interface OutboundMail {
	from: string
	to: string
	subject: string
	text: string
	html?: string
	// 收件人点击“回复”时回到哪个地址（通常即临时邮箱本身）
	replyTo?: string
	// 线程串联：原邮件的 Message-ID
	inReplyTo?: string
	references?: string
}

export async function sendMail(env: Env, mail: OutboundMail): Promise<void> {
	if (env.SEND_PROVIDER === "resend") {
		await sendViaResend(env, mail)
		return
	}
	throw new Error("Sending disabled (SEND_PROVIDER=none)")
}

async function sendViaResend(env: Env, mail: OutboundMail): Promise<void> {
	if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured")

	// 线程串联头：让回复归入原会话（多数客户端据此聚合，也利于避免被判为孤立垃圾邮件）。
	const headers: Record<string, string> = {}
	if (mail.inReplyTo) headers["In-Reply-To"] = mail.inReplyTo
	if (mail.references) headers["References"] = mail.references

	const payload: Record<string, unknown> = {
		from: mail.from,
		to: mail.to,
		subject: mail.subject,
		text: mail.text,
	}
	if (mail.html) payload.html = mail.html
	if (mail.replyTo) payload.reply_to = mail.replyTo
	if (Object.keys(headers).length) payload.headers = headers

	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	})
	if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`)
}
