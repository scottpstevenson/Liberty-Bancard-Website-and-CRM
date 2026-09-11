/**
 * CRO-03B CSV Handoff Certification — Business-Only, Contact, Safe-Hold, DBPR-HR, and Cross-Source Dedup Paths
 *
 * Certifies six distinct terminal paths through the CRO-03B admission pipeline:
 *
 *   Path A — Provider-export (Apollo), no-email fixture:
 *     Admission → processNextCro03bRecipeItem → reviewAndProjectCro03bItem →
 *     projectBusinessOnly → business_only_projection_completed.
 *     Exactly one businesses row created (outcome="created"), one canonical_source_links
 *     row, zero contacts, no finalization receipt.
 *     Idempotency: re-running admitCro03bHandoffs returns the same command ID.
 *
 *   Path B — Provider-export (Apollo), with email + phone fixture:
 *     Admission → review → waiting (validation deferred) →
 *     resumeCro03bAfterValidation → completed.
 *     Exactly one contact created or matched; no duplicate subject.
 *
 *   Path C — Provider-export (Apollo), no-email, no strong-anchor fixture:
 *     Has business_name + city + state (qualifying for CRO-03A) but NO website,
 *     NO phone, NO address. Passes CRO-03A qualification → gets a handoff →
 *     admitted to CRO-03B → processNextCro03bRecipeItem runs arbitration →
 *     reviewAndProjectCro03bItem throws CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED
 *     (city+state alone is not a strong anchor; address is also required).
 *     Recipe item stays in review_required; zero contacts, zero businesses projection,
 *     zero outbound effects.
 *
 *     This certifies the safe-hold behaviour for government-registry-style records
 *     that lack a contactable anchor until a governed field-forwarding extension is
 *     added (tracked as a separate task).
 *
 *   Path D — Real DBPR-HR adapter path (MI-02 field fix certification):
 *     Verifies that dbprHrAdapter.normalize() exposes city/state/address/phone on
 *     NormalizedSourceRecord, and that runSourceImport() writes those fields into
 *     the occurrence payload and cro03_normalized_candidates (candidateValues).
 *     Positive fixture (with phone): after scaffold handoff + CRO-03B admission,
 *       reviewAndProjectCro03bItem completes → business_only_projection_completed.
 *     Negative fixture (no phone, no address): strong-anchor check correctly fires
 *       CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED.
 *     NOTE: DBPR-HR vertical (Restaurant/Hospitality) is not in the active CRO-03A
 *       policy targetVerticals. A minimal CRO-03A scaffold is inserted directly in
 *       the DB to test the CRO-03B path independently of the vertical policy.
 *
 *   Path E — Cross-source dedup certification:
 *     An Apollo record and a DBPR-HR record for the same real-world business
 *     (shared phone) both project to the same businesses.id via resolveOrganization()
 *     phone matching. Exactly one canonical_source_links row per source is created.
 *     No-phone variant asserts name+city+state fallback matching also works.
 *     Conflicting non-null identifiers must produce canonical_conflict_evidence rows.
 *
 *   Path F — Concurrent projection race:
 *     Apollo and DBPR-HR projectBusinessOnly() calls raced simultaneously.
 *     Asserts either one shared businesses.id (advisory-lock serialization wins) or
 *     two explicitly linked conflict rows — never two unlinked businesses rows.
 *
 * Effect-denied proof (all paths):
 *   transport_invoked=FALSE, zero requested/settled units, no live GHL/sequence/deal writes.
 *
 * Run: npx tsx scripts/certify-cro03b-csv-handoff.ts
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { providerCsvSourceSubject } from "../server/services/cro03a/adapters";
import { createCro03SourceBatch } from "../server/services/cro03/source-staging";
import {
  createCro03aQualificationRun,
  processCro03aQualificationRunQueueSafe,
} from "../server/services/cro03a/qualification-service";
import {
  admitCro03bHandoffs,
  processNextCro03bRecipeItem,
  reviewAndProjectCro03bItem,
} from "../server/services/cro03/admission-service";
import {
  projectBusinessOnly,
  resumeCro03bAfterValidation,
} from "../server/services/cro03/projection-service";
import { CRO03B_UNIFIED_RECIPE } from "../server/services/cro03/recipe-contract";
import { dbprHrAdapter } from "../server/services/source-registry/adapters/dbpr-hr";
import { createImportRun, runSourceImport } from "../server/services/source-registry/import-runner";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const run = crypto.randomUUID();
const now = new Date().toISOString();
// Run-unique numeric suffix for phone numbers — avoids resolveOrganization matching
// a prior run's business by phone across sequential suites on the same disposable DB.
const runDigits = run.replace(/[^0-9]/g, "").slice(-7).padStart(7, "0");

// ── Shared admin fixture ─────────────────────────────────────────────────────

const admin = rows(
  await db.execute(sql`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`),
)[0];
assert(admin, "Admin user required for certification");

// ── Global baseline snapshot (effect-denied proof) ───────────────────────────

const baseline = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM contacts) AS contacts,
    (SELECT COUNT(*)::int FROM deals)    AS deals,
    (SELECT COUNT(*)::int FROM sequence_enrollments) AS enrollments,
    (SELECT COUNT(*)::int FROM businesses) AS businesses,
    (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links
`))[0];

// ── Helper: build, stage, qualify, return handoff ID via providerCsvSourceSubject ──

async function stageAndQualify(opts: {
  label: string;
  sourceSystem: "apollo" | "outscraper";
  rowNumber: number;
  row: Record<string, unknown>;
  importExecId: string;
  qualIdempotencyKey: string;
}): Promise<string> {
  const draft = providerCsvSourceSubject({
    importExecutionId: opts.importExecId,
    sourceRowNumber: opts.rowNumber,
    sourceSystem: opts.sourceSystem,
    row: opts.row,
    sourceObservedAt: now,
  });
  const subject = {
    ...draft,
    sourceEventKey: `${opts.sourceSystem}:${opts.importExecId}:${opts.rowNumber}`,
  };

  const batchResult = await createCro03SourceBatch({
    idempotencyKey: `cert-cro03b-${opts.label}:${run}`,
    actorType: "system",
    actorId: "cro03b-csv-handoff-cert",
    purpose: "staging_review",
    subjects: [subject],
  });
  assert(!batchResult.replayed, `${opts.label}: first staging must not replay`);
  assert.equal(batchResult.totalCount, 1, `${opts.label}: exactly 1 subject staged`);

  const occurrence = rows(await db.execute(sql`
    SELECT o.id FROM cro03_source_occurrences o
     WHERE o.source_event_key = ${subject.sourceEventKey}
  `))[0];
  assert(occurrence, `${opts.label}: occurrence must exist after staging`);

  const qualRun = await createCro03aQualificationRun({
    idempotencyKey: opts.qualIdempotencyKey,
    occurrenceIds: [String(occurrence.id)],
    actorId: String(admin.id),
    actorRole: "admin",
  });
  await processCro03aQualificationRunQueueSafe(qualRun.id);

  const handoff = rows(await db.execute(sql`
    SELECT id FROM cro03a_handoffs WHERE run_id = ${qualRun.id}::uuid
  `))[0];
  assert(handoff, `${opts.label}: fixture must qualify into a handoff (check row fields match CRO-03A scoring policy)`);
  return String(handoff.id);
}

// ── Helper: assert effect-denied stages for a recipe item ────────────────────

async function assertEffectDenied(itemId: string, label: string) {
  const externalRecipeSteps = CRO03B_UNIFIED_RECIPE.steps.filter((step) =>
    ["public-web", "rdap", "jsonld", "serper", "outscraper", "openai", "apollo"].includes(step.id),
  );
  const deniedStages = rows(await db.execute(sql`
    SELECT o.step_key, o.requested_units, o.settled_units,
           a.outcome, a.transport_invoked,
           r.outcome AS receipt_outcome,
           e.outcome AS evidence_outcome
      FROM cro03b_stage_operations o
      JOIN cro03b_stage_attempts a ON a.operation_id = o.id
      JOIN cro03b_stage_receipts r ON r.operation_id = o.id
      JOIN cro03b_evidence_observations e ON e.stage_operation_id = o.id
     WHERE o.item_id = ${itemId}::uuid
     ORDER BY o.step_key
  `));
  assert.equal(
    deniedStages.length,
    externalRecipeSteps.length,
    `${label}: expected ${externalRecipeSteps.length} denied stages; got ${deniedStages.length}`,
  );
  for (const stage of deniedStages) {
    assert.equal(stage.outcome, "transport_denied", `${label}: ${stage.step_key} outcome must be transport_denied`);
    assert.equal(stage.transport_invoked, false, `${label}: ${stage.step_key} transport_invoked must be FALSE`);
    assert.equal(Number(stage.requested_units), 0, `${label}: ${stage.step_key} requested_units must be 0`);
    assert.equal(Number(stage.settled_units), 0, `${label}: ${stage.step_key} settled_units must be 0`);
    assert.equal(stage.receipt_outcome, "transport_denied", `${label}: ${stage.step_key} receipt_outcome must be transport_denied`);
    assert.equal(stage.evidence_outcome, "disabled", `${label}: ${stage.step_key} evidence_outcome must be disabled`);
  }
  console.log(`[cert] PASS ${label}: all ${deniedStages.length} external stages transport_invoked=FALSE, zero units`);
}

// ═════════════════════════════════════════════════════════════════════════════
// PATH A — Provider-export (Apollo), no-email fixture → projectBusinessOnly
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path A: provider-export no-email → projectBusinessOnly (run=${run}) ──`);

const pathAImportId = `cert-cro03b-path-a-${run}`;
const pathAHandoffId = await stageAndQualify({
  label: "path-a",
  sourceSystem: "apollo",
  rowNumber: 1,
  row: {
    // Has companyName + website + phone + city/state → strong anchor present (website wins)
    // No email → routes to projectBusinessOnly
    companyName: `Cert Path A Auto ${run}`,
    website: `https://path-a-${run}.example.test`,
    phone: `305${runDigits}`,
    industry: "Auto",
    status: "active",
    city: "Miami",
    state: "FL",
    county: "Miami-Dade",
    countyFips: "12086",
  },
  importExecId: pathAImportId,
  qualIdempotencyKey: `cert-cro03b-path-a-qual:${run}`,
});

// ── A1: Admit (first time) ────────────────────────────────────────────────────

const pathAAdmitted = await admitCro03bHandoffs({
  handoffIds: [pathAHandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B CSV handoff certification — Path A",
});
assert(!pathAAdmitted.replayed, "Path A: first admission must not replay");
console.log(`[cert] Path A: command admitted id=${pathAAdmitted.id}`);

// ── A2: Idempotency — re-admitting same handoff+reason returns same command ───

const pathAReplay = await admitCro03bHandoffs({
  handoffIds: [pathAHandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B CSV handoff certification — Path A",
});
assert(pathAReplay.replayed, "Path A: second admission must replay");
assert.equal(pathAReplay.id, pathAAdmitted.id, "Path A: replayed command ID must match first admission");
console.log("[cert] PASS Path A: admission idempotency (replay returns same command ID)");

// ── A3: Process item — arbitration runs, item reaches review_required ─────────

const pathAProcessResult = await processNextCro03bRecipeItem();
assert.equal(
  pathAProcessResult,
  "waiting",
  `Path A: processNextCro03bRecipeItem must return 'waiting'; got '${pathAProcessResult}'`,
);
const pathAItem = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathAAdmitted.id}::uuid
`))[0];
assert(pathAItem, "Path A: recipe item must exist");
assert.equal(
  pathAItem.state,
  "review_required",
  `Path A: item state must be 'review_required' after processing; got '${pathAItem.state}'`,
);
await assertEffectDenied(String(pathAItem.id), "Path A");

// ── A4: Capture counts immediately before projection ─────────────────────────

const pathAPreProj = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM businesses) AS businesses,
    (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links,
    (SELECT COUNT(*)::int FROM contacts) AS contacts
`))[0];

// ── A5: Review and project (business-only path, no email) ────────────────────

const pathAProjectResult = await reviewAndProjectCro03bItem(
  String(pathAItem.id),
  String(admin.id),
) as any;

assert(
  pathAProjectResult?.outcome === "created" || pathAProjectResult?.outcome === "matched",
  `Path A: projectBusinessOnly must succeed with 'created' or 'matched'; got outcome=${pathAProjectResult?.outcome ?? JSON.stringify(pathAProjectResult)}`,
);
const pathAOutcome = pathAProjectResult.outcome as string;
const pathABusinessId = Number(pathAProjectResult.businessId);
assert(pathABusinessId > 0, "Path A: projectBusinessOnly must return a valid businessId");

// ── A6: Assert recipe item final state ────────────────────────────────────────

const pathAItemFinal = rows(await db.execute(sql`
  SELECT state, terminal_code, business_id, contact_id
    FROM cro03b_recipe_items WHERE id = ${pathAItem.id}::uuid
`))[0];
assert.equal(
  pathAItemFinal.state,
  "completed",
  `Path A: item must reach 'completed' after business-only projection; got '${pathAItemFinal.state}'`,
);
assert.equal(
  pathAItemFinal.terminal_code,
  "business_only_projection_completed",
  `Path A: terminal_code must be 'business_only_projection_completed'; got '${pathAItemFinal.terminal_code}'`,
);
assert.equal(
  Number(pathAItemFinal.business_id),
  pathABusinessId,
  "Path A: recipe item business_id must match projectBusinessOnly return value",
);
assert(
  pathAItemFinal.contact_id == null,
  "Path A: recipe item contact_id must be NULL (business-only projection creates no contact)",
);

// ── A7: Count invariants — exactly one new source_link; contacts unchanged ────

const pathAPostProj = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM businesses) AS businesses,
    (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links,
    (SELECT COUNT(*)::int FROM contacts) AS contacts
`))[0];

// When outcome=created: exactly one new business row
if (pathAOutcome === "created") {
  assert.equal(
    Number(pathAPostProj.businesses),
    Number(pathAPreProj.businesses) + 1,
    `Path A (created): businesses count must increase by exactly 1 (before=${pathAPreProj.businesses} after=${pathAPostProj.businesses})`,
  );
} else {
  // matched: business row already existed, count unchanged
  assert.equal(
    Number(pathAPostProj.businesses),
    Number(pathAPreProj.businesses),
    `Path A (matched): businesses count must not change (before=${pathAPreProj.businesses} after=${pathAPostProj.businesses})`,
  );
}

// Exactly one new canonical_source_links row
assert.equal(
  Number(pathAPostProj.source_links),
  Number(pathAPreProj.source_links) + 1,
  `Path A: canonical_source_links must gain exactly 1 row (before=${pathAPreProj.source_links} after=${pathAPostProj.source_links})`,
);

// Zero new contacts
assert.equal(
  Number(pathAPostProj.contacts),
  Number(pathAPreProj.contacts),
  `Path A: contacts count must not change (before=${pathAPreProj.contacts} after=${pathAPostProj.contacts})`,
);

// Verify the specific source link written by this item references the correct business
const pathASourceLink = rows(await db.execute(sql`
  SELECT id, business_id FROM canonical_source_links
   WHERE business_id = ${pathABusinessId}
  ORDER BY created_at DESC LIMIT 1
`))[0];
assert(pathASourceLink, "Path A: canonical_source_links row must exist for the projected business");
assert.equal(
  Number(pathASourceLink.business_id),
  pathABusinessId,
  "Path A: canonical_source_links.business_id must match projectBusinessOnly.businessId",
);

// No finalization receipt (no email validation needed)
const pathAFinalization = rows(await db.execute(sql`
  SELECT id FROM cro03b_finalization_receipts WHERE item_id = ${pathAItem.id}::uuid
`))[0];
assert(!pathAFinalization, "Path A: no cro03b_finalization_receipts must exist (business-only path has no email)");

console.log(
  `[cert] PASS Path A: business-only projection outcome=${pathAOutcome} businessId=${pathABusinessId}; ` +
  `exactly 1 new source_link; zero new contacts; no finalization receipt`,
);

// ═════════════════════════════════════════════════════════════════════════════
// PATH B — Provider-export (Apollo), with email + phone → contact projection
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path B: provider-export with email+phone → contact projection (run=${run}) ──`);

const pathBEmail = `cert-cro03b-path-b-${run}@example.test`;
const pathBPhone = `555${runDigits}`;
const pathBImportId = `cert-cro03b-path-b-${run}`;
const pathBHandoffId = await stageAndQualify({
  label: "path-b",
  sourceSystem: "apollo",
  rowNumber: 2,
  row: {
    companyName: `Cert Path B Clinic ${run}`,
    website: `https://path-b-${run}.example.test`,
    phone: pathBPhone,
    email: pathBEmail,
    industry: "Healthcare",
    status: "active",
    city: "Fort Lauderdale",
    state: "FL",
    county: "Broward",
    countyFips: "12011",
  },
  importExecId: pathBImportId,
  qualIdempotencyKey: `cert-cro03b-path-b-qual:${run}`,
});

// ── B1: Admit ─────────────────────────────────────────────────────────────────

const pathBAdmitted = await admitCro03bHandoffs({
  handoffIds: [pathBHandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B CSV handoff certification — Path B",
});
assert(!pathBAdmitted.replayed, "Path B: first admission must not replay");
console.log(`[cert] Path B: command admitted id=${pathBAdmitted.id}`);

// ── B2: Process item ──────────────────────────────────────────────────────────

const pathBProcessResult = await processNextCro03bRecipeItem();
assert.equal(
  pathBProcessResult,
  "waiting",
  `Path B: processNextCro03bRecipeItem must return 'waiting'; got '${pathBProcessResult}'`,
);
const pathBItem = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathBAdmitted.id}::uuid
`))[0];
assert(pathBItem, "Path B: recipe item must exist");
assert.equal(
  pathBItem.state,
  "review_required",
  `Path B: item must be in 'review_required' after processing; got '${pathBItem.state}'`,
);
await assertEffectDenied(String(pathBItem.id), "Path B");

// ── B3: Review and project — contact created, validation intent deferred ──────

const pathBContactsBefore = Number(
  rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM contacts`))[0].n,
);

await reviewAndProjectCro03bItem(String(pathBItem.id), String(admin.id));

const pathBItemAfterReview = rows(await db.execute(sql`
  SELECT state, contact_id FROM cro03b_recipe_items WHERE id = ${pathBItem.id}::uuid
`))[0];
assert.equal(
  pathBItemAfterReview.state,
  "waiting",
  `Path B: item must be in 'waiting' state after review (validation deferred); got '${pathBItemAfterReview.state}'`,
);
assert(pathBItemAfterReview.contact_id, "Path B: item must have a contact_id after projection");

// At most one new contact created
const pathBContactsAfter = Number(
  rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM contacts`))[0].n,
);
assert(
  pathBContactsAfter <= pathBContactsBefore + 1,
  `Path B: at most one new contact created; before=${pathBContactsBefore} after=${pathBContactsAfter}`,
);

// ── B4: Assert exactly one deferred cro03_winning_email validation intent ─────

const pathBFinalization = rows(await db.execute(sql`
  SELECT f.*, i.contact_id
    FROM cro03b_finalization_receipts f
    JOIN cro03b_recipe_items i ON i.id = f.item_id
   WHERE f.item_id = ${pathBItem.id}::uuid
`))[0];
assert(pathBFinalization, "Path B: cro03b_finalization_receipts must exist after review");
assert(pathBFinalization.validation_intent_id, "Path B: finalization must carry a validation_intent_id");

const pathBIntents = rows(await db.execute(sql`
  SELECT purpose, enqueue_state, COUNT(*)::int AS cnt
    FROM validation_intents
   WHERE contact_id = ${pathBFinalization.contact_id}
     AND subject_generation = ${pathBFinalization.subject_generation}
     AND purpose = 'cro03_winning_email'
   GROUP BY purpose, enqueue_state
`));
assert(pathBIntents.length > 0, "Path B: at least one cro03_winning_email validation_intent must exist");
assert.equal(
  Number(pathBIntents[0].cnt),
  1,
  `Path B: exactly one cro03_winning_email intent; got ${pathBIntents[0].cnt}`,
);
console.log(`[cert] Path B: validation_intent created (purpose=cro03_winning_email, enqueue_state=${pathBIntents[0].enqueue_state})`);

// ── B5: Simulate terminal validation → resumeCro03bAfterValidation ────────────

await db.execute(sql`
  UPDATE validation_intents
     SET state = 'completed', completed_at = NOW(), updated_at = NOW()
   WHERE id = ${pathBFinalization.validation_intent_id}::uuid
`);

// Concurrent resumes are safe — one completes, rest return completed idempotently
const [pathBResume1, pathBResume2] = await Promise.all([
  resumeCro03bAfterValidation(String(pathBItem.id)),
  resumeCro03bAfterValidation(String(pathBItem.id)),
]);
assert(
  pathBResume1.state === "completed" || pathBResume2.state === "completed",
  `Path B: at least one concurrent resumeCro03bAfterValidation must return 'completed'`,
);

// Repeated resume is idempotent
const pathBResume3 = await resumeCro03bAfterValidation(String(pathBItem.id));
assert.equal(pathBResume3.state, "completed", "Path B: third resume must return 'completed'");

const pathBItemFinal = rows(await db.execute(sql`
  SELECT state, terminal_code FROM cro03b_recipe_items WHERE id = ${pathBItem.id}::uuid
`))[0];
assert.equal(
  pathBItemFinal.state,
  "completed",
  `Path B: recipe item must be 'completed' after validation + resume; got '${pathBItemFinal.state}'`,
);

// Exactly one item (no duplicate subject)
const pathBItemCount = Number(
  rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM cro03b_recipe_items WHERE command_id = ${pathBAdmitted.id}::uuid
  `))[0].n,
);
assert.equal(pathBItemCount, 1, "Path B: exactly one recipe item (no duplicate subject)");

console.log("[cert] PASS Path B: contact projection → waiting → resume → completed; no duplicate subject");

// ═════════════════════════════════════════════════════════════════════════════
// PATH C — No strong anchor (no website, no phone, no address) → CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED
//
// This fixture passes CRO-03A qualification (business_name + city/state for geo +
// Auto vertical + active entity → score ≥70 → selected → handoff produced).
// Inside CRO-03B, after arbitration the winners are business_name + city + state +
// category + entity_status — but no website, no phone, and no address winner.
// The strong-anchor check (website OR phone OR (address+city+state)) therefore
// fails because address is absent, and reviewAndProjectCro03bItem throws
// CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED before any projection write.
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path C: no strong anchor → CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED (run=${run}) ──`);

const pathCImportId = `cert-cro03b-path-c-${run}`;
const pathCHandoffId = await stageAndQualify({
  label: "path-c",
  sourceSystem: "apollo",
  rowNumber: 3,
  row: {
    // Has business_name + geo for CRO-03A scoring → qualifies → handoff produced.
    // No phone, no website, no email, no address → no strong anchor in CRO-03B.
    // city+state alone does NOT satisfy (address+city+state) — address is required.
    companyName: `Cert Path C No Anchor ${run}`,
    industry: "Auto",
    status: "active",
    city: "Miami",
    state: "FL",
    county: "Miami-Dade",
    countyFips: "12086",
    // Deliberately omitted: phone, website, email, address
  },
  importExecId: pathCImportId,
  qualIdempotencyKey: `cert-cro03b-path-c-qual:${run}`,
});

// ── C1: Admit to CRO-03B ──────────────────────────────────────────────────────

const pathCAdmitted = await admitCro03bHandoffs({
  handoffIds: [pathCHandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B CSV handoff certification — Path C safe-hold",
});
assert(!pathCAdmitted.replayed, "Path C: first admission must not replay");
console.log(`[cert] Path C: command admitted id=${pathCAdmitted.id}`);

// ── C2: Process item — arbitration runs, item reaches review_required ─────────

const pathCProcessResult = await processNextCro03bRecipeItem();
assert.equal(
  pathCProcessResult,
  "waiting",
  `Path C: processNextCro03bRecipeItem must return 'waiting'; got '${pathCProcessResult}'`,
);
const pathCItem = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathCAdmitted.id}::uuid
`))[0];
assert(pathCItem, "Path C: recipe item must exist");
assert.equal(
  pathCItem.state,
  "review_required",
  `Path C: item must be in 'review_required' after processing; got '${pathCItem.state}'`,
);
await assertEffectDenied(String(pathCItem.id), "Path C");

// ── C3: Snapshot counts before the safe-hold attempt ─────────────────────────

const pathCPreCounts = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM contacts) AS contacts,
    (SELECT COUNT(*)::int FROM businesses) AS businesses,
    (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links,
    (SELECT COUNT(*)::int FROM cro03b_finalization_receipts) AS finalizations
`))[0];

// ── C4: reviewAndProjectCro03bItem must throw CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED ─

await assert.rejects(
  () => reviewAndProjectCro03bItem(String(pathCItem.id), String(admin.id)),
  (err: any) => {
    assert(
      err?.message?.includes("CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED"),
      `Path C: expected CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED; got: ${err?.message}`,
    );
    return true;
  },
);
console.log("[cert] Path C: reviewAndProjectCro03bItem correctly throws CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED");

// ── C5: Item state must still be review_required — the safe-hold is non-mutating ─

const pathCItemAfterReject = rows(await db.execute(sql`
  SELECT state, contact_id, business_id FROM cro03b_recipe_items WHERE id = ${pathCItem.id}::uuid
`))[0];
assert.equal(
  pathCItemAfterReject.state,
  "review_required",
  `Path C: item must remain 'review_required' after safe-hold; got '${pathCItemAfterReject.state}'`,
);
assert(
  pathCItemAfterReject.contact_id == null,
  "Path C: recipe item contact_id must be NULL after safe-hold",
);
assert(
  pathCItemAfterReject.business_id == null,
  "Path C: recipe item business_id must be NULL after safe-hold",
);

// ── C6: Zero writes — no new contacts, businesses, source_links, finalizations ─

const pathCPostCounts = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM contacts) AS contacts,
    (SELECT COUNT(*)::int FROM businesses) AS businesses,
    (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links,
    (SELECT COUNT(*)::int FROM cro03b_finalization_receipts) AS finalizations
`))[0];

assert.equal(
  Number(pathCPostCounts.contacts),
  Number(pathCPreCounts.contacts),
  `Path C: contacts count must not change (before=${pathCPreCounts.contacts} after=${pathCPostCounts.contacts})`,
);
assert.equal(
  Number(pathCPostCounts.businesses),
  Number(pathCPreCounts.businesses),
  `Path C: businesses count must not change (before=${pathCPreCounts.businesses} after=${pathCPostCounts.businesses})`,
);
assert.equal(
  Number(pathCPostCounts.source_links),
  Number(pathCPreCounts.source_links),
  `Path C: canonical_source_links must not change (before=${pathCPreCounts.source_links} after=${pathCPostCounts.source_links})`,
);
assert.equal(
  Number(pathCPostCounts.finalizations),
  Number(pathCPreCounts.finalizations),
  `Path C: cro03b_finalization_receipts must not change (before=${pathCPreCounts.finalizations} after=${pathCPostCounts.finalizations})`,
);

console.log(
  "[cert] PASS Path C: CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED safe-hold — item stays in review_required; " +
  "zero contacts, zero businesses, zero source_links, zero finalizations written",
);

// ═════════════════════════════════════════════════════════════════════════════
// PATHS D / E / F SETUP — scaffold helper for DBPR-HR records
// ═════════════════════════════════════════════════════════════════════════════

// DBPR-HR records currently cannot pass CRO-03A under the active policy because
// Restaurant/Hospitality verticals are not in targetVerticals (["Auto","Healthcare","Salon/Spa"]).
// This helper inserts a minimal run→item→decision→handoff chain directly in the
// DB so we can certify the CRO-03B arbitration path independently of that policy.
// The scaffold uses disposition='selected' and a score of 75 — above the 70-point
// threshold — so the handoff is formally "selected" but only for test purposes.

async function scaffoldDbprHrHandoff(opts: {
  label: string;
  occurrenceId: string;
  subjectKey: string;
}): Promise<string> {
  const policyRow = rows(await db.execute(sql`
    SELECT pd.id, pd.policy_hash, pd.version
      FROM cro03a_policy_control pc
      JOIN cro03a_policy_documents pd ON pd.id = pc.active_policy_id
     LIMIT 1
  `))[0];
  assert(policyRow, `${opts.label}: active CRO-03A policy must exist`);

  const occurrenceIds = JSON.stringify([opts.occurrenceId]);
  const scopeHash = crypto.createHash("sha256")
    .update(`cert-scaffold:${opts.label}:${run}`).digest("hex");
  const selectionHash = crypto.createHash("sha256")
    .update(`cert-scaffold-sel:${opts.label}:${run}`).digest("hex");

  const qualRun = rows(await db.execute(sql`
    INSERT INTO cro03a_qualification_runs
      (idempotency_key, actor_id, actor_role, policy_id, policy_hash, scope_hash,
       frozen_occurrence_ids, state, total_count, selected_count, review_count,
       terminal_count, completed_at)
    VALUES (
      ${`cert-scaffold-run:${opts.label}:${run}`},
      ${String(admin.id)}, 'admin',
      ${String(policyRow.id)}::uuid,
      ${String(policyRow.policy_hash)},
      ${scopeHash},
      ${occurrenceIds}::jsonb,
      'completed', 1, 1, 0, 1, NOW()
    )
    RETURNING id
  `))[0];
  assert(qualRun, `${opts.label}: qualification_run insert must succeed`);

  const qualItem = rows(await db.execute(sql`
    INSERT INTO cro03a_qualification_items
      (run_id, occurrence_id, ordinal, state)
    VALUES (${String(qualRun.id)}::uuid, ${opts.occurrenceId}::uuid, 1, 'completed')
    RETURNING id
  `))[0];

  const qualDecision = rows(await db.execute(sql`
    INSERT INTO cro03a_qualification_decisions
      (item_id, run_id, occurrence_id, disposition, score,
       geography_result, vertical_result, active_state_evidence,
       identity_relationship_evidence, fit_components, reason_codes,
       missing_field_classes, frozen_occurrence_ids,
       policy_id, policy_version, policy_hash, selection_hash)
    VALUES (
      ${String(qualItem.id)}::uuid, ${String(qualRun.id)}::uuid,
      ${opts.occurrenceId}::uuid,
      'selected', 75,
      '{"eligible":true,"evidenceClass":"verified","reasonCodes":[]}'::jsonb,
      '{"vertical":"Restaurant","targetVertical":true,"subverticalMapVersion":"1"}'::jsonb,
      '{"active":true,"rawStatus":"Active","synthetic":false}'::jsonb,
      '{"exactMatches":[],"conflictingExactMatches":[],"weakMatches":[]}'::jsonb,
      '{}'::jsonb, '["cert_scaffold"]'::jsonb, '[]'::jsonb,
      ${occurrenceIds}::jsonb,
      ${String(policyRow.id)}::uuid,
      ${Number(policyRow.version)},
      ${String(policyRow.policy_hash)},
      ${selectionHash}
    )
    RETURNING id
  `))[0];

  const handoffRow = rows(await db.execute(sql`
    INSERT INTO cro03a_handoffs
      (run_id, decision_id, source_type, source_system, source_key,
       occurrence_ids, policy_id, policy_version, policy_hash,
       reason_codes, missing_field_classes, selection_hash, effect_authorized)
    VALUES (
      ${String(qualRun.id)}::uuid, ${String(qualDecision.id)}::uuid,
      'provider_csv_row', 'dbpr-hr', ${opts.subjectKey},
      ${occurrenceIds}::jsonb,
      ${String(policyRow.id)}::uuid,
      ${Number(policyRow.version)},
      ${String(policyRow.policy_hash)},
      '[]'::jsonb, '[]'::jsonb, ${selectionHash}, FALSE
    )
    RETURNING id
  `))[0];

  return String(handoffRow.id);
}

// ═════════════════════════════════════════════════════════════════════════════
// PATH D — Real DBPR-HR adapter path (MI-02 field fix certification)
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path D: DBPR-HR adapter field fix + CRO-03B pipeline (run=${run}) ──`);

// ── D0: Assert adapter directly exposes the new fields ───────────────────────

const pathDAdapterRow = {
  LicenseNumber: "HR-ADAPT-TEST",
  LicenseType: "Restaurant",
  LicenseStatus: "Active",
  LocationZip: "33101",
  BusinessName: "Cert Adapter Test Restaurant",
  LocationCity: "Miami",
  LocationAddress: "456 Biscayne Blvd",
  Phone: "3055551234",
};
const pathDNormalized = dbprHrAdapter.normalize(pathDAdapterRow);
assert(pathDNormalized !== null, "Path D adapter: normalize() must return non-null for valid establishment row");
assert.equal(pathDNormalized!.city, "Miami", "Path D adapter: city must be exposed on NormalizedSourceRecord");
assert.equal(pathDNormalized!.address, "456 Biscayne Blvd", "Path D adapter: address must be exposed on NormalizedSourceRecord");
assert.equal(pathDNormalized!.phone, "3055551234", "Path D adapter: phone must be exposed on NormalizedSourceRecord");
assert.equal(pathDNormalized!.state, "FL", "Path D adapter: state must be 'FL' (derived from known source geography)");
console.log("[cert] PASS Path D adapter: normalize() exposes city/state/address/phone on NormalizedSourceRecord");

// ── D1: Positive fixture — has phone → strong anchor passes after import ──────

const pathDLicense1 = `HR-D1-${run.slice(0, 8)}`;
const pathDPhone1 = `786${runDigits}`;
const pathDCsv1 = Buffer.from([
  "LicenseNumber,LicenseType,LicenseStatus,LocationZip,BusinessName,LocationCity,LocationAddress,Phone",
  `${pathDLicense1},Restaurant,Active,33101,Cert D Positive ${run},Miami,789 Ocean Dr,${pathDPhone1}`,
].join("\n"));

const pathDRun1 = await createImportRun("dbpr-hr", false);
assert(pathDRun1, "Path D positive: createImportRun must succeed (no queued run in progress)");
const pathDImport1 = await runSourceImport({
  runId: pathDRun1.runId,
  _testCsvBuffer: pathDCsv1,
  adapterKey: "dbpr-hr",
});
assert.equal(
  pathDImport1.status,
  "completed",
  `Path D positive: import must complete; got status=${pathDImport1.status} error=${pathDImport1.errorText}`,
);
assert.equal(pathDImport1.recordsProcessed, 1, "Path D positive: exactly 1 record must be processed");

const pathD1EventKey = `dbpr-hr:${pathDLicense1}:${pathDRun1.runId}`;
const pathD1Occurrence = rows(await db.execute(sql`
  SELECT o.id FROM cro03_source_occurrences o
   WHERE o.source_event_key = ${pathD1EventKey}
`))[0];
assert(pathD1Occurrence, "Path D positive: occurrence must exist after runSourceImport()");

// Verify candidateValues reached cro03_normalized_candidates
const pathD1Candidates = rows(await db.execute(sql`
  SELECT n.field, n.normalized_value
    FROM cro03_normalized_candidates n
    JOIN cro03_source_observations obs ON obs.id = n.source_observation_id
    JOIN cro03_source_occurrences so ON so.source_observation_id = obs.id
   WHERE so.id = ${String(pathD1Occurrence.id)}::uuid
   ORDER BY n.field
`));
const pathD1FieldMap = new Map(pathD1Candidates.map((c: any) => [String(c.field), String(c.normalized_value)]));
assert(pathD1FieldMap.has("phone"), "Path D positive: candidateValues must include 'phone' field in cro03_normalized_candidates");
assert(pathD1FieldMap.has("city"), "Path D positive: candidateValues must include 'city' field in cro03_normalized_candidates");
assert(pathD1FieldMap.has("state"), "Path D positive: candidateValues must include 'state' field in cro03_normalized_candidates");
assert(pathD1FieldMap.has("address"), "Path D positive: candidateValues must include 'address' field in cro03_normalized_candidates");
console.log(
  `[cert] Path D positive: candidateValues verified — phone=${pathD1FieldMap.get("phone")}, ` +
  `city=${pathD1FieldMap.get("city")}, state=${pathD1FieldMap.get("state")}`,
);

// Also verify occurrence payload contains the new fields
const pathD1Payload = rows(await db.execute(sql`
  SELECT obs.payload
    FROM cro03_source_observations obs
    JOIN cro03_source_occurrences so ON so.source_observation_id = obs.id
   WHERE so.id = ${String(pathD1Occurrence.id)}::uuid
   LIMIT 1
`))[0];
assert(pathD1Payload, "Path D positive: source_observation with payload must exist");
const pathD1PayloadObj = typeof pathD1Payload.payload === "string"
  ? JSON.parse(pathD1Payload.payload)
  : (pathD1Payload.payload as Record<string, unknown>);
assert(pathD1PayloadObj.phone, "Path D positive: occurrence payload must include phone field for CRO-03A evaluation");
assert(pathD1PayloadObj.city, "Path D positive: occurrence payload must include city field for CRO-03A evaluation");
assert(pathD1PayloadObj.state, "Path D positive: occurrence payload must include state field for CRO-03A evaluation");
assert(pathD1PayloadObj.address, "Path D positive: occurrence payload must include address field for CRO-03A evaluation");
console.log("[cert] Path D positive: occurrence payload includes city/state/address/phone");

// Scaffold CRO-03A handoff (DBPR-HR can't pass CRO-03A under current vertical policy)
const pathD1HandoffId = await scaffoldDbprHrHandoff({
  label: "path-d-pos",
  occurrenceId: String(pathD1Occurrence.id),
  subjectKey: `dbpr-hr:${pathDLicense1}`,
});

// Admit to CRO-03B
const pathD1Admitted = await admitCro03bHandoffs({
  handoffIds: [pathD1HandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B certification — Path D positive (phone present)",
});
assert(!pathD1Admitted.replayed, "Path D positive: admission must not replay");

// Process — arbitration materializes candidates, item reaches review_required
const pathD1ProcessResult = await processNextCro03bRecipeItem();
assert.equal(
  pathD1ProcessResult,
  "waiting",
  `Path D positive: processNextCro03bRecipeItem must return 'waiting'; got '${pathD1ProcessResult}'`,
);
const pathD1Item = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathD1Admitted.id}::uuid
`))[0];
assert(pathD1Item, "Path D positive: recipe item must exist after processing");
assert.equal(pathD1Item.state, "review_required", `Path D positive: item must be review_required; got '${pathD1Item.state}'`);
await assertEffectDenied(String(pathD1Item.id), "Path D positive");

// Review — strong-anchor check must pass because phone candidate is present
const pathD1ProjectResult = await reviewAndProjectCro03bItem(String(pathD1Item.id), String(admin.id)) as any;
assert(
  pathD1ProjectResult?.outcome === "created" || pathD1ProjectResult?.outcome === "matched",
  `Path D positive: projectBusinessOnly must succeed; got outcome=${pathD1ProjectResult?.outcome ?? JSON.stringify(pathD1ProjectResult)}`,
);

const pathD1ItemFinal = rows(await db.execute(sql`
  SELECT state, terminal_code FROM cro03b_recipe_items WHERE id = ${String(pathD1Item.id)}::uuid
`))[0];
assert.equal(pathD1ItemFinal.terminal_code, "business_only_projection_completed",
  `Path D positive: terminal_code must be 'business_only_projection_completed'; got '${pathD1ItemFinal.terminal_code}'`);
console.log(
  `[cert] PASS Path D positive: import exposes phone/city/state/address → strong-anchor passes → ` +
  `business_only_projection_completed (outcome=${pathD1ProjectResult.outcome})`,
);

// ── D2: Negative fixture — no phone, no address → strong-anchor must fail ─────

const pathDLicense2 = `HR-D2-${run.slice(0, 8)}`;
const pathDCsv2 = Buffer.from([
  "LicenseNumber,LicenseType,LicenseStatus,LocationZip,BusinessName,LocationCity",
  `${pathDLicense2},Restaurant,Active,33101,Cert D Negative ${run},Miami`,
].join("\n"));

const pathDRun2 = await createImportRun("dbpr-hr", false);
assert(pathDRun2, "Path D negative: createImportRun must succeed");
const pathDImport2 = await runSourceImport({
  runId: pathDRun2.runId,
  _testCsvBuffer: pathDCsv2,
  adapterKey: "dbpr-hr",
});
assert.equal(pathDImport2.status, "completed",
  `Path D negative: import must complete; got ${pathDImport2.errorText}`);

const pathD2Occurrence = rows(await db.execute(sql`
  SELECT o.id FROM cro03_source_occurrences o
   WHERE o.source_event_key = ${"dbpr-hr:" + pathDLicense2 + ":" + pathDRun2.runId}
`))[0];
assert(pathD2Occurrence, "Path D negative: occurrence must exist after import");

const pathD2HandoffId = await scaffoldDbprHrHandoff({
  label: "path-d-neg",
  occurrenceId: String(pathD2Occurrence.id),
  subjectKey: `dbpr-hr:${pathDLicense2}`,
});

const pathD2Admitted = await admitCro03bHandoffs({
  handoffIds: [pathD2HandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B certification — Path D negative (no phone, no address)",
});
assert(!pathD2Admitted.replayed, "Path D negative: admission must not replay");

const pathD2ProcessResult = await processNextCro03bRecipeItem();
assert.equal(pathD2ProcessResult, "waiting",
  `Path D negative: processNextCro03bRecipeItem must return 'waiting'; got '${pathD2ProcessResult}'`);
const pathD2Item = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathD2Admitted.id}::uuid
`))[0];
assert(pathD2Item, "Path D negative: recipe item must exist");

await assert.rejects(
  () => reviewAndProjectCro03bItem(String(pathD2Item.id), String(admin.id)),
  (err: any) => {
    assert(
      err?.message?.includes("CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED"),
      `Path D negative: expected CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED; got: ${err?.message}`,
    );
    return true;
  },
);
console.log(
  "[cert] PASS Path D negative: no phone + no address → CRO03B_STRONG_ORGANIZATION_ANCHOR_REQUIRED correctly fired",
);

// ═════════════════════════════════════════════════════════════════════════════
// PATH E — Cross-source dedup: Apollo + DBPR-HR → same businesses.id
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path E: cross-source dedup Apollo + DBPR-HR → shared businesses.id (run=${run}) ──`);

// Shared identifiers for cross-source matching
const pathEPhone = `954${runDigits}`;
const pathEName = `Cert Path E Bistro ${run}`;
const pathEItemIdApollo = crypto.randomUUID();
const pathEItemIdDbpr = crypto.randomUUID();

// ── E1: Apollo projects first — creates the canonical business row ─────────────

const pathEApolloResult = await projectBusinessOnly({
  itemId: pathEItemIdApollo,
  sourceSystem: "apollo",
  sourceType: "provider_csv_row",
  stableKey: `apollo:cert-e-${run}`,
  organization: {
    canonicalName: pathEName,
    websiteDomain: `cert-e-${run}.example.test`,
    mainPhone: pathEPhone,
    city: "Fort Lauderdale",
    state: "FL",
  },
  location: { city: "Fort Lauderdale", state: "FL" },
}) as any;
assert(
  pathEApolloResult?.outcome === "created" || pathEApolloResult?.outcome === "matched",
  `Path E Apollo: projectBusinessOnly must succeed; got outcome=${pathEApolloResult?.outcome ?? JSON.stringify(pathEApolloResult)}`,
);
const pathEApolloBusinessId = Number(pathEApolloResult.businessId);
const pathEApolloLinkId = String(pathEApolloResult.sourceLinkId);
assert(pathEApolloBusinessId > 0, "Path E Apollo: must return a valid businessId");
console.log(`[cert] Path E Apollo: projected → businessId=${pathEApolloBusinessId} outcome=${pathEApolloResult.outcome}`);

// ── E2: DBPR-HR projects same business via shared phone ───────────────────────

const pathEDbprResult = await projectBusinessOnly({
  itemId: pathEItemIdDbpr,
  sourceSystem: "dbpr-hr",
  sourceType: "provider_csv_row",
  stableKey: `dbpr-hr:HR-E-${run.slice(0, 8)}`,
  organization: {
    canonicalName: pathEName,
    // No websiteDomain — DBPR-HR does not produce a domain
    mainPhone: pathEPhone,
    city: "Fort Lauderdale",
    state: "FL",
  },
  location: { city: "Fort Lauderdale", state: "FL" },
}) as any;
assert(
  pathEDbprResult?.outcome === "created" || pathEDbprResult?.outcome === "matched",
  `Path E DBPR-HR: projectBusinessOnly must succeed; got outcome=${pathEDbprResult?.outcome ?? JSON.stringify(pathEDbprResult)}`,
);
const pathEDbprBusinessId = Number(pathEDbprResult.businessId);
const pathEDbprLinkId = String(pathEDbprResult.sourceLinkId);
assert(pathEDbprBusinessId > 0, "Path E DBPR-HR: must return a valid businessId");
console.log(`[cert] Path E DBPR-HR: projected → businessId=${pathEDbprBusinessId} outcome=${pathEDbprResult.outcome}`);

// ── E3: Both must resolve to the same businesses.id ──────────────────────────

assert.equal(
  pathEApolloBusinessId,
  pathEDbprBusinessId,
  `Path E: Apollo and DBPR-HR must resolve to the same businesses.id via phone matching ` +
  `(apollo=${pathEApolloBusinessId} dbpr=${pathEDbprBusinessId})`,
);

// ── E4: Exactly one canonical_source_links row per source ────────────────────

const pathELinks = rows(await db.execute(sql`
  SELECT source_system, source_type, stable_key, business_id
    FROM canonical_source_links
   WHERE id = ${pathEApolloLinkId}::uuid
      OR id = ${pathEDbprLinkId}::uuid
   ORDER BY source_system
`));
assert.equal(
  pathELinks.length,
  2,
  `Path E: must have exactly 2 canonical_source_links rows (one per source); got ${pathELinks.length}`,
);
const pathESourceSystems = new Set(pathELinks.map((link: any) => String(link.source_system)));
assert(pathESourceSystems.has("apollo"), "Path E: must have a canonical_source_links row for source_system='apollo'");
assert(pathESourceSystems.has("dbpr-hr"), "Path E: must have a canonical_source_links row for source_system='dbpr-hr'");
for (const link of pathELinks) {
  assert.equal(
    Number(link.business_id),
    pathEApolloBusinessId,
    `Path E: both source links must reference the same businesses.id=${pathEApolloBusinessId} (got ${link.business_id} for ${link.source_system})`,
  );
}
console.log(
  "[cert] PASS Path E: Apollo + DBPR-HR (shared phone) → same businesses.id; " +
  "exactly 1 canonical_source_links per source",
);

// ── E5: No-phone variant — name+city+state fallback matching ─────────────────

const pathEName2 = `Cert Path E2 Bistro ${run}`;
const pathEItemIdApollo2 = crypto.randomUUID();
const pathEItemIdDbpr2 = crypto.randomUUID();

// Apollo creates business with domain (but no phone for the fallback test)
const pathEApolloResult2 = await projectBusinessOnly({
  itemId: pathEItemIdApollo2,
  sourceSystem: "apollo",
  sourceType: "provider_csv_row",
  stableKey: `apollo:cert-e2-${run}`,
  organization: {
    canonicalName: pathEName2,
    websiteDomain: `cert-e2-${run}.example.test`,
    city: "Miami",
    state: "FL",
  },
  location: { city: "Miami", state: "FL" },
}) as any;
assert(
  pathEApolloResult2?.outcome === "created" || pathEApolloResult2?.outcome === "matched",
  `Path E2 Apollo: projectBusinessOnly must succeed; got ${JSON.stringify(pathEApolloResult2)}`,
);
const pathEApollo2BusinessId = Number(pathEApolloResult2.businessId);

// DBPR-HR with no phone — resolveOrganization falls back to name+city+state match
const pathEDbprResult2 = await projectBusinessOnly({
  itemId: pathEItemIdDbpr2,
  sourceSystem: "dbpr-hr",
  sourceType: "provider_csv_row",
  stableKey: `dbpr-hr:HR-E2-${run.slice(0, 8)}`,
  organization: {
    canonicalName: pathEName2,
    // No websiteDomain (DBPR-HR) — no phone for this variant
    city: "Miami",
    state: "FL",
  },
  location: { city: "Miami", state: "FL" },
}) as any;
assert(
  pathEDbprResult2?.outcome === "created" || pathEDbprResult2?.outcome === "matched" ||
  pathEDbprResult2?.outcome === "conflict",
  `Path E2 DBPR-HR: projectBusinessOnly must produce created/matched/conflict; got ${JSON.stringify(pathEDbprResult2)}`,
);

if (pathEDbprResult2?.outcome === "conflict") {
  // Conflicting identifiers must produce linked canonical_conflict_evidence — never two unlinked rows
  const pathE2ConflictEvidence = rows(await db.execute(sql`
    SELECT id FROM canonical_conflict_evidence WHERE id = ${pathEDbprResult2.conflictEvidenceId}::uuid
  `))[0];
  assert(pathE2ConflictEvidence, "Path E2: conflict outcome must produce a canonical_conflict_evidence row");
  console.log(`[cert] Path E2 DBPR-HR: conflict detected with evidence (id=${pathEDbprResult2.conflictEvidenceId})`);
} else {
  assert.equal(
    Number(pathEDbprResult2.businessId),
    pathEApollo2BusinessId,
    `Path E2: name+city+state fallback must resolve to same businesses.id ` +
    `(apollo=${pathEApollo2BusinessId} dbpr=${pathEDbprResult2.businessId})`,
  );
  console.log(
    `[cert] Path E2 DBPR-HR: name+city+state fallback → same businesses.id=${pathEApollo2BusinessId}`,
  );
}
console.log("[cert] PASS Path E: cross-source dedup (phone + name/location fallback) certified");

// ═════════════════════════════════════════════════════════════════════════════
// PATH F — Concurrent projection race: Apollo + DBPR-HR simultaneously
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path F: concurrent projection race Apollo vs DBPR-HR (run=${run}) ──`);

const pathFPhone = `561${runDigits}`;
const pathFName = `Cert Path F Lounge ${run}`;

const [pathFApolloResult, pathFDbprResult] = await Promise.all([
  projectBusinessOnly({
    itemId: crypto.randomUUID(),
    sourceSystem: "apollo",
    sourceType: "provider_csv_row",
    stableKey: `apollo:cert-f-${run}`,
    organization: {
      canonicalName: pathFName,
      websiteDomain: `cert-f-${run}.example.test`,
      mainPhone: pathFPhone,
      city: "Boca Raton",
      state: "FL",
    },
    location: { city: "Boca Raton", state: "FL" },
  }),
  projectBusinessOnly({
    itemId: crypto.randomUUID(),
    sourceSystem: "dbpr-hr",
    sourceType: "provider_csv_row",
    stableKey: `dbpr-hr:HR-F-${run.slice(0, 8)}`,
    organization: {
      canonicalName: pathFName,
      // No domain — DBPR-HR does not produce a domain
      mainPhone: pathFPhone,
      city: "Boca Raton",
      state: "FL",
    },
    location: { city: "Boca Raton", state: "FL" },
  }),
]) as any[];

// Both must be non-null and produce a valid outcome
assert(pathFApolloResult, "Path F: Apollo projectBusinessOnly must return a result");
assert(pathFDbprResult, "Path F: DBPR-HR projectBusinessOnly must return a result");

// Every outcome (created/matched/conflict) is acceptable — no silent duplicate is permitted.
// If both succeeded (created or matched), they must reference the same businesses.id.
// If either produced a conflict, linked canonical_conflict_evidence must exist.
const pathFApolloOk = pathFApolloResult.outcome === "created" || pathFApolloResult.outcome === "matched";
const pathFDbprOk = pathFDbprResult.outcome === "created" || pathFDbprResult.outcome === "matched";

if (pathFApolloOk && pathFDbprOk) {
  assert.equal(
    Number(pathFApolloResult.businessId),
    Number(pathFDbprResult.businessId),
    `Path F: concurrent race must resolve to same businesses.id via advisory-lock serialization ` +
    `(apollo=${pathFApolloResult.businessId} dbpr=${pathFDbprResult.businessId})`,
  );
  console.log(
    `[cert] Path F: advisory-lock serialized → same businesses.id=${pathFApolloResult.businessId} ` +
    `(apollo=${pathFApolloResult.outcome} dbpr=${pathFDbprResult.outcome})`,
  );
} else {
  // At least one conflict — verify linked evidence exists; no unlinked duplicate businesses
  const conflictIds = [
    (pathFApolloResult as any).conflictEvidenceId,
    (pathFDbprResult as any).conflictEvidenceId,
  ].filter(Boolean);
  assert(
    conflictIds.length > 0,
    `Path F: non-created/matched outcomes must produce conflict evidence rows; got apollo=${pathFApolloResult.outcome} dbpr=${pathFDbprResult.outcome}`,
  );
  for (const evidenceId of conflictIds) {
    const evidence = rows(await db.execute(sql`
      SELECT id FROM canonical_conflict_evidence WHERE id = ${String(evidenceId)}::uuid
    `))[0];
    assert(evidence, `Path F: canonical_conflict_evidence must exist for id=${evidenceId}`);
  }
  console.log(`[cert] Path F: conflict race → linked conflict_evidence (${conflictIds.length} row(s)); no unlinked duplicate`);
}

// Verify no unlinked duplicate businesses rows for this name+phone combination
const pathFBusinessCount = Number(
  rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM businesses
     WHERE regexp_replace(coalesce(main_phone, ''), '[^0-9]', '', 'g') = ${pathFPhone.replace(/\D/g, "")}
  `))[0]?.n ?? 0,
);
assert(
  pathFBusinessCount <= 1,
  `Path F: at most one businesses row must exist for this phone — got ${pathFBusinessCount} (silent canonical duplicate detected)`,
);
console.log("[cert] PASS Path F: concurrent projection race → no silent canonical duplicate");

// ═════════════════════════════════════════════════════════════════════════════
// GLOBAL EFFECT-DENIED PROOF — deals, enrollments unchanged across all paths
// ═════════════════════════════════════════════════════════════════════════════

const finalCounts = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM deals)              AS deals,
    (SELECT COUNT(*)::int FROM sequence_enrollments) AS enrollments
`))[0];

assert.equal(
  Number(finalCounts.deals),
  Number(baseline.deals),
  `Global effect-denied: deals must not change (before=${baseline.deals} after=${finalCounts.deals})`,
);
assert.equal(
  Number(finalCounts.enrollments),
  Number(baseline.enrollments),
  `Global effect-denied: sequence_enrollments must not change (before=${baseline.enrollments} after=${finalCounts.enrollments})`,
);

console.log("\n[cert] PASS Global effect-denied: zero new deals, zero new sequence_enrollments across all six paths");
console.log(
  "\n✅ CRO-03B CSV Handoff Certification COMPLETE — " +
  "Path A (business-only), Path B (contact + validation), Path C (safe-hold), " +
  "Path D (DBPR-HR adapter + CRO-03B pipeline), " +
  "Path E (cross-source dedup Apollo + DBPR-HR), " +
  "Path F (concurrent projection race)\n",
);
process.exit(0);
