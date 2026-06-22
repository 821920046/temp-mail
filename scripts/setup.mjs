#!/usr/bin/env node
/**
 * 交互式初始化（P2，纯免费额度）— 创建 D1 / KV / R2 并提示填入 wrangler.toml。
 * 依赖 wrangler 已登录（wrangler login）。不创建任何付费资源（无 Queues / DO）。
 */
import { execSync } from "node:child_process"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

function run(cmd) {
	console.log(`\n$ ${cmd}`)
	try {
		return execSync(cmd, { stdio: "pipe" }).toString()
	} catch (e) {
		console.error(e.stdout?.toString() ?? e.message)
		return ""
	}
}

const rl = readline.createInterface({ input, output })

console.log("=== temp-mail 交互式初始化（纯免费额度）===")
const domain = await rl.question("主收件域名 (如 example.com): ")

console.log("\n[1/3] 创建 D1 数据库 ...")
run("npx wrangler d1 create temp-mail")

console.log("\n[2/3] 创建 KV 命名空间 ...")
run("npx wrangler kv namespace create KV")

console.log("\n[3/3] 创建 R2 存储桶 ...")
run("npx wrangler r2 bucket create temp-mail-attachments")

console.log(`\n✅ 免费资源创建完成。请将上面输出中的 database_id / kv id 填入 worker/wrangler.toml，`)
console.log(`并将 MAIL_DOMAINS 设为: ${domain || "example.com"}`)
console.log(`\n然后运行：`)
console.log(`  npx wrangler d1 execute temp-mail --file db/schema.sql --remote`)
console.log(`  npx wrangler secret put JWT_SECRET`)
console.log(`  npx wrangler secret put ADMIN_PASSWORD`)
console.log(`  bash scripts/deploy.sh`)

await rl.close()
