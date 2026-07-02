/** 单个附件的元数据（用于前端展示与下载，存入 KV 热缓存）。 */
export interface AttachmentMeta {
	/** R2 对象键，形如 att/{mailbox}/{receivedAt}-{filename}，下载接口直接使用。 */
	key: string
	filename: string
	contentType: string
	/** 字节大小。 */
	size: number
}

/** 邮件元数据（热缓存与 D1 归档共用）。 */
export interface MailMeta {
	id: string
	from: string
	subject: string
	preview: string
	hasAttachment: boolean
	receivedAt: number
	// AI / 正则提取的结构化信息（P3）
	code?: string
	category?: string
	// 附件清单（仅 KV 热缓存携带；附件 TTL 比邮件短，可下载的附件必然在热缓存内）
	attachments?: AttachmentMeta[]
	// 原始邮件 Message-ID（回复时用于 In-Reply-To / References，保持邮件会话串联）
	messageId?: string
}
