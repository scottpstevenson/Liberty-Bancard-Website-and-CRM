/**
 * Phase 6 R01: task -> website request -> retained file evidence.
 *
 * Runs on the disposable test database with uniquely tagged fixtures that it removes. Proves the projection comes only from
 * recorded work links and the recorded statement upload command, never from description text, and that every non-linked,
 * held, missing, ambiguous, mismatched and restricted state is explicit. Also proves the pure client contract (links,
 * notices, safe Work return) and that the route authorizes the task with the actor-scoped exact read first.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { eq as sqlEq, inArray } from "drizzle-orm";
import {
  contacts, documents, inboundRequests, inboundRequestWorkLinks, statementReviews, statementUploadCommands, tasks,
} from "../shared/schema";
import {
  parseTaskEvidence, safeWorkReturn, taskEvidenceActions, taskEvidenceNotice, withWorkReturn, type TaskEvidence,
} from "../shared/task-evidence";
import { safeParams, workReturnFromSearch } from "../client/src/lib/crm-destination-state";
import { db } from "../server/db";
import { readTaskEvidence } from "../server/services/task-evidence";
import { inboundShortRef } from "../server/services/inbound-request-authority";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── Pure client contract ─────────────────────────────────────────────────────────────────────────────────────────────
const WORK = "/dashboard/tasks-appointments?tab=tasks&due=overdue&taskId=7072";
eq(safeWorkReturn(WORK), WORK, "a Work list URL with its filters is a valid return");
eq(safeWorkReturn("/dashboard/tasks-appointments"), "/dashboard/tasks-appointments", "the bare Work route is valid");
for (const bad of ["https://evil.example/dashboard/tasks-appointments", "//evil.example", "/dashboard/contacts", "/dashboard/tasks-appointments/../admin",
  "/dashboard/tasks-appointments?x=<script>", "javascript:alert(1)", "", null, undefined]) {
  eq(safeWorkReturn(bad as string | null), null, `unsafe return ${String(bad)} is dropped`);
}
eq(withWorkReturn("/dashboard/lead-ops?tab=pipeline&ref=269B66AF", WORK),
  `/dashboard/lead-ops?tab=pipeline&ref=269B66AF&from=${encodeURIComponent(WORK)}`, "the safe return rides as `from`");
eq(withWorkReturn("/dashboard/lead-ops?tab=pipeline&ref=269B66AF", "/dashboard/contacts"), "/dashboard/lead-ops?tab=pipeline&ref=269B66AF", "an unsafe return is not appended");
const carried = new URL(withWorkReturn("/dashboard/contacts/166168", WORK), "http://x");
eq(workReturnFromSearch(carried.search), WORK, "the destination reads the same validated return");
eq(workReturnFromSearch(`from=${encodeURIComponent(WORK)}&from=${encodeURIComponent("/dashboard/tasks-appointments?tab=calendar")}`), null, "a repeated return is refused");
eq(safeParams(carried.search, ["from"]).get("from"), WORK, "the shared destination parameter policy keeps the Work return");
eq(safeParams(`from=${encodeURIComponent("/dashboard/contacts")}`, ["from"]).get("from"), "/dashboard/contacts", "a bare dashboard path is still a valid return elsewhere");

const ref = "269B66AF";
const receipt = "269b66af-1111-4111-8111-111111111111";
const linked: TaskEvidence = {
  taskId: 7072, state: "linked", reason: null,
  request: { requestReceipt: receipt, shortRef: ref, sourceType: "statement_upload", lifecycleState: "accepted", createdAt: "2026-11-12T12:00:00.000Z", contactId: 166168 },
  file: { state: "retained", documentId: 1077, fileName: "statement.pdf", fileSize: 2048, mimeType: "application/pdf",
    review: { state: "present", reviewId: 31, status: "received" }, analysis: "held" },
};
eq(parseTaskEvidence(JSON.parse(JSON.stringify(linked)), 7072)?.request?.shortRef, ref, "a well-formed linked response parses");
eq(parseTaskEvidence(linked, 7073), null, "evidence for another task is refused");
eq(parseTaskEvidence({ ...linked, state: "bogus" }, 7072), null, "an unknown state is refused");
eq(parseTaskEvidence({ ...linked, request: { ...linked.request, shortRef: "../x" } }, 7072), null, "a malformed reference is refused");
eq(parseTaskEvidence({ ...linked, request: null }, 7072), null, "linked without a request is refused");
eq(parseTaskEvidence({ taskId: 7072, state: "none_recorded", request: linked.request, file: null, reason: null }, 7072), null, "a non-linked state may not carry a request");
eq(parseTaskEvidence(null, 7072), null, "null is refused");
const actions = taskEvidenceActions(linked, WORK);
eq(actions.map(a => a.kind), ["request", "review"], "a linked request with a retained file and one review offers both actions");
eq(actions[0].label, "Open request 269B66AF", "the request action names the reference");
ok(actions[0].href.startsWith("/dashboard/lead-ops?tab=pipeline&ref=269B66AF&from="), "the request action opens the exact reference with a safe return");
ok(actions[1].href.startsWith("/dashboard/statement-review?documentId=1077&from="), "the review action opens the exact retained document");
eq(taskEvidenceActions({ ...linked, file: { ...linked.file!, review: { state: "none", reviewId: null, status: null } } }, null).map(a => a.kind), ["request"], "no review means no review link");
eq(taskEvidenceNotice({ ...linked, file: { ...linked.file!, review: { state: "none", reviewId: null, status: null } } }), "The file is retained and no analyst review exists for it yet.", "no-review state is explained");
eq(taskEvidenceNotice({ ...linked, file: { ...linked.file!, review: { state: "ambiguous", reviewId: null, status: null } } }), "More than one analyst review exists for this file, so none is opened automatically.", "ambiguous review is explained");
for (const state of ["none_recorded", "ambiguous", "mismatch", "restricted"] as const) {
  const evidence: TaskEvidence = { taskId: 1, state, request: null, file: null, reason: state };
  eq(taskEvidenceActions(evidence, WORK), [], `${state} offers no link`);
  ok(taskEvidenceNotice(evidence), `${state} always says why`);
}
eq(taskEvidenceNotice(linked), null, "a fully resolved evidence needs no notice");

// ── Route and component source contracts ────────────────────────────────────────────────────────────────────────────
const route = read("server/routes/tickets-tasks.ts");
const routeStart = route.indexOf('app.get("/api/tasks/:id/evidence"');
const routeBody = routeStart >= 0 ? route.slice(routeStart, route.indexOf("\n  app.post(\"/api/tasks\"", routeStart)) : "";
ok(routeBody.includes("isDashboardUser"), "the evidence route requires a dashboard user");
ok(routeBody.indexOf("storage.getTasks(") >= 0 && routeBody.indexOf("storage.getTasks(") < routeBody.indexOf("readTaskEvidence("), "the task is authorized by the actor-scoped exact read before any evidence is resolved");
ok(routeBody.includes("denyCrmObject(res)"), "a task the actor cannot read is an indistinguishable denial");
ok(routeBody.includes("no-store"), "evidence is never cached");
const service = read("server/services/task-evidence.ts");
ok(!/description/i.test(service.replace(/\/\*[\s\S]*?\*\//g, "")), "the service never reads a task description");
ok(service.includes("inboundRequestWorkLinks") && service.includes("readStatementOccurrenceTruth"), "evidence comes from recorded work links and the recorded statement command");
const panel = read("client/src/components/work/SelectedTaskPanel.tsx");
ok(panel.includes("/api/tasks/${taskId}/evidence") && panel.includes("user?.accountVersion"), "the panel reads evidence keyed by actor and permission generation");
ok(panel.includes("gcTime: 0") && panel.includes("staleTime: 0"), "evidence is never reused from cache");

// ── Database: the recorded relationships ────────────────────────────────────────────────────────────────────────────
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const tag = `p6evidence-${randomUUID().slice(0, 8)}`;
const created = { contacts: [] as number[], tasks: [] as number[], requests: [] as string[], docs: [] as number[] };
const phoneBase = String(Date.now()).slice(-7);
let phoneCounter = 0;
async function makeContact(label: string) {
  const [row] = await db.insert(contacts).values({
    firstName: `${tag}-${label}`, lastName: "Fixture", email: `${tag}-${label}@example.invalid`,
    phone: `+1555${phoneBase}${phoneCounter++}`.slice(0, 12), recordClass: "test",
  } as never).returning({ id: contacts.id });
  created.contacts.push(row.id);
  return row.id;
}
async function makeTask(contactId: number | null, description = "") {
  const [row] = await db.insert(tasks).values({ title: `${tag} task`, description, contactId, status: "pending" } as never).returning({ id: tasks.id });
  created.tasks.push(row.id);
  return row.id;
}
async function makeRequest(sourceType: string, contactId: number | null) {
  const key = randomUUID();
  const [row] = await db.insert(inboundRequests).values({
    idempotencyKey: key, occurrenceKey: randomUUID(), requestFingerprint: sha(randomUUID()), sourceCategory: "website_form", sourceType,
    sourceClass: "sales_request", callerScope: `test:${tag}`, actorType: "system", manifestVersion: "test", manifestHash: sha("manifest"), contactId,
  } as never).returning({ id: inboundRequests.id, idempotencyKey: inboundRequests.idempotencyKey });
  created.requests.push(row.id);
  return row;
}
const linkTask = (requestId: string, taskId: number) => db.insert(inboundRequestWorkLinks).values({ requestId, workType: "task", taskId, commandKey: `${tag}-${randomUUID()}` } as never);
async function makeDocument(contactId: number | null) {
  const [row] = await db.insert(documents).values({ type: "statement", fileName: `${tag}.pdf`, fileSize: 2048, mimeType: "application/pdf", contactId } as never).returning({ id: documents.id });
  created.docs.push(row.id);
  return row.id;
}
const recordCommand = (requestKey: string, documentId: number | null) => db.insert(statementUploadCommands).values({
  requestId: requestKey, requestFingerprint: sha(randomUUID()), operationScope: "statement_upload", ownerScope: `test:${tag}`, documentId, status: "succeeded",
} as never);

try {
  const contactA = await makeContact("a");
  const contactB = await makeContact("b");

  // Restricted roles never resolve request or file identity, even for a linked task.
  const restrictedTask = await makeTask(contactA);
  const restrictedRequest = await makeRequest("estimate_form", contactA);
  await linkTask(restrictedRequest.id, restrictedTask);
  for (const role of ["agent", "merchant", "partner", "affiliate", "", undefined, null]) {
    const evidence = await readTaskEvidence({ taskId: restrictedTask, taskContactId: contactA, role: role as string | null | undefined });
    eq([evidence.state, evidence.request, evidence.file], ["restricted", null, null], `role ${JSON.stringify(role)} gets no request identity`);
  }

  // No recorded link: a reference pasted into the description is never parsed.
  const decoyRef = inboundShortRef(restrictedRequest.id);
  const decoyTask = await makeTask(contactA, `Review request ${decoyRef} and receipt ${restrictedRequest.id}`);
  const none = await readTaskEvidence({ taskId: decoyTask, taskContactId: contactA, role: "admin" });
  eq([none.state, none.request, none.file], ["none_recorded", null, null], "a reference in the description is not evidence");

  // Non-statement request: request identity, no file.
  const plain = await readTaskEvidence({ taskId: restrictedTask, taskContactId: contactA, role: "manager" });
  eq([plain.state, plain.request?.shortRef, plain.file], ["linked", inboundShortRef(restrictedRequest.id), null], "an estimate request resolves with no file");

  // Statement request with a retained document and one analyst review (the 269B66AF -> task -> contact -> file shape).
  const stmtRequest = await makeRequest("statement_upload", contactA);
  const stmtTask = await makeTask(contactA);
  await linkTask(stmtRequest.id, stmtTask);
  const doc = await makeDocument(contactA);
  await recordCommand(stmtRequest.idempotencyKey, doc);
  const noReview = await readTaskEvidence({ taskId: stmtTask, taskContactId: contactA, role: "admin" });
  eq([noReview.state, noReview.file?.state, noReview.file?.documentId, noReview.file?.review.state], ["linked", "retained", doc, "none"], "a retained file with no review says so");
  eq(noReview.file?.fileName, `${tag}.pdf`, "retained file metadata is shown");
  eq(taskEvidenceActions(noReview, null).map(a => a.kind), ["request"], "no review means only the request opens");
  const [review] = await db.insert(statementReviews).values({ documentId: doc, contactId: contactA, status: "received" } as never).returning({ id: statementReviews.id });
  const withReview = await readTaskEvidence({ taskId: stmtTask, taskContactId: contactA, role: "admin" });
  eq([withReview.file?.review.state, withReview.file?.review.reviewId], ["present", review.id], "one review resolves exactly");
  eq(taskEvidenceActions(withReview, WORK).map(a => a.kind), ["request", "review"], "request and review both open");
  ok(withReview.file?.analysis !== "completed", "held analysis is never reported as completed");
  // statement_reviews_document_identity_uidx makes a second review for one document impossible in the database; the
  // ambiguous review state stays a defensive client/service state and is covered by the pure checks above.
  await db.delete(statementReviews).where(inArray(statementReviews.id, [review.id]));

  // Upload command recorded without a document: no retained file claimed.
  const heldRequest = await makeRequest("statement_upload", contactA);
  const heldTask = await makeTask(contactA);
  await linkTask(heldRequest.id, heldTask);
  await recordCommand(heldRequest.idempotencyKey, null);
  const held = await readTaskEvidence({ taskId: heldTask, taskContactId: contactA, role: "admin" });
  eq([held.state, held.file?.state, held.file?.documentId], ["linked", "none_recorded", null], "a command with no document claims no retained file");

  // Statement request with no upload command at all: unavailable detail, never a guess.
  const bareRequest = await makeRequest("statement_upload", contactA);
  const bareTask = await makeTask(contactA);
  await linkTask(bareRequest.id, bareTask);
  const bare = await readTaskEvidence({ taskId: bareTask, taskContactId: contactA, role: "admin" });
  eq([bare.state, bare.file?.state], ["linked", "none_recorded"], "a statement request with no recorded command has no recorded file");

  // Two requests recorded against one task are ambiguous; neither identity is returned.
  const dupTask = await makeTask(contactA);
  const dupOne = await makeRequest("estimate_form", contactA);
  const dupTwo = await makeRequest("callback_form", contactA);
  await linkTask(dupOne.id, dupTask);
  await linkTask(dupTwo.id, dupTask);
  const ambiguous = await readTaskEvidence({ taskId: dupTask, taskContactId: contactA, role: "admin" });
  eq([ambiguous.state, ambiguous.request], ["ambiguous", null], "two recorded requests are not chosen between");

  // A recorded request for another contact is a mismatch and shows nothing.
  const foreignRequest = await makeRequest("statement_upload", contactA);
  const foreignTask2 = await makeTask(contactB);
  await linkTask(foreignRequest.id, foreignTask2);
  const mismatch = await readTaskEvidence({ taskId: foreignTask2, taskContactId: contactB, role: "admin" });
  eq([mismatch.state, mismatch.request, mismatch.file], ["mismatch", null, null], "a request recorded for a different contact shows no identity or file");

  // Read-only: no rows are written by any evidence read.
  const before = (await db.select({ id: inboundRequestWorkLinks.id }).from(inboundRequestWorkLinks).where(inArray(inboundRequestWorkLinks.requestId, created.requests))).length;
  await readTaskEvidence({ taskId: stmtTask, taskContactId: contactA, role: "admin" });
  const after = (await db.select({ id: inboundRequestWorkLinks.id }).from(inboundRequestWorkLinks).where(inArray(inboundRequestWorkLinks.requestId, created.requests))).length;
  eq(after, before, "reading evidence writes nothing");
} finally {
  if (created.requests.length) {
    await db.delete(inboundRequestWorkLinks).where(inArray(inboundRequestWorkLinks.requestId, created.requests));
    for (const requestId of created.requests) {
      const [row] = await db.select({ key: inboundRequests.idempotencyKey }).from(inboundRequests).where(sqlEq(inboundRequests.id, requestId));
      if (row) await db.delete(statementUploadCommands).where(sqlEq(statementUploadCommands.requestId, row.key));
    }
    await db.delete(inboundRequests).where(inArray(inboundRequests.id, created.requests));
  }
  if (created.docs.length) {
    await db.delete(statementReviews).where(inArray(statementReviews.documentId, created.docs));
    await db.delete(documents).where(inArray(documents.id, created.docs));
  }
  if (created.tasks.length) await db.delete(tasks).where(inArray(tasks.id, created.tasks));
  if (created.contacts.length) await db.delete(contacts).where(inArray(contacts.id, created.contacts));
}

console.log(`Phase 6 task evidence: ${checks} checks passed`);
process.exit(0);
