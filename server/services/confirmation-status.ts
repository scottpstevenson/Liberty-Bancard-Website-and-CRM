/**
 * server/services/confirmation-status.ts
 *
 * Shared service for inbound confirmation delivery status.
 * All consumers (API routes for contact-level, metric, and failures) import from here.
 * No raw audit-log parsing is done elsewhere.
 *
 * Liberty Bancard is single-tenant — no tenantId/organizationId on audit_logs, contacts,
 * or deals. All isDashboardUser-gated endpoints expose data across all contacts.
 * If multi-tenant support is added, these queries will need a tenant predicate.
 *
 * EXPLAIN ANALYZE results (2026-07-10, dev DB):
 *   Contact-level: Uses audit_logs_entity_type_entity_id_action_idx (index scan, rows=0)
 *   Stage-1 metric: Uses audit_logs_created_at_idx / idx_audit_logs_created_at (index scan, not seq scan)
 *   No new index added — both queries use existing indexes without seq scans.
 */

import { pool } from "../db";
import { APP_TIMEZONE } from "../config";
import type {
  ConfirmationState,
  ConfirmationChannel,
  SubmissionStatus,
  ContactConfirmationResult,
  ConfirmationMetric,
  FailedSubmission,
} from "@shared/confirmation-status-types";
import { labelForConfirmationStatus } from "@shared/confirmation-status-types";

export { labelForConfirmationStatus };

// Re-export types for route consumers
export type { SubmissionStatus, ContactConfirmationResult, ConfirmationMetric, FailedSubmission };

const CONFIRMATION_ACTIONS = [
  "ghl_inbound_confirmation_enrolled",
  "inbound_confirmation_sent",
  "inbound_confirmation_failed",
  "inbound_confirmation_skipped",
] as const;

type ConfirmationAction = typeof CONFIRMATION_ACTIONS[number];

interface RawAuditRow {
  id: number;
  action: string;
  entity_id: number | null;
  details: Record<string, any> | null;
  created_at: string | null;
}

interface ConfirmationEvent {
  id: number;
  action: ConfirmationAction;
  state: ConfirmationState;
  provider: string | null;
  channel: ConfirmationChannel;
  submissionId: string;
  formType: string | null;
  timestamp: Date;
  rawReason: string | undefined;
}

/**
 * Normalize one raw audit log row into a typed ConfirmationEvent.
 * Does NOT produce display labels — use labelForConfirmationStatus() for that.
 */
export function normalizeConfirmationAuditEvent(row: RawAuditRow): ConfirmationEvent {
  const details = row.details ?? {};
  const action = row.action as ConfirmationAction;

  let state: ConfirmationState;
  let provider: string | null = null;
  let channel: ConfirmationChannel = null;

  switch (action) {
    case "ghl_inbound_confirmation_enrolled":
      state = "workflow_enrolled";
      channel = "ghl_workflow";
      break;
    case "inbound_confirmation_sent":
      state = "sent";
      provider = details.provider ?? null;
      channel = provider === "ghl_direct" ? "ghl_direct" : provider === "smtp" ? "smtp" : null;
      break;
    case "inbound_confirmation_failed":
      state = "failed";
      break;
    case "inbound_confirmation_skipped":
      state = "skipped";
      break;
    default:
      state = "failed";
  }

  return {
    id: row.id,
    action,
    state,
    provider,
    channel,
    submissionId: String(details.submissionId ?? ""),
    formType: details.formType ?? null,
    timestamp: row.created_at ? new Date(row.created_at) : new Date(0),
    rawReason: details.reason ?? undefined,
  };
}

/**
 * Sanitize raw failure reason so no SMTP errors, GHL HTTP bodies, DB messages,
 * or request details are ever returned to the API caller.
 */
export function sanitizeFailureReason(rawReason: string | undefined): string | null {
  if (!rawReason) return null;
  const r = rawReason.toLowerCase();
  if (r.includes("no_email") || r.includes("no email") || r === "no email address") {
    return "No email address";
  }
  if (r.includes("ghl") || r.includes("workflow") || r.includes("enrollment")) {
    return "GHL workflow error";
  }
  if (r.includes("smtp") || r.includes("all providers") || r.includes("refused") || r.includes("connect")) {
    return "All providers unavailable";
  }
  if (r.includes("timeout") || r.includes("timed out")) {
    return "Send timeout";
  }
  return "All providers unavailable";
}

function toSubmissionStatus(event: ConfirmationEvent): SubmissionStatus {
  return {
    submissionId: event.submissionId,
    state: event.state,
    provider: event.provider,
    channel: event.channel,
    formType: event.formType,
    timestamp: event.timestamp.toISOString(),
    safeReason: (event.state === "failed" || event.state === "skipped")
      ? sanitizeFailureReason(event.rawReason)
      : null,
  };
}

/**
 * Shared helper: given rows for a single contact (already sorted by created_at DESC, id DESC),
 * return the de-duplicated list of submission statuses (latest event per submissionId),
 * with index 0 being the most recent submission overall.
 *
 * Both getContactConfirmationStatuses and getContactConfirmationStatusBatch call this
 * so single-contact and batch results are identical for the same audit rows.
 */
function resolveSubmissionsFromRows(rows: RawAuditRow[]): SubmissionStatus[] {
  // Group by submissionId; first occurrence per group is the latest event
  // because rows are sorted DESC by (created_at, id).
  const seen = new Set<string>();
  const events: ConfirmationEvent[] = [];
  for (const row of rows) {
    const event = normalizeConfirmationAuditEvent(row);
    if (!seen.has(event.submissionId)) {
      seen.add(event.submissionId);
      events.push(event);
    }
  }
  return events.map(toSubmissionStatus);
}

/**
 * Contact-level: groups by submissionId (entity_id is fixed), latest event per group.
 * Uses audit_logs_entity_type_entity_id_action_idx (or entity_type/entity_id index) — index-bounded.
 *
 * NOTE: Liberty is single-tenant; all dashboard users may access all contacts.
 * Update with a tenant predicate if multi-tenant support is added.
 */
export async function getContactConfirmationStatuses(
  contactId: number,
): Promise<ContactConfirmationResult> {
  const { rows } = await pool.query<RawAuditRow>(
    `SELECT id, action, entity_id, details, created_at
     FROM audit_logs
     WHERE entity_type = 'contact'
       AND entity_id = $1
       AND action = ANY($2::text[])
     ORDER BY created_at DESC, id DESC`,
    [contactId, CONFIRMATION_ACTIONS],
  );

  if (rows.length === 0) {
    return { latestStatus: null, submissions: [], hasConfirmationRecord: false };
  }

  const submissions = resolveSubmissionsFromRows(rows);
  return {
    latestStatus: submissions[0] ?? null,
    submissions,
    hasConfirmationRecord: submissions.length > 0,
  };
}

/**
 * Batch response shape for the /api/contacts/confirmation-status/batch endpoint.
 * Only contacts with a current "failed" latest submission are included in statuses.
 * null value (or omission) means no current failure.
 */
export interface BatchContactConfirmationStatus {
  status: "failed";
  submissionId: string;
  timestamp: string;
  formType: string | null;
  reason: string | null;
}

export interface BatchConfirmationResult {
  statuses: Record<string, BatchContactConfirmationStatus | null>;
}

/**
 * Batch: resolves confirmation status for up to 200 contacts in one DB query.
 * Uses the same shared resolveSubmissionsFromRows helper so results are identical
 * to getContactConfirmationStatuses for the same audit rows.
 *
 * Only contacts whose latest submission's state is "failed" appear in the response.
 * Contacts with no record, skipped, sent, or workflow_enrolled are omitted (null).
 *
 * Uses audit_logs_entity_type_entity_id_idx — one query for the whole chunk.
 */
export async function getContactConfirmationStatusBatch(
  contactIds: number[],
): Promise<BatchConfirmationResult> {
  if (contactIds.length === 0) return { statuses: {} };

  const { rows } = await pool.query<RawAuditRow>(
    `SELECT id, action, entity_id, details, created_at
     FROM audit_logs
     WHERE entity_type = 'contact'
       AND entity_id = ANY($1::int[])
       AND action = ANY($2::text[])
     ORDER BY entity_id, created_at DESC, id DESC`,
    [contactIds, CONFIRMATION_ACTIONS],
  );

  // Group rows by entity_id; within each group rows are sorted DESC (created_at, id)
  const byContact = new Map<number, RawAuditRow[]>();
  for (const row of rows) {
    if (row.entity_id == null) continue;
    const bucket = byContact.get(row.entity_id);
    if (bucket) {
      bucket.push(row);
    } else {
      byContact.set(row.entity_id, [row]);
    }
  }

  const statuses: BatchConfirmationResult["statuses"] = {};
  for (const [contactId, contactRows] of byContact.entries()) {
    const submissions = resolveSubmissionsFromRows(contactRows);
    const latestStatus = submissions[0] ?? null;
    if (latestStatus && latestStatus.state === "failed") {
      statuses[String(contactId)] = {
        status: "failed",
        submissionId: latestStatus.submissionId,
        timestamp: latestStatus.timestamp,
        formType: latestStatus.formType,
        reason: latestStatus.safeReason,
      };
    }
    // Contacts with no failure are omitted (treated as null by the consumer)
  }

  return { statuses };
}

/**
 * Dashboard metric — Option B:
 *   Candidates: (entity_id, submissionId) pairs with a terminal confirmation event during
 *               the supplied window (today's ET calendar day).
 *   Outcome: latest authoritative terminal event for each candidate (two-stage CTE).
 *   Numerator: candidates whose authoritative outcome = "sent" OR "workflow_enrolled".
 *   Denominator: all candidates (sent + enrolled + failed) — skipped excluded from both.
 *
 * Two-stage SQL-first approach:
 *   Stage 1 (CTE "candidates") — distinct (entity_id, submissionId) pairs with an event in
 *     the window; bounded by idx_audit_logs_created_at.
 *   Stage 2 (CTE "latest_events") — DISTINCT ON resolves the latest terminal event for each
 *     candidate across ALL time; join back to audit_logs on (entity_id, submissionId).
 *   Aggregation done entirely in SQL; no N+1 app-layer loops.
 *
 * Retry-after-midnight: a successful retry tomorrow resolves this candidate to "sent"
 * if the operator reads the metric before the day turns in ET. Once the day has passed,
 * the retry is outside the cohort window and does not alter today's archived rate.
 * Operators should check the failures panel next day for corrections.
 *
 * Liberty is single-tenant — no tenant predicate on audit_logs or contacts.
 */
export async function getConfirmationMetricForRange(
  start: Date,
  end: Date,
  timezone: string = APP_TIMEZONE,
): Promise<ConfirmationMetric> {
  const { rows } = await pool.query<{ numerator: number; denominator: number }>(
    `WITH candidates AS (
       SELECT DISTINCT
         entity_id,
         details->>'submissionId' AS submission_id
       FROM audit_logs
       WHERE action = ANY($1::text[])
         AND created_at >= $2
         AND created_at < $3
         AND entity_id IS NOT NULL
         AND details->>'submissionId' IS NOT NULL
     ),
     latest_events AS (
       SELECT DISTINCT ON (al.entity_id, al.details->>'submissionId')
         al.action
       FROM audit_logs al
       INNER JOIN candidates c
         ON al.entity_id = c.entity_id
         AND al.details->>'submissionId' = c.submission_id
       WHERE al.action = ANY($1::text[])
         AND al.entity_type = 'contact'
       ORDER BY al.entity_id, al.details->>'submissionId', al.created_at DESC, al.id DESC
     )
     SELECT
       COUNT(*) FILTER (WHERE action IN (
         'inbound_confirmation_sent',
         'ghl_inbound_confirmation_enrolled'
       ))::int AS numerator,
       COUNT(*) FILTER (WHERE action != 'inbound_confirmation_skipped')::int AS denominator
     FROM latest_events`,
    [CONFIRMATION_ACTIONS, start, end],
  );

  const numerator = rows[0]?.numerator ?? 0;
  const denominator = rows[0]?.denominator ?? 0;
  const rate = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;

  return {
    rate,
    numerator,
    denominator,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    timezone,
    cohortSemantics: "terminal_event_in_window",
  };
}

/**
 * Unresolved failures panel:
 *   A failure is unresolved when its latest terminal event is "failed"
 *   with no later "sent" or "enrolled" for the same (entity_id, submissionId).
 *
 *   SQL-first two-stage CTE approach — no N+1, no app-layer pagination:
 *   Stage 1 (CTE "candidates") — distinct (entity_id, submissionId) pairs with ANY terminal
 *     event in the lookback window; bounded by idx_audit_logs_created_at.
 *   Stage 2 (CTE "latest_events") — DISTINCT ON resolves the latest terminal event for each
 *     candidate across ALL time; join on (entity_id, submissionId).
 *   COUNT and paginated data retrieved with SQL LIMIT/OFFSET — no app-layer slicing.
 *
 *   Default lookback: 7 days; maximum: 30 days.
 *   Default limit: 50; maximum: 200.
 *
 *   Liberty is single-tenant — no tenant predicate needed today.
 */

const FAILURES_CTE = `
  WITH candidates AS (
    SELECT DISTINCT
      entity_id,
      details->>'submissionId' AS submission_id
    FROM audit_logs
    WHERE action = ANY($1::text[])
      AND created_at >= $2
      AND entity_id IS NOT NULL
      AND details->>'submissionId' IS NOT NULL
  ),
  latest_events AS (
    SELECT DISTINCT ON (al.entity_id, al.details->>'submissionId')
      al.entity_id                      AS contact_id,
      al.details->>'submissionId'        AS submission_id,
      al.details->>'formType'            AS form_type,
      al.created_at,
      al.details->>'reason'              AS raw_reason,
      al.action
    FROM audit_logs al
    INNER JOIN candidates c
      ON al.entity_id = c.entity_id
      AND al.details->>'submissionId' = c.submission_id
    WHERE al.action = ANY($1::text[])
      AND al.entity_type = 'contact'
    ORDER BY al.entity_id, al.details->>'submissionId', al.created_at DESC, al.id DESC
  )
`;

type FailureRow = {
  contact_id: number;
  submission_id: string;
  form_type: string | null;
  created_at: Date;
  raw_reason: string | null;
};

export async function getUnresolvedConfirmationFailures(opts: {
  lookbackDays?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ failures: FailedSubmission[]; total: number }> {
  // Defensive clamps — the route layer validates and returns 400 for out-of-bounds values,
  // but the service also clamps defensively so callers can never produce an unbounded query
  // (e.g. LIMIT -1 = no limit in Postgres) or a negative OFFSET SQL error.
  const lookbackDays = Math.max(1, Math.min(Math.floor(opts.lookbackDays ?? 7), 30));
  const limit        = Math.max(1, Math.min(Math.floor(opts.limit ?? 50), 200));
  const offset       = Math.max(0, Math.floor(opts.offset ?? 0));

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Count query — SQL-level, no app-layer row counting
  const countResult = await pool.query<{ total: number }>(
    `${FAILURES_CTE}
     SELECT COUNT(*)::int AS total
     FROM latest_events
     WHERE action = 'inbound_confirmation_failed'`,
    [CONFIRMATION_ACTIONS, since],
  );

  const total = countResult.rows[0]?.total ?? 0;

  if (total === 0) {
    return { failures: [], total: 0 };
  }

  // Data query — LIMIT/OFFSET applied in SQL
  const dataResult = await pool.query<FailureRow>(
    `${FAILURES_CTE}
     SELECT contact_id, submission_id, form_type, created_at, raw_reason
     FROM latest_events
     WHERE action = 'inbound_confirmation_failed'
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [CONFIRMATION_ACTIONS, since, limit, offset],
  );

  const failures: FailedSubmission[] = dataResult.rows.map((row) => ({
    contactId: row.contact_id,
    submissionId: row.submission_id,
    formType: row.form_type ?? null,
    timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    safeReason: sanitizeFailureReason(row.raw_reason ?? undefined),
  }));

  return { failures, total };
}
