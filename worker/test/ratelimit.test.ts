import { describe, it, expect } from "vitest"

/**
 * 令牌桶纯函数逻辑测试（从 RateLimiterDO 抽出的算法）。
 */
function take(
	state: { tokens: number; updatedAt: number },
	capacity: number,
	refillPerSec: number,
	now: number,
	cost = 1,
) {
	const elapsed = (now - state.updatedAt) / 1000
	state.tokens = Math.min(capacity, state.tokens + elapsed * refillPerSec)
	state.updatedAt = now
	if (state.tokens >= cost) {
		state.tokens -= cost
		return { allowed: true, remaining: Math.floor(state.tokens) }
	}
	return { allowed: false, remaining: 0 }
}

describe("token bucket rate limiter", () => {
	it("allows up to capacity then blocks", () => {
		const s = { tokens: 3, updatedAt: 0 }
		expect(take(s, 3, 1, 0).allowed).toBe(true)
		expect(take(s, 3, 1, 0).allowed).toBe(true)
		expect(take(s, 3, 1, 0).allowed).toBe(true)
		expect(take(s, 3, 1, 0).allowed).toBe(false)
	})

	it("refills over time", () => {
		const s = { tokens: 0, updatedAt: 0 }
		expect(take(s, 10, 1, 0).allowed).toBe(false)
		// 5s 后补充 5 个令牌
		expect(take(s, 10, 1, 5000).allowed).toBe(true)
	})
})
