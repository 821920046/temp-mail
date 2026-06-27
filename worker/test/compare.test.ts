import { describe, it, expect } from "vitest"
import { safeEqual } from "../src/security/compare"

describe("safeEqual", () => {
	it("returns true for identical strings", () => {
		expect(safeEqual("secret", "secret")).toBe(true)
		expect(safeEqual("", "")).toBe(true)
	})

	it("returns false for different strings of the same length", () => {
		expect(safeEqual("secret", "secres")).toBe(false)
	})

	it("returns false for strings of different length", () => {
		expect(safeEqual("a", "ab")).toBe(false)
	})

	it("handles multi-byte unicode", () => {
		expect(safeEqual("验证码", "验证码")).toBe(true)
		expect(safeEqual("验证码", "验证吗")).toBe(false)
	})
})
