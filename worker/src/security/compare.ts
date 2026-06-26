/**
 * 恒定时间字符串比较，避免密码 / 密钥比较的时序侧信道（timing attack）。
 */
export function safeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder()
	const ae = enc.encode(a)
	const be = enc.encode(b)
	if (ae.length !== be.length) return false
	let diff = 0
	for (let i = 0; i < ae.length; i++) diff |= ae[i] ^ be[i]
	return diff === 0
}
