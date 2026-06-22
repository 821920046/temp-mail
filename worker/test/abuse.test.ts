import { describe, it, expect } from "vitest"
import { scoreAbuse } from "../src/security/abuse"

const env: any = { MAIL_DOMAINS: "example.com" }

describe("abuse scoring", () => {
	it("accepts a normal mail", () => {
		const v = scoreAbuse(env, {
			from: "alice@github.com",
			subject: "Your receipt",
			body: "Thanks for your purchase.",
		})
		expect(v.action).toBe("accept")
		expect(v.score).toBeLessThan(50)
	})

	it("flags suspicious keywords + low reputation", () => {
		const v = scoreAbuse(env, {
			from: "x@spam.tld",
			subject: "loan approved - claim your bitcoin",
			body: "wire transfer now, crypto wallet ready",
			senderReputation: 5,
		})
		expect(v.score).toBeGreaterThanOrEqual(50)
		expect(["quarantine", "block"]).toContain(v.action)
	})
})
