import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { createCro03SourceBatch } from "../server/services/cro03/source-staging";
import {
  createCro03aQualificationRun, processCro03aQualificationRunQueueSafe,
} from "../server/services/cro03a/qualification-service";
import {
  admitCro03bHandoffs, processNextCro03bRecipeItem, reviewAndProjectCro03bItem,
} from "../server/services/cro03/admission-service";
import { resumeCro03bAfterValidation } from "../server/services/cro03/projection-service";
import { CRO03B_UNIFIED_RECIPE } from "../server/services/cro03/recipe-contract";

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const run = crypto.randomUUID();
const admin = rows(await db.execute(sql`SELECT id FROM users WHERE role='admin' ORDER BY created_at LIMIT 1`))[0];
assert(admin, "admin reviewer fixture required");
const forbiddenBefore = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM contact_provider_projections) AS projections,
    (SELECT COUNT(*)::int FROM deals) AS deals,
    (SELECT COUNT(*)::int FROM sequence_enrollments) AS enrollments
`))[0];
const observedAt = new Date().toISOString();
const subjectKey = `cro03b-cert-${run}`;
const email = `cro03b-${run}@example.test`;
await createCro03SourceBatch({
  idempotencyKey: `cro03b-cert-source:${run}`,
  actorType: "system", actorId: "cro03b-certification", purpose: "staging_review",
  subjects: [{
    subjectType: "prospect", subjectKey, sourceSystem: "prospects",
    sourceObservedAt: observedAt, sourceEventKey: `cro03b-cert-event:${run}`, timestampProvenance: "source",
    provenance: { certification: true },
    payload: {
      businessName: `CRO03B Certification ${run}`, website: `https://cro03b-${run}.example.test`,
      email, phone: "3055550199", address: "100 Test Way", city: "Miami", state: "FL",
      county: "Miami-Dade", industry: "Auto", entityStatus: "active",
    },
    candidateValues: {
      business_name: `CRO03B Certification ${run}`, website: `https://cro03b-${run}.example.test`,
      email, phone: "3055550199", address: "100 Test Way", city: "Miami", state: "FL",
      category: "Auto", entity_status: "active",
    },
  }],
});
const occurrence = rows(await db.execute(sql`
  SELECT o.id FROM cro03_source_occurrences o
   WHERE o.source_event_key=${`cro03b-cert-event:${run}`}
`))[0];
assert(occurrence);
const qualification = await createCro03aQualificationRun({
  idempotencyKey: `cro03b-cert-qualification:${run}`, occurrenceIds: [occurrence.id],
  actorId: String(admin.id), actorRole: "admin",
});
await processCro03aQualificationRunQueueSafe(qualification.id);
const handoff = rows(await db.execute(sql`
  SELECT id FROM cro03a_handoffs WHERE run_id=${qualification.id}::uuid
`))[0];
assert(handoff, "fixture must qualify into a handoff");
const [admitted, replay] = await Promise.all([0, 1].map(() => admitCro03bHandoffs({
  handoffIds: [String(handoff.id)], actorId: String(admin.id), actorRole: "admin",
  reason: "deterministic integration certification",
})));
assert.equal(replay.id, admitted.id);
assert.equal([admitted.replayed, replay.replayed].filter(Boolean).length, 1);
await assert.rejects(admitCro03bHandoffs({
  handoffIds: [String(handoff.id)], actorId: String(admin.id), actorRole: "admin",
  reason: "changed deterministic integration certification",
}), /CRO03B_COMMAND_PAYLOAD_CONFLICT/);
assert.equal(await processNextCro03bRecipeItem(), "waiting");
const item = rows(await db.execute(sql`
  SELECT id,state FROM cro03b_recipe_items WHERE command_id=${admitted.id}::uuid
`))[0];
assert.equal(item.state, "review_required");
const deniedStages = rows(await db.execute(sql`
  SELECT o.step_key,o.execution_owner,o.accounting_owner,o.requested_units,o.settled_units,
         a.outcome,a.transport_invoked,r.outcome AS receipt_outcome,r.evidence_hash,
         e.outcome AS evidence_outcome
    FROM cro03b_stage_operations o
    JOIN cro03b_stage_attempts a ON a.operation_id=o.id
    JOIN cro03b_stage_receipts r ON r.operation_id=o.id
    JOIN cro03b_evidence_observations e ON e.stage_operation_id=o.id
   WHERE o.item_id=${item.id}::uuid ORDER BY o.step_key
`));
const externalRecipeSteps = CRO03B_UNIFIED_RECIPE.steps.filter((step) =>
  ["public-web", "rdap", "jsonld", "serper", "outscraper", "openai", "apollo"].includes(step.id));
assert.equal(deniedStages.length, externalRecipeSteps.length);
for (const stage of deniedStages) {
  const recipeStep = externalRecipeSteps.find((step) => step.id === stage.step_key)!;
  assert.equal(stage.execution_owner, recipeStep.executionOwner);
  assert.equal(stage.accounting_owner, recipeStep.accountingOwner);
  assert.equal(Number(stage.requested_units), 0);
  assert.equal(Number(stage.settled_units), 0);
  assert.equal(stage.outcome, "transport_denied");
  assert.equal(stage.transport_invoked, false);
  assert.equal(stage.receipt_outcome, "transport_denied");
  assert.equal(stage.evidence_outcome, "disabled");
  assert.match(stage.evidence_hash, /^[0-9a-f]{64}$/);
}
const validationEffectsBefore = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM provider_operations WHERE provider='zerobounce') AS operations,
    (SELECT COUNT(*)::int FROM provider_attempts a JOIN provider_operations o ON o.id=a.operation_id
      WHERE o.provider='zerobounce') AS attempts
`))[0];
await reviewAndProjectCro03bItem(String(item.id), String(admin.id));
const finalization = rows(await db.execute(sql`
  SELECT f.*,i.contact_id FROM cro03b_finalization_receipts f
  JOIN cro03b_recipe_items i ON i.id=f.item_id WHERE f.item_id=${item.id}::uuid
`))[0];
assert(finalization.validation_intent_id);
const intents = rows(await db.execute(sql`
  SELECT purpose,enqueue_state,terminal_code,execution_authorized_at,execution_authority,COUNT(*)::int count
    FROM validation_intents
   WHERE contact_id=${finalization.contact_id} AND subject_generation=${finalization.subject_generation}
   GROUP BY purpose,enqueue_state,terminal_code,execution_authorized_at,execution_authority
`));
assert.deepEqual(intents, [{
  purpose: "cro03_winning_email", enqueue_state: "deferred",
  terminal_code: "cro03b_provider_denied", execution_authorized_at: null,
  execution_authority: null, count: 1,
}]);
const { processValidationIntent } = await import("../server/services/provider-readiness-control");
assert.equal(await processValidationIntent(String(finalization.validation_intent_id), {
  verifyEmail: async () => { throw new Error("CRO03B_FORBIDDEN_TRANSPORT"); },
}), "not_found");
const validationEffectsAfter = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM provider_operations WHERE provider='zerobounce') AS operations,
    (SELECT COUNT(*)::int FROM provider_attempts a JOIN provider_operations o ON o.id=a.operation_id
      WHERE o.provider='zerobounce') AS attempts
`))[0];
assert.deepEqual(validationEffectsAfter, validationEffectsBefore);
await db.execute(sql`
  UPDATE validation_intents SET state='completed',completed_at=NOW(),updated_at=NOW()
   WHERE id=${finalization.validation_intent_id}::uuid
`);
const concurrentResumes = await Promise.all([
  resumeCro03bAfterValidation(String(item.id)),
  resumeCro03bAfterValidation(String(item.id)),
]);
assert.ok(concurrentResumes.some((result) => result.state === "completed"));
assert.equal((await resumeCro03bAfterValidation(String(item.id))).state, "completed");
const hookRequests = rows(await db.execute(sql`
  SELECT state,attempt_count FROM cro03b_terminal_hook_requests WHERE item_id=${item.id}::uuid
`));
assert.equal(hookRequests.length, 1);
assert.equal(hookRequests[0].state, "completed");
assert.equal(Number(hookRequests[0].attempt_count), 1);
const finalCommand = rows(await db.execute(sql`
  SELECT state,terminal_count,total_count FROM cro03b_recipe_commands WHERE id=${admitted.id}::uuid
`))[0];
assert.equal(finalCommand.state, "completed");
assert.equal(Number(finalCommand.terminal_count), Number(finalCommand.total_count));
const forbiddenAfter = rows(await db.execute(sql`
  SELECT
    (SELECT COUNT(*)::int FROM contact_provider_projections) AS projections,
    (SELECT COUNT(*)::int FROM deals) AS deals,
    (SELECT COUNT(*)::int FROM sequence_enrollments) AS enrollments
`))[0];
assert.deepEqual(forbiddenAfter, forbiddenBefore);
console.log("PASS CRO-03B durable integration chain, replay, final intent, and zero forbidden effects");
process.exit(0);