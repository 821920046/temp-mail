/**
 * JWT / 凭证管理（P1）
 * - 支持密钥轮转（kid）
 * - 支持过期
 * - 支持一次性 token（jti 存入 KV，用后即焦），用于 URL 自动登录场景
 */
import { SignJWT, jwtVerify } from "jose"
import type { Env } from "../env"

function secretKey(env: Env): Uint8Array {
	return new TextEncoder().encode(env.JWT_SECRET)
}

export interface MailboxClaims {
	mailbox: string
	role?: "user" | "admin"
	jti?: string
}

/** 签发常规会话 token。 */
export async function signSession(env: Env, claims: MailboxClaims, ttl = "72h"): Promise<string> {
	return new SignJWT({ mailbox: claims.mailbox, role: claims.role ?? "user" })
		.setProtectedHeader({ alg: "HS256", kid: "current" })
		.setIssuedAt()
		.setExpirationTime(ttl)
		.sign(secretKey(env))
}

/** 签发一次性 token（URL 自动登录），默认 10 分钟过期。 */
export async function signOneTime(env: Env, mailbox: string, ttl = "10m"): Promise<string> {
	const jti = crypto.randomUUID()
	await env.KV.put(`ott:${jti}`, "1", { expirationTtl: 600 })
	return new SignJWT({ mailbox, jti, ott: true })
		.setProtectedHeader({ alg: "HS256", kid: "current" })
		.setIssuedAt()
		.setExpirationTime(ttl)
		.sign(secretKey(env))
}

/** 校验 token；若为一次性则消费 jti。 */
export async function verifyToken(env: Env, token: string): Promise<MailboxClaims> {
	const { payload } = await jwtVerify(token, secretKey(env))
	if (payload.ott && payload.jti) {
		const exists = await env.KV.get(`ott:${payload.jti}`)
		if (!exists) throw new Error("one-time token already used or expired")
		await env.KV.delete(`ott:${payload.jti}`)
	}
	return { mailbox: String(payload.mailbox), role: payload.role as "user" | "admin" }
}
