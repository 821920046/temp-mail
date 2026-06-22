/**
 * 可观测性（P2）— 写入 Analytics Engine，供看板查询。
 * 失败不影响主流程（best-effort）。
 */
import type { Env } from "../env"

export type MetricName =
	| "mail_received"
	| "mail_parsed"
	| "mail_rejected"
	| "mail_quarantined"
	| "parse_failed"
	| "push_sent"
	| "push_failed"

export function recordMetric(
	env: Env,
	name: MetricName,
	labels: Record<string, string | number> = {},
): void {
	try {
		env.METRICS?.writeDataPoint({
			indexes: [name],
			blobs: [name, String(labels.domain ?? ""), String(labels.reason ?? "")],
			doubles: [Number(labels.value ?? 1)],
		})
	} catch {
		// best-effort
	}
}
