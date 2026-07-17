import { db } from "../../../db";
import { sql } from "drizzle-orm";
import type { ProbeResult } from "./ghl-sync";

export async function probeAnomalyDetection(): Promise<ProbeResult> {
  try {
    const [anomalyLogs, dlqItems, workerAlerts] = await Promise.all([
      db.execute(sql`
        SELECT action, COUNT(*) AS cnt,
               MAX(created_at) AS last_seen
        FROM audit_logs
        WHERE action IN (
          'anomaly_detected', 'bounce_rate_spike', 'inbox_health_alert',
          'send_volume_anomaly', 'reply_rate_drop', 'GHL_CIRCUIT_OPEN',
          'consecutive_failure_threshold'
        )
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY action
        ORDER BY cnt DESC
      `),
      db.execute(sql`
        SELECT COUNT(*) AS dlq_count
        FROM review_queue_items
        WHERE source_type = 'dead_letter_job'
          AND status = 'pending'
          AND created_at > NOW() - INTERVAL '7 days'
      `),
      db.execute(sql`
        SELECT COUNT(*) AS worker_alerts
        FROM review_queue_items
        WHERE (notes LIKE '%consecutive_failure%' OR notes LIKE '%Worker alert%')
          AND status = 'pending'
          AND created_at > NOW() - INTERVAL '7 days'
      `),
    ]);

    const anomalies = anomalyLogs.rows as Array<{ action: string; cnt: string; last_seen: Date }>;
    const totalAnomalyEvents = anomalies.reduce((s, r) => s + Number(r.cnt), 0);
    const dlqCount = Number((dlqItems.rows[0] as any)?.dlq_count ?? 0);
    const workerAlertCount = Number((workerAlerts.rows[0] as any)?.worker_alerts ?? 0);

    let status: ProbeResult["status"] = "ok";
    let summary = `Anomaly detection: ${totalAnomalyEvents} events in 7d. DLQ: ${dlqCount} items. Worker alerts: ${workerAlertCount}`;

    if (dlqCount > 20 || workerAlertCount > 3) {
      status = "error";
      summary = `Anomaly overload: ${dlqCount} DLQ items, ${workerAlertCount} worker alerts in 7d`;
    } else if (totalAnomalyEvents > 10 || dlqCount > 5) {
      status = "warn";
      summary = `${totalAnomalyEvents} anomaly events and ${dlqCount} DLQ items in 7d — review recommended`;
    }

    return {
      subsystem: "anomaly-detection",
      status,
      summary,
      details: {
        anomalyEvents7d: totalAnomalyEvents,
        anomalyBreakdown: anomalies.map(r => ({
          action: r.action,
          count: Number(r.cnt),
          lastSeen: r.last_seen?.toISOString() ?? null,
        })),
        dlqItemsPending7d: dlqCount,
        workerAlerts7d: workerAlertCount,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "anomaly-detection",
      status: "error",
      summary: `Anomaly detection probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
