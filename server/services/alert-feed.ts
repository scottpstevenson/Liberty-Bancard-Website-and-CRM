/**
 * Append-only, durable admin incident feed backed by audit_logs.
 */
import crypto from "crypto";
import { sanitizeAuditPayload } from "./audit-sanitizer";

export type AlertSeverity = "critical" | "warning" | "info";
export interface AlertEntry {
  id?: number;
  severity: AlertSeverity;
  subsystem: string;
  summary: string;
  details?: Record<string, unknown>;
  acknowledged?: boolean;
  createdAt?: string;
  incidentBucket?: string;
}
export type AlertFeedReadResult = { alerts: AlertEntry[]; degraded: boolean; error?: string };
const ALERT_FINGERPRINT_VERSION = 1;
const MAX_ACK_REASON = 240;

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}
function canonicalAlert(alert: AlertEntry) {
  // The fingerprint is based on the already-sanitized operational shape, not
  // arbitrary caller object ordering.
  return stableJson({
    v: ALERT_FINGERPRINT_VERSION,
    severity: alert.severity,
    subsystem: String(alert.subsystem).slice(0, 120),
    summary: String(alert.summary).slice(0, 500),
    details: sanitizeAuditPayload(alert.details ?? {}),
    incidentBucket: alert.incidentBucket ?? currentIncidentBucket(),
  });
}
function currentIncidentBucket(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}
export function alertFingerprint(alert: AlertEntry): string {
  return `v${ALERT_FINGERPRINT_VERSION}:${crypto.createHash("sha256").update(canonicalAlert(alert)).digest("base64url")}`;
}

/** Insert exactly one append-only event for a fingerprint, even under races. */
export async function persistAlert(alert: AlertEntry): Promise<{
  created: boolean;
  fingerprint: string;
  alertId: number;
  createdAt: string;
}> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const incidentBucket = alert.incidentBucket ?? currentIncidentBucket();
  const normalizedAlert = { ...alert, incidentBucket };
  const fingerprint = alertFingerprint(normalizedAlert);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`alert-feed:${fingerprint}`}))`);
      const found = await tx.execute(sql`
        SELECT id FROM audit_logs
        WHERE action = 'system_alert' AND entity_type = 'system_alert' AND entity_key = ${fingerprint}
        LIMIT 1
      `);
       const existing = (found.rows as any[])[0];
       if (existing) {
         const existingRow = await tx.execute(sql`
           SELECT id, created_at FROM audit_logs WHERE id = ${existing.id} LIMIT 1
         `);
         const row = (existingRow.rows as any[])[0];
         return { created: false, fingerprint, alertId: Number(row.id), createdAt: new Date(row.created_at).toISOString() };
       }
       const inserted = await tx.execute(sql`
        INSERT INTO audit_logs (action, entity_type, entity_key, actor_type, details)
        VALUES ('system_alert', 'system_alert', ${fingerprint}, 'system',
          ${JSON.stringify({
            fingerprintVersion: ALERT_FINGERPRINT_VERSION,
            severity: alert.severity,
            subsystem: String(alert.subsystem).slice(0, 120),
            summary: String(alert.summary).slice(0, 500),
            details: sanitizeAuditPayload(alert.details ?? {}),
             incidentBucket,
           })}::jsonb)
         RETURNING id, created_at
      `);
       const row = (inserted.rows as any[])[0];
       return { created: true, fingerprint, alertId: Number(row.id), createdAt: new Date(row.created_at).toISOString() };
    });
  } catch (err: any) {
    console.error("[AlertFeed] persistence failure:", err?.message ?? "unknown");
    throw err;
  }
}

export async function getRecentAlerts(limit = 50): Promise<AlertFeedReadResult> {
  const bounded = Math.min(Math.max(Math.floor(limit), 1), 200);
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT a.id, a.details, a.created_at,
        EXISTS(SELECT 1 FROM audit_logs ack
          WHERE ack.action = 'system_alert_acknowledged'
            AND ack.entity_type = 'system_alert' AND ack.entity_id = a.id) AS acknowledged
      FROM audit_logs a
      WHERE a.action = 'system_alert' AND a.entity_type = 'system_alert'
      ORDER BY a.id DESC LIMIT ${bounded}
    `);
    return {
      alerts: (rows.rows as any[]).map((r) => ({
        id: r.id, severity: r.details?.severity ?? "info", subsystem: r.details?.subsystem ?? "unknown",
        summary: r.details?.summary ?? "", details: r.details?.details ?? {},
        acknowledged: r.acknowledged === true || r.acknowledged === "t", createdAt: r.created_at,
      })),
      degraded: false,
    };
  } catch (err: any) {
    console.error("[AlertFeed] read failure:", err?.message ?? "unknown");
    return { alerts: [], degraded: true, error: "alert_feed_unavailable" };
  }
}

/** Acknowledgements are their own immutable event; the alert row is never edited. */
export async function acknowledgeAlert(id: number, actor?: string, reason?: string): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const boundedReason = typeof reason === "string" ? reason.trim().slice(0, MAX_ACK_REASON) : "";
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`alert-ack:${id}`}))`);
      const alert = await tx.execute(sql`SELECT id FROM audit_logs WHERE id = ${id} AND action = 'system_alert' AND entity_type = 'system_alert' LIMIT 1`);
      if (!(alert.rows as any[]).length) return false;
      const existing = await tx.execute(sql`SELECT id FROM audit_logs WHERE action = 'system_alert_acknowledged' AND entity_type = 'system_alert' AND entity_id = ${id} LIMIT 1`);
      if (!(existing.rows as any[]).length) {
        await tx.execute(sql`
          INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, actor_id, details)
          VALUES ('system_alert_acknowledged', 'system_alert', ${id}, 'user', ${actor?.slice(0, 160) ?? "unknown"},
            ${JSON.stringify({ reason: boundedReason || null })}::jsonb)
        `);
      }
      return true;
    });
  } catch (err: any) {
    console.error("[AlertFeed] acknowledgement persistence failure:", err?.message ?? "unknown");
    throw err;
  }
}