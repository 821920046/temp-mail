/**
 * 实时滥用打分（P1）— 基于发件频率、关键词、信誉库给出 0-100 的风险分。
 * 分数越高越可疑；超过阈值可自动降级（仅入库不推送）或封禁。
 */
import type { Env } from "../env"
import { getConfig } from "../config"

const SUSPICIOUS_KEYWORDS = [
	"verify your account",
	"bitcoin",
	"crypto wallet",
	"loan approved",
	"wire transfer",
	"中奖",
	"贷款",
]

export interface AbuseSignal {
	from: string
	subject: string
	body: string
	senderReputation?: number // 0(差)-100(好)，可接外部信誉库
	recentCountFromIp?: number
}

export interface AbuseVerdict {
	score: number
	action: "accept" | "quarantine" | "block"
	reasons: string[]
}

export function scoreAbuse(env: Env, sig: AbuseSignal): AbuseVerdict {
	const cfg = getConfig(env).abuse
	let score = 0
	const reasons: string[] = []

	// 1) 关键词
	const hay = `${sig.subject} ${sig.body}`.toLowerCase()
	const hit = SUSPICIOUS_KEYWORDS.filter((k) => hay.includes(k.toLowerCase()))
	if (hit.length) {
		score += Math.min(40, hit.length * 15)
		reasons.push(`keyword:${hit.join(",")}`)
	}

	// 2) 信誉分（反向）
	if (sig.senderReputation !== undefined && sig.senderReputation < 40) {
		score += 40 - sig.senderReputation
		reasons.push(`low_reputation:${sig.senderReputation}`)
	}

	// 3) 频率
	if (sig.recentCountFromIp && sig.recentCountFromIp > 30) {
		score += Math.min(30, sig.recentCountFromIp - 30)
		reasons.push(`high_frequency:${sig.recentCountFromIp}`)
	}

	score = Math.min(100, Math.round(score))
	const action =
		score >= cfg.blockScore ? "block" : score >= cfg.warnScore ? "quarantine" : "accept"
	return { score, action, reasons }
}
