import { and, eq, sql, type SQL } from "drizzle-orm";
import { tasks } from "@shared/schema";
import { db } from "../db";
import { syntheticQaIdentitySql } from "@shared/synthetic-qa-identity";

export type TaskReadScope = {
  actor?: { role?: string; email?: string | null };
  recordClass?: "production" | "test" | "demo" | "all";
  states?: readonly ("open" | "in_progress" | "completed" | "cancelled")[];
  asOf: Date;
  timezone: string;
  dueFrom?: Date; dueBefore?: Date;
  dealId?: number; source?: "sla" | "manual";
};

/** Authority state wins; legacy values are only a fallback for unmigrated rows. */
export const taskStateSql = sql`COALESCE(${tasks.authorityState}, CASE
  WHEN lower(${tasks.status}) IN ('completed','complete','done') THEN 'completed'
  WHEN lower(${tasks.status}) IN ('cancelled','canceled') THEN 'cancelled'
  WHEN lower(${tasks.status}) IN ('in progress','in_progress') THEN 'in_progress' ELSE 'open' END)`;

/** Contract v1: nondeleted tasks, all linked objects in selected class and not
 * archived; linked agent ownership is exact, unlinked tasks use task assignee.
 * Unlinked tasks require the agent's exact task assignee. Counts are successful DB reads, never
 * error fallbacks. asOf freezes date comparisons, not concurrent DB snapshots.
 */
export function taskReadPredicate(scope: TaskReadScope): SQL {
  if (!Number.isFinite(scope.asOf.getTime())) throw new Error("TASK_ASOF_INVALID");
  new Intl.DateTimeFormat("en", { timeZone: scope.timezone }).format(scope.asOf);
  const recordClass = scope.recordClass ?? "production";
  const agent = scope.actor?.role === "agent";
  const owner = scope.actor?.email ?? "";
  const contactFilter = (alias: string) => sql`
    ${sql.raw(`${alias}.archived_at`)} IS NULL
    ${recordClass !== "all" ? sql`AND ${sql.raw(`${alias}.record_class`)}=${recordClass}` : sql``}
    ${recordClass === "production" ? sql`AND NOT ${sql.raw(syntheticQaIdentitySql(alias))}` : sql``}
    ${agent ? sql`AND ${sql.raw(`${alias}.assigned_to`)}=${owner}` : sql``}`;
  return and(
    sql`${tasks.deletedAt} IS NULL`,
    sql`(${tasks.contactId} IS NULL OR EXISTS(SELECT 1 FROM contacts tc
      WHERE tc.id=${tasks.contactId} AND ${contactFilter("tc")}))`,
    sql`(${tasks.dealId} IS NULL OR EXISTS(SELECT 1 FROM deals td WHERE td.id=${tasks.dealId}
      AND td.archived_at IS NULL
      ${recordClass !== "all" ? sql`AND td.record_class=${recordClass}` : sql``}
      ${agent ? sql`AND td.owner=${owner}` : sql``}))`,
    sql`(${tasks.ticketId} IS NULL OR EXISTS(SELECT 1 FROM tickets tt JOIN contacts ttc ON ttc.id=tt.contact_id
      WHERE tt.id=${tasks.ticketId} AND ${contactFilter("ttc")}))`,
    agent ? sql`(${tasks.contactId} IS NOT NULL OR ${tasks.dealId} IS NOT NULL OR ${tasks.ticketId} IS NOT NULL
      OR COALESCE(${tasks.canonicalAssignee},${tasks.assignedTo})=${owner})` : undefined,
    scope.states ? (scope.states.length
      ? sql`${taskStateSql} IN (${sql.join(scope.states.map(state => sql`${state}`), sql`,`)})`
      : sql`FALSE`) : undefined,
    scope.dueFrom ? sql`${tasks.dueDate} >= ${scope.dueFrom}` : undefined,
    scope.dueBefore ? sql`${tasks.dueDate} < ${scope.dueBefore}` : undefined,
    scope.dealId ? eq(tasks.dealId, scope.dealId) : undefined,
    scope.source === "sla" ? eq(tasks.source, "sla") : scope.source === "manual" ? sql`${tasks.source} IS NULL` : undefined,
  )!;
}

export async function readTaskMetrics(scope: TaskReadScope) {
  const result = await db.execute(sql`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER(WHERE ${taskStateSql}='open')::int AS pending,
    COUNT(*) FILTER(WHERE ${taskStateSql}='in_progress')::int AS in_progress,
    COUNT(*) FILTER(WHERE ${taskStateSql}='completed')::int AS completed,
    COUNT(*) FILTER(WHERE ${taskStateSql}='cancelled')::int AS cancelled,
    COUNT(*) FILTER(WHERE ${taskStateSql} IN ('open','in_progress') AND ${tasks.dueDate}<${scope.asOf})::int AS overdue
    FROM ${tasks} WHERE ${taskReadPredicate(scope)}`);
  return { rows: result.rows as Array<{ total: number; pending: number; in_progress: number; completed: number; cancelled: number; overdue: number }>, meta: { contractVersion: 1, population: "scoped_non_deleted_tasks",
    recordClass: scope.recordClass ?? "production", actorScope: scope.actor?.role === "agent" ? "owned_linked_or_owned_unlinked" : "management",
    timezone: scope.timezone, asOf: scope.asOf.toISOString(), exact: true, snapshot: "statement" } };
}