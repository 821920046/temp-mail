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
}

export async function sendMail(env: Env, mail: OutboundMail): Promise<void> {
	if (env.SEND_PROVIDER === "resend") {
		await sendViaResend(env, mail)
		return
	}
	throw new Error("Sending disabled (SEND_PROVIDER=none)")
}

async function sendViaResend(env: Env, mail: OutboundMail): Promise<void> {
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: mail.from,
			to: mail.to,
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		}),
	})
	if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`)
}
