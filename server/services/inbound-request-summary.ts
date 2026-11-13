import { sql } from "drizzle-orm";
import { db } from "../db";

/**
 * Operator-facing populations for website submissions. Each number answers ONE question and fails on its own to null
 * ("unavailable"), so a slow section can never read as zero or as an all-clear.
 *
 *  - received            website requests that arrived in the window (production + unknown records)
 *  - needsReview         requests still waiting for an owner or a review decision (all time, not windowed)
 *  - statementAttention  statement uploads whose automatic processing did not start or finish (all time)
 *  - tasksDueToday /
 *    tasksOverdue        OPEN request-linked work, split by Eastern-time day boundaries (never one merged number)
 *
 * Excluded from every number above, and counted so the exclusion is visible: requests whose contact is a test/demo/
 * synthetic record, and requests whose contact is archived. A contact of unknown class is NOT excluded: an unclassified
 * submission still carries an obligation.
 */
export interface InboundRequestSummary {
  asOf: string;
  windowDays: number;
  timezone: "America/New_York";
  received: number | null;
  needsReview: number | null;
  statementAttention: number | null;
  tasksDueToday: number | null;
  tasksOverdue: number | null;
  excluded: { nonProduction: number | null; archived: number | null };
}

const NON_PRODUCTION = sql`c.record_class IN ('test', 'demo', 'synthetic')`;
const INCLUDED = sql`(c.id IS NULL OR (c.archived_at IS NULL AND c.record_class NOT IN ('test', 'demo', 'synthetic')))`;

/** Windowed intake populations. The summary counts them and the Intake list filters to them with this one definition. */
export const INBOUND_INTAKE_COHORTS = ["received", "needs_review", "statement_attention"] as const;
export type InboundIntakeCohort = typeof INBOUND_INTAKE_COHORTS[number];
export const INBOUND_TASK_COHORTS = ["due_today", "overdue"] as const;
export type InboundTaskCohort = typeof INBOUND_TASK_COHORTS[number];
export const clampSummaryWindowDays = (windowDays: unknown) => Math.min(Math.max(Math.trunc(Number(windowDays)) || 7, 1), 90);

/** Request ids in one intake population (aliases: r = inbound_requests, c = contacts, e = statement_review effect). */
export function inboundIntakeCohortIds(cohort: InboundIntakeCohort, windowDays = 7) {
  const days = clampSummaryWindowDays(windowDays);
  switch (cohort) {
    case "received":
      return sql`SELECT DISTINCT r.id FROM inbound_requests r LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.source_category = 'website_form' AND r.created_at >= now() - make_interval(days => ${days}) AND ${INCLUDED}`;
    case "needs_review":
      return sql`SELECT DISTINCT r.id FROM inbound_requests r LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.source_category = 'website_form' AND ${INCLUDED}
          AND r.lifecycle_state NOT IN ('failed', 'cancelled', 'completed')
          AND (r.lifecycle_state = 'review_required' OR r.assignment_status IN ('review_required', 'unassigned_policy_missing'))`;
    case "statement_attention":
      return sql`SELECT DISTINCT r.id FROM inbound_requests r
        JOIN inbound_request_effects e ON e.request_id = r.id AND e.effect_key = 'statement_review'
        LEFT JOIN contacts c ON c.id = r.contact_id
        WHERE r.source_type = 'statement_upload' AND ${INCLUDED} AND e.state IN ('held', 'failed')
          AND r.lifecycle_state NOT IN ('cancelled')`;
  }
}

/** Task ids of OPEN request-linked work due today (Eastern) or before today. One definition for the count and the Work list. */
export function inboundTaskCohortIds(cohort: InboundTaskCohort) {
  const ET = sql`'America/New_York'`;
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${ET}) AT TIME ZONE ${ET})`;
  const tomorrowStart = sql`((date_trunc('day', now() AT TIME ZONE ${ET}) + interval '1 day') AT TIME ZONE ${ET})`;
  const openTasks = sql`t.deleted_at IS NULL AND t.authority_state = 'open' AND COALESCE(t.status, 'pending') NOT IN ('completed', 'cancelled')`;
  const due = cohort === "due_today"
    ? sql`t.due_date IS NOT NULL AND (t.due_date AT TIME ZONE 'UTC') >= ${todayStart} AND (t.due_date AT TIME ZONE 'UTC') < ${tomorrowStart}`
    : sql`t.due_date IS NOT NULL AND (t.due_date AT TIME ZONE 'UTC') < ${todayStart}`;
  return sql`SELECT DISTINCT t.id
    FROM inbound_request_work_links l
    JOIN inbound_requests r ON r.id = l.request_id AND r.source_category = 'website_form'
    JOIN tasks t ON t.id = l.task_id
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE l.work_type = 'task' AND ${INCLUDED} AND ${openTasks} AND ${due}`;
}

/** Task ids of one cohort, for the Work list to select exactly the counted tasks. Throws when the read fails (never an empty list). */
export async function readInboundTaskCohort(cohort: InboundTaskCohort): Promise<{ cohort: InboundTaskCohort; asOf: string; timezone: "America/New_York"; taskIds: number[] }> {
  const result = await db.execute(inboundTaskCohortIds(cohort));
  const taskIds = (result.rows as Array<{ id: number | string }>).map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id));
  return { cohort, asOf: new Date().toISOString(), timezone: "America/New_York", taskIds: taskIds.sort((a, b) => a - b) };
}

async function count(query: ReturnType<typeof sql>): Promise<number | null> {
  try {
    const result = await db.execute(query);
    const value = (result.rows[0] as { n?: string | number } | undefined)?.n;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (error) {
    console.error("[InboundSummary] population unavailable:", error instanceof Error ? error.name : "unknown");
    return null;
  }
}

export async function getInboundRequestSummary(windowDays = 7): Promise<InboundRequestSummary> {
  const days = clampSummaryWindowDays(windowDays);
  const countOf = (ids: ReturnType<typeof sql>) => count(sql`SELECT count(*)::int AS n FROM (${ids}) cohort`);
  const [received, needsReview, statementAttention, tasksDueToday, tasksOverdue, nonProduction, archived] = await Promise.all([
    countOf(inboundIntakeCohortIds("received", days)),
    countOf(inboundIntakeCohortIds("needs_review", days)),
    countOf(inboundIntakeCohortIds("statement_attention", days)),
    countOf(inboundTaskCohortIds("due_today")),
    countOf(inboundTaskCohortIds("overdue")),
    count(sql`SELECT count(*)::int AS n FROM inbound_requests r JOIN contacts c ON c.id = r.contact_id
      WHERE r.source_category = 'website_form' AND r.created_at >= now() - make_interval(days => ${days}) AND ${NON_PRODUCTION}`),
    count(sql`SELECT count(*)::int AS n FROM inbound_requests r JOIN contacts c ON c.id = r.contact_id
      WHERE r.source_category = 'website_form' AND r.created_at >= now() - make_interval(days => ${days})
        AND c.archived_at IS NOT NULL AND c.record_class NOT IN ('test', 'demo', 'synthetic')`),
  ]);
  return {
    asOf: new Date().toISOString(),
    windowDays: days,
    timezone: "America/New_York",
    received, needsReview, statementAttention, tasksDueToday, tasksOverdue,
    excluded: { nonProduction, archived },
  };
}
