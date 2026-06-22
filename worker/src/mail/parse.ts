/**
 * 邮件解析（保留原项目 Rust WASM 方案的接口）。
 *
 * 实际部署时，将 mail-parser-wasm 构建产物引入并替换下面的 fallback。
 * 这里提供一个轻量的 TS 降级解析器，保证在未接入 WASM 时也能跑通流程。
 */
export interface ParsedMail {
	subject: string
	from: string
	text: string
	html?: string
	attachments: Array<{ filename: string; contentType: string; bytes: Uint8Array }>
}

export async function parseEmail(raw: ArrayBuffer): Promise<ParsedMail> {
	// TODO: 接入 mail-parser-wasm：
	//   import init, { parse_message } from "mail-parser-wasm"
	//   await init(); return adapt(parse_message(new Uint8Array(raw)))
	return fallbackParse(new TextDecoder().decode(raw))
}

/** 极简降级解析：仅用于开发/未接 WASM 时。 */
function fallbackParse(rawText: string): ParsedMail {
	const headerEnd = rawText.indexOf("\r\n\r\n")
	const headerBlock = headerEnd >= 0 ? rawText.slice(0, headerEnd) : rawText
	const body = headerEnd >= 0 ? rawText.slice(headerEnd + 4) : ""
	const header = (name: string) => {
		const m = headerBlock.match(new RegExp(`^${name}:\\s*(.*)$`, "im"))
		return m?.[1]?.trim() ?? ""
	}
	return {
		subject: header("Subject"),
		from: header("From"),
		text: body,
		attachments: [],
	}
}
