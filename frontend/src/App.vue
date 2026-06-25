<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue"
import { api, setSitePassword, setToken } from "./api/client"

interface MailMeta {
	id: string
	from: string
	subject: string
	preview: string
	hasAttachment: boolean
	receivedAt: number
	code?: string
	category?: string
}

const TIMER_MAX = 15
const STORE_ADDR = "temp_mail_address"
const STORE_SITE_OK = "temp_mail_site_ok"

const view = ref<"gate" | "generator" | "inbox">("gate")
const passwordInput = ref("")
const addressInput = ref("")
const selectedDomain = ref("")
const generatedAddress = ref("")
const prefixLen = ref(4)
const currentAddress = ref("")
const mails = ref<MailMeta[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const polling = ref(false)
const search = ref("")
const timer = ref(TIMER_MAX)
const copied = ref(false)
const error = ref("")
const readIds = ref<Set<string>>(new Set())
const domains = ref<string[]>([])
const generating = ref(false)
const toast = ref({ visible: false, title: "", msg: "" })

let countdownIv: number | undefined
let copiedTo: number | undefined
let toastTo: number | undefined

const selectedMail = computed<MailMeta | null>(
	() => mails.value.find((m) => m.id === selectedId.value) || null,
)
const filteredMails = computed<MailMeta[]>(() => {
	const t = search.value.trim().toLowerCase()
	if (!t) return mails.value
	return mails.value.filter(
		(m) =>
			(m.subject || "").toLowerCase().includes(t) ||
			(m.from || "").toLowerCase().includes(t) ||
			(m.preview || "").toLowerCase().includes(t),
	)
})
const inboxLabel = computed(() => "收件箱 (" + mails.value.length + ")")
const refreshLabel = computed(() =>
	polling.value ? "同步中…" : "刷新 (" + timer.value + ")",
)
const emptyText = computed(() =>
	search.value ? "未找到匹配邮件" : "等待邮件投递…",
)
const statusText = computed(() => (polling.value ? "SYNCING…" : "LIVE"))
const copyLabel = computed(() => (copied.value ? "已复制" : "复制"))
const domainHint = computed(() =>
	domains.value.length
		? "已从后台读取 " + domains.value.length + " 个可用域名，请选择一个后随机生成邮箱"
		: "后台暂未返回可用域名，请检查 Worker 的 MAIL_DOMAINS 配置",
)
const prefixFillStyle = computed(() => {
	const pct = ((prefixLen.value - 4) / (16 - 4)) * 100
	return { "--fill": pct + "%" }
})
const progressStyle = computed(() => {
	const pct = Math.max(0, Math.min(100, (timer.value / TIMER_MAX) * 100))
	return { width: pct + "%" }
})

function isRead(id: string) {
	return readIds.value.has(id)
}
function senderEmail(from?: string) {
	const m = /<([^>]+)>/.exec(from || "")
	return m ? m[1] : from || ""
}
function senderName(from?: string) {
	const m = /^\s*"?([^"<]+?)"?\s*</.exec(from || "")
	const name = m ? m[1].trim() : senderEmail(from)
	return name || "未知发件人"
}
function avatarLetter(from?: string) {
	const n = senderName(from).trim()
	return (n[0] || "?").toUpperCase()
}
function avatarStyle(from?: string) {
	const s = from || "?"
	let h = 0
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
	const hue = h % 360
	const hue2 = (hue + 40) % 360
	return {
		background:
			"linear-gradient(135deg, hsl(" +
			hue +
			" 70% 55%), hsl(" +
			hue2 +
			" 70% 45%))",
	}
}
function subjectOf(m?: MailMeta | null) {
	return (m && m.subject) || "(无主题)"
}
function formatTime(ms?: number) {
	if (!ms) return ""
	const d = new Date(ms)
	const now = new Date()
	const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate()
	if (sameDay) return pad(d.getHours()) + ":" + pad(d.getMinutes())
	return d.getMonth() + 1 + "月" + d.getDate() + "日"
}

async function copyText(t: string) {
	try {
		await navigator.clipboard.writeText(t)
	} catch (e) {
		/* ignore */
	}
}
async function copyAddress() {
	await copyText(currentAddress.value)
	copied.value = true
	if (copiedTo) clearTimeout(copiedTo)
	copiedTo = window.setTimeout(() => (copied.value = false), 2000)
}
async function copyCode(c?: string) {
	if (!c) return
	await copyText(c)
	showToast("已复制", "验证码已复制到剪贴板")
}

function showToast(title: string, msg: string) {
	toast.value = { visible: true, title, msg }
	if (toastTo) clearTimeout(toastTo)
	toastTo = window.setTimeout(() => (toast.value.visible = false), 4000)
}

function selectMail(id: string) {
	selectedId.value = id
	const next = new Set(readIds.value)
	next.add(id)
	readIds.value = next
}

async function refresh() {
	if (polling.value) return
	const wasEmpty = mails.value.length === 0
	polling.value = true
	try {
		const r = await api.listMails()
		const list: MailMeta[] = (r && r.mails) || []
		const known = new Set(mails.value.map((m) => m.id))
		const fresh = list.filter((m) => !known.has(m.id))
		mails.value = list
		if (!wasEmpty && fresh.length > 0) {
			const top = fresh[0]
			showToast("收到新邮件", subjectOf(top))
		}
	} catch (e) {
		/* keep current list on transient errors */
	} finally {
		polling.value = false
		timer.value = TIMER_MAX
	}
}

function startCountdown() {
	stopCountdown()
	countdownIv = window.setInterval(() => {
		if (timer.value <= 1) {
			refresh()
		} else {
			timer.value -= 1
		}
	}, 1000)
}
function stopCountdown() {
	if (countdownIv) {
		clearInterval(countdownIv)
		countdownIv = undefined
	}
}

async function loadDomains() {
	const dr = await api.domains()
	domains.value = (dr && dr.domains) || []
	if (!selectedDomain.value && domains.value.length > 0) selectedDomain.value = domains.value[0]
}

async function verifySite() {
	const pw = passwordInput.value.trim()
	if (!pw) {
		error.value = "请输入登录密码"
		return
	}
	error.value = ""
	loading.value = true
	try {
		await api.verifySitePassword(pw)
		setSitePassword(pw)
		localStorage.setItem(STORE_SITE_OK, "1")
		await loadDomains()
		view.value = "generator"
	} catch (e: any) {
		error.value = "验证失败：" + (e && e.message ? e.message : String(e))
	} finally {
		loading.value = false
	}
}

function randomLocal() {
	// 按滑块设定的长度生成前缀（4–16 个字符）。
	const len = Math.min(16, Math.max(4, Math.round(prefixLen.value)))
	const letters = "abcdefghijklmnopqrstuvwxyz"
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	// 首字符用字母，避免纯数字开头。
	let s = letters[Math.floor(Math.random() * letters.length)]
	for (let i = 1; i < len; i++) {
		s += chars[Math.floor(Math.random() * chars.length)]
	}
	return s
}
function generateAddress() {
	if (!selectedDomain.value) {
		error.value = "请先选择一个域名"
		return
	}
	error.value = ""
	generatedAddress.value = randomLocal() + "@" + selectedDomain.value
	addressInput.value = generatedAddress.value
}
async function generateAndLogin() {
	if (loading.value || generating.value) return
	if (!selectedDomain.value) {
		error.value = "请先选择一个域名"
		return
	}
	generating.value = true
	generateAddress()
	try {
		await login()
	} finally {
		generating.value = false
	}
}

async function login() {
	const addr = addressInput.value.trim()
	if (!addr) {
		error.value = "请输入邮箱地址"
		return
	}
	error.value = ""
	loading.value = true
	try {
		const r = await api.login(addr)
		if (!r || !r.token) throw new Error("未返回令牌")
		setToken(r.token)
		currentAddress.value = addr
		localStorage.setItem(STORE_ADDR, addr)
		view.value = "inbox"
		selectedId.value = null
		await refresh()
		startCountdown()
	} catch (e: any) {
		error.value = "连接失败：" + (e && e.message ? e.message : String(e))
	} finally {
		loading.value = false
	}
}

function logout() {
	stopCountdown()
	setToken("")
	localStorage.removeItem(STORE_ADDR)
	localStorage.removeItem("token")
	mails.value = []
	selectedId.value = null
	readIds.value = new Set()
	currentAddress.value = ""
	addressInput.value = ""
	generatedAddress.value = ""
	view.value = "generator"
}

// 拖动滑块改变前缀长度时，若已生成过地址，自动重新生成一个符合新长度的。
watch(prefixLen, () => {
	if (generatedAddress.value && selectedDomain.value) {
		generatedAddress.value = randomLocal() + "@" + selectedDomain.value
		addressInput.value = generatedAddress.value
	}
})

onMounted(async () => {
	// 严格按流程：打开前端页面时，先显示站点密码验证页。
	// 验证通过后再加载后台域名，进入邮箱生成页。
	view.value = "gate"
})
onUnmounted(() => stopCountdown())
</script>

<template>
	<!-- PASSWORD GATEWAY -->
	<div
		v-if="view === 'gate'"
		class="h-screen flex flex-col items-center justify-center px-4 animate-fade-in"
	>
		<div class="relative mb-6">
			<div class="absolute inset-0 bg-nebula-500 blur-2xl opacity-25 rounded-full scale-150"></div>
			<div class="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-nebula-500 to-nebula-700 flex items-center justify-center shadow-lg shadow-nebula-500/30">
				<svg class="w-8 h-8 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
			</div>
		</div>
		<h1 class="text-3xl font-bold tracking-tight text-white">
			temp<span class="font-light text-nebula-400">-mail</span>
		</h1>
		<div class="flex items-center gap-2 mt-2 mb-8">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
			<span class="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Secure Gateway</span>
		</div>

		<div class="w-full max-w-md">
			<div class="relative group">
				<div class="absolute -inset-0.5 bg-gradient-to-r from-nebula-500/40 to-violet-500/40 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
				<div class="relative bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-2xl">
					<label class="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">输入站点登录密码</label>
					<input
						v-model="passwordInput"
						@keyup.enter="verifySite"
						type="password"
						placeholder="请输入访问密码"
						class="block w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-slate-200 placeholder-slate-600 font-mono-jb text-sm focus:outline-none focus:ring-2 focus:ring-nebula-500/50 focus:border-nebula-500/50 transition"
					/>
					<button
						@click="verifySite"
						:disabled="loading"
						class="mt-4 w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-nebula-600 to-nebula-500 hover:from-nebula-500 hover:to-nebula-400 shadow-lg shadow-nebula-500/20 rounded-xl px-4 py-3 transition disabled:opacity-50"
					>
						<span v-text="loading ? '验证中…' : '验证并继续'"></span>
					</button>
					<p v-if="error" class="mt-3 text-xs text-red-400" v-text="error"></p>
					<p class="mt-4 text-[11px] text-slate-600 leading-relaxed">通过站点密码后，才能选择域名并生成临时邮箱地址。</p>
				</div>
			</div>
		</div>
	</div>

	<!-- ADDRESS GENERATOR -->
	<div
		v-if="view === 'generator'"
		class="h-screen flex flex-col items-center justify-center px-4 animate-fade-in"
	>
		<div class="w-full max-w-xl">
			<div class="mb-7 text-center">
				<div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-nebula-500 to-violet-600 shadow-lg shadow-nebula-500/30 mb-4">
					<svg class="w-8 h-8 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
				</div>
				<h1 class="text-3xl font-bold text-white">生成临时邮箱</h1>
				<p class="mt-2 text-sm text-slate-500" v-text="domainHint"></p>
			</div>

			<div class="relative group">
				<div class="absolute -inset-0.5 bg-gradient-to-r from-nebula-500/40 to-violet-500/40 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
				<div class="relative bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
					<div>
						<label class="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">选择收件域名</label>
						<select
							v-model="selectedDomain"
							class="block w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-slate-200 font-mono-jb text-sm focus:outline-none focus:ring-2 focus:ring-nebula-500/50 focus:border-nebula-500/50 transition"
						>
							<option v-for="d in domains" :key="d" :value="d" v-text="d"></option>
						</select>
					</div>

					<div>
						<div class="flex items-center justify-between mb-2">
							<label class="block text-[10px] uppercase tracking-widest text-slate-500 font-bold">邮箱前缀长度</label>
							<span class="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-lg bg-nebula-500/10 border border-nebula-500/30">
								<span class="text-sm font-bold font-mono-jb text-nebula-200" v-text="prefixLen"></span>
								<span class="text-[10px] text-slate-400">字符</span>
							</span>
						</div>
						<input
							type="range"
							min="4"
							max="16"
							step="1"
							v-model.number="prefixLen"
							class="prefix-slider"
							:style="prefixFillStyle"
							aria-label="邮箱前缀字符数量"
						/>
						<div class="flex justify-between text-[10px] text-slate-600 font-mono-jb mt-1.5">
							<span>4</span>
							<span>16</span>
						</div>
					</div>

					<div>
						<label class="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">随机邮箱地址</label>
						<div class="flex gap-2">
							<input
								v-model="generatedAddress"
								readonly
								placeholder="点击下方按钮随机生成"
								class="flex-1 min-w-0 px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-700 text-slate-200 placeholder-slate-600 font-mono-jb text-sm focus:outline-none"
							/>
							<button
								@click="generateAddress"
								class="shrink-0 inline-flex items-center justify-center text-xs font-semibold text-nebula-200 bg-slate-800/70 border border-nebula-500/30 hover:bg-slate-800 hover:border-nebula-500/60 rounded-xl px-4 transition"
							>
								换一个
							</button>
						</div>
					</div>

					<button
						@click="generateAndLogin"
						:disabled="loading || generating || domains.length === 0"
						class="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-gradient-to-r from-nebula-600 to-nebula-500 hover:from-nebula-500 hover:to-nebula-400 shadow-lg shadow-nebula-500/20 rounded-xl px-4 py-3 transition disabled:opacity-50"
					>
						<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /></svg>
						<span v-text="generating ? '生成并登录中…' : '随机生成并进入收件箱'"></span>
					</button>
					<p v-if="error" class="text-xs text-red-400" v-text="error"></p>
					<p class="text-[11px] text-slate-600 leading-relaxed">邮箱地址会从你在 Worker 的 MAIL_DOMAINS 中配置的域名生成。生成后会自动进入收件箱并开始轮询新邮件。</p>
				</div>
			</div>
		</div>
	</div>

	<!-- INBOX -->
	<div v-if="view === 'inbox'" class="h-screen flex flex-col">
		<!-- TopBar -->
		<header
			class="bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 shadow-xl relative z-20"
		>
			<div class="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
				<!-- Logo -->
				<div
					class="flex items-center gap-3 cursor-pointer select-none group shrink-0"
					@click="selectedId = null"
				>
					<div class="relative">
						<div
							class="absolute inset-0 bg-nebula-500 blur-xl opacity-30 group-hover:opacity-50 transition rounded-full scale-125"
						></div>
						<div
							class="relative w-9 h-9 rounded-xl bg-gradient-to-br from-nebula-500 to-nebula-700 flex items-center justify-center group-hover:scale-105 transition"
						>
							<svg class="w-5 h-5 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
						</div>
					</div>
					<div class="flex flex-col">
						<h1 class="text-lg font-bold text-white leading-none">
							temp<span class="font-light text-nebula-400">-mail</span>
						</h1>
						<div class="flex items-center gap-1.5 mt-1">
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
							<span class="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Secure Gateway</span>
						</div>
					</div>
				</div>

				<!-- Address card -->
				<div class="flex-1 max-w-xl">
					<div class="relative group">
						<div
							class="absolute -inset-0.5 bg-gradient-to-r from-nebula-500/40 to-violet-500/40 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-500"
						></div>
						<div
							class="relative bg-slate-950/90 backdrop-blur border border-slate-800 rounded-lg py-1.5 pl-3 pr-1.5 flex items-center justify-between shadow-lg"
						>
							<div class="flex flex-col overflow-hidden mr-2">
								<span class="text-[10px] text-slate-500 font-mono-jb uppercase tracking-wide">你的临时地址</span>
								<span
									class="text-xs md:text-sm font-mono-jb text-slate-200 truncate"
									v-text="currentAddress"
								></span>
							</div>
							<button
								@click="copyAddress"
								:class="copied ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-300 border-slate-700 bg-slate-900 hover:bg-slate-800'"
								class="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg px-3 py-1.5 transition"
							>
								<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
								<span v-text="copyLabel"></span>
							</button>
						</div>
					</div>
				</div>

				<!-- Actions -->
				<div class="hidden md:flex items-center gap-2 shrink-0">
					<button
						@click="refresh"
						:disabled="polling"
						class="relative min-w-[120px] inline-flex items-center justify-center gap-2 text-xs font-medium text-slate-300 bg-slate-900/50 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 rounded-lg px-3 py-2 overflow-hidden transition"
					>
						<svg class="w-4 h-4" :class="polling ? 'animate-spin-slow' : ''" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>
						<span v-text="refreshLabel"></span>
						<span
							class="absolute bottom-0 left-0 h-[2px] bg-nebula-500 transition-all duration-1000 ease-linear"
							:style="progressStyle"
						></span>
					</button>
					<button
						@click="logout"
						class="inline-flex items-center gap-2 text-xs font-medium text-white bg-gradient-to-r from-nebula-600 to-nebula-500 hover:from-nebula-500 hover:to-nebula-400 shadow-lg shadow-nebula-500/20 rounded-lg px-4 py-2 transition"
					>
						<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
						<span>切换邮箱</span>
					</button>
				</div>
			</div>
		</header>

		<!-- Body: list + detail -->
		<div class="flex flex-1 overflow-hidden relative z-10">
			<!-- List -->
			<aside
				class="w-full md:w-96 border-r border-slate-800/50 bg-slate-900/80 backdrop-blur-md flex-col"
				:class="selectedId ? 'hidden md:flex' : 'flex'"
			>
				<div
					class="p-3 border-b border-slate-800/50 flex justify-between items-center"
				>
					<span
						class="text-xs font-semibold text-slate-500 uppercase tracking-wider pl-1"
						v-text="inboxLabel"
					></span>
				</div>

				<!-- Search -->
				<div class="p-3 border-b border-slate-800/50">
					<div class="relative">
						<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
							<svg class="h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
						</div>
						<input
							v-model="search"
							type="text"
							placeholder="搜索收件箱…"
							class="block w-full pl-9 pr-3 py-1.5 border border-slate-700 rounded-lg bg-slate-950/50 text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-nebula-500/50 text-sm transition"
						/>
					</div>
				</div>

				<!-- List scroll -->
				<div class="flex-1 overflow-y-auto">
					<div
						v-if="filteredMails.length === 0"
						class="flex flex-col items-center justify-center h-80 text-center px-8"
					>
						<div class="relative mb-6 w-20 h-20 flex items-center justify-center">
							<div class="absolute inset-0 border border-slate-800 rounded-full"></div>
							<div class="absolute inset-3 border border-slate-800/50 rounded-full"></div>
							<div class="relative bg-slate-900 p-4 rounded-full ring-1 ring-slate-700 shadow-2xl">
								<svg class="w-7 h-7 text-nebula-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
							</div>
						</div>
						<p class="text-sm font-medium text-slate-300" v-text="emptyText"></p>
						<p class="text-[10px] uppercase tracking-wider mt-2 text-slate-600 font-mono-jb">
							<span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse align-middle"></span>监听中 · Live
						</p>
					</div>

					<button
						v-for="m in filteredMails"
						:key="m.id"
						@click="selectMail(m.id)"
						:class="[selectedId === m.id ? 'bg-slate-800/80 border-l-nebula-500' : 'border-l-transparent', !isRead(m.id) ? 'bg-slate-900/40' : '']"
						class="w-full relative flex items-start gap-3 p-4 text-left border-b border-slate-800/50 border-l-4 hover:bg-slate-800/50 transition animate-slide-in"
					>
						<div class="flex-shrink-0 relative">
							<div
								class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ring-2"
								:class="selectedId === m.id ? 'ring-nebula-500' : 'ring-slate-800'"
								:style="avatarStyle(m.from)"
								v-text="avatarLetter(m.from)"
							></div>
							<span v-if="!isRead(m.id)" class="absolute -top-1 -right-1 flex h-3 w-3">
								<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-nebula-400 opacity-75"></span>
								<span class="relative inline-flex rounded-full h-3 w-3 bg-nebula-500"></span>
							</span>
						</div>
						<div class="flex-1 min-w-0">
							<div class="flex justify-between items-baseline mb-0.5">
								<h3
									class="text-sm truncate pr-2"
									:class="!isRead(m.id) ? 'text-white font-semibold' : 'text-slate-300 font-medium'"
									v-text="senderName(m.from)"
								></h3>
								<span class="text-[10px] text-slate-500 font-mono-jb flex-shrink-0" v-text="formatTime(m.receivedAt)"></span>
							</div>
							<p
								class="text-xs truncate mb-1"
								:class="!isRead(m.id) ? 'text-slate-200' : 'text-slate-400'"
								v-text="subjectOf(m)"
							></p>
							<div class="flex items-center gap-2">
								<span
									v-if="m.code"
									class="inline-flex items-center text-[11px] font-mono-jb font-bold text-nebula-300 bg-nebula-500/10 border border-nebula-500/20 rounded px-1.5 py-0.5"
									v-text="m.code"
								></span>
								<p class="text-[11px] text-slate-500 truncate" v-text="m.preview"></p>
							</div>
						</div>
					</button>
				</div>

				<!-- Footer status -->
				<div class="p-3 border-t border-slate-800/50 bg-slate-950/50">
					<div class="flex items-center justify-between text-[10px] text-slate-500 font-mono-jb">
						<div class="flex items-center gap-1.5">
							<span
								class="w-1.5 h-1.5 rounded-full"
								:class="polling ? 'bg-yellow-400' : 'bg-emerald-500 animate-pulse'"
							></span>
							<span v-text="statusText"></span>
						</div>
						<span class="truncate" v-text="currentAddress"></span>
					</div>
				</div>
			</aside>

			<!-- Detail -->
			<section
				class="flex-1 bg-transparent"
				:class="selectedId ? 'flex flex-col absolute inset-0 md:relative z-20 md:z-auto bg-slate-950 md:bg-transparent' : 'hidden md:flex'"
			>
				<div
					v-if="!selectedMail"
					class="h-full flex flex-col items-center justify-center text-slate-500 m-4 md:m-8 border border-dashed border-slate-800/50 rounded-xl bg-slate-900/30"
				>
					<div class="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-5">
						<svg class="w-9 h-9 opacity-30" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
					</div>
					<h3 class="text-lg font-medium text-slate-400">选择一封邮件查看</h3>
					<p class="text-sm mt-2 max-w-xs text-center text-slate-600">邮件经安全网关接收，会话过期后自动清除。</p>
				</div>

				<div v-else class="h-full flex flex-col overflow-hidden">
					<!-- Mobile back header -->
					<div class="md:hidden flex items-center gap-2 p-3 border-b border-slate-800 bg-slate-900/95 sticky top-0 z-10">
						<button @click="selectedId = null" class="p-2 -ml-2 text-slate-400 hover:text-white">
							<svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
						</button>
						<span class="font-medium text-sm truncate" v-text="subjectOf(selectedMail)"></span>
					</div>

					<div class="flex-1 overflow-y-auto">
						<div class="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
							<!-- Header card -->
							<div class="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 md:p-6 shadow-xl">
								<h1 class="text-xl md:text-2xl font-bold text-white leading-tight break-words mb-5" v-text="subjectOf(selectedMail)"></h1>
								<div class="flex items-center gap-4">
									<div
										class="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold ring-2 ring-slate-600"
										:style="avatarStyle(selectedMail?.from)"
										v-text="avatarLetter(selectedMail?.from)"
									></div>
									<div class="flex-1 min-w-0">
										<p class="text-base font-semibold text-white truncate" v-text="senderName(selectedMail?.from)"></p>
										<p class="text-sm text-slate-400 truncate font-mono-jb" v-text="senderEmail(selectedMail?.from)"></p>
									</div>
									<div class="text-right shrink-0">
										<p class="text-xs text-slate-500 font-mono-jb" v-text="formatTime(selectedMail?.receivedAt)"></p>
										<span
											v-if="selectedMail?.category"
											class="inline-block mt-1 text-[10px] uppercase tracking-wider text-slate-400 bg-slate-700/50 rounded px-2 py-0.5"
											v-text="selectedMail?.category"
										></span>
									</div>
								</div>
							</div>

							<!-- Verification code highlight -->
							<div
								v-if="selectedMail?.code"
								class="bg-gradient-to-r from-nebula-900/30 to-slate-900/40 rounded-2xl p-[1px]"
							>
								<div class="bg-slate-950/80 rounded-[15px] p-5 flex items-center justify-between gap-4">
									<div class="min-w-0">
										<p class="text-[10px] uppercase tracking-widest text-nebula-400 font-bold mb-1">验证码</p>
										<p class="text-2xl md:text-3xl font-mono-jb font-bold text-white tracking-[0.25em] truncate" v-text="selectedMail?.code"></p>
									</div>
									<button
										@click="copyCode(selectedMail?.code)"
										class="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-nebula-300 bg-nebula-500/10 border border-nebula-500/20 hover:bg-nebula-500/20 rounded-lg px-3 py-2 transition"
									>
										<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
										<span>复制验证码</span>
									</button>
								</div>
							</div>

							<!-- Preview body -->
							<div class="bg-slate-900 rounded-2xl border border-slate-800/50 p-5 md:p-6 min-h-[200px]">
								<div class="flex items-center gap-2 mb-3 text-slate-400">
									<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
									<span class="text-xs font-semibold uppercase tracking-wider">内容预览</span>
								</div>
								<p class="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap" v-text="(selectedMail && selectedMail.preview) || '（无可显示内容）'"></p>
								<div
									v-if="selectedMail?.hasAttachment"
									class="mt-4 flex items-center gap-2 text-xs text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded-lg p-3"
								>
									<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
									<span>此邮件包含附件</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>

	<!-- Toast -->
	<div
		v-if="toast.visible"
		class="fixed bottom-6 right-6 z-50 max-w-sm w-[calc(100%-3rem)] sm:w-full bg-slate-800 border border-slate-700 shadow-2xl shadow-black/50 rounded-xl p-4 flex items-start gap-3 animate-slide-in"
	>
		<div class="bg-nebula-500/20 p-2 rounded-full text-nebula-400 shrink-0">
			<svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
		</div>
		<div class="flex-1 min-w-0">
			<h4 class="text-sm font-semibold text-white" v-text="toast.title"></h4>
			<p class="text-xs text-slate-300 mt-1 truncate" v-text="toast.msg"></p>
		</div>
		<button @click="toast.visible = false" class="text-slate-500 hover:text-white shrink-0">✕</button>
	</div>
</template>
