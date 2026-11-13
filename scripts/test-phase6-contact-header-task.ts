/**
 * Phase 6 R06: the contact header offers the same next action on every section.
 *
 * Disposable test database. The header's next task is a small section-independent fact (known task, none, or unavailable) read
 * on every contact projection with the Tasks section's own authorization predicate. This proves the read (order, states,
 * authorization, no payload beyond id and title), the pure header rule (same inputs, same link, business-time wording), and that
 * the route reads it for every section and the page uses it. Fixtures are tagged and removed.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { contacts, tasks } from "../shared/schema";
import { db } from "../server/db";
import { readContactNextTask } from "../server/services/task-read-authority";
import { headerNextAction } from "../client/src/lib/contact-header-presentation";
import { formatBusinessDateTime } from "../shared/business-time";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── Pure header rule ────────────────────────────────────────────────────────────────────────────────────────────────
const base = { nextFollowUp: null, activeDealId: null, pendingTask: null, pendingTasksLoaded: false } as const;
const known = { state: "known", task: { id: 41, title: "Call the owner" } } as const;
// The same facts give the same header whichever section's arrays happen to be loaded.
for (const loaded of [false, true]) {
  eq(headerNextAction({ ...base, pendingTasksLoaded: loaded, pendingTask: loaded ? { id: 99, title: "Other section's first row" } : null, taskFacts: known }),
    { text: "Complete task: Call the owner", href: "/dashboard/tasks-appointments?tab=tasks&taskId=41" }, `a known header task decides the link whether or not the Tasks rows are loaded (${loaded})`);
}
eq(headerNextAction({ ...base, nextFollowUp: undefined, taskFacts: { state: "known", task: null } }).text, "Scheduled action unavailable", "a follow-up that could not be read is still unavailable");
eq(headerNextAction({ ...base, nextFollowUp: null, taskFacts: { state: "known", task: null } }).text, "No next action scheduled", "a known 'no task' with no follow-up is a real none");
eq(headerNextAction({ ...base, nextFollowUp: null, taskFacts: { state: "unavailable" } }), { text: "Scheduled action unavailable", href: null }, "an unavailable task read is never 'no next action'");
eq(headerNextAction({ ...base, nextFollowUp: null, pendingTasksLoaded: true }).text, "No next action scheduled", "without header facts the loaded-rows fallback is unchanged");
eq(headerNextAction({ ...base, nextFollowUp: null, pendingTask: { id: 5, title: "Legacy" }, pendingTasksLoaded: true }).href, "/dashboard/tasks-appointments?tab=tasks&taskId=5", "the legacy fallback still links the exact task");
const followUp = "2026-11-12T03:30:00.000Z"; // 10:30 PM EST on Nov 11: the device date and the business date differ in most zones
eq(headerNextAction({ ...base, nextFollowUp: followUp, activeDealId: 7, taskFacts: known }),
  { text: `Follow up ${formatBusinessDateTime(followUp)}`, href: "/dashboard/pipeline?id=7" }, "a follow-up reads in business time and still wins over a task");
ok(formatBusinessDateTime(followUp).includes("Nov 11, 2026") && /\bEST\b/.test(formatBusinessDateTime(followUp)), "the follow-up states Eastern time and the Eastern calendar day");
eq(headerNextAction({ ...base, nextFollowUp: "garbage", taskFacts: known }).text, "Follow-up date needs review", "an unreadable follow-up is named, not hidden");
const presentation = read("client/src/lib/contact-header-presentation.ts");
ok(!/toLocale(?:Date|Time)?String/.test(presentation), "the header presentation never formats in the device zone");

// ── Source wiring ───────────────────────────────────────────────────────────────────────────────────────────────────
const route = read("server/routes/crm-operations.ts");
const detailRoute = route.slice(route.indexOf('app.get("/api/contacts/:id/detail"'), route.indexOf("// === EXPORT CSV ==="));
ok(/headerTaskFacts=await readContactNextTask\(\{actor:req\.user as any,asOf,timezone:"UTC"\},contactId\)/.test(detailRoute) && /\bheaderTaskFacts,/.test(detailRoute), "every contact projection returns the header task facts");
ok(detailRoute.indexOf("readContactNextTask") > detailRoute.indexOf("loadTasks=") && !/loadTasks\s*\?\s*await readContactNextTask|if\s*\(loadTasks\)[^;]*readContactNextTask/.test(detailRoute), "the header read does not depend on the Tasks section being requested");
const page = read("client/src/pages/dashboard/ContactDetail.tsx");
ok(page.includes("taskFacts: data.headerTaskFacts ?? null"), "the page uses the section-independent fact");
ok(/staleTime: 0,\s*refetchOnWindowFocus: true/.test(page), "returning to the tab or revisiting a section re-reads the header facts");
ok(!/retained.*headerTaskFacts|coreStore\.current\.observe\([^)]*headerTaskFacts/.test(page), "the retained contact core never stores the task fact");
ok(read("client/src/lib/retained-contact-core.ts").includes("return { contact: detail.contact, capabilities: detail.capabilities };"), "the retained core still holds only contact and capabilities");

// ── Database: the read ──────────────────────────────────────────────────────────────────────────────────────────────
const tag = `p6header-${randomUUID().slice(0, 8)}`;
const created = { contacts: [] as number[], tasks: [] as number[] };
const phoneBase = String(Date.now()).slice(-7);
let phoneCounter = 0;
async function makeContact(label: string, assignedTo: string | null = null) {
  const [row] = await db.insert(contacts).values({
    firstName: `${tag}-${label}`, lastName: "Fixture", email: `${tag}-${label}@example.invalid`,
    phone: `+1555${phoneBase}${phoneCounter++}`.slice(0, 12), recordClass: "production", ...(assignedTo ? { assignedTo } : {}),
  } as never).returning({ id: contacts.id });
  created.contacts.push(row.id);
  return row.id;
}
async function makeTask(contactId: number | null, label: string, input: { status?: string; dueInDays?: number | null; deleted?: boolean; description?: string } = {}) {
  const [row] = await db.insert(tasks).values({ title: `${tag} ${label}`, description: input.description ?? "private detail", contactId, status: input.status ?? "pending" } as never).returning({ id: tasks.id });
  created.tasks.push(row.id);
  if (input.dueInDays !== undefined && input.dueInDays !== null) await db.execute(sql`UPDATE tasks SET due_date = now() AT TIME ZONE 'UTC' + make_interval(days => ${input.dueInDays}) WHERE id = ${row.id}`);
  // The authority column is the effective state; a real completion writes both, so the fixture does too.
  if (input.status && input.status !== "pending") await db.execute(sql`UPDATE tasks SET authority_state = ${input.status} WHERE id = ${row.id}`);
  if (input.deleted) await db.execute(sql`UPDATE tasks SET deleted_at = now() WHERE id = ${row.id}`);
  return row.id;
}
const asOf = () => new Date();
const admin = { role: "admin", email: "admin@example.invalid" };

try {
  const contactA = await makeContact("a", "rep-a@example.invalid");
  const contactB = await makeContact("b", "rep-b@example.invalid");
  const empty = await makeContact("empty");

  const undated = await makeTask(contactA, "undated");
  const later = await makeTask(contactA, "later", { dueInDays: 5 });
  const soonest = await makeTask(contactA, "soonest", { dueInDays: -2, status: "in_progress" });
  const tie1 = await makeTask(contactA, "tie-1", { dueInDays: 9 });
  await makeTask(contactA, "completed", { dueInDays: -9, status: "completed" });
  await makeTask(contactA, "cancelled", { dueInDays: -9, status: "cancelled" });
  await makeTask(contactA, "deleted", { dueInDays: -9, deleted: true });
  const otherContactTask = await makeTask(contactB, "b-task", { dueInDays: -20 });
  void undated; void later; void tie1;

  const factsA = await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "UTC" }, contactA);
  eq(factsA, { state: "known", task: { id: soonest, title: `${tag} soonest` } }, "the soonest-due open or in-progress task wins; completed, cancelled and deleted tasks never do");
  eq(Object.keys((factsA as { task: object }).task).sort(), ["id", "title"], "the fact carries only id and title, never description or notes");
  const factsB = await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "UTC" }, contactB);
  eq(factsB, { state: "known", task: { id: otherContactTask, title: `${tag} b-task` } }, "another contact's task is its own contact's fact");
  eq(await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "UTC" }, empty), { state: "known", task: null }, "a contact with no open task is a known none");

  // Undated tasks sort last: with only an undated and a dated task, the dated one leads; with only undated, it is the answer.
  const onlyUndated = await makeContact("only-undated");
  const undatedOnlyTask = await makeTask(onlyUndated, "only-undated");
  eq((await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "UTC" }, onlyUndated)), { state: "known", task: { id: undatedOnlyTask, title: `${tag} only-undated` } }, "an undated open task is still offered when it is the only one");

  // Authorization: an agent only reads tasks on contacts assigned to them (the Tasks section's own predicate).
  const agentOwner = { role: "agent", email: "rep-a@example.invalid" };
  const agentOther = { role: "agent", email: "someone-else@example.invalid" };
  const ownerFacts = await readContactNextTask({ actor: agentOwner, asOf: asOf(), timezone: "UTC" }, contactA);
  eq(ownerFacts, { state: "known", task: { id: soonest, title: `${tag} soonest` } }, "the assigned agent gets the header task");
  eq(await readContactNextTask({ actor: agentOther, asOf: asOf(), timezone: "UTC" }, contactA), { state: "known", task: null }, "an agent who does not own the contact gets no task fact");

  // A failed read is unavailable, never 'no task'.
  const originalError = console.error; console.error = () => undefined;
  try {
    eq(await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "Not/A_Zone" }, contactA), { state: "unavailable" }, "a read that cannot run is unavailable, not none");
  } finally { console.error = originalError; }

  // Completing the task elsewhere changes the next read (the page re-reads on focus/revisit).
  await db.execute(sql`UPDATE tasks SET status = 'completed', authority_state = 'completed' WHERE id = ${soonest}`);
  const afterComplete = await readContactNextTask({ actor: admin, asOf: asOf(), timezone: "UTC" }, contactA);
  ok(afterComplete.state === "known" && afterComplete.task && afterComplete.task.id !== soonest, "a task completed elsewhere is not offered on the next read");
} finally {
  if (created.tasks.length) await db.delete(tasks).where(inArray(tasks.id, created.tasks));
  if (created.contacts.length) await db.delete(contacts).where(inArray(contacts.id, created.contacts));
}

console.log(`Phase 6 contact header task: ${checks} checks passed`);
process.exit(0);
