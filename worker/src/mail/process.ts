/**
 * 邮件后台处理流水线（免费额度，由 ctx.waitUntil 驱动）：
 *   解析 → 滥用打分 → AI/正则提取 → 写热缓存(KV) → D1 归档 → 推送
 */
import type { Env, ProcessTask } from "../env"
import type { MailMeta, AttachmentMeta } from "./types"
import { parseEmail } from "./parse"
import { scoreAbuse } from "../security/abuse"
import { extractInsights } from "../ai/extract"
import { putAttachment } from "../storage/attachments"
import { archiveMail } from "../storage/d1"
import { pushHot } from "../storage/hotcache"
import { pushNotification } from "./notify"
import { recordMetric } from "../observability/metrics"

export async function processMail(env: Env, task: ProcessTask): Promise<void> {
	const rawObj = await env.ATTACHMENTS.get(task.rawKey)
	if (!rawObj) return
	const raw = await rawObj.arrayBuffer()

	// 1) 解析
	const parsed = await parseEmail(raw)
	recordMetric(env, "mail_parsed", { domain: task.mailbox.split("@")[1] ?? "" })

	// 2) 滥用打分
	const verdict = scoreAbuse(env, {
		from: task.from,
		subject: parsed.subject,
		body: parsed.text,
	})
	if (verdict.action === "block") {
		recordMetric(env, "mail_rejected", { reason: "abuse" })
		await env.ATTACHMENTS.delete(task.rawKey)
		return
	}

	// 3) 附件落盘（带 TTL），同时收集元数据供前端列出 / 下载
	const attachmentsMeta: AttachmentMeta[] = []
	for (const att of parsed.attachments) {
		const key = `att/${task.mailbox}/${task.receivedAt}-${att.filename}`
		await putAttachment(env, key, att.bytes, att.contentType)
		attachmentsMeta.push({
			key,
			filename: att.filename,
			contentType: att.contentType,
			size: att.bytes.length,
		})
	}

	// 4) AI / 正则提取
	const insights = await extractInsights(env, parsed.subject, parsed.text)

	// 5) 写热缓存（KV）
	const meta: MailMeta = {
		id: crypto.randomUUID(),
		from: parsed.from || task.from,
		subject: parsed.subject,
		preview: parsed.text.slice(0, 140),
		hasAttachment: parsed.attachments.length > 0,
		receivedAt: task.receivedAt,
		code: insights.code,
		category: insights.category,
		attachments: attachmentsMeta,
	}
	await pushHot(env, task.mailbox, meta)

	// 6) D1 归档
	await archiveMail(env, task.mailbox, meta, task.rawKey)

	// 7) 推送（quarantine 不推送）
	if (verdict.action === "accept") {
		await pushNotification(env, task.mailbox, meta, insights)
	} else {
		recordMetric(env, "mail_quarantined", { reason: verdict.reasons.join(",") })
	}

	// 8) 原始 .eml 已解析完毕，删除以节省存储
	await env.ATTACHMENTS.delete(task.rawKey)
}
