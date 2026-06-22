/**
 * 信息提取（P3）— 优先用 Workers AI（免费额度），未绑定或调用失败时
 * 自动降级为**正则提取**，保证在纯免费环境下也能稳定运行。
 */
import type { Env } from "../env"

export interface MailInsights {
	code?: string // 验证码
	category?: string // 邮件分类
	summary: string // 一句话摘要
	unsubscribeUrl?: string // 退订链接
}

const CODE_RE = /\b(\d{4,8})\b/
const UNSUB_RE = /https?:\/\/\S*(unsubscribe|optout|opt-out)\S*/i

/** 正则提取（降级方案，零成本）。 */
function regexExtract(subject: string, body: string): MailInsights {
	const text = `${subject}\n${body}`
	const codeMatch = text.match(/(?:code|verification|otp|验证码|校验码)[^\d]{0,12}(\d{4,8})/i) ?? text.match(CODE_RE)
	const unsub = text.match(UNSUB_RE)?.[0]
	let category = "general"
	if (/invoice|receipt|payment|账单|发票/i.test(text)) category = "billing"
	else if (/verif|otp|code|验证/i.test(text)) category = "verification"
	else if (/newsletter|unsubscribe|退订|订阅/i.test(text)) category = "newsletter"
	return {
		code: codeMatch?.[1],
		category,
		summary: subject.slice(0, 80) || "(无主题)",
		unsubscribeUrl: unsub,
	}
}

export async function extractInsights(env: Env, subject: string, body: string): Promise<MailInsights> {
	const fallback = regexExtract(subject, body)
	if (!env.AI) return fallback

	try {
		const prompt =
			`你是邮件助手。从下面邮件中提取 JSON：{"code":验证码或null,"category":“verification|billing|newsletter|general”,"summary":一句话中文摘要}。\n` +
			`主题：${subject}\n正文：${body.slice(0, 1500)}`
		const res: any = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
			messages: [{ role: "user", content: prompt }],
			max_tokens: 256,
		})
		const raw = (res?.response ?? "").trim()
		const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)
		const parsed = JSON.parse(json)
		return {
			code: parsed.code ? String(parsed.code) : fallback.code,
			category: parsed.category ?? fallback.category,
			summary: parsed.summary ?? fallback.summary,
			unsubscribeUrl: fallback.unsubscribeUrl,
		}
	} catch {
		return fallback
	}
}
