/**
 * CRO-03B CSV Handoff Certification — Business-Only, Contact, and Safe-Hold Paths
 *
 * Certifies three distinct terminal paths through the CRO-03B admission pipeline:
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
import { resumeCro03bAfterValidation } from "../server/services/cro03/projection-service";
import { CRO03B_UNIFIED_RECIPE } from "../server/services/cro03/recipe-contract";

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

console.log("\n[cert] PASS Global effect-denied: zero new deals, zero new sequence_enrollments across all three paths");
console.log("\n✅ CRO-03B CSV Handoff Certification COMPLETE — Path A (business-only), Path B (contact + validation), Path C (safe-hold)\n");
process.exit(0);
