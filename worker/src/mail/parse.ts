/**
 * 邮件解析。
 *
 * 说明：Cloudflare Email Routing 投递的是标准 RFC822/MIME 原文。
 * 之前的 fallback 只按第一个空行切 header/body，会把 multipart boundary、
 * Content-Type 头、encoded-word 标题等原样展示到收件箱里。
 *
 * 这里实现一个轻量 MIME 解析器，覆盖临时邮箱最常见场景：
 * - RFC2047 encoded-word 标题/发件人解码：=?UTF-8?B?...?= / =?UTF-8?Q?...?=
 * - multipart/alternative、multipart/mixed 的 boundary 拆分
 * - text/plain 优先，缺失时把 text/html 转纯文本
 * - Content-Transfer-Encoding: base64 / quoted-printable / 7bit / 8bit
 */
export interface ParsedMail {
	subject: string
	from: string
	text: string
	html?: string
	// 原始邮件 Message-ID（用于回复时的 In-Reply-To / References 线程串联）
	messageId?: string
	attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }>
}

type HeaderMap = Record<string, string>

type MimePart = {
	headers: HeaderMap
	body: string
	parts: MimePart[]
}

export async function parseEmail(raw: ArrayBuffer): Promise<ParsedMail> {
	// TODO: 如后续接入 mail-parser-wasm，可在这里替换为 WASM 解析器。
	const rawText = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(raw)
	return fallbackParse(rawText)
}

function fallbackParse(rawText: string): ParsedMail {
	const root = parseMimePart(normalizeNewlines(rawText))
	const subject = decodeHeader(getHeader(root.headers, "subject"))
	const from = decodeHeader(getHeader(root.headers, "from"))
	const messageId = getHeader(root.headers, "message-id").trim()
	const leaves = flattenLeafParts(root)

	let text = ""
	let html = ""
	const attachments: ParsedMail["attachments"] = []

	for (const part of leaves) {
		const disposition = getHeader(part.headers, "content-disposition").toLowerCase()
		const contentTypeRaw = getHeader(part.headers, "content-type") || "text/plain"
		const contentType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() || "text/plain"
		const filename = getParam(contentTypeRaw, "name") || getParam(disposition, "filename")
		const transferEncoding = getHeader(part.headers, "content-transfer-encoding").toLowerCase()
		const charset = getParam(contentTypeRaw, "charset") || "utf-8"

		if (disposition.includes("attachment") || filename) {
			attachments.push({
				filename: filename || "attachment.bin",
				contentType,
				bytes: decodeTransferToBytes(part.body.trim(), transferEncoding),
			})
			continue
		}

		if (contentType === "text/plain" && !text) {
			text = decodeBody(part.body, transferEncoding, charset)
			continue
		}

		if (contentType === "text/html" && !html) {
			html = decodeBody(part.body, transferEncoding, charset)
		}
	}

	// 如果没有叶子 text/plain（例如非常简单的非 multipart 邮件），尝试解析根正文。
	if (!text && leaves.length === 1 && root.parts.length === 0) {
		const contentTypeRaw = getHeader(root.headers, "content-type") || "text/plain"
		const contentType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() || "text/plain"
		const transferEncoding = getHeader(root.headers, "content-transfer-encoding").toLowerCase()
		const charset = getParam(contentTypeRaw, "charset") || "utf-8"
		const decoded = decodeBody(root.body, transferEncoding, charset)
		text = contentType === "text/html" ? htmlToText(decoded) : decoded
		if (contentType === "text/html") html = decoded
	}

	if (!text && html) text = htmlToText(html)

	return {
		subject: cleanText(subject),
		from: cleanText(from),
		text: cleanText(text),
		html: html || undefined,
		messageId: messageId || undefined,
		attachments,
	}
}

function normalizeNewlines(s: string): string {
	return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function splitHeaderBody(raw: string): { headerBlock: string; body: string } {
	const idx = raw.indexOf("\n\n")
	if (idx < 0) return { headerBlock: raw, body: "" }
	return { headerBlock: raw.slice(0, idx), body: raw.slice(idx + 2) }
}

function parseHeaders(headerBlock: string): HeaderMap {
	const headers: HeaderMap = {}
	let current = ""
	for (const line of headerBlock.split("\n")) {
		if (/^[\t ]/.test(line) && current) {
			current += " " + line.trim()
			continue
		}
		if (current) addHeader(headers, current)
		current = line
	}
	if (current) addHeader(headers, current)
	return headers
}

function addHeader(headers: HeaderMap, line: string): void {
	const idx = line.indexOf(":")
	if (idx <= 0) return
	const key = line.slice(0, idx).trim().toLowerCase()
	const value = line.slice(idx + 1).trim()
	headers[key] = headers[key] ? `${headers[key]}, ${value}` : value
}

function parseMimePart(raw: string): MimePart {
	const { headerBlock, body } = splitHeaderBody(raw)
	const headers = parseHeaders(headerBlock)
	const contentType = getHeader(headers, "content-type")
	const boundary = getParam(contentType, "boundary")
	const isMultipart = contentType.toLowerCase().startsWith("multipart/") && boundary
	const parts = isMultipart ? splitMultipart(body, boundary).map(parseMimePart) : []
	return { headers, body, parts }
}

function splitMultipart(body: string, boundary: string): string[] {
	const marker = `--${boundary}`
	const endMarker = `--${boundary}--`
	const out: string[] = []
	let current: string[] | null = null

	for (const line of body.split("\n")) {
		const trimmed = line.trimEnd()
		if (trimmed === endMarker) {
			if (current && current.length) out.push(current.join("\n").replace(/^\n+|\n+$/g, ""))
			current = null
			break
		}
		if (trimmed === marker) {
			if (current && current.length) out.push(current.join("\n").replace(/^\n+|\n+$/g, ""))
			current = []
			continue
		}
		if (current) current.push(line)
	}
	if (current && current.length) out.push(current.join("\n").replace(/^\n+|\n+$/g, ""))
	return out.filter(Boolean)
}

function flattenLeafParts(part: MimePart): MimePart[] {
	if (part.parts.length === 0) return [part]
	return part.parts.flatMap(flattenLeafParts)
}

function getHeader(headers: HeaderMap, name: string): string {
	return headers[name.toLowerCase()] || ""
}

function getParam(headerValue: string, name: string): string {
	const re = new RegExp(`${escapeRegExp(name)}\\*?=(?:\"([^\"]*)\"|([^;\\s]*))`, "i")
	const m = headerValue.match(re)
	return (m?.[1] || m?.[2] || "").trim()
}

function decodeHeader(value: string): string {
	if (!value) return ""
	return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
		try {
			const bytes = enc.toUpperCase() === "B" ? base64ToBytes(text) : qEncodedToBytes(text)
			return decodeBytes(bytes, charset)
		} catch {
			return text
		}
	})
}

function decodeBody(body: string, transferEncoding: string, charset: string): string {
	const bytes = decodeTransferToBytes(body, transferEncoding)
	return decodeBytes(bytes, charset)
}

function decodeTransferToBytes(body: string, transferEncoding: string): Uint8Array {
	const enc = transferEncoding.trim().toLowerCase()
	if (enc === "base64") return base64ToBytes(body.replace(/\s+/g, ""))
	if (enc === "quoted-printable") return quotedPrintableToBytes(body)
	return stringToUtf8Bytes(body)
}

function base64ToBytes(value: string): Uint8Array {
	const bin = atob(value.replace(/\s+/g, ""))
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes
}

function qEncodedToBytes(value: string): Uint8Array {
	return quotedPrintableToBytes(value.replace(/_/g, " "))
}

function quotedPrintableToBytes(value: string): Uint8Array {
	const softBreaksRemoved = value.replace(/=\n/g, "")
	const bytes: number[] = []
	for (let i = 0; i < softBreaksRemoved.length; i++) {
		const ch = softBreaksRemoved.charAt(i)
		if (ch === "=" && /^[0-9a-fA-F]{2}$/.test(softBreaksRemoved.slice(i + 1, i + 3))) {
			bytes.push(parseInt(softBreaksRemoved.slice(i + 1, i + 3), 16))
			i += 2
		} else {
			bytes.push(ch.charCodeAt(0))
		}
	}
	return new Uint8Array(bytes)
}

function stringToUtf8Bytes(value: string): Uint8Array {
	return new TextEncoder().encode(value)
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
	const normalized = charset.trim().replace(/^['\"]|['\"]$/g, "").toLowerCase()
	const labels = normalized ? [normalized] : ["utf-8"]
	if (normalized === "gb2312") labels.unshift("gb18030")
	if (normalized === "gbk") labels.unshift("gb18030")
	for (const label of labels) {
		try {
			return new TextDecoder(label, { fatal: false, ignoreBOM: false }).decode(bytes)
		} catch {
			// 某些 Worker 运行时可能不支持少数 legacy charset，继续回退。
		}
	}
	return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes)
}

function htmlToText(html: string): string {
	return html
		.replace(/<\s*br\s*\/?\s*>/gi, "\n")
		.replace(/<\s*\/p\s*>/gi, "\n")
		.replace(/<\s*\/div\s*>/gi, "\n")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
}

function cleanText(value: string): string {
	return value.replace(/\u0000/g, "").replace(/[\t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
