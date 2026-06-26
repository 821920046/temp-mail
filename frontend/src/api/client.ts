/** 极简 API 客户端。 */
const base = "/api"

function readTokenFromUrl(): string {
	const rawHash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash
	const fromHash = new URLSearchParams(rawHash).get("token")
	const fromQuery = new URLSearchParams(location.search).get("token")
	return fromHash || fromQuery || ""
}
let token = readTokenFromUrl() || localStorage.getItem("token") || ""
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
	/** 站点入口密码验证，对应 Worker Secret: ADMIN_PASSWORD。 */
	verifySitePassword: (password: string) =>
		req("/site/login", { method: "POST", body: JSON.stringify({ password }) }),
	/** 获取后台配置的可用收件域名列表。 */
	domains: () => req("/domains"),
	login: (mailbox: string) =>
		req("/auth/login", { method: "POST", body: JSON.stringify({ mailbox }) }),
	listMails: () => req("/mailbox/mails"),
	/** 下载附件（带鉴权头），返回 Blob。key 按路径段逐个编码以兼容空格 / 中文。 */
	async downloadAttachment(key: string): Promise<Blob> {
		const encoded = key.split("/").map(encodeURIComponent).join("/")
		const res = await fetch(base + "/mailbox/attachment/" + encoded, {
			headers: {
				...(sitePassword ? { "X-Site-Password": sitePassword } : {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		})
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
		return res.blob()
	},
}
