#!/usr/bin/env npx tsx
/**
 * Disposable certification for Task 2060's automatic classification handoff,
 * post-watermark ingestion, geography follow-up, and provider-independent
 * durable cohort admission. The queue tick is run with provider transport
 * disabled; no discovery/validation transport can be dispatched.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "Task 2060 automatic SFP continuity certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "false";
delete process.env.SERPER_API_KEY;
applyCertificationProviderDenyBoundary({ fatal: true });

const { sql } = await import("drizzle-orm");
const { db, pool } = await import("../server/db");
const {
  processSfpFreeClassificationTick,
} = await import("../server/services/cro03/sfp-free-classification-continuation");
const { processSfpContinuousDiscoveryTick } =
  await import("../server/services/cro03/sfp-continuous-discovery");
const { SFP_TARGET_VERTICALS_V2 } = await import("../server/services/cro03/sfp-vertical-classifier");

const rows = (result: any): any[] => result?.rows ?? result ?? [];
const nonce = randomUUID();
const actorId = `system:sfp2060-continuity:${nonce}`;
const programName = "south-florida-v1";
const policyVersion = 206060;
const targetVertical = "Construction/Trades/Home Services";

async function addBusiness(name: string, vertical: string | null, withLocation: boolean): Promise<number> {
  const inserted = rows(await db.execute(sql`
    INSERT INTO businesses
      (canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class,website_domain)
    VALUES (${`${name} ${nonce}`},${`${name} ${nonce}`.toLowerCase()},${vertical},
            ${withLocation ? "Miami" : null},${withLocation ? "FL" : null},${withLocation ? "33130" : null},
            'active','canonical',NULL)
    RETURNING id
  `))[0];
  const id = Number(inserted.id);
  if (withLocation) {
    await db.execute(sql`
      INSERT INTO business_locations
        (business_id,is_primary,city,state,postal_code,county_fips,created_at,updated_at)
      VALUES (${id},TRUE,'Miami','FL','33130','12086',NOW(),NOW())
    `);
  }
  return id;
}

try {
  const programRow = rows(await db.execute(sql`
    INSERT INTO sfp_programs
      (name,county_fips,vertical_ids,max_cohort_size,policy_version,taxonomy_version,
       is_active,recurring_enabled,created_by)
    VALUES (${programName},ARRAY['12086'],ARRAY[${sql.join(
      SFP_TARGET_VERTICALS_V2.map((vertical) => sql`${vertical}`), sql`, `,
    )}],25,${policyVersion},2,TRUE,FALSE,${actorId})
    ON CONFLICT (name) DO UPDATE SET
      county_fips=EXCLUDED.county_fips,
      vertical_ids=EXCLUDED.vertical_ids,
      max_cohort_size=EXCLUDED.max_cohort_size,
      policy_version=EXCLUDED.policy_version,
      taxonomy_version=2,
      is_active=TRUE,
      recurring_enabled=FALSE
    RETURNING id
  `))[0];
  const programId = String(programRow.id);

  const roofingId = await addBusiness("Reliable Roofing", targetVertical, true);
  const supplierId = await addBusiness("Roofing Materials Supply", null, true);
  const geographyPendingId = await addBusiness("Local Roofing Contractor", targetVertical, false);

  const before = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM provider_operations) AS provider_operations,
      (SELECT COUNT(*)::int FROM sfp_stage_runs) AS stage_runs,
      (SELECT COUNT(*)::int FROM contacts WHERE business_id=ANY(ARRAY[${sql.join(
        [roofingId, supplierId, geographyPendingId].map((id) => sql`${id}`), sql`, `,
      )}]::integer[])) AS contacts,
      (SELECT COUNT(*)::int FROM sequence_enrollments se JOIN contacts c ON c.id=se.contact_id
        WHERE c.business_id=ANY(ARRAY[${sql.join(
          [roofingId, supplierId, geographyPendingId].map((id) => sql`${id}`), sql`, `,
        )}]::integer[])) AS enrollments
  `))[0];

  const first = await processSfpFreeClassificationTick();
  assert.equal(first.claimed, true, "the active named SFP v2 program starts its classification pass automatically");
  assert.equal(first.programId, programId);
  assert.equal(first.scanned, 3);
  assert.equal(first.processed, 2, "resolved geography is classified; unresolved geography remains a durable route");
  const firstDone = await processSfpFreeClassificationTick();
  assert.equal(firstDone.state, "completed");

  const supplierEvidence = rows(await db.execute(sql`
    SELECT outcome,reason_codes,terminal_state
      FROM sfp_classification_evidence
     WHERE business_id=${supplierId} AND policy_version=${policyVersion}
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  const supplierReasons = Array.isArray(supplierEvidence?.reason_codes)
    ? supplierEvidence.reason_codes
    : JSON.parse(supplierEvidence?.reason_codes ?? "[]");
  assert.equal(supplierEvidence?.outcome, "review_required");
  assert.equal(supplierEvidence?.terminal_state, "provisional");
  assert.ok(supplierReasons.includes("FREE_ONLY_NO_ESCALATION"),
    "uncertain vertical remains explicit provisional evidence for the supported OpenAI escalation route");

  const geographyReview = rows(await db.execute(sql`
    SELECT i.id,i.state,i.outcome_code
      FROM sfp_classification_items i
      JOIN sfp_classification_runs r ON r.id=i.run_id
     WHERE r.program_id=${programId}::uuid AND i.business_id=${geographyPendingId}
       AND i.state='skipped'
       AND i.outcome_code::jsonb @> '{"route":"geography_review"}'::jsonb
     ORDER BY i.created_at DESC LIMIT 1
  `))[0];
  assert.ok(geographyReview, "unresolved location evidence is retained as a durable geography-review item");
  const reviewFacts = JSON.parse(geographyReview.outcome_code);
  assert.ok(reviewFacts.reasons.length > 0 && Array.isArray(reviewFacts.candidates));

  // A business arriving after the pinned stop id must automatically reopen
  // from the old watermark rather than requiring an operator restart.
  const lateId = await addBusiness("Palm Coast Roofing", targetVertical, true);
  const late = await processSfpFreeClassificationTick();
  assert.equal(late.claimed, true);
  assert.equal(late.programId, programId);
  assert.equal(late.scanned, 1);
  assert.equal(late.processed, 1);
  assert.equal(Number((await pool.query(
    `SELECT high_water_business_id FROM sfp_free_classification_continuations WHERE program_id=$1`,
    [programId],
  )).rows[0].high_water_business_id), lateId);
  assert.equal((await processSfpFreeClassificationTick()).state, "completed");

  // A newly retained location fact re-enters the geography route even though
  // the original classification watermark has already completed.
  await db.execute(sql`
    INSERT INTO business_locations
      (business_id,is_primary,city,state,postal_code,county_fips,created_at,updated_at)
    VALUES (${geographyPendingId},TRUE,'Miami','FL','33130','12086',NOW(),NOW())
  `);
  const geographyFollowup = await processSfpFreeClassificationTick();
  assert.equal(geographyFollowup.claimed, false);
  assert.equal(geographyFollowup.processed, 1, "changed geography facts are automatically revisited after the watermark");
  const geographyEvidence = rows(await db.execute(sql`
    SELECT outcome,admission_tier
      FROM sfp_classification_evidence
     WHERE business_id=${geographyPendingId} AND policy_version=${policyVersion}
     ORDER BY created_at DESC LIMIT 1
  `))[0];
  assert.equal(geographyEvidence?.outcome, "target");
  assert.equal(geographyEvidence?.admission_tier, "resolved_high");
  const resolvedReview = rows(await db.execute(sql`
    SELECT state,outcome_code FROM sfp_classification_items
     WHERE id=${String(geographyReview.id)}::uuid
  `))[0];
  assert.equal(resolvedReview?.state, "completed");
  assert.equal(JSON.parse(resolvedReview?.outcome_code).route, "geography_review_revisited");

  // Continuous discovery admits a bounded cohort before checking provider
  // readiness, then stops quietly with transport globally disabled.
  const discovery = await processSfpContinuousDiscoveryTick();
  assert.equal(discovery.newlyFrozenCount, 1, "eligible inventory is admitted independently of provider readiness");
  assert.equal(String(discovery.stopReason).startsWith("provider_paused:"), true);
  const admitted = rows(await db.execute(sql`
    SELECT id,idempotency_key,cohort_state
      FROM sfp_cohort_runs
     WHERE program_id=${programId}::uuid
     ORDER BY frozen_at DESC,id DESC LIMIT 1
  `))[0];
  assert.equal(admitted?.cohort_state, "frozen");
  assert.match(String(admitted?.idempotency_key), /:admission:1$/);
  const members = rows(await db.execute(sql`
    SELECT business_id FROM sfp_cohort_members WHERE cohort_run_id=${String(admitted.id)}::uuid
  `)).map((row) => Number(row.business_id));
  assert.ok(members.includes(roofingId) && members.includes(lateId) && members.includes(geographyPendingId),
    "admission reuses canonical businesses with current target and resolved-geography evidence");

  const secondDiscovery = await processSfpContinuousDiscoveryTick();
  assert.equal(secondDiscovery.newlyFrozenCount, 0, "replay/drained inventory does not create a duplicate cohort");
  const after = rows(await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM provider_operations) AS provider_operations,
      (SELECT COUNT(*)::int FROM sfp_stage_runs) AS stage_runs,
      (SELECT COUNT(*)::int FROM contacts WHERE business_id=ANY(ARRAY[${sql.join(
        [roofingId, supplierId, geographyPendingId, lateId].map((id) => sql`${id}`), sql`, `,
      )}]::integer[])) AS contacts,
      (SELECT COUNT(*)::int FROM sequence_enrollments se JOIN contacts c ON c.id=se.contact_id
        WHERE c.business_id=ANY(ARRAY[${sql.join(
          [roofingId, supplierId, geographyPendingId, lateId].map((id) => sql`${id}`), sql`, `,
        )}]::integer[])) AS enrollments
  `))[0];
  assert.equal(Number(after.provider_operations), Number(before.provider_operations));
  assert.equal(Number(after.stage_runs), Number(before.stage_runs));
  assert.equal(Number(after.contacts), Number(before.contacts));
  assert.equal(Number(after.enrollments), Number(before.enrollments));
  assert.equal(getBlockedCertificationNetworkAttemptCount(), 0,
    "provider-deny boundary observed no attempted non-loopback requests");
  console.log("Task 2060 continuity certification passed: auto handoff, post-watermark rearm, geography retry, durable cohort admission, zero provider/outbound writes.");
} finally {
  await pool.end();
}