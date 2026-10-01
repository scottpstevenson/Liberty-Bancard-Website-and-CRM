#!/usr/bin/env npx tsx
/**
 * BT-06 integration classification tests.
 * Requires an isolated non-production Postgres database migrated through 0150.
 */
import crypto from "crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  PASS ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

async function main() {
  // Must happen before any server/database import so this suite cannot
  // initialize the application's configured pool against a shared database.
  await assertDisposableTestInfrastructure({
    operation: "commercial-classification-test",
  });

  const [{ db }, schema, drizzle, authority] = await Promise.all([
    import("../server/db"),
    import("../shared/schema"),
    import("drizzle-orm"),
    import("../server/services/commercial-classification-authority"),
  ]);
  const {
    businesses,
    canonicalSourceLinks,
    contacts,
    deals,
    commercialClassificationEvents,
    sunbizBootstrapClaims,
    sunbizEntities,
  } = schema;
  const { and, eq } = drizzle;
  const {
    applyClassification,
    authorizeUse,
    createPreviewCommand,
    approveCommand,
    executeApprovedCommand,
    getCurrentClass,
    initializeSunbizBootstrapBusinessClass,
  } = authority;

  const nonce = crypto.randomUUID();

  async function makeSunbizBusinessFixture(
    suffix: string,
    options: {
      includeClaim?: boolean;
      entityName?: string;
      website?: string | null;
      phone?: string | null;
      city?: string | null;
      state?: string | null;
      score?: string;
      lineageBusinessId?: number;
      claimStatus?: "claimed" | "created";
      claimBusinessId?: number;
    } = {},
  ) {
    const filingNumber = `BT06-${nonce}-${suffix}`;
    const entityName = options.entityName ?? `Sunbiz ${suffix} LLC`;
    const website = options.website === undefined ? `https://${suffix}.example.test` : options.website;
    const phone = options.phone === undefined ? "3055550199" : options.phone;
    const city = options.city === undefined ? "Miami" : options.city;
    const state = options.state === undefined ? "FL" : options.state;
    const [entity] = await db.insert(sunbizEntities).values({
      filingNumber,
      entityName,
      website,
      phone,
      principalCity: city,
      principalState: state,
      score: options.score ?? "hot",
    }).returning();
    const [business] = await db.insert(businesses).values({
      canonicalName: entityName,
      normalizedName: entityName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      websiteDomain: website?.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "") ?? null,
      mainPhone: phone?.replace(/\D/g, "") ?? null,
      city,
      state,
    }).returning();
    const claimLease = new Date(Date.now() - 1_000);
    if (options.includeClaim !== false) {
      await db.insert(sunbizBootstrapClaims).values({
        filingNumber,
        sunbizEntityId: entity.id,
        status: options.claimStatus ?? "claimed",
        businessId: options.claimStatus === "created" ? (options.claimBusinessId ?? business.id) : null,
        claimedAt: claimLease,
      });
    }
    const lineageBusinessId = options.lineageBusinessId ?? business.id;
    await db.insert(canonicalSourceLinks).values({
      businessId: lineageBusinessId,
      sourceSystem: "sunbiz",
      sourceType: "sunbiz_entity",
      stableKey: filingNumber,
    });
    return { filingNumber, entity, business, claimLease };
  }

  // The automated Sunbiz policy is evidence-gated independently of the
  // human-reviewed applyClassification path. Invalid fences/provenance and
  // blank evidence leave the default unknown projection untouched.
  const missingClaimFixture = await makeSunbizBusinessFixture("missing-claim", { includeClaim: false });
  const missingClaim = await initializeSunbizBootstrapBusinessClass({
    businessId: missingClaimFixture.business.id,
    filingNumber: missingClaimFixture.filingNumber,
    claimMode: "active_lease",
    claimLease: missingClaimFixture.claimLease,
  });
  assert(missingClaim.decision === "quarantined" && missingClaim.recordClass === "unknown", "missing fenced claim is denied and remains unknown");
  assert(await getCurrentClass("business", missingClaimFixture.business.id) === "unknown", "missing claim cannot promote the business projection");

  const blankEvidenceFixture = await makeSunbizBusinessFixture("blank-evidence", {
    entityName: " ",
    website: " ",
    phone: "123",
    city: null,
    state: null,
  });
  const blankEvidence = await initializeSunbizBootstrapBusinessClass({
    businessId: blankEvidenceFixture.business.id,
    filingNumber: blankEvidenceFixture.filingNumber,
    claimMode: "active_lease",
    claimLease: blankEvidenceFixture.claimLease,
  });
  assert(blankEvidence.decision === "quarantined" && blankEvidence.recordClass === "unknown", "blank name and identity evidence are denied and remain unknown");

  const mismatchedClaimFixture = await makeSunbizBusinessFixture("mismatched-claim");
  const mismatchedClaim = await initializeSunbizBootstrapBusinessClass({
    businessId: mismatchedClaimFixture.business.id,
    filingNumber: mismatchedClaimFixture.filingNumber,
    claimMode: "active_lease",
    claimLease: new Date(mismatchedClaimFixture.claimLease.getTime() + 60_000),
  });
  assert(mismatchedClaim.decision === "quarantined" && mismatchedClaim.recordClass === "unknown", "mismatched claim lease is denied and remains unknown");

  const wrongRepairStatusFixture = await makeSunbizBusinessFixture("wrong-repair-status");
  const wrongRepairStatus = await initializeSunbizBootstrapBusinessClass({
    businessId: wrongRepairStatusFixture.business.id,
    filingNumber: wrongRepairStatusFixture.filingNumber,
    claimMode: "completed_bootstrap",
  });
  assert(wrongRepairStatus.decision === "quarantined" && wrongRepairStatus.recordClass === "unknown", "repair policy rejects claims not in the created state");

  const mismatchedLineageFixture = await makeSunbizBusinessFixture("mismatched-lineage", {
    lineageBusinessId: missingClaimFixture.business.id,
  });
  const mismatchedLineage = await initializeSunbizBootstrapBusinessClass({
    businessId: mismatchedLineageFixture.business.id,
    filingNumber: mismatchedLineageFixture.filingNumber,
    claimMode: "active_lease",
    claimLease: mismatchedLineageFixture.claimLease,
  });
  assert(mismatchedLineage.decision === "quarantined" && mismatchedLineage.recordClass === "unknown", "lineage linked to a different business is denied and remains unknown");

  const validBootstrapFixture = await makeSunbizBusinessFixture("valid-bootstrap");
  const validBootstrap = await initializeSunbizBootstrapBusinessClass({
    businessId: validBootstrapFixture.business.id,
    filingNumber: validBootstrapFixture.filingNumber,
    claimMode: "active_lease",
    claimLease: validBootstrapFixture.claimLease,
  });
  assert(validBootstrap.decision === "initialized" && validBootstrap.recordClass === "production" && validBootstrap.applied, "verified bootstrap evidence initializes production through its source policy");
  assert(await getCurrentClass("business", validBootstrapFixture.business.id) === "production", "verified bootstrap policy updates the business projection");
  const bootstrapEvents = await db.select().from(commercialClassificationEvents).where(and(
    eq(commercialClassificationEvents.eventNamespace, "sunbiz_bootstrap"),
    eq(commercialClassificationEvents.subjectType, "business"),
    eq(commercialClassificationEvents.subjectId, validBootstrapFixture.business.id),
  ));
  assert(
    bootstrapEvents.length === 1 &&
      bootstrapEvents[0].newClass === "production" &&
      bootstrapEvents[0].approverId === null &&
      bootstrapEvents[0].actorId === "service:sunbiz_bootstrap" &&
      (bootstrapEvents[0].evidenceFields as Record<string, unknown>).review_source === "sunbiz_bootstrap_evidence_policy_v1",
    "verified bootstrap writes a policy receipt with truthful service actor and no approver identity",
  );

  const completedBootstrapFixture = await makeSunbizBusinessFixture("completed-bootstrap", { claimStatus: "created" });
  const completedBootstrap = await initializeSunbizBootstrapBusinessClass({
    businessId: completedBootstrapFixture.business.id,
    filingNumber: completedBootstrapFixture.filingNumber,
    claimMode: "completed_bootstrap",
  });
  assert(
    completedBootstrap.decision === "initialized" &&
      completedBootstrap.recordClass === "production" &&
      completedBootstrap.applied,
    "completed repair policy promotes only a created claim with matching source evidence",
  );

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

  const sunbizSpoofEventKey = `sunbiz-policy-spoof:${nonce}`;
  let publicSunbizPolicySpoofRejected = false;
  try {
    await applyClassification({
      subjectType: "contact",
      subjectId: contact.id,
      targetClass: "production",
      eventNamespace: "bt06-test",
      eventKey: sunbizSpoofEventKey,
      evidenceFields: {
        source_system: "sunbiz_bootstrap",
        external_reference: "sunbiz-filing-ref:disposable-test",
        classification_reason: "verified_sunbiz_bootstrap_evidence",
        review_source: "sunbiz_bootstrap_evidence_policy_v1",
      },
      actorId: "service:sunbiz_bootstrap",
      approverId: null,
    });
  } catch {
    publicSunbizPolicySpoofRejected = true;
  }
  const sunbizSpoofEvents = await db.select({ id: commercialClassificationEvents.id }).from(commercialClassificationEvents).where(and(
    eq(commercialClassificationEvents.eventNamespace, "bt06-test"),
    eq(commercialClassificationEvents.eventKey, sunbizSpoofEventKey),
  ));
  assert(
    publicSunbizPolicySpoofRejected &&
      await getCurrentClass("contact", contact.id) === "unknown" &&
      sunbizSpoofEvents.length === 0,
    "public applyClassification rejects a Sunbiz service actor with null approver and spoofed policy metadata without changing class or creating an event",
  );

  const eventKey = `promotion:${nonce}`;
  const transition = await applyClassification({
    subjectType: "contact",
    subjectId: contact.id,
    targetClass: "production",
    eventNamespace: "bt06-test",
    eventKey,
    evidenceFields: { review_source: "isolated_test", verified_at: "2026-08-21" },
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
    evidenceFields: { review_source: "isolated_test", verified_at: "2026-08-21" },
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
      evidenceFields: { review_source: "isolated_test" },
      actorId: "same-admin", approverId: "same-admin",
    });
  } catch { selfApprovalRejected = true; }
  assert(selfApprovalRejected, "production transition requires an independent approver");

  let missingActorRejected = false;
  try {
    await applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "production",
      eventNamespace: "bt06-test", eventKey: `missing-actor:${nonce}`,
      evidenceFields: { review_source: "isolated_test" }, approverId: "admin-only",
    });
  } catch { missingActorRejected = true; }
  assert(missingActorRejected, "production transition requires a recorded requester and approver");

  const conflictingReplay = await Promise.allSettled([
    applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "test",
      eventNamespace: "bt06-test", eventKey: `conflict:${nonce}`,
      evidenceFields: { review_source: "isolated_test" }, actorId: "test",
    }),
    applyClassification({
      subjectType: "contact", subjectId: contact.id, targetClass: "demo",
      eventNamespace: "bt06-test", eventKey: `conflict:${nonce}`,
      evidenceFields: { review_source: "isolated_test" }, actorId: "test",
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
      evidenceFields: { review_source: "isolated_test" }, actorId: "test",
    }),
    applyClassification({
      subjectType: "contact", subjectId: otherContact.id, targetClass: "synthetic",
      eventNamespace: "bt06-test", eventKey: `cross-subject:${nonce}`,
      evidenceFields: { review_source: "isolated_test" }, actorId: "test",
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
      evidenceFields: { review_source: "isolated_test" }, actorId: "test",
    });
  } catch { missingSubjectRejected = true; }
  assert(missingSubjectRejected, "classification cannot create an event for an absent subject");

  const [rootlessDeal] = await db.insert(deals).values({
    title: `BT06 rootless deal ${nonce}`,
    pipeline: "sales",
    stage: "New Lead",
  } as any).returning();
  let rootlessDealRejected = false;
  try {
    await createPreviewCommand({
      idempotencyKey: crypto.randomUUID(),
      subjectType: "deal",
      subjectId: rootlessDeal.id,
      targetClass: "production",
      evidenceFields: { review_source: "isolated_test" },
      evidenceRefs: [],
      requestedBy: "manager-test",
    });
  } catch (error) {
    rootlessDealRejected = String(error).includes("CLASSIFICATION_GRAPH_QUARANTINED");
  }
  assert(rootlessDealRejected, "production command rejects a deal with no required commercial root");

  const preview = await createPreviewCommand({
    idempotencyKey: crypto.randomUUID(),
    subjectType: "contact",
    subjectId: contact.id,
    targetClass: "test",
    evidenceFields: { review_source: "isolated_test" },
    evidenceRefs: [{ kind: "classification_event", id: transition.eventId }],
    requestedBy: "manager-test",
  });
  assert(preview.status === "created", "manager preview command is created");
  const approval = await approveCommand({ commandId: preview.commandId, approvedBy: "admin-test", versionLock: 0 });
  assert(approval.approved && !approval.conflict, "admin can approve current command version");
  const execution = await executeApprovedCommand(preview.commandId, "executor-test");
  assert(execution.executed, "approved command executes into immutable event");
  assert(await getCurrentClass("contact", contact.id) === "test", "executed command updates root projection");

  if (failed) process.exit(1);
  console.log(`\n✓ BT-06 commercial classification integration passed (${passed} checks).`);
}

main().catch((error) => {
  console.error("BT-06 integration test crashed:", error);
  process.exit(1);
});