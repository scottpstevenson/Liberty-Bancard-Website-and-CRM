/**
 * Phase 6 work presentation contracts (no database): one business time zone with DST edges, explicit task verbs, "no work exists"
 * versus "no matching work", exact selected-task and related-record destinations, statement/request exact paths, unmapped inbox
 * rows, the notification task target, and the unassigned-work queue (claim goes through the existing fenced edit, nothing assigns).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BUSINESS_TIMEZONE, businessDayKey, businessInputToInstant, businessZoneAbbreviation, businessZoneNote, formatBusinessDateTime,
  instantToBusinessInput, isDueBusinessToday, isSameBusinessDay,
} from "../shared/business-time";
import { taskActionVerb, taskEmptyState, taskRelatedLinks } from "../client/src/lib/task-presentation";
import { documentIdFromSearch, statementReviewHref, websiteRequestHref } from "../client/src/lib/statement-request-paths";
import {
  canClaimUnassignedWork, claimConflictMessage, isUnassignedWork, summarizeUnassigned, unassignedBlocker, workOwner,
} from "../client/src/lib/unassigned-work";
import { buildTaskCohortHref, buildTaskSelectionHref, taskCohortState, taskSelectionHref } from "../client/src/lib/crm-destination-state";
import { UNMAPPED_INBOX_ROW_MESSAGE, inboxRowOpenState } from "../client/src/lib/inbox-source";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const throws = (fn: () => unknown, message: string) => { assert.throws(fn, undefined, message); checks++; };
const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── Business time: one zone, DST edges, no browser-zone fallback ────────────────────────────────────────────────────
eq(BUSINESS_TIMEZONE, "America/New_York", "the single business zone is named once");
eq(businessZoneAbbreviation("2026-01-15T17:00:00Z"), "EST", "winter instants read EST");
eq(businessZoneAbbreviation("2026-07-15T16:00:00Z"), "EDT", "summer instants read EDT");
ok(businessZoneNote("2026-07-15T16:00:00Z").includes("not your device zone"), "the footnote states that the device zone is not used");
// Spring forward 2026-03-08 02:00 local (07:00Z): the civil day changes at local midnight, not at UTC midnight.
eq(businessDayKey("2026-03-08T04:59:00Z"), "2026-03-07", "before local midnight on the spring-forward day is still the prior day");
eq(businessDayKey("2026-03-08T05:00:00Z"), "2026-03-08", "local midnight starts the spring-forward day");
eq(businessDayKey("2026-03-09T03:59:00Z"), "2026-03-08", "the 23-hour day ends one UTC hour earlier than a normal day");
eq(businessDayKey("2026-03-09T04:00:00Z"), "2026-03-09", "the next day starts at 04:00Z after spring forward");
// Fall back 2026-11-01 02:00 EDT (06:00Z): that civil day lasts 25 hours.
eq(businessDayKey("2026-11-01T03:59:00Z"), "2026-10-31", "before local midnight on the fall-back day is the prior day");
eq(businessDayKey("2026-11-02T04:59:00Z"), "2026-11-01", "the 25-hour day still contains 04:59Z the next UTC day");
eq(businessDayKey("2026-11-02T05:00:00Z"), "2026-11-02", "the day after fall back starts at 05:00Z");
ok(isSameBusinessDay("2026-11-01T04:30:00Z", "2026-11-02T04:30:00Z"), "two instants 24h apart can share the 25-hour day");
eq(businessDayKey("not a date"), null, "an invalid instant is reported as null, never today");
eq(businessDayKey(null), null, "an empty instant is null");
ok(isDueBusinessToday("2026-11-12T03:00:00Z", new Date("2026-11-11T20:00:00Z")), "a 10 PM Eastern due time is due today even though UTC says tomorrow");
ok(!isDueBusinessToday("2026-11-12T05:00:00Z", new Date("2026-11-11T20:00:00Z")), "midnight Eastern is tomorrow");
eq(formatBusinessDateTime("2026-07-15T16:00:00Z"), "Jul 15, 2026, 12:00 PM EDT", "formatted instants state the business zone");
eq(formatBusinessDateTime("garbage"), "Invalid date", "invalid input is reported rather than blanked");
eq(formatBusinessDateTime(null, { empty: "No due date" }), "No due date", "empty input uses the caller's empty text");
eq(instantToBusinessInput("2026-03-08T07:30:00Z"), "2026-03-08T03:30", "datetime-local reads the business zone, not the device");
const ambiguous = businessInputToInstant("2026-11-01T01:30");
ok(ambiguous && ambiguous.toISOString() === "2026-11-01T05:30:00.000Z", "an ambiguous fall-back wall time resolves to the first occurrence");
const skipped = businessInputToInstant("2026-03-08T02:30");
ok(skipped && instantToBusinessInput(skipped) !== "2026-03-08T02:30", "a wall time skipped by spring forward never round-trips to the nonexistent time");
eq(businessInputToInstant("2026-13-40T99:99")?.toString() === "Invalid Date", false, "malformed ranges never produce an invalid Date object");
eq(businessInputToInstant("tomorrow"), null, "free text is rejected");
const roundTrip = businessInputToInstant("2026-07-15T09:15");
eq(roundTrip && instantToBusinessInput(roundTrip), "2026-07-15T09:15", "an ordinary wall time round-trips");

// ── Task presentation: verbs, empty states, related links ───────────────────────────────────────────────────────────
eq(taskActionVerb("pending"), { verb: "Start task", next: "in_progress" }, "a pending task offers Start task");
eq(taskActionVerb("in_progress"), { verb: "Mark complete", next: "completed" }, "an in-progress task offers Mark complete");
eq(taskActionVerb("completed"), null, "a completed task offers no transition");
eq(taskActionVerb("cancelled"), null, "a cancelled task offers no transition");
eq(taskActionVerb(null), null, "an unknown status offers no transition");
eq(taskEmptyState(3, 2), null, "rows present means no empty state");
eq(taskEmptyState(0, 0)?.kind, "none_exist", "no loaded tasks says none exist");
const noMatch = taskEmptyState(7, 0);
ok(noMatch?.kind === "no_match" && noMatch.canClear && noMatch.detail.startsWith("7 tasks are loaded"), "filtered-empty says no match, states the loaded count and can be cleared");
ok(taskEmptyState(1, 0)?.detail.startsWith("1 task is loaded"), "singular wording");
ok(taskEmptyState(0, 0)?.title !== taskEmptyState(7, 0)?.title, "the two empty states never share a title");
eq(taskRelatedLinks({ contactId: 5, dealId: 9, ticketId: 11 }).map(l => l.href),
  ["/dashboard/contacts/5", "/dashboard/pipeline?id=9", "/dashboard/tickets?id=11"], "related links are exact record destinations");
eq(taskRelatedLinks({ contactId: 0, dealId: -1, ticketId: 2147483648 }), [], "invalid ids create no link");
eq(taskRelatedLinks({ contactId: 1.5 as number, dealId: null }), [], "non-integer ids and nulls create no link");

// ── Selected task / cohort hrefs ────────────────────────────────────────────────────────────────────────────────────
eq(taskSelectionHref(15), "/dashboard/tasks-appointments?tab=tasks&taskId=15", "the selected task is an exact destination");
eq(buildTaskSelectionHref("/dashboard/tasks-appointments?tab=tasks&taskState=pending&junk=1&contactId=4", 8),
  "/dashboard/tasks-appointments?tab=tasks&contactId=4&taskState=pending&taskId=8", "selection keeps registered context and drops unregistered query state");
eq(buildTaskSelectionHref("/dashboard/tasks-appointments?taskId=3", null), "/dashboard/tasks-appointments?tab=tasks", "clearing selection removes taskId");
for (const bad of [0, -1, 1.5, 2147483648, Number.NaN]) throws(() => buildTaskSelectionHref("/dashboard/tasks-appointments", bad as number), `task id ${bad} is refused`);
eq(taskCohortState("?taskOwner=unassigned&due=overdue").owner, "unassigned", "unassigned owner is a registered selector");
eq(taskCohortState("?taskOwner=nobody").issues.length, 1, "an unsupported owner value is reported");
eq(taskCohortState("?taskOwner=nobody").owner, "all", "an unsupported owner value never broadens into a different view");
eq(buildTaskCohortHref("/dashboard/tasks-appointments", { status: "pending", due: "overdue", owner: "unassigned" }),
  "/dashboard/tasks-appointments?tab=tasks&taskState=pending&due=overdue&taskOwner=unassigned", "cohort href lists each selector once");

// ── Statement request <-> review exact paths ────────────────────────────────────────────────────────────────────────
eq(statementReviewHref(42), "/dashboard/statement-review?documentId=42", "a request opens its retained document's review");
throws(() => statementReviewHref(0), "document id 0 is refused");
throws(() => statementReviewHref(2147483648), "document id above int range is refused");
eq(documentIdFromSearch("?documentId=42"), 42, "a single valid documentId is read");
eq(documentIdFromSearch("?documentId=42&documentId=43"), null, "conflicting ids select nothing");
eq(documentIdFromSearch("?documentId=4x"), null, "a malformed id selects nothing");
eq(documentIdFromSearch("?documentId=0"), null, "zero selects nothing");
eq(websiteRequestHref(null), "/dashboard/lead-ops?tab=pipeline", "no reference opens the intake list");
eq(websiteRequestHref(" ab12cd "), "/dashboard/lead-ops?tab=pipeline&ref=AB12CD", "a reference is normalized to the short code");
throws(() => websiteRequestHref("../etc"), "a non-hex reference is refused");

const statementRoutes = read("server/routes/statement-review.ts");
ok(statementRoutes.includes('app.get("/api/statement-reviews/:id/request", requireRole("admin", "manager")'), "the request link is read by management roles only");
ok(statementRoutes.includes("if (!await authorizeReview(req, res, review)) return;") && !/if \(!review \|\| !await authorizeReview\(req, res, review\)\) return;\s*\n\s*(res\.setHeader|\n\s*let contactName)/.test(statementRoutes),
  "a missing review answers 404 instead of leaving the request open");
const patchStart = statementRoutes.indexOf('app.patch("/api/statement-reviews/:id"');
const patchEnd = statementRoutes.indexOf("\n  // POST /api/statement-reviews/:id/follow-up-draft", patchStart);
const patchRoute = patchStart >= 0 && patchEnd > patchStart ? statementRoutes.slice(patchStart, patchEnd) : "";
ok(patchRoute.includes("if (!await authorizeReview(req, res, existing, true)) return;") && !/!existing\s*\|\|/.test(patchRoute),
  "saving a missing or invisible review answers 404 instead of leaving the request open");
const draftStart = statementRoutes.indexOf('app.post("/api/statement-reviews/:id/follow-up-draft"');
const draftEnd = statementRoutes.indexOf("\n  // POST /api/statement-reviews — create", draftStart);
const draftRoute = draftStart >= 0 && draftEnd > draftStart ? statementRoutes.slice(draftStart, draftEnd) : "";
ok(draftRoute.includes("if (!await authorizeReview(req, res, review, true)) return;") && !/!review\s*\|\|/.test(draftRoute),
  "generating a follow-up draft for a missing or invisible review answers 404 instead of leaving the request open");
ok(statementRoutes.includes('eq(statementUploadCommands.operationScope, "statement_upload")') && statementRoutes.includes('reason: "ambiguous"'), "the link comes only from the recorded upload command and an ambiguous record is not guessed");

// ── Unmapped inbox rows and notification target ─────────────────────────────────────────────────────────────────────
eq(inboxRowOpenState({ channel: "email", contactId: null, detailAccess: "unmapped_contact" }), { openable: false, reason: UNMAPPED_INBOX_ROW_MESSAGE }, "the server's unmapped answer wins");
eq(inboxRowOpenState({ channel: "sms", contactId: null }), { openable: false, reason: UNMAPPED_INBOX_ROW_MESSAGE }, "an older server answer with no contact is not openable");
eq(inboxRowOpenState({ channel: "sms", contactId: 4 }), { openable: true }, "a mapped row opens");
eq(inboxRowOpenState({ channel: "site", contactId: null }), { openable: true }, "site rows open without a contact");
eq(inboxRowOpenState({ channel: "email", contactId: 4, detailAccess: "readable" }), { openable: true }, "a readable server answer opens");
const authority = read("server/services/notification-authority.ts");
ok(authority.includes("task:`/dashboard/tasks-appointments?tab=tasks&taskId=${target.id}`"), "a task notification opens the exact selected task");
ok(!authority.includes("authorized_list_fallback\",label:\"Open task list"), "the task list fallback label is retired");
const notifications = read("client/src/pages/dashboard/Notifications.tsx");
ok(notifications.indexOf("markReadMutation.mutate(notification.id)") > notifications.indexOf("target.state===\"available\""),
  "a notification is marked read only after its destination resolved");
ok(notifications.includes("This notification was left unread"), "a failed destination leaves the notification unread and says so");
ok(notifications.includes('role="alert"'), "the destination failure is announced");

// ── Unassigned-work queue: view, blocker and fenced single claim; no assignment policy ──────────────────────────────
eq(workOwner({ assignedTo: " ", canonicalAssignee: null }), null, "a blank owner is no owner");
eq(workOwner({ assignedTo: "legacy@x.test", canonicalAssignee: "canon@x.test" }), "canon@x.test", "the canonical assignee wins over the legacy field");
ok(isUnassignedWork({}), "a row with no owner fields is unassigned");
ok(canClaimUnassignedWork("admin") && canClaimUnassignedWork("manager"), "management roles may claim");
ok(!canClaimUnassignedWork("agent") && !canClaimUnassignedWork(undefined), "agents and unknown roles never see a claim");
eq(summarizeUnassigned([{ assignedTo: null }, { assignedTo: "a@x.test" }, { canonicalAssignee: null, due: 1 }], (r: any) => r.due === 1),
  { unassigned: 2, unassignedOverdue: 1, loaded: 3 }, "counts describe loaded rows only");
ok(unassignedBlocker("task", { contactId: 4 }).includes("only that record's current owner"), "a linked record states its blocker");
ok(unassignedBlocker("ticket", {}).includes("A manager or administrator must claim or assign it"), "an unlinked record names who can act");
eq(claimConflictMessage(new Error('409: {"message":"Record changed; reload"}')), "Record changed; reload", "a JSON conflict is shown verbatim");
eq(claimConflictMessage(new Error("409: plain body")), "plain body", "a plain conflict is shown verbatim");
ok(claimConflictMessage(new Error("")).includes("Reload the queue"), "an empty error still tells the operator what to do");
const claimWiring = read("client/src/components/work/UnassignedQueueBanner.tsx");
ok(!/assignmentPolicy|autoAssign|round.?robin/i.test(claimWiring.replace(/no assignment policy|No assignment policy/g, "")), "the queue banner contains no assignment policy");
const tasksPage = read("client/src/pages/dashboard/Tasks.tsx");
ok(tasksPage.includes("canClaimUnassignedWork") && tasksPage.includes("UnassignedQueueBanner"), "Work wires the queue banner and the role gate");
ok(tasksPage.includes("workCommands.edit(task, { assignedTo: user.email })") && tasksPage.includes('apiRequest("PUT", `/api/tasks/${task.id}`'),
  "a task claim is one fenced edit of one task, assigned to the signed-in manager");
ok(!/claim[A-Za-z]*All|bulkClaim/i.test(tasksPage), "there is no bulk claim");
const ticketsPage = read("client/src/pages/dashboard/Tickets.tsx");
ok(ticketsPage.includes("canClaimUnassignedWork") && ticketsPage.includes("UnassignedQueueBanner"), "Support wires the queue banner and the role gate");

console.log(`phase6 work presentation: ${checks} checks passed`);
