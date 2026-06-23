/** 极简 API 客户端。 */
const base = "/api"

let token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("token") ?? ""

export function setToken(t: string) {
	token = t
	localStorage.setItem("token", t)
}

async function req(path: string, init: RequestInit = {}) {
	const res = await fetch(base + path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init.headers ?? {}),
		},
	})
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
	return res.json()
}

export const api = {
	/** 获取后台配置的可用收件域名列表（公开，无需登录）。 */
	domains: () => req("/domains"),
	login: (mailbox: string) =>
		req("/auth/login", { method: "POST", body: JSON.stringify({ mailbox }) }),
	listMails: () => req("/mailbox/mails"),
}
