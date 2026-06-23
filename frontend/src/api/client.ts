/** 极简 API 客户端。 */
const base = "/api"

let token = new URLSearchParams(location.search).get("token") ?? localStorage.getItem("token") ?? ""
let sitePassword = localStorage.getItem("site_password") ?? ""

export function setToken(t: string) {
	token = t
	localStorage.setItem("token", t)
}

export function setSitePassword(p: string) {
	sitePassword = p
	localStorage.setItem("site_password", p)
}

async function req(path: string, init: RequestInit = {}) {
	const res = await fetch(base + path, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(sitePassword ? { "X-Site-Password": sitePassword } : {}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(init.headers ?? {}),
		},
	})
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
	return res.json()
}

export const api = {
	/** 站点入口密码验证，对应 Worker Secret: SITE_PASSWORD。 */
	verifySitePassword: (password: string) =>
		req("/site/login", { method: "POST", body: JSON.stringify({ password }) }),
	/** 获取后台配置的可用收件域名列表。 */
	domains: () => req("/domains"),
	login: (mailbox: string) =>
		req("/auth/login", { method: "POST", body: JSON.stringify({ mailbox }) }),
	listMails: () => req("/mailbox/mails"),
}
