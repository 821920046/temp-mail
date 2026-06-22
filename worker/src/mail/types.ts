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
}
