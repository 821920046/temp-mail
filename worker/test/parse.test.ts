import { describe, it, expect } from "vitest"
import { parseEmail } from "../src/mail/parse"

function raw(lines: string[]): ArrayBuffer {
	return new TextEncoder().encode(lines.join("\r\n")).buffer as ArrayBuffer
}

describe("parseEmail", () => {
	it("parses a simple text/plain message", async () => {
		const p = await parseEmail(
			raw([
				"From: Alice <alice@example.com>",
				"Subject: Hello world",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"This is the body.",
			]),
		)
		expect(p.subject).toBe("Hello world")
		expect(p.from).toContain("alice@example.com")
		expect(p.text).toBe("This is the body.")
		expect(p.attachments.length).toBe(0)
	})

	it("decodes RFC2047 base64 encoded-word subject", async () => {
		const p = await parseEmail(
			raw([
				"From: test@example.com",
				"Subject: =?UTF-8?B?5L2g5aW9?=",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"body",
			]),
		)
		expect(p.subject).toBe("你好")
	})

	it("extracts a base64 attachment from multipart/mixed", async () => {
		const p = await parseEmail(
			raw([
				"From: test@example.com",
				"Subject: with attachment",
				'Content-Type: multipart/mixed; boundary="BOUNDARY"',
				"",
				"--BOUNDARY",
				"Content-Type: text/plain; charset=utf-8",
				"",
				"see attachment",
				"--BOUNDARY",
				'Content-Type: application/octet-stream; name="hi.txt"',
				"Content-Transfer-Encoding: base64",
				'Content-Disposition: attachment; filename="hi.txt"',
				"",
				"aGVsbG8=",
				"--BOUNDARY--",
			]),
		)
		expect(p.text).toContain("see attachment")
		expect(p.attachments.length).toBe(1)
		expect(p.attachments[0]?.filename).toBe("hi.txt")
		expect(new TextDecoder().decode(p.attachments[0]!.bytes)).toBe("hello")
	})

	it("converts html to text when no text/plain part exists", async () => {
		const p = await parseEmail(
			raw([
				"From: test@example.com",
				"Subject: html only",
				"Content-Type: text/html; charset=utf-8",
				"",
				"<p>Hello <b>world</b></p>",
			]),
		)
		expect(p.text).toContain("Hello")
		expect(p.text).toContain("world")
		expect(p.text).not.toContain("<p>")
	})
})
