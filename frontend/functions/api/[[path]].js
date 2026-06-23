/**
 * Cloudflare Pages Function：把前端的同源 /api/* 请求反向代理到后端 Worker。
 *
 * 为什么需要它：前端用同源相对路径 "/api" 调用后端，但 Pages 本身只托管静态资源，
 * 没有 /api 后端，直接请求会返回 405。这个 Function 会把 /api/* 透明转发到 Worker，
 * 浏览器看到的是同源请求，因此无需在 Worker 上配置 CORS。
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
	// 用原始 request 作为 init，保留 method / headers / body（含 Authorization）。
	return fetch(new Request(target, request))
}
