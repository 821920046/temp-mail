/**
 * 邮件后台处理流水线（免费额度，由 ctx.waitUntil 驱动）：
 *   解析 → 滥用打分 → AI/正则提取 → 写热缓存(KV) → D1 归档 → 推送
 */
import type { Env, ProcessTask } from "../env"
import type { MailMeta, AttachmentMeta } from "./types"
import { parseEmail } from "./parse"
import { scoreAbuse, matchBlocklist } from "../security/abuse"
import { extractInsights } from "../ai/extract"
import { putAttachment } from "../storage/attachments"
import { archiveMail, countRecentFromSender } from "../storage/d1"
import { pushHot } from "../storage/hotcache"
import { pushNotification } from "./notify"
import { recordMetric } from "../observability/metrics"
import { getConfig } from "../config"

export async function processMail(env: Env, task: ProcessTask): Promise<void> {
	const rawObj = await env.ATTACHMENTS.get(task.rawKey)
	if (!rawObj) return
	const raw = await rawObj.arrayBuffer()

	// 1) 解析
	const parsed = await parseEmail(raw)
	recordMetric(env, "mail_parsed", { domain: task.mailbox.split("@")[1] ?? "" })

	// 2) 滥用打分
	// 黑名单前置拦截（消费 blocklist 表）
	if (await matchBlocklist(env, task.from)) {
		recordMetric(env, "mail_rejected", { reason: "blocklist" })
		await env.ATTACHMENTS.delete(task.rawKey)
		return
	}

	const recentCountFromSender = await countRecentFromSender(env, task.from, 3_600_000)
	const verdict = scoreAbuse(env, {
		from: task.from,
		subject: parsed.subject,
		body: parsed.text,
		recentCountFromSender,
	})
	if (verdict.action === "block") {
		recordMetric(env, "mail_rejected", { reason: "abuse" })
		await env.ATTACHMENTS.delete(task.rawKey)
		return
	}

	// 3) 附件落盘（带 TTL），同时收集元数据供前端列出 / 下载
	const maxAttachmentBytes = getConfig(env).maxAttachmentBytes
	const attachmentsMeta: AttachmentMeta[] = []
	let attIndex = 0
	for (const att of parsed.attachments) {
		// 跳过超大附件，防止 R2 被塞满
		if (att.bytes.length > maxAttachmentBytes) {
			recordMetric(env, "attachment_skipped", { reason: "too_large" })
			continue
		}
		const key = `att/${task.mailbox}/${task.receivedAt}-${attIndex++}-${sanitizeFilename(att.filename)}`
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

/** 清洗附件文件名：仅保留安全字符，去路径分隔与前导点，限制长度，避免畸形 R2 key 与路径穿越。 */
function sanitizeFilename(name: string): string {
	const base = (name || "attachment.bin").split(/[\\/]/).pop() || "attachment.bin"
	const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 100)
	return cleaned || "attachment.bin"
}
