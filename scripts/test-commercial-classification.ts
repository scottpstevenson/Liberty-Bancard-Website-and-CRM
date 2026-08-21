#!/usr/bin/env npx tsx
/**
 * BT-06 integration classification tests.
 * Requires an isolated non-production Postgres database migrated through 0150.
 */
import crypto from "crypto";
import { db } from "../server/db";
import { contacts, commercialClassificationEvents } from "../shared/schema";
import { and, eq } from "drizzle-orm";
import {
  applyClassification,
  authorizeUse,
  createPreviewCommand,
  approveCommand,
  executeApprovedCommand,
  getCurrentClass,
} from "../server/services/commercial-classification-authority";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run BT-06 classification tests in production.");
}

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

async function main() {
  const nonce = crypto.randomUUID();
  const [contact] = await db.insert(contacts).values({
    firstName: "BT06",
    lastName: "Classification",
    email: `bt06-${nonce}@test.invalid`,
    phone: "3055550101",
  }).returning();

  assert(contact.recordClass === "unknown", "new roots default to unknown");
  const unknownMarketing = await authorizeUse({ contactId: contact.id, purpose: "marketing_outreach" });
  assert(!unknownMarketing.allowed && unknownMarketing.reasonCode === "COMMERCIAL_CLASS_UNKNOWN", "unknown contact is quarantined from marketing");
  const unknownTransactional = await authorizeUse({ contactId: contact.id, purpose: "transactional_response" });
  assert(unknownTransactional.allowed, "unknown contact can receive transactional response");

  const eventKey = `promotion:${nonce}`;
  const transition = await applyClassification({
    subjectType: "contact",
    subjectId: contact.id,
    targetClass: "production",
    eventNamespace: "bt06-test",
    eventKey,
    evidenceFields: { reviewSource: "isolated_test", verifiedAt: "2026-08-21" },
    actorId: "test-requester",
    approverId: "test-approver",
  });
  assert(transition.applied, "approved evidence-backed production transition applies");
  assert(await getCurrentClass("contact", contact.id) === "production", "root projection follows immutable event");
  assert((await authorizeUse({ contactId: contact.id, purpose: "marketing_outreach" })).allowed, "production contact can pass marketing gate");

  const replay = await applyClassification({
    subjectType: "contact",
    subjectId: contact.id,
    targetClass: "production",
    eventNamespace: "bt06-test",
    eventKey,
    evidenceFields: { reviewSource: "isolated_test", verifiedAt: "2026-08-21" },
    actorId: "test-requester",
    approverId: "test-approver",
  });
  assert(replay.duplicate && !replay.applied, "event namespace/key replay is idempotent");
  const events = await db.select({ id: commercialClassificationEvents.id }).from(commercialClassificationEvents).where(and(
    eq(commercialClassificationEvents.eventNamespace, "bt06-test"),
    eq(commercialClassificationEvents.eventKey, eventKey),
  ));
  assert(events.length === 1, "idempotent replay leaves exactly one immutable event");

  let piiRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "test",
      eventNamespace: "bt06-test", eventKey: `pii:${nonce}`,
      evidenceFields: { nested: { email_body: "sensitive email content" } }, actorId: "test",
    });
  } catch { piiRejected = true; }
  assert(piiRejected, "nested sensitive evidence fields are rejected before persistence");

  let emptyEvidenceRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "production",
      eventNamespace: "bt06-test", eventKey: `empty-evidence:${nonce}`,
      evidenceFields: {}, actorId: "requester", approverId: "approver",
    });
  } catch { emptyEvidenceRejected = true; }
  assert(emptyEvidenceRejected, "production cannot be promoted without an allowlisted evidence reference");

  let selfApprovalRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "production",
      eventNamespace: "bt06-test", eventKey: `self-approval:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" },
      actorId: "same-admin", approverId: "same-admin",
    });
  } catch { selfApprovalRejected = true; }
  assert(selfApprovalRejected, "production transition requires an independent approver");

  let missingActorRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "production",
      eventNamespace: "bt06-test", eventKey: `missing-actor:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, approverId: "admin-only",
    });
  } catch { missingActorRejected = true; }
  assert(missingActorRejected, "production transition requires a recorded requester and approver");

  const conflictingReplay = await Promise.allSettled([
    applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "test",
      eventNamespace: "bt06-test", eventKey: `conflict:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, actorId: "test",
    }),
    applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "demo",
      eventNamespace: "bt06-test", eventKey: `conflict:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, actorId: "test",
    }),
  ]);
  assert(
    conflictingReplay.filter((result) => result.status === "fulfilled").length === 1 &&
      conflictingReplay.filter((result) => result.status === "rejected").length === 1,
    "conflicting concurrent replay cannot alter the immutable event projection",
  );

  const [otherContact] = await db.insert(contacts).values({
    firstName: "BT06",
    lastName: "Other Subject",
    email: `bt06-other-${nonce}@test.invalid`,
    phone: "3055550102",
  }).returning();
  const crossSubjectReplay = await Promise.allSettled([
    applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "demo",
      eventNamespace: "bt06-test", eventKey: `cross-subject:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, actorId: "test",
    }),
    applyClassification({
      subjectType: "contact", subjectId: otherContact.id, targetClass: "synthetic",
      eventNamespace: "bt06-test", eventKey: `cross-subject:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, actorId: "test",
    }),
  ]);
  const primaryClass = await getCurrentClass("contact", contact.id);
  const otherClass = await getCurrentClass("contact", otherContact.id);
  assert(
    crossSubjectReplay.filter((result) => result.status === "fulfilled").length === 1 &&
      crossSubjectReplay.filter((result) => result.status === "rejected").length === 1 &&
      [primaryClass, otherClass].filter((recordClass) =>
        recordClass === "demo" || recordClass === "synthetic",
      ).length === 1,
    "cross-subject key collision cannot commit an unjournaled root projection",
  );

  let missingSubjectRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: 2147483647, targetClass: "test",
      eventNamespace: "bt06-test", eventKey: `missing-subject:${nonce}`,
      evidenceFields: { reviewSource: "isolated_test" }, actorId: "test",
    });
  } catch { missingSubjectRejected = true; }
  assert(missingSubjectRejected, "classification cannot create an event for an absent subject");

  const preview = await createPreviewCommand({
    idempotencyKey: crypto.randomUUID(),
    subjectType: "contact",
    subjectId: contact.id,
    targetClass: "test",
    evidenceFields: { reviewSource: "isolated_test" },
    requestedBy: "manager-test",
  });
  assert(preview.status === "created", "manager preview command is created");
  const approval = await approveCommand({ commandId: preview.commandId, approvedBy: "admin-test", versionLock: 0 });
  assert(approval.approved && !approval.conflict, "admin can approve current command version");
  const execution = await executeApprovedCommand(preview.commandId, "admin-test");
  assert(execution.executed, "approved command executes into immutable event");
  assert(await getCurrentClass("contact", contact.id) === "test", "executed command updates root projection");

  if (failed) process.exit(1);
  console.log(`\n✓ BT-06 commercial classification integration passed (${passed} checks).`);
}

main().catch((error) => {
  console.error("BT-06 integration test crashed:", error);
  process.exit(1);
});