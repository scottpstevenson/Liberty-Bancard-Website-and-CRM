/**
 * S5-09 — Underwriting read model.
 *
 * Two distinct cohorts, never mixed:
 *  - CURRENT WORK: the latest decision per deal (deterministic: created_at DESC, id DESC), not overridden, with
 *    decision review|hold. The queue list, its total and the KPI "Needs review"/"Holds" all read this one cohort,
 *    so a count and its drill-through always agree.
 *  - DECISION-EVENT HISTORY: individual decision rows (approvals today, overrides, all-time totals). These count
 *    events, not deals, and are labelled as such.
 * Every figure is a SQL aggregate or a bounded page; nothing loads the full decision table into memory.
 */

export interface Queryable { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export function normalizePage(rawLimit: unknown, rawOffset: unknown): { limit: number; offset: number } {
  const l = Number.parseInt(String(rawLimit ?? ""), 10);
  const o = Number.parseInt(String(rawOffset ?? ""), 10);
  return {
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(o) && o > 0 ? o : 0,
  };
}

const LATEST_CTE = `
  latest AS (
    SELECT DISTINCT ON (ud.deal_id) ud.*
    FROM underwriting_decisions ud
    WHERE ud.deal_id IS NOT NULL
    ORDER BY ud.deal_id, ud.created_at DESC NULLS LAST, ud.id DESC
  )`;

export async function getQueuePage(db: Queryable, opts: { decision?: "review" | "hold"; limit: number; offset: number }) {
  const params: any[] = [];
  let decisionFilter = `latest.decision IN ('review', 'hold')`;
  if (opts.decision) { params.push(opts.decision); decisionFilter = `latest.decision = $${params.length}`; }
  const base = `WITH ${LATEST_CTE}`;
  const { rows: countRows } = await db.query(
    `${base} SELECT count(*)::int AS n FROM latest WHERE latest.override_action IS NULL AND ${decisionFilter}`, params);
  const total = Number(countRows[0]?.n ?? 0);
  const limitIdx = params.length + 1, offsetIdx = params.length + 2;
  const { rows } = await db.query(
    `${base}
     SELECT latest.*, d.stage AS deal_stage, d.contact_id AS deal_contact_id, d.total_volume, d.effective_rate, d.pipeline,
            c.first_name, c.last_name, c.company_name, c.email
     FROM latest
     LEFT JOIN deals d ON d.id = latest.deal_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE latest.override_action IS NULL AND ${decisionFilter}
     ORDER BY CASE latest.decision WHEN 'hold' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, latest.created_at DESC NULLS LAST, latest.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, opts.limit, opts.offset]);
  return { rows, total, limit: opts.limit, offset: opts.offset, hasMore: opts.offset + rows.length < total };
}

/** Decision EVENTS (approve) created since `since`. */
export async function getApprovedSincePage(db: Queryable, opts: { since: Date; limit: number; offset: number }) {
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS n FROM underwriting_decisions WHERE decision = 'approve' AND created_at >= $1`, [opts.since]);
  const total = Number(countRows[0]?.n ?? 0);
  const { rows } = await db.query(
    `SELECT ud.*, d.stage AS deal_stage, d.contact_id AS deal_contact_id, c.first_name, c.last_name, c.company_name
     FROM underwriting_decisions ud
     LEFT JOIN deals d ON d.id = ud.deal_id
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE ud.decision = 'approve' AND ud.created_at >= $1
     ORDER BY ud.created_at DESC NULLS LAST, ud.id DESC
     LIMIT $2 OFFSET $3`, [opts.since, opts.limit, opts.offset]);
  return { rows, total, limit: opts.limit, offset: opts.offset, hasMore: opts.offset + rows.length < total };
}

export async function getStatsSummary(db: Queryable, since: Date) {
  const [{ rows: cur }, { rows: today }, { rows: hist }] = await Promise.all([
    db.query(`WITH ${LATEST_CTE}
      SELECT count(*) FILTER (WHERE decision = 'review' AND override_action IS NULL)::int AS pending_review,
             count(*) FILTER (WHERE decision = 'hold' AND override_action IS NULL)::int AS pending_hold
      FROM latest`),
    db.query(`SELECT count(*) FILTER (WHERE decision = 'approve' AND created_at >= $1)::int AS approved_events,
                     count(*) FILTER (WHERE override_action IS NOT NULL AND overridden_at >= $1)::int AS overrides
              FROM underwriting_decisions`, [since]),
    db.query(`SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE decision = 'approve')::int AS approved,
                     count(*) FILTER (WHERE decision = 'review')::int AS review,
                     count(*) FILTER (WHERE decision = 'hold')::int AS hold,
                     count(*) FILTER (WHERE override_action IS NOT NULL)::int AS overridden
              FROM underwriting_decisions`),
  ]);
  return {
    /** Deals CURRENTLY waiting (latest decision per deal, not overridden). Same cohort as the queue list. */
    current: { pendingReview: Number(cur[0]?.pending_review ?? 0), pendingHold: Number(cur[0]?.pending_hold ?? 0) },
    /** Decision EVENTS since local midnight. */
    today: { approvedEvents: Number(today[0]?.approved_events ?? 0), overridesRecorded: Number(today[0]?.overrides ?? 0) },
    /** Decision EVENTS over all time (rows, not deals). */
    history: {
      total: Number(hist[0]?.total ?? 0), approved: Number(hist[0]?.approved ?? 0), review: Number(hist[0]?.review ?? 0),
      hold: Number(hist[0]?.hold ?? 0), overridden: Number(hist[0]?.overridden ?? 0),
    },
  };
}
