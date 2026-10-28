/**
 * Scoped SQL aggregates for the GHL sync dashboard.
 *
 * Contract: one `asOf`, one trailing window ([asOf - hours, asOf]) and one scope (all contacts) for every windowed
 * count. Time and action predicates run inside SQL before aggregation, so no row cap can hide a late event. Each
 * section fails independently: a failed query yields null for exactly that section (unavailable), never zero.
 * Only the 422 detail sample is bounded, and it is ordered newest-first with an id tiebreak.
 */
import { sql } from "drizzle-orm";
import { GHL_EMAIL_VALIDATION_422_BODY_PATTERN } from "./ghl";

export const GHL_DASHBOARD_WINDOW_HOURS = 24;
export const GHL_DASHBOARD_422_SAMPLE_LIMIT = 10;

export type Ghl422Kind = "field_write" | "email_validation" | "unclassified";

export interface GhlDashboardActivity {
  window: { asOf: string; since: string; hours: number; scope: "all_contacts"; sources: ["audit_logs", "ghl_activity_log"] };
  /** false = that section's query failed and its fields are null (unavailable), not zero. */
  availability: { audit: boolean; activity: boolean; circuit: boolean };
  failedSyncs: number | null;
  optOutEvents: number | null;
  /** Latest GHL_CIRCUIT_OPEN / GHL_CIRCUIT_OPEN_AUTH event ever recorded (not window-limited). */
  lastCircuitTripAt: string | null;
  /** Latest circuit event of any kind (open, auth-open or closed), so a later recovery is visible. */
  lastCircuitEvent: { action: string; at: string } | null;
  webhookEvents: number | null;
  permissionChecks: number | null;
  fieldWriteErrors422: number | null;
  emailValidation422: number | null;
  unclassified422: number | null;
  recent422: Array<{ contactId: number | null; operation: string | null; httpStatus: number | null; createdAt: string | null; kind: Ghl422Kind }>;
}

type Exec = { execute: (q: any) => Promise<any> };
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

// Postgres ARE equivalents of the JS patterns: `\y` is a word boundary there (`\b` would be a backspace).
const EMAIL_RX = GHL_EMAIL_VALIDATION_422_BODY_PATTERN.source;
const FIELD_RX = "custom ?field|\\ylb_[a-z_]+|customFields";

export async function readGhlDashboardActivity(exec: Exec, asOfDate: Date = new Date(), hours = GHL_DASHBOARD_WINDOW_HOURS): Promise<GhlDashboardActivity> {
  const since = new Date(asOfDate.getTime() - hours * 3600_000);
  const out: GhlDashboardActivity = {
    window: { asOf: asOfDate.toISOString(), since: since.toISOString(), hours, scope: "all_contacts", sources: ["audit_logs", "ghl_activity_log"] },
    availability: { audit: true, activity: true, circuit: true },
    failedSyncs: null, optOutEvents: null, lastCircuitTripAt: null, lastCircuitEvent: null,
    webhookEvents: null, permissionChecks: null, fieldWriteErrors422: null, emailValidation422: null, unclassified422: null,
    recent422: [],
  };

  try {
    const r = rows(await exec.execute(sql`
      SELECT
        count(*) FILTER (WHERE action IN ('ghl_sync_error', 'ghl_sync_failed'))::int AS failed,
        count(*) FILTER (WHERE action IN ('contact_unsubscribed', 'contact_dnd_set'))::int AS opt_out
      FROM audit_logs
      WHERE created_at >= ${since} AND created_at <= ${asOfDate}
        AND action IN ('ghl_sync_error', 'ghl_sync_failed', 'contact_unsubscribed', 'contact_dnd_set')`))[0];
    out.failedSyncs = Number(r.failed);
    out.optOutEvents = Number(r.opt_out);
  } catch { out.availability.audit = false; }

  try {
    const trip = rows(await exec.execute(sql`
      SELECT created_at FROM audit_logs
      WHERE action IN ('GHL_CIRCUIT_OPEN', 'GHL_CIRCUIT_OPEN_AUTH') AND created_at IS NOT NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`))[0];
    const last = rows(await exec.execute(sql`
      SELECT action, created_at FROM audit_logs
      WHERE action IN ('GHL_CIRCUIT_OPEN', 'GHL_CIRCUIT_OPEN_AUTH', 'GHL_CIRCUIT_CLOSED') AND created_at IS NOT NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`))[0];
    out.lastCircuitTripAt = trip ? iso(trip.created_at) : null;
    out.lastCircuitEvent = last ? { action: String(last.action), at: iso(last.created_at)! } : null;
  } catch { out.availability.circuit = false; }

  try {
    const kindSql = sql`CASE
      WHEN ('GHL API error 422: ' || COALESCE(metadata->>'errorBody', '')) ~* 'GHL API error 422'
        AND COALESCE(metadata->>'errorBody', '') ~* ${EMAIL_RX} THEN 'email_validation'
      WHEN COALESCE(metadata->>'errorBody', '') ~* ${FIELD_RX} THEN 'field_write'
      ELSE 'unclassified' END`;
    const is422 = sql`channel = 'sync_error' AND metadata->>'httpStatus' = '422'`;
    const agg = rows(await exec.execute(sql`
      SELECT
        count(*) FILTER (WHERE direction = 'inbound')::int AS webhooks,
        count(*) FILTER (WHERE channel = 'permission_check')::int AS perm,
        count(*) FILTER (WHERE ${is422} AND ${kindSql} = 'field_write')::int AS field_write,
        count(*) FILTER (WHERE ${is422} AND ${kindSql} = 'email_validation')::int AS email_validation,
        count(*) FILTER (WHERE ${is422} AND ${kindSql} = 'unclassified')::int AS unclassified
      FROM ghl_activity_log
      WHERE created_at >= ${since} AND created_at <= ${asOfDate}
        AND (direction = 'inbound' OR channel IN ('permission_check', 'sync_error'))`))[0];
    const sample = rows(await exec.execute(sql`
      SELECT contact_id, metadata->>'operation' AS operation, created_at, ${kindSql} AS kind
      FROM ghl_activity_log
      WHERE created_at >= ${since} AND created_at <= ${asOfDate} AND ${is422}
      ORDER BY created_at DESC, id DESC LIMIT ${GHL_DASHBOARD_422_SAMPLE_LIMIT}`));
    out.webhookEvents = Number(agg.webhooks);
    out.permissionChecks = Number(agg.perm);
    out.fieldWriteErrors422 = Number(agg.field_write);
    out.emailValidation422 = Number(agg.email_validation);
    out.unclassified422 = Number(agg.unclassified);
    out.recent422 = sample.map((s) => ({
      contactId: s.contact_id == null ? null : Number(s.contact_id), operation: s.operation ?? null, httpStatus: 422,
      createdAt: iso(s.created_at), kind: s.kind as Ghl422Kind,
    }));
  } catch { out.availability.activity = false; }

  return out;
}
