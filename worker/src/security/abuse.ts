/**
 * 实时滥用打分（P1）— 基于发件频率、关键词、信誉库给出 0-100 的风险分。
 * 分数越高越可疑；超过阈值可自动降级（仅入库不推送）或封禁。
 */
import type { Env } from "../env"
import { getConfig } from "../config"
import { loadBlocklistPatterns } from "../storage/d1"

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
	recentCountFromSender?: number // 最近时间窗内同一发件人来信数
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
	const recentCount = sig.recentCountFromSender ?? sig.recentCountFromIp ?? 0
	if (recentCount > 30) {
		score += Math.min(30, recentCount - 30)
		reasons.push(`high_frequency:${recentCount}`)
	}

	score = Math.min(100, Math.round(score))
	const action =
		score >= cfg.blockScore ? "block" : score >= cfg.warnScore ? "quarantine" : "accept"
	return { score, action, reasons }
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 黑名单匹配：命中返回触发的规则，否则 null。支持 * 通配。 */
export async function matchBlocklist(env: Env, from: string): Promise<string | null> {
	const patterns = await loadBlocklistPatterns(env)
	const f = from.toLowerCase()
	for (const { pattern } of patterns) {
		const p = (pattern ?? "").trim().toLowerCase()
		if (!p) continue
		if (p.includes("*")) {
			const re = new RegExp("^" + p.split("*").map(escapeRegExp).join(".*") + "$")
			if (re.test(f)) return pattern
		} else if (f.includes(p)) {
			return pattern
		}
	}
	return null
}
