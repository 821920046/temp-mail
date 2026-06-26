/**
 * Cloudflare Pages Function：把前端的同源 /api/* 请求反向代理到后端 Worker。
 *
 * 为什么需要它：前端用同源相对路径 "/api" 调用后端，但 Pages 本身只托管静态资源，
 * 没有 /api 后端，直接请求会返回 405。这个 Function 会把 /api/* 透明转发到 Worker，
 * 浏览器看到的是同源请求，因此无需在 Worker 上配置 CORS。
 *
 * 安全：如在 Pages 项目 Settings → Variables 里设置了 PROXY_SECRET，会注入到
 * X-Proxy-Secret 请求头；Worker 端配置同值后将拒绝一切不经本代理的直连请求
 * （堵死直接访问 workers.dev 绕过站点密码门）。
 *
 * 配置：默认指向下面的 DEFAULT_UPSTREAM。若你的 Worker 地址不同，
 * 可改这里的常量，或在 Pages 项目 Settings → Variables 里设置环境变量 API_UPSTREAM。
 */
const DEFAULT_UPSTREAM = "https://temp-mail.weiw55016.workers.dev"

export async function onRequest(context) {
	const { request, env } = context
	const upstream = ((env && env.API_UPSTREAM) || DEFAULT_UPSTREAM).replace(/\/+$/, "")
	const url = new URL(request.url)
	// url.pathname 形如 /api/auth/login，直接拼到 Worker 根域名后即可命中后端同名路由。
	const target = upstream + url.pathname + url.search

	// 复制原始请求头并注入反代密钥（保留 Authorization / X-Site-Password 等）。
	const headers = new Headers(request.headers)
	if (env && env.PROXY_SECRET) headers.set("x-proxy-secret", env.PROXY_SECRET)

	const init = { method: request.method, headers, redirect: "manual" }
	// GET / HEAD 无 body；其余方法读取 body 后转发（请求体很小，读取后转发最稳妥）。
	if (request.method !== "GET" && request.method !== "HEAD") {
		init.body = await request.arrayBuffer()
	}
	return fetch(target, init)
}
