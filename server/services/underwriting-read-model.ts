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

import { operationalDealSql, productionDealSql } from "./deal-production-scope";

/** The business day for "today" figures. Explicit, not the server's local midnight. */
export const BUSINESS_TIMEZONE = "America/New_York";

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

/**
 * The latest decision per OPERATIONAL deal: archived, QA (test/demo/synthetic) and closed-lost deals are not
 * underwriting work. The latest decision is chosen among a deal's decisions only, so scope never changes which row is latest.
 */
const LATEST_CTE = `
  latest AS (
    SELECT DISTINCT ON (ud.deal_id) ud.*
    FROM underwriting_decisions ud
    JOIN deals sd ON sd.id = ud.deal_id AND ${operationalDealSql("sd")}
    WHERE ud.deal_id IS NOT NULL
    ORDER BY ud.deal_id, ud.created_at DESC NULLS LAST, ud.id DESC
  )`;

/** Business-day window computed by the database: `dayStart` is local midnight in BUSINESS_TIMEZONE, `asOf` is now(). */
export async function getBusinessDayWindow(db: Queryable): Promise<{ since: string; asOf: string; timezone: string }> {
  const { rows } = await db.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1) AS day_start, now() AS as_of`, [BUSINESS_TIMEZONE]);
  return { since: new Date(rows[0].day_start).toISOString(), asOf: new Date(rows[0].as_of).toISOString(), timezone: BUSINESS_TIMEZONE };
}

/** A stable revision of the exact decision + rules snapshot a reviewer saw; overrides must present it. */
export function decisionRevisionSql(alias = "latest"): string {
  return `md5(${alias}.id::text || ':' || ${alias}.decision || ':' || ${alias}.score::text || ':' || coalesce(${alias}.rules_snapshot::text,'') || ':' || coalesce(${alias}.created_at::text,''))`;
}

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
     SELECT latest.*, ${decisionRevisionSql('latest')} AS decision_revision, d.stage AS deal_stage, d.contact_id AS deal_contact_id, d.total_volume, d.effective_rate, d.pipeline,
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
export async function getApprovedSincePage(db: Queryable, opts: { since: Date | string; limit: number; offset: number }) {
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS n FROM underwriting_decisions ud JOIN deals sd ON sd.id = ud.deal_id AND ${productionDealSql("sd")}
     WHERE ud.decision = 'approve' AND ud.created_at >= $1`, [opts.since]);
  const total = Number(countRows[0]?.n ?? 0);
  const { rows } = await db.query(
    `SELECT ud.*, ${decisionRevisionSql('ud')} AS decision_revision, d.stage AS deal_stage, d.contact_id AS deal_contact_id, c.first_name, c.last_name, c.company_name
     FROM underwriting_decisions ud
     JOIN deals d ON d.id = ud.deal_id AND ${productionDealSql("d")}
     LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE ud.decision = 'approve' AND ud.created_at >= $1
     ORDER BY ud.created_at DESC NULLS LAST, ud.id DESC
     LIMIT $2 OFFSET $3`, [opts.since, opts.limit, opts.offset]);
  return { rows, total, limit: opts.limit, offset: opts.offset, hasMore: opts.offset + rows.length < total };
}

export async function getStatsSummary(db: Queryable, since: Date | string) {
  const [{ rows: cur }, { rows: today }, { rows: hist }] = await Promise.all([
    db.query(`WITH ${LATEST_CTE}
      SELECT count(*) FILTER (WHERE decision = 'review' AND override_action IS NULL)::int AS pending_review,
             count(*) FILTER (WHERE decision = 'hold' AND override_action IS NULL)::int AS pending_hold
      FROM latest`),
    db.query(`SELECT count(*) FILTER (WHERE ud.decision = 'approve' AND ud.created_at >= $1)::int AS approved_events,
                     count(*) FILTER (WHERE ud.override_action IS NOT NULL AND ud.overridden_at >= $1)::int AS overrides
              FROM underwriting_decisions ud JOIN deals sd ON sd.id = ud.deal_id AND ${productionDealSql("sd")}`, [since]),
    db.query(`SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE ud.decision = 'approve')::int AS approved,
                     count(*) FILTER (WHERE ud.decision = 'review')::int AS review,
                     count(*) FILTER (WHERE ud.decision = 'hold')::int AS hold,
                     count(*) FILTER (WHERE ud.override_action IS NOT NULL)::int AS overridden
              FROM underwriting_decisions ud JOIN deals sd ON sd.id = ud.deal_id AND ${productionDealSql("sd")}`),
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
