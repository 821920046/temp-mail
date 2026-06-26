/**
 * Worker 运行时绑定与环境变量类型定义。
 * 全部基于 Cloudflare **免费额度** 服务：Workers / D1 / KV / R2 / Email Routing。
 * 不依赖任何付费特性（无 Queues、无标准 Durable Objects）。
 */

export interface Env {
	// 存储（均免费额度）
	DB: D1Database
	KV: KVNamespace
	ATTACHMENTS: R2Bucket

	// AI（可选：Workers AI 免费额度；未绑定时自动降级为正则提取）
	AI?: Ai

	// 可观测性（可选：未绑定时降级为 console.log）
	METRICS?: AnalyticsEngineDataset

	// Secrets
	JWT_SECRET: string
	ADMIN_PASSWORD: string
	// 站点入口密码（独立于管理员密码）；未设置时回退使用 ADMIN_PASSWORD。
	SITE_PASSWORD?: string
	// 反向代理共享密钥：设置后 Worker 仅接受携带正确 X-Proxy-Secret 的请求（堵死 workers.dev 直连）。
	PROXY_SECRET?: string
	RESEND_API_KEY?: string
	TELEGRAM_BOT_TOKEN?: string

	// Vars
	MAIL_DOMAINS: string
	SEND_PROVIDER: "resend" | "none"
	ATTACHMENT_TTL_DAYS: string
	MAIL_RETENTION_DAYS: string
	// 设为 "1"/"true" 时 API 返回详细错误（仅排查用）；默认返回笼统 500。
	DEBUG_ERRORS?: string
}

/**
 * 入站邮件的后台处理任务（原来走 Queues，现改为 ctx.waitUntil 同进程异步执行）。
 */
export interface ProcessTask {
	rawKey: string // R2 中原始邮件的临时 key
	mailbox: string // 收件人地址
	from: string
	receivedAt: number
}
