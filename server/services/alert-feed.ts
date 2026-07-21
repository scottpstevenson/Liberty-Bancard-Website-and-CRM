/**
 * Alert Feed — admin-visible persistent incident log.
 *
 * Writes critical alerts to audit_logs (action = "system_alert") so they
 * survive restarts and appear in the admin health screen regardless of
 * whether Slack is configured.
 *
 * Severity levels:
 *   critical — requires immediate owner action (circuit open, backup fail, DLQ overflow)
 *   warning  — degraded state; system still operational
 *   info     — informational (backup success, audit complete)
 */

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertEntry {
  id?: number;
  severity: AlertSeverity;
  subsystem: string;
  summary: string;
  details?: Record<string, unknown>;
  acknowledged?: boolean;
  createdAt?: string;
}

export async function persistAlert(alert: AlertEntry): Promise<void> {
  try {
    const { storage } = await import("../storage");
    await storage.createAuditLog({
      action: "system_alert",
      entityType: "system",
      actorType: "system",
      details: {
        severity: alert.severity,
        subsystem: alert.subsystem,
        summary: alert.summary,
        details: alert.details ?? {},
        acknowledged: false,
      },
    });
  } catch (err: any) {
    console.error("[AlertFeed] Failed to persist alert:", err.message);
  }
}

export async function getRecentAlerts(limit = 50): Promise<AlertEntry[]> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT id, details, created_at
      FROM audit_logs
      WHERE action = 'system_alert'
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return (rows.rows as any[]).map((r) => ({
      id: r.id,
      severity: (r.details as any)?.severity ?? "info",
      subsystem: (r.details as any)?.subsystem ?? "unknown",
      summary: (r.details as any)?.summary ?? "",
      details: (r.details as any)?.details ?? {},
      acknowledged: (r.details as any)?.acknowledged ?? false,
      createdAt: r.created_at,
    }));
  } catch (err: any) {
    console.error("[AlertFeed] Failed to read alerts:", err.message);
    return [];
  }
}

export async function acknowledgeAlert(id: number): Promise<boolean> {
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      UPDATE audit_logs
      SET details = jsonb_set(COALESCE(details, '{}'::jsonb), '{acknowledged}', 'true'::jsonb)
      WHERE id = ${id} AND action = 'system_alert'
    `);
    return true;
  } catch {
    return false;
  }
}
