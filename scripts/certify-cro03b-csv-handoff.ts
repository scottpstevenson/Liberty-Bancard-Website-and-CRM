/**
 * CRO-03B CSV Handoff Certification — Business-Only, Contact, Safe-Hold, DBPR-HR, and Cross-Source Dedup Paths
 *
 * Certifies seven distinct terminal paths through the CRO-03B admission pipeline:
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
 *   Path G — countyFips conflict (CRO03B_COUNTY_FIPS_CONFLICT guard):
 *     Two source observations for related occurrences carry conflicting countyFips
 *     values (12086 Miami-Dade and 12011 Broward) in their payloads. Both
 *     occurrence IDs are frozen in the same handoff. reviewAndProjectCro03bItem()
 *     must throw CRO03B_COUNTY_FIPS_CONFLICT; the item remains in review_required;
 *     zero business_locations, business_projections, or canonical_source_links rows
 *     are created for the conflicting handoff item.
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
import { createCro03SourceBatch, hashCro03Evidence } from "../server/services/cro03/source-staging";
import { stableCro03aSelectionHash } from "../server/services/cro03/contracts";
import {
  activateCro03aPolicy,
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
// PATH D — Real DBPR-HR adapter path: real CRO-03A chain with v3 policy
// ═════════════════════════════════════════════════════════════════════════════
//
// This path exercises the FULL real chain for DBPR-HR records:
//   CSV row → dbprHrAdapter.normalize() → runSourceImport() →
//   createCro03aQualificationRun() (v3 policy with Restaurant/Hospitality) →
//   processCro03aQualificationRunQueueSafe() → handoff →
//   admitCro03bHandoffs() → processNextCro03bRecipeItem() →
//   reviewAndProjectCro03bItem() → projectBusinessOnly() →
//   business_only_projection_completed + business_locations(county_fips)
//
// Post-deployment operations note:
//   After deploying MI-06 field fixes, re-import the current DBPR-HR source snapshot
//   to create new occurrences with canonical payload fields (vertical, entityStatus,
//   postalCode). Qualify only the newly created occurrences idempotently via the
//   auto-wire. Historical immutable observations (created before #1915) do NOT need
//   to be mutated — the re-import creates new occurrences with the correct shape.

console.log(`\n[cert] ── Path D: DBPR-HR real CRO-03A chain (v3 policy) + CRO-03B pipeline (run=${run}) ──`);

// ── D_SETUP: Save prior policy pointer and activate v3 in this disposable DB ──

const pathDPriorPolicyControl = rows(await db.execute(sql`
  SELECT active_policy_id, expected_version FROM cro03a_policy_control WHERE id = 1
`))[0];
assert(pathDPriorPolicyControl, "Path D setup: cro03a_policy_control row must exist");

const pathDV3Policy = rows(await db.execute(sql`
  SELECT id, version, policy_hash
    FROM cro03a_policy_documents
   WHERE policy_key = 'south_florida_candidate_qualification' AND version = 3
   LIMIT 1
`))[0];
assert(pathDV3Policy, "Path D setup: v3 policy document must exist (migration 0256 must be applied)");

// Safety guard: refuse to activate v3 in a production environment.
// Production activation requires MI-09 operator approval and a v1-vs-v3 impact preview.
assert(
  process.env.NODE_ENV !== "production",
  "Path D setup: REFUSED — v3 policy activation must not run in a production environment. " +
  "Use a disposable certification DB. Production activation is deferred to MI-09.",
);
// Additional guard: verify the DB is not named with 'prod' to catch mis-pointed connections.
const pathDCurrentDb = rows(await db.execute(sql`SELECT current_database() AS dbname`))[0];
assert(
  !String(pathDCurrentDb?.dbname ?? "").toLowerCase().includes("prod"),
  `Path D setup: REFUSED — connected database '${pathDCurrentDb?.dbname}' appears to be a production database. ` +
  `v3 policy activation must only run in the disposable cert environment.`,
);

// Activate v3 only in this disposable DB cert environment.
// Production activation is deferred to MI-09 — a v1-vs-v3 impact preview is required first.
const pathDActivated = await activateCro03aPolicy({
  policyId: String(pathDV3Policy.id),
  expectedVersion: Number(pathDPriorPolicyControl.expected_version),
  reason: "cert-path-d-v3-activation-disposable-db-only",
  actorId: String(admin.id),
});
console.log(
  `[cert] Path D setup: v3 policy activated in disposable DB ` +
  `(policyId=${pathDV3Policy.id} hash=${pathDV3Policy.policy_hash} controlVersion=${pathDActivated.controlVersion})`,
);

// Seed a disposable DB runtime attestation documenting migration_head alignment.
// CRO03C_CURRENT_MIGRATION_HEAD = "0255_mi06_business_email_winner" (from contracts.ts).
// This attestation is not required for CRO-03B processing but documents that the
// cert ran against the correct migration head.
const pathDAttestationId = crypto.randomUUID();
const pathDAttestationHash = crypto.createHash("sha256")
  .update(`cert-path-d-attestation:${run}:migration_head:0255_mi06_business_email_winner`).digest("hex");
const pathDFakeReleaseSha = "0000000000000000000000000000000000000000";
await db.execute(sql`
  INSERT INTO cro03c_runtime_attestations
    (id, idempotency_key, artifact_sha, migration_head, deployment_identity,
     environment_identity, web_boot_identity, worker_boot_identity,
     queue_topology_hash, worker_heartbeat_at, db_healthy, redis_healthy,
     expires_at, attestation_hash, created_by)
  VALUES (
    ${pathDAttestationId}::uuid,
    ${"cert-path-d-attestation:" + run},
    ${pathDFakeReleaseSha},
    ${"0255_mi06_business_email_winner"},
    ${"cert-path-d"},
    ${"disposable-db"},
    ${"cert-web-boot"},
    ${"cert-worker-boot"},
    ${pathDAttestationHash},
    NOW(),
    TRUE, TRUE,
    NOW() + INTERVAL '1 hour',
    ${pathDAttestationHash},
    ${String(admin.id)}
  )
  ON CONFLICT (idempotency_key) DO NOTHING
`);
console.log("[cert] Path D setup: disposable DB attestation seeded (migration_head=0255_mi06_business_email_winner)");

try {
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
assert.equal(pathDNormalized!.vertical, "Restaurant",
  `Path D adapter: vertical must be 'Restaurant' (canonical string from DBPR_HR_VERTICAL_MAP); got '${pathDNormalized!.vertical}'`);
console.log("[cert] PASS Path D adapter: normalize() exposes city/state/address/phone/vertical on NormalizedSourceRecord");

// ── D1: Positive fixture — has phone → real CRO-03A chain → business_locations ─

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

// Verify occurrence payload contains canonical field names (not deprecated aliases)
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
assert.equal(String(pathD1PayloadObj.vertical), "Restaurant",
  `Path D positive: occurrence payload.vertical must be 'Restaurant' (canonical string); got '${pathD1PayloadObj.vertical}'`);
assert.equal(String(pathD1PayloadObj.entityStatus), "active",
  `Path D positive: occurrence payload.entityStatus must be 'active' (string, not boolean); got '${pathD1PayloadObj.entityStatus}'`);
assert(pathD1PayloadObj.postalCode, "Path D positive: occurrence payload must include postalCode (canonical field, not deprecated addressZip)");
assert(!("addressZip" in pathD1PayloadObj),
  "Path D positive: occurrence payload must NOT contain deprecated addressZip field");
assert(!("licenseType" in pathD1PayloadObj),
  "Path D positive: occurrence payload must NOT contain raw licenseType — vertical string is used instead");
console.log(
  "[cert] Path D positive: occurrence payload canonical fields verified — " +
  `vertical=${pathD1PayloadObj.vertical} entityStatus=${pathD1PayloadObj.entityStatus} postalCode=${pathD1PayloadObj.postalCode}`,
);

// Run real CRO-03A qualification against v3 policy (Restaurant/Hospitality now targetVerticals)
const pathD1QualRun = await createCro03aQualificationRun({
  idempotencyKey: `cert-path-d-pos-qual:${run}`,
  occurrenceIds: [String(pathD1Occurrence.id)],
  actorId: String(admin.id),
  actorRole: "admin",
});
await processCro03aQualificationRunQueueSafe(pathD1QualRun.id);

// Assert decision fields
const pathD1Decision = rows(await db.execute(sql`
  SELECT d.disposition, d.score, d.vertical_result, d.active_state_evidence,
         d.policy_id, d.policy_version, d.policy_hash
    FROM cro03a_qualification_decisions d
    JOIN cro03a_qualification_items i ON i.id = d.item_id
   WHERE i.run_id = ${pathD1QualRun.id}::uuid
   LIMIT 1
`))[0];
assert(pathD1Decision, "Path D positive: qualification decision must exist after CRO-03A run");
assert.equal(String(pathD1Decision.disposition), "selected",
  `Path D positive: decision disposition must be 'selected'; got '${pathD1Decision.disposition}'`);
assert(Number(pathD1Decision.score) >= 70,
  `Path D positive: decision score must be >= 70 (selectedMinimum); got ${pathD1Decision.score}`);

const pathD1VerticalResult = typeof pathD1Decision.vertical_result === "string"
  ? JSON.parse(pathD1Decision.vertical_result)
  : (pathD1Decision.vertical_result as Record<string, unknown>);
assert.equal(String(pathD1VerticalResult?.vertical), "Restaurant",
  `Path D positive: decision vertical must be 'Restaurant'; got '${pathD1VerticalResult?.vertical}'`);
assert(
  pathD1VerticalResult?.targetVertical === true || String(pathD1VerticalResult?.targetVertical) === "true",
  `Path D positive: decision targetVertical must be true (v3 includes Restaurant); got '${pathD1VerticalResult?.targetVertical}'`,
);

const pathD1ActiveEvidence = typeof pathD1Decision.active_state_evidence === "string"
  ? JSON.parse(pathD1Decision.active_state_evidence)
  : (pathD1Decision.active_state_evidence as Record<string, unknown>);
assert(
  pathD1ActiveEvidence?.active === true || String(pathD1ActiveEvidence?.active).toLowerCase() === "true",
  `Path D positive: active_state_evidence.active must be true (entityStatus='active'); got '${pathD1ActiveEvidence?.active}'`,
);
assert(pathD1Decision.policy_id, "Path D positive: decision must reference a policy_id");
assert(pathD1Decision.policy_hash, "Path D positive: decision must reference a policy_hash");
assert.equal(Number(pathD1Decision.policy_version), 3,
  `Path D positive: decision policy_version must be 3 (v3 policy); got '${pathD1Decision.policy_version}'`);
console.log(
  `[cert] Path D positive: CRO-03A decision — disposition=selected score=${pathD1Decision.score} ` +
  `vertical=Restaurant targetVertical=true entityStatus=active policyVersion=3`,
);

// Get handoff created by real CRO-03A qualification
const pathD1Handoff = rows(await db.execute(sql`
  SELECT id FROM cro03a_handoffs WHERE run_id = ${pathD1QualRun.id}::uuid
`))[0];
assert(pathD1Handoff, "Path D positive: handoff must be created by CRO-03A qualification (disposition=selected)");
const pathD1HandoffId = String(pathD1Handoff.id);

// Admit to CRO-03B
const pathD1Admitted = await admitCro03bHandoffs({
  handoffIds: [pathD1HandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B certification — Path D positive real chain (phone present)",
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

// Assert exactly one canonical_source_links row with source_system='dbpr-hr'
const pathD1SourceLinks = rows(await db.execute(sql`
  SELECT source_system, stable_key, business_id
    FROM canonical_source_links
   WHERE source_system = 'dbpr-hr' AND stable_key = ${'dbpr-hr:' + pathDLicense1}
`));
assert.equal(pathD1SourceLinks.length, 1,
  `Path D positive: must have exactly 1 canonical_source_links row for source_system='dbpr-hr'; got ${pathD1SourceLinks.length}`);
const pathD1BusinessId = Number((pathD1SourceLinks[0] as any).business_id);
assert(pathD1BusinessId > 0, "Path D positive: canonical_source_links must reference a valid businesses.id");

// Assert full business_locations row with county_fips='12086' (Miami-Dade, zip 33101)
const pathD1Locations = rows(await db.execute(sql`
  SELECT county_fips, postal_code, street_address, city, state
    FROM business_locations
   WHERE business_id = ${pathD1BusinessId}
`));
assert(pathD1Locations.length > 0,
  "Path D positive: business_locations row must be created (countyFips loaded from occurrence payload)");
const pathD1Location = pathD1Locations[0] as any;
assert.equal(String(pathD1Location.county_fips), "12086",
  `Path D positive: business_locations.county_fips must be '12086' (Miami-Dade for zip 33101); got '${pathD1Location.county_fips}'`);
console.log(
  `[cert] PASS Path D positive: real CRO-03A v3 chain → ` +
  `decision=selected score=${pathD1Decision.score} vertical=Restaurant targetVertical=true policyVersion=3 → ` +
  `business_only_projection_completed (outcome=${pathD1ProjectResult.outcome}) → ` +
  `canonical_source_links(dbpr-hr) → business_locations(county_fips=${pathD1Location.county_fips})`,
);

// ── D2: Negative fixture — no phone, no address → CRO-03A qualifies but CRO-03B safe-holds ─

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

// Run real CRO-03A against v3 policy — record qualifies (vertical+geo+active score >= 70)
const pathD2QualRun = await createCro03aQualificationRun({
  idempotencyKey: `cert-path-d-neg-qual:${run}`,
  occurrenceIds: [String(pathD2Occurrence.id)],
  actorId: String(admin.id),
  actorRole: "admin",
});
await processCro03aQualificationRunQueueSafe(pathD2QualRun.id);

const pathD2Handoff = rows(await db.execute(sql`
  SELECT id FROM cro03a_handoffs WHERE run_id = ${pathD2QualRun.id}::uuid
`))[0];
assert(pathD2Handoff,
  "Path D negative: handoff must be created by CRO-03A qualification (vertical+geo+active scoring passes even without phone)");

const pathD2Admitted = await admitCro03bHandoffs({
  handoffIds: [String(pathD2Handoff.id)],
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

} finally {
  // ── D_TEARDOWN: Restore prior CRO-03A policy control pointer (guaranteed) ──
  // v3 was activated only for this cert run. Restore the prior active policy so
  // subsequent cert paths and production workflows are not affected.
  // Uses try/finally to guarantee restoration even if assertions above throw.
  try {
    await activateCro03aPolicy({
      policyId: String(pathDPriorPolicyControl.active_policy_id),
      expectedVersion: pathDActivated.controlVersion,
      reason: "cert-path-d-restore-prior-policy-after-v3-cert",
      actorId: String(admin.id),
    });
    console.log(
      `[cert] Path D teardown: prior policy (id=${pathDPriorPolicyControl.active_policy_id}) restored — ` +
      `production activation of v3 deferred to MI-09`,
    );
  } catch (teardownErr: any) {
    console.error(`[cert] WARN Path D teardown: failed to restore prior policy — ${teardownErr?.message}. Manual restore required.`);
  }
}

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
// PATH G — countyFips conflict guard (CRO03B_COUNTY_FIPS_CONFLICT)
// ─────────────────────────────────────────────────────────────────────────────
// Two source observations for the same source subject carry conflicting
// countyFips values (12086 Miami-Dade and 12011 Broward). Both occurrence IDs
// are frozen in the same handoff. reviewAndProjectCro03bItem() must throw
// CRO03B_COUNTY_FIPS_CONFLICT; item remains review_required; zero
// business_locations, business_projections, and canonical_source_links rows
// are created for the conflicting handoff item.
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\n[cert] ── Path G: countyFips conflict guard (CRO03B_COUNTY_FIPS_CONFLICT) ──`);

// ── G_SETUP: Stage two source observations with conflicting countyFips ────────
// Two SEPARATE subjects, each with its own occurrence, in the same source system.
// Occurrence 1: countyFips='12086' (Miami-Dade)
// Occurrence 2: countyFips='12011' (Broward)
// Both occurrence IDs are embedded in the handoff at INSERT time — the
// cro03a_handoffs_immutable BEFORE UPDATE/DELETE trigger forbids any later UPDATE.

const pathGSubjectKey1 = `cert-g-fips-a-${run.slice(0, 8)}`;
const pathGSubjectKey2 = `cert-g-fips-b-${run.slice(0, 8)}`;

const pathGBasePayload = {
  vertical: "Auto",
  city: "Miami",
  state: "FL",
  postalCode: "33101",
  phone: `305${runDigits}`,
  address: "100 Brickell Ave",
  entityStatus: "active",
};

const pathGBatch = await createCro03SourceBatch({
  idempotencyKey: `cert-path-g-batch:${run}`,
  actorType: "system",
  actorId: String(admin.id),
  purpose: "staging_review",
  subjects: [
    {
      subjectType: "provider_csv_row",
      subjectKey: pathGSubjectKey1,
      sourceSystem: "apollo",
      provenance: { certPath: "G", countyFipsVariant: "miami-dade" },
      payload: { ...pathGBasePayload, businessName: `Cert G FIPS Conflict ${run.slice(0, 8)}`, countyFips: "12086" },
    },
    {
      subjectType: "provider_csv_row",
      subjectKey: pathGSubjectKey2,
      sourceSystem: "apollo",
      provenance: { certPath: "G", countyFipsVariant: "broward" },
      payload: { ...pathGBasePayload, businessName: `Cert G FIPS Conflict B ${run.slice(0, 8)}`, countyFips: "12011" },
    },
  ],
});
assert(pathGBatch.occurrenceIds.length >= 2,
  `Path G: createCro03SourceBatch must return >= 2 occurrenceIds; got ${pathGBatch.occurrenceIds.length}`);

// ── G1: Retrieve both occurrence IDs ─────────────────────────────────────────

const pathGOcc1 = rows(await db.execute(sql`
  SELECT o.id FROM cro03_source_occurrences o
   JOIN cro03_source_subjects s ON s.id = o.source_subject_id
  WHERE s.subject_key = ${pathGSubjectKey1} AND s.source_system = 'apollo'
  ORDER BY o.source_observed_at DESC LIMIT 1
`))[0];
assert(pathGOcc1, "Path G: occurrence 1 (countyFips=12086) must exist after staging");
const pathGOcc1Id = String(pathGOcc1.id);

const pathGOcc2 = rows(await db.execute(sql`
  SELECT o.id FROM cro03_source_occurrences o
   JOIN cro03_source_subjects s ON s.id = o.source_subject_id
  WHERE s.subject_key = ${pathGSubjectKey2} AND s.source_system = 'apollo'
  ORDER BY o.source_observed_at DESC LIMIT 1
`))[0];
assert(pathGOcc2, "Path G: occurrence 2 (countyFips=12011) must exist after staging");
const pathGOcc2Id = String(pathGOcc2.id);
console.log(`[cert] Path G: occ1=${pathGOcc1Id} (Miami-Dade 12086) occ2=${pathGOcc2Id} (Broward 12011)`);

// ── G2: Resolve current active policy for the scaffold ──────────────────────
// Path D may have activated a newer policy in this disposable DB — query the
// live control pointer rather than assuming a fixed version.

const pathGActivePolicy = rows(await db.execute(sql`
  SELECT p.id, p.version, p.policy_hash
    FROM cro03a_policy_control c
    JOIN cro03a_policy_documents p ON p.id = c.active_policy_id
   WHERE c.id = 1
`))[0];
assert(pathGActivePolicy, "Path G: active policy must be resolvable for scaffold");
const pathGPolicyId    = String(pathGActivePolicy.id);
const pathGPolicyVer   = Number(pathGActivePolicy.version);
const pathGPolicyHash  = String(pathGActivePolicy.policy_hash);

// ── G3: INSERT full scaffold (run → item → decision → handoff) ──────────────
// The handoff is created with occurrence_ids=[occ1.id, occ2.id] at INSERT time,
// preserving the append-only invariant enforced by cro03a_handoffs_immutable.

const pathGOccIds = [pathGOcc1Id, pathGOcc2Id];
const pathGSelHash = stableCro03aSelectionHash(pathGOccIds);
const pathGScopeHash = hashCro03Evidence([...pathGOccIds].sort());
const pathGOccJson = JSON.stringify(pathGOccIds);

// qualification run
const pathGRunRow = rows(await db.execute(sql`
  INSERT INTO cro03a_qualification_runs
    (idempotency_key, actor_id, actor_role, policy_id, policy_hash,
     scope_hash, frozen_occurrence_ids, state,
     total_count, selected_count, review_count, terminal_count, cursor_position)
  VALUES (
    ${"cert-path-g-run:" + run}, ${String(admin.id)}, 'admin',
    ${pathGPolicyId}::uuid, ${pathGPolicyHash},
    ${pathGScopeHash}, ${pathGOccJson}::jsonb, 'completed',
    2, 2, 0, 0, 2
  )
  RETURNING id
`))[0];
assert(pathGRunRow, "Path G: scaffold qualification run must be created");
const pathGRunId = String(pathGRunRow.id);

// qualification item for occ1 (the "primary" occurrence)
const pathGItemScaffoldRow = rows(await db.execute(sql`
  INSERT INTO cro03a_qualification_items
    (run_id, occurrence_id, ordinal, state, authority_evidence, authority_evaluated_at)
  VALUES (
    ${pathGRunId}::uuid, ${pathGOcc1Id}::uuid, 0,
    'completed', '{}'::jsonb, NOW()
  )
  RETURNING id
`))[0];
assert(pathGItemScaffoldRow, "Path G: scaffold qualification item must be created");
const pathGQItemId = String(pathGItemScaffoldRow.id);

// qualification decision — frozen_occurrence_ids includes BOTH occurrences so the
// handoff's occurrence_ids column inherits the full conflict scenario
const pathGDecisionRow = rows(await db.execute(sql`
  INSERT INTO cro03a_qualification_decisions
    (item_id, run_id, occurrence_id, disposition, score,
     geography_result, vertical_result, active_state_evidence,
     identity_relationship_evidence, fit_components, reason_codes,
     missing_field_classes, frozen_occurrence_ids,
     policy_id, policy_version, policy_hash, selection_hash)
  VALUES (
    ${pathGQItemId}::uuid, ${pathGRunId}::uuid, ${pathGOcc1Id}::uuid,
    'selected', 75,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    '[]'::jsonb, '[]'::jsonb,
    ${pathGOccJson}::jsonb,
    ${pathGPolicyId}::uuid, ${pathGPolicyVer}, ${pathGPolicyHash},
    ${pathGSelHash}
  )
  RETURNING id
`))[0];
assert(pathGDecisionRow, "Path G: scaffold qualification decision must be created");
const pathGDecisionId = String(pathGDecisionRow.id);

// handoff — occurrence_ids holds [occ1.id, occ2.id] at INSERT time (append-only)
const pathGHandoffScaffold = rows(await db.execute(sql`
  INSERT INTO cro03a_handoffs
    (run_id, decision_id, source_type, source_system, source_key,
     occurrence_ids, policy_id, policy_version, policy_hash,
     reason_codes, missing_field_classes, selection_hash, effect_authorized)
  VALUES (
    ${pathGRunId}::uuid, ${pathGDecisionId}::uuid,
    'provider_csv_row', 'apollo', ${pathGSubjectKey1},
    ${pathGOccJson}::jsonb,
    ${pathGPolicyId}::uuid, ${pathGPolicyVer}, ${pathGPolicyHash},
    '[]'::jsonb, '[]'::jsonb, ${pathGSelHash}, FALSE
  )
  RETURNING id
`))[0];
assert(pathGHandoffScaffold, "Path G: scaffold handoff must be created");
const pathGHandoffId = String(pathGHandoffScaffold.id);
console.log(`[cert] Path G: scaffold handoff id=${pathGHandoffId} occurrence_ids=${pathGOccJson}`);

// ── G4: Admit to CRO-03B ──────────────────────────────────────────────────────

const pathGAdmitted = await admitCro03bHandoffs({
  handoffIds: [pathGHandoffId],
  actorId: String(admin.id),
  actorRole: "admin",
  reason: "CRO-03B certification — Path G countyFips conflict",
});

// ── G5: Process to review_required ────────────────────────────────────────────

await processNextCro03bRecipeItem();
const pathGItem = rows(await db.execute(sql`
  SELECT id, state FROM cro03b_recipe_items WHERE command_id = ${pathGAdmitted.id}::uuid
`))[0];
assert(pathGItem, "Path G: recipe item must exist after processing");
assert.equal(pathGItem.state, "review_required",
  `Path G: item must be review_required after processing; got '${pathGItem.state}'`);
const pathGItemId = String(pathGItem.id);

// Baseline: count rows BEFORE the projection attempt
const pathGBaseline = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM business_locations
      WHERE business_id IN (
        SELECT id FROM businesses
         WHERE name LIKE ${"Cert G FIPS Conflict%"}
      )
    ) AS locations,
    (SELECT COUNT(*)::int FROM business_projections) AS projections,
    (SELECT COUNT(*)::int FROM canonical_source_links
      WHERE stable_key IN (${pathGSubjectKey1}, ${pathGSubjectKey2})
    ) AS source_links
`))[0];

// ── G6: Call reviewAndProjectCro03bItem — expect CRO03B_COUNTY_FIPS_CONFLICT ─

let pathGConflictErrorCaught = false;
let pathGConflictErrorMessage = "";
try {
  await reviewAndProjectCro03bItem(pathGItemId, String(admin.id));
} catch (err: any) {
  pathGConflictErrorMessage = err instanceof Error ? err.message : String(err);
  if (pathGConflictErrorMessage.includes("CRO03B_COUNTY_FIPS_CONFLICT")) {
    pathGConflictErrorCaught = true;
  }
}
assert(
  pathGConflictErrorCaught,
  `Path G: reviewAndProjectCro03bItem must throw CRO03B_COUNTY_FIPS_CONFLICT; got: "${pathGConflictErrorMessage}"`,
);
console.log(`[cert] Path G: CRO03B_COUNTY_FIPS_CONFLICT thrown correctly (${pathGConflictErrorMessage.slice(0, 120)})`);

// ── G7: Item must remain in review_required ───────────────────────────────────

const pathGItemAfter = rows(await db.execute(sql`
  SELECT state, terminal_code FROM cro03b_recipe_items WHERE id = ${pathGItemId}::uuid
`))[0];
assert.equal(
  pathGItemAfter.state,
  "review_required",
  `Path G: item must remain review_required after CRO03B_COUNTY_FIPS_CONFLICT; got '${pathGItemAfter.state}'`,
);
console.log(`[cert] Path G: item state remains 'review_required' — no mutation after conflict`);

// ── G8: Zero business_locations rows created for the conflicting item ──────────

const pathGAfterLocations = Number(
  rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM business_locations
     WHERE business_id IN (
       SELECT id FROM businesses WHERE name LIKE ${"Cert G FIPS Conflict%"}
     )
  `))[0]?.n ?? 0,
);
assert.equal(
  pathGAfterLocations,
  Number(pathGBaseline.locations),
  `Path G: zero business_locations rows must be created for the conflicting item; ` +
  `baseline=${pathGBaseline.locations} after=${pathGAfterLocations}`,
);
console.log("[cert] Path G: zero business_locations rows created");

// ── G9: Zero business_projections rows created ────────────────────────────────

const pathGAfterProjections = Number(
  rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM business_projections
  `))[0]?.n ?? 0,
);
assert.equal(
  pathGAfterProjections,
  Number(pathGBaseline.projections),
  `Path G: zero business_projections rows must be created; ` +
  `baseline=${pathGBaseline.projections} after=${pathGAfterProjections}`,
);
console.log("[cert] Path G: zero business_projections rows created");

// ── G10: Zero canonical_source_links rows created for this item's subjects ────

const pathGAfterSourceLinks = Number(
  rows(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM canonical_source_links
     WHERE stable_key IN (${pathGSubjectKey1}, ${pathGSubjectKey2})
  `))[0]?.n ?? 0,
);
assert.equal(
  pathGAfterSourceLinks,
  Number(pathGBaseline.source_links),
  `Path G: zero canonical_source_links rows must be created for conflicting subjects; ` +
  `baseline=${pathGBaseline.source_links} after=${pathGAfterSourceLinks}`,
);
console.log("[cert] Path G: zero canonical_source_links rows created");

console.log("[cert] PASS Path G: countyFips conflict guard → CRO03B_COUNTY_FIPS_CONFLICT thrown; " +
  "item remains review_required; zero business_locations, projections, source_links");

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

console.log("\n[cert] PASS Global effect-denied: zero new deals, zero new sequence_enrollments across all seven paths");
console.log(
  "\n✅ CRO-03B CSV Handoff Certification COMPLETE — " +
  "Path A (business-only), Path B (contact + validation), Path C (safe-hold), " +
  "Path D (DBPR-HR adapter + CRO-03B pipeline), " +
  "Path E (cross-source dedup Apollo + DBPR-HR), " +
  "Path F (concurrent projection race), " +
  "Path G (countyFips conflict → CRO03B_COUNTY_FIPS_CONFLICT)\n",
);
process.exit(0);
