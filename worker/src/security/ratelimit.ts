/**
 * 分级限流（P1，免费额度）— 基于 **D1 令牌桶**的 IP / 域名 / 地址 三维限流。
 *
 * 设计：原本用 RateLimiterDO（付费）保证强一致；现改为 D1 持久化令牌桶，
 * 单次 take = 1 次读 + 1 次写（upsert）。D1 免费写额度（~10万/天）足以支撑
 * 个人/小型部署；并发一致性略弱于 DO，但对限流场景可接受。
 */
import type { Env } from "../env"
import { getConfig } from "../config"

export type RateScope = "ip" | "domain" | "address" | "site"

export interface RateResult {
	allowed: boolean
	remaining: number
	retryAfterMs: number
	scope?: RateScope
}

async function take(
	env: Env,
	scope: RateScope,
	key: string,
	capacity: number,
	refillPerSec: number,
	cost = 1,
): Promise<RateResult> {
	const scopeKey = `${scope}:${key}`
	const now = Date.now()

	const row = await env.DB.prepare(
		`SELECT tokens, updated_at FROM rate_limits WHERE scope_key = ?`,
	)
		.bind(scopeKey)
		.first<{ tokens: number; updated_at: number }>()

	let tokens = capacity
	if (row) {
		const elapsedSec = (now - row.updated_at) / 1000
		tokens = Math.min(capacity, row.tokens + elapsedSec * refillPerSec)
	}

	let allowed = false
	let retryAfterMs = 0
	if (tokens >= cost) {
		tokens -= cost
		allowed = true
	} else {
		retryAfterMs = Math.ceil(((cost - tokens) / refillPerSec) * 1000)
	}

	await env.DB.prepare(
		`INSERT INTO rate_limits (scope_key, tokens, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(scope_key) DO UPDATE SET tokens = excluded.tokens, updated_at = excluded.updated_at`,
	)
		.bind(scopeKey, tokens, now)
		.run()

	return { allowed, remaining: Math.floor(tokens), retryAfterMs, scope }
}

/** 依次检查多个维度，任一超限则拒绝。 */
export async function checkRateLimits(
	env: Env,
	dims: { ip?: string; domain?: string; address?: string },
): Promise<RateResult> {
	const cfg = getConfig(env).rateLimits
	// 串行执行，避免同一 D1 事务的并发写冲突
	if (dims.ip) {
		const r = await take(env, "ip", dims.ip, cfg.ip.capacity, cfg.ip.refillPerSec)
		if (!r.allowed) return r
	}
	if (dims.domain) {
		const r = await take(env, "domain", dims.domain, cfg.domain.capacity, cfg.domain.refillPerSec)
		if (!r.allowed) return r
	}
	if (dims.address) {
		const r = await take(env, "address", dims.address, cfg.address.capacity, cfg.address.refillPerSec)
		if (!r.allowed) return r
	}
	return { allowed: true, remaining: 0, retryAfterMs: 0 }
}

/** 站点密码登录专用的严格限流（按 IP），防止暴力破解唯一密码。 */
export async function checkSiteLoginLimit(env: Env, ip: string): Promise<RateResult> {
	const cfg = getConfig(env).rateLimits
	return take(env, "site", ip, cfg.site.capacity, cfg.site.refillPerSec)
}
