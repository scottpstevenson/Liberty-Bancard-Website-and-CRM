/**
 * Phase 6 R05: a count action opens the population it counted.
 *
 * Disposable test database. Seeds one included and one excluded row per Website-requests card (nonproduction contact,
 * archived contact, wrong category, wrong state, outside the window, outside the Eastern day), then proves that for every
 * card the summary count, the Intake list filtered to the group, and the Work task-id read name the same members. Fixtures
 * are tagged and removed. Totals of different cards are never forced to equal one another.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { contacts, inboundRequestEffects, inboundRequestWorkLinks, inboundRequests, tasks } from "../shared/schema";
import { db } from "../server/db";
import { listInboundRequests } from "../server/services/inbound-request-authority";
import {
  INBOUND_INTAKE_COHORTS, getInboundRequestSummary, readInboundTaskCohort, type InboundIntakeCohort,
} from "../server/services/inbound-request-summary";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const tag = `p6cohort-${randomUUID().slice(0, 8)}`;
const created = { contacts: [] as number[], tasks: [] as number[], requests: [] as string[] };
const phoneBase = String(Date.now()).slice(-7);
let phoneCounter = 0;

async function makeContact(label: string, recordClass: string, archived = false) {
  const [row] = await db.insert(contacts).values({
    firstName: `${tag}-${label}`, lastName: "Fixture", email: `${tag}-${label}@example.invalid`,
    phone: `+1555${phoneBase}${phoneCounter++}`.slice(0, 12), recordClass, ...(archived ? { archivedAt: new Date() } : {}),
  } as never).returning({ id: contacts.id });
  created.contacts.push(row.id);
  return row.id;
}
async function makeRequest(label: string, input: {
  contactId: number | null; lifecycle?: string; assignment?: string; category?: string; sourceType?: string; ageDays?: number;
}) {
  const [row] = await db.insert(inboundRequests).values({
    idempotencyKey: randomUUID(), occurrenceKey: randomUUID(), requestFingerprint: sha(randomUUID()),
    sourceCategory: input.category ?? "website_form", sourceType: input.sourceType ?? "contact_form",
    sourceClass: "sales_request", callerScope: `test:${tag}:${label}`, actorType: "system", manifestVersion: "test", manifestHash: sha("manifest"),
    contactId: input.contactId, lifecycleState: input.lifecycle ?? "claimed", assignmentStatus: input.assignment ?? "assigned",
  } as never).returning({ id: inboundRequests.id });
  created.requests.push(row.id);
  if (input.ageDays) {
    await db.execute(sql`UPDATE inbound_requests SET created_at = now() - make_interval(days => ${input.ageDays}) WHERE id = ${row.id}`);
  }
  return row.id;
}
const addEffect = (requestId: string, state: string) => db.insert(inboundRequestEffects).values({
  requestId, effectKey: "statement_review", effectType: "statement_review", state,
} as never);
/** A due time `offsetSeconds` after the start of today in Eastern time, stored the way tasks store it (UTC wall time). */
const dueAtEastern = (offsetSeconds: number) => sql`((date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York') + make_interval(secs => ${offsetSeconds})) AT TIME ZONE 'UTC'`;
async function makeTask(label: string, contactId: number | null, input: { status?: string; dueOffsetSeconds: number | null; deleted?: boolean }) {
  const [row] = await db.insert(tasks).values({ title: `${tag} ${label}`, contactId, status: input.status ?? "pending" } as never).returning({ id: tasks.id });
  created.tasks.push(row.id);
  if (input.dueOffsetSeconds !== null) await db.execute(sql`UPDATE tasks SET due_date = ${dueAtEastern(input.dueOffsetSeconds)} WHERE id = ${row.id}`);
  if (input.deleted) await db.execute(sql`UPDATE tasks SET deleted_at = now() WHERE id = ${row.id}`);
  return row.id;
}
const link = (requestId: string, taskId: number) => db.insert(inboundRequestWorkLinks).values({ requestId, workType: "task", taskId, commandKey: `${tag}-${randomUUID()}` } as never);

async function listAll(kind: InboundIntakeCohort, windowDays?: number) {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await listInboundRequests({ limit: 200, offset, cohort: { kind, windowDays } });
    ids.push(...page.map((row) => row.id));
    if (page.length < 200) return ids;
  }
}

try {
  const production = await makeContact("prod", "production");
  const unclassified = await makeContact("unknown", "unknown");
  const test = await makeContact("test", "test");
  const archived = await makeContact("archived", "production", true);

  // ── Intake groups ─────────────────────────────────────────────────────────────────────────────────────────────────
  const r = {
    reviewRequired: await makeRequest("review-required", { contactId: production, lifecycle: "review_required" }),
    unassigned: await makeRequest("unassigned", { contactId: unclassified, assignment: "unassigned_policy_missing" }),
    completedReview: await makeRequest("completed", { contactId: production, lifecycle: "completed", assignment: "review_required" }),
    failedReview: await makeRequest("failed", { contactId: production, lifecycle: "failed", assignment: "review_required" }),
    noContact: await makeRequest("no-contact", { contactId: null, assignment: "review_required" }),
    old: await makeRequest("old", { contactId: production, lifecycle: "review_required", ageDays: 20 }),
    testContact: await makeRequest("test-contact", { contactId: test, lifecycle: "review_required" }),
    archivedContact: await makeRequest("archived-contact", { contactId: archived, lifecycle: "review_required" }),
    otherCategory: await makeRequest("other-category", { contactId: production, lifecycle: "review_required", category: "provider_event", sourceType: "provider_event" }),
    stmtHeld: await makeRequest("stmt-held", { contactId: production, sourceType: "statement_upload" }),
    stmtFailed: await makeRequest("stmt-failed", { contactId: unclassified, sourceType: "statement_upload" }),
    stmtDone: await makeRequest("stmt-done", { contactId: production, sourceType: "statement_upload" }),
    stmtCancelled: await makeRequest("stmt-cancelled", { contactId: production, sourceType: "statement_upload", lifecycle: "cancelled" }),
    stmtTest: await makeRequest("stmt-test", { contactId: test, sourceType: "statement_upload" }),
  };
  await addEffect(r.stmtHeld, "held");
  await addEffect(r.stmtFailed, "failed");
  await addEffect(r.stmtDone, "sent");
  await addEffect(r.stmtCancelled, "held");
  await addEffect(r.stmtTest, "held");

  const summary = await getInboundRequestSummary(7);
  const mine = new Set(created.requests);
  const expectedMembers: Record<InboundIntakeCohort, string[]> = {
    needs_review: [r.reviewRequired, r.unassigned, r.noContact, r.old],
    statement_attention: [r.stmtHeld, r.stmtFailed],
    received: [r.reviewRequired, r.unassigned, r.completedReview, r.failedReview, r.noContact, r.stmtHeld, r.stmtFailed, r.stmtDone, r.stmtCancelled],
  };
  const countFor: Record<InboundIntakeCohort, number | null> = {
    needs_review: summary.needsReview, statement_attention: summary.statementAttention, received: summary.received,
  };
  for (const kind of INBOUND_INTAKE_COHORTS) {
    const members = await listAll(kind, 7);
    eq(members.filter((id) => mine.has(id)).sort(), [...expectedMembers[kind]].sort(), `${kind}: the list holds exactly the fixture rows the predicate admits`);
    eq(members.length, countFor[kind], `${kind}: the summary count equals the number of rows the list opens`);
    ok(![r.testContact, r.archivedContact, r.stmtTest, r.otherCategory].some((id) => members.includes(id)), `${kind}: test, archived and non-website rows are excluded from count and list alike`);
  }
  ok(!(await listAll("received", 7)).includes(r.old), "a request outside the window is not in the windowed group");
  ok((await listAll("received", 30)).includes(r.old), "the same request is in a wider window");
  const wide = await getInboundRequestSummary(30);
  eq((await listAll("received", 30)).length, wide.received, "received: a different window changes count and list together");
  eq((await listAll("needs_review", 30)).length, wide.needsReview, "needs_review is all-time: the window does not change it");
  eq(wide.needsReview, summary.needsReview, "needs_review count is independent of the window");

  // The list's own filters still compose with the group (never replace it).
  const reviewOnly = await listInboundRequests({ limit: 200, lifecycleState: "review_required", cohort: { kind: "needs_review" } });
  ok(reviewOnly.every((row) => row.lifecycleState === "review_required") && reviewOnly.some((row) => row.id === r.reviewRequired) && !reviewOnly.some((row) => row.id === r.unassigned), "a lifecycle filter narrows the group instead of replacing it");

  // ── Request tasks (Eastern day boundaries) ────────────────────────────────────────────────────────────────────────
  const reqA = await makeRequest("task-a", { contactId: production });
  const reqB = await makeRequest("task-b", { contactId: unclassified });
  const reqTest = await makeRequest("task-test", { contactId: test });
  const reqArchived = await makeRequest("task-archived", { contactId: archived });
  const reqOther = await makeRequest("task-other", { contactId: production, category: "provider_event", sourceType: "provider_event" });
  const DAY = 86_400;
  const t = {
    todayStartExact: await makeTask("today-start", production, { dueOffsetSeconds: 0 }),
    todayNoon: await makeTask("today-noon", production, { dueOffsetSeconds: 12 * 3600, status: "in_progress" }),
    todayEnd: await makeTask("today-end", production, { dueOffsetSeconds: DAY - 1 }),
    tomorrowStart: await makeTask("tomorrow-start", production, { dueOffsetSeconds: DAY }),
    justBeforeToday: await makeTask("just-before", production, { dueOffsetSeconds: -1 }),
    lastWeek: await makeTask("last-week", unclassified, { dueOffsetSeconds: -7 * DAY }),
    completedOverdue: await makeTask("completed", production, { dueOffsetSeconds: -2 * DAY, status: "completed" }),
    cancelledToday: await makeTask("cancelled", production, { dueOffsetSeconds: 3600, status: "cancelled" }),
    deletedOverdue: await makeTask("deleted", production, { dueOffsetSeconds: -2 * DAY, deleted: true }),
    noDue: await makeTask("no-due", production, { dueOffsetSeconds: null }),
    testOverdue: await makeTask("test-overdue", production, { dueOffsetSeconds: -3 * DAY }),
    archivedOverdue: await makeTask("archived-overdue", production, { dueOffsetSeconds: -3 * DAY }),
    otherCategoryOverdue: await makeTask("other-overdue", production, { dueOffsetSeconds: -3 * DAY }),
    unlinkedOverdue: await makeTask("unlinked-overdue", production, { dueOffsetSeconds: -3 * DAY }),
  };
  await link(reqA, t.todayStartExact); await link(await makeRequest("task-a2", { contactId: production }), t.todayNoon);
  await link(await makeRequest("task-a3", { contactId: production }), t.todayEnd); await link(await makeRequest("task-a4", { contactId: production }), t.tomorrowStart);
  await link(await makeRequest("task-a5", { contactId: production }), t.justBeforeToday); await link(reqB, t.lastWeek);
  await link(await makeRequest("task-a6", { contactId: production }), t.completedOverdue); await link(await makeRequest("task-a7", { contactId: production }), t.cancelledToday);
  await link(await makeRequest("task-a8", { contactId: production }), t.deletedOverdue); await link(await makeRequest("task-a9", { contactId: production }), t.noDue);
  await link(reqTest, t.testOverdue); await link(reqArchived, t.archivedOverdue); await link(reqOther, t.otherCategoryOverdue);
  // t.unlinkedOverdue deliberately has no request link: a task is not request work because of its name, contact or text.

  const taskSummary = await getInboundRequestSummary(7);
  const dueToday = await readInboundTaskCohort("due_today");
  const overdue = await readInboundTaskCohort("overdue");
  const mineTasks = new Set(created.tasks);
  eq(dueToday.taskIds.filter((id) => mineTasks.has(id)), [t.todayStartExact, t.todayNoon, t.todayEnd].sort((a, b) => a - b), "due today: the start of the Eastern day is in, the next day's start is out, open states only");
  eq(overdue.taskIds.filter((id) => mineTasks.has(id)), [t.justBeforeToday, t.lastWeek].sort((a, b) => a - b), "overdue: one second before today and older open linked work; completed, deleted, excluded and unlinked tasks are out");
  eq(dueToday.taskIds.length, taskSummary.tasksDueToday, "due today: the count equals the number of task ids Work opens");
  eq(overdue.taskIds.length, taskSummary.tasksOverdue, "overdue: the count equals the number of task ids Work opens");
  ok(!dueToday.taskIds.some((id) => overdue.taskIds.includes(id)), "due today and overdue never share a task");
  eq(dueToday.timezone, "America/New_York", "the group states its business time zone");

  // Completing a counted task removes it from the next read (another tab's change shows up on refetch).
  await db.execute(sql`UPDATE tasks SET status = 'completed' WHERE id = ${t.lastWeek}`);
  const afterComplete = await readInboundTaskCohort("overdue");
  ok(!afterComplete.taskIds.includes(t.lastWeek), "a task completed elsewhere leaves the group on the next read");
  eq(afterComplete.taskIds.length, (await getInboundRequestSummary(7)).tasksOverdue, "the count follows the same change");
} finally {
  if (created.requests.length) {
    await db.delete(inboundRequestWorkLinks).where(inArray(inboundRequestWorkLinks.requestId, created.requests));
    await db.delete(inboundRequestEffects).where(inArray(inboundRequestEffects.requestId, created.requests));
    await db.delete(inboundRequests).where(inArray(inboundRequests.id, created.requests));
  }
  if (created.tasks.length) await db.delete(tasks).where(inArray(tasks.id, created.tasks));
  if (created.contacts.length) await db.delete(contacts).where(inArray(contacts.id, created.contacts));
}

console.log(`Phase 6 intake cohorts: ${checks} checks passed`);
process.exit(0);
