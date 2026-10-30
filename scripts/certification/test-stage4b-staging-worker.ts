#!/usr/bin/env npx tsx
/**
 * Stage 4B real-worker certification (guarded disposable PostgreSQL only).
 *
 * Drives the actual recurring campaign-staging worker (processSfpCampaignStagingTick) end to end against real
 * governed validation receipts, with provider transports denied and a fake ZeroBounce transport. It proves,
 * on rows the worker itself wrote:
 *   - a backlog larger than one window drains across windows with each recipient staged exactly once;
 *   - a permanent item-local refusal is held across later windows (the recipient is not re-selected);
 *   - a changed relevant fact reopens that recipient exactly once, and it then stages;
 *   - a suppression refusal is a timed hold; after the suppression is really lifted it stages in a later window;
 *   - two concurrent ticks never stage a recipient twice;
 *   - a crashed worker's expired claim is recovered by the next tick without double staging.
 *
 * Nothing here sends, enrolls, dispatches or calls GHL. The fixture is built through the governed paths
 * (canonical preparation, SFP validation); no eligibility status is written directly.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Stage 4B staging worker certification", requireRedis: false });
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const deniedFetch = globalThis.fetch;
const fakeKey = "stage4b-disposable-zero-bounce-key";
process.env.ZEROBOUNCE_API_KEY = fakeKey;
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED = "true";
let zeroBounceCalls = 0;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.origin === "https://api.zerobounce.net" && url.pathname === "/v2/validate") {
    if (url.searchParams.get("api_key") !== fakeKey) throw new Error("STAGE4B_FAKE_ZEROBOUNCE_KEY_MISMATCH");
    zeroBounceCalls++;
    return new Response(JSON.stringify({ status: "valid", sub_status: "" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return deniedFetch(input, init);
}) as typeof fetch;
(dns as any).resolveMx = async () => [{ exchange: "mx.stage4b.invalid", priority: 10 }];

let assertions = 0;
function check(value: unknown, label: string): void {
  assertions++;
  assert.ok(value, `[4BW-${String(assertions).padStart(2, "0")}] ${label}`);
  console.log(`✓ [4BW-${String(assertions).padStart(2, "0")}] ${label}`);
}
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const runKey = `stage4bw-${randomUUID()}`;

const { runDrizzleMigrations } = await import("../../server/db-migrate");
await runDrizzleMigrations();
const { db, pool } = await import("../../server/db");
const { seal } = await import("../../server/services/cro03/candidate-evidence-service");
const { computeLivePackageContentHash } = await import("../../server/services/cro03/sfp-campaign-packages");
const { CLASSIFIER_VERSION, SFP_TARGET_VERTICALS_V2, TAXONOMY_VERSION_V2 } = await import("../../server/services/cro03/sfp-vertical-classifier");
const { GEOGRAPHY_RESOLVER_VERSION, resolveGeographyForBusiness } = await import("../../server/services/cro03/sfp-geography-resolver");
const { ensureProgram } = await import("../../server/services/cro03/south-florida-prospecting");
const { previewSfpValidation, executeSfpValidation } = await import("../../server/services/cro03/sfp-validation");
const { renewSfpRuntimeDeploymentOwner } = await import("../../server/services/cro03/sfp-provider-operations");
const { prepareCanonicalRecipient } = await import("../../server/services/canonical-recipient-preparation");
const { previewContactBusinessSystemLinks, applyContactBusinessSystemLink } = await import("../../server/services/contact-business-system-links");
const { processSfpCampaignStagingTick } = await import("../../server/services/cro03/sfp-campaign-staging-worker");
const actor = { role: "admin" as const, actorId: `system:${runKey}`, email: null };
let ownerHeartbeat: ReturnType<typeof setInterval> | undefined;
let ownerHeartbeatError: unknown;

try {
  const runtimeIdentityHelper = await import("../helpers/sfp-runtime-test-identity");
  const currentTestRuntime = await runtimeIdentityHelper.getSfpRuntimeTestIdentity();
  const releaseSelection = await runtimeIdentityHelper.selectSfpRuntimeTestRelease(runKey);
  check(releaseSelection.currentReleaseSelected && releaseSelection.ownerLive && releaseSelection.ready,
    "the test release is selected through the audited helper with its live runtime owner");
  let heartbeatPending = false;
  ownerHeartbeat = setInterval(async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try { await renewSfpRuntimeDeploymentOwner(); } catch (error) { ownerHeartbeatError = error; } finally { heartbeatPending = false; }
  }, 5000);
  const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } = await import("../../server/services/mi09-pilot-authority");
  await authorizePaidBudget({ authorizedBy: runKey, typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION });
  const { updateSfpPaidProviderControl } = await import("../../server/services/paid-provider-control");
  await updateSfpPaidProviderControl({ provider: "zerobounce", enabled: true, reason: "Stage 4B disposable fake-provider validation", actorId: runKey });

  // ── program, package, cohort ──
  const targetVerticalSql = sql.join(SFP_TARGET_VERTICALS_V2.map((v) => sql`${v}`), sql`, `);
  const ensured = await ensureProgram({ createdBy: runKey, maxCohortSize: 25 });
  const program = rows(await db.execute(sql`
    UPDATE sfp_programs SET county_fips=ARRAY['12086']::text[], vertical_ids=ARRAY[${targetVerticalSql}]::text[],
           max_cohort_size=25, is_active=TRUE, taxonomy_version=${TAXONOMY_VERSION_V2}
     WHERE id=${String(ensured.id)}::uuid RETURNING id`))[0];
  const programId = String(program.id);
  const cohortRunId = randomUUID();
  await db.execute(sql`
    INSERT INTO sfp_cohort_runs (id, program_id, idempotency_key, status, cohort_size, cohort_hash, release_sha, actor_id, cohort_state, frozen_at)
    VALUES (${cohortRunId}::uuid, ${programId}::uuid, ${`${runKey}-cohort`}, 'freezing', 25,
      ${createHash("sha256").update(runKey).digest("hex")}, ${String(currentTestRuntime.artifactSha)}, ${runKey}, 'freezing', NULL)`);

  async function seedPackage(vertical: string, family: string) {
    const campaign = rows(await db.execute(sql`INSERT INTO campaigns (name, status, target_verticals, created_by, total_steps)
      VALUES (${`${runKey}-${family}-campaign`}, 'draft', ARRAY[${vertical}], ${runKey}, 1) RETURNING id`))[0];
    const sequence = rows(await db.execute(sql`INSERT INTO follow_up_sequences
      (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers, trigger_config)
      VALUES (${`${runKey}-${family}-sequence`}, 'paused', 'manual', 1, ${`${runKey}-${family}`},
              ARRAY['email','task'], ARRAY['first_party_role_inbox'],
              ${JSON.stringify({ canonicalProgramId: programId, canonicalVerticals: [vertical] })}::jsonb) RETURNING id`))[0];
    const hash = await computeLivePackageContentHash(db, Number(campaign.id), Number(sequence.id));
    const key = `sfp.${family}.v2`;
    await db.execute(sql`UPDATE sfp_campaign_package_versions SET lifecycle_state='superseded', superseded_at=NOW(), updated_at=NOW()
      WHERE package_key=${key} AND lifecycle_state='current'`);
    await db.execute(sql`INSERT INTO sfp_campaign_package_versions
      (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name, sequence_family, content_hash, lifecycle_state, effective_at, actor_id)
      VALUES (${key}, ${vertical}, ${Number(campaign.id)}, ${`${runKey}-${family}-campaign`}, ${Number(sequence.id)},
              ${`${runKey}-${family}-sequence`}, ${`${runKey}-${family}`}, ${hash}, 'current', NOW(), ${runKey})`);
    return { campaignId: Number(campaign.id), sequenceId: Number(sequence.id) };
  }
  const healthcare = await seedPackage("Healthcare", "healthcare");
  const automotive = await seedPackage("Automotive", "automotive");

  const generation = rows(await db.execute(sql`INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${runKey}-generation`}, ${runKey}, 'email_discovery', 'Stage 4B worker certification', 'completed') RETURNING id`))[0];
  const classificationPolicyVersion = Number(rows(await db.execute(sql`SELECT policy_version FROM sfp_programs WHERE id=${programId}::uuid`))[0]?.policy_version);

  async function seedFrozenClassification(businessId: number, targetVertical: string, targetCohort = cohortRunId) {
    await db.execute(sql`INSERT INTO business_locations (business_id,street_address,city,state,postal_code,county_fips,is_primary,created_at,updated_at)
      VALUES (${businessId},'100 Test Avenue','Miami','FL','33130','12086',TRUE,NOW(),NOW())`);
    const geography = await resolveGeographyForBusiness(businessId, db);
    assert.equal(geography.resolverVersion, GEOGRAPHY_RESOLVER_VERSION);
    assert.equal(geography.eligible, true);
    const geographySource = geography.evidenceClass === "verified" ? "fips" : geography.evidenceClass === "zip_inferred" ? "zip" : geography.evidenceClass === "city_inferred" ? "city" : "none";
    const evidenceHash = createHash("sha256").update(JSON.stringify({ businessId, targetVertical, runKey })).digest("hex");
    const evidence = rows(await db.execute(sql`INSERT INTO sfp_classification_evidence
      (business_id, evidence_hash, source_refs, classifier_version, taxonomy_version, policy_version, outcome, confidence, reason_codes,
       idempotency_key, cost_micros, terminal_state, resolved_vertical_id, admission_tier)
      VALUES (${businessId}, ${evidenceHash}, ${JSON.stringify([{ source: "stage4b-worker-certification" }])}::jsonb, ${CLASSIFIER_VERSION},
        ${TAXONOMY_VERSION_V2}, ${classificationPolicyVersion}, 'target', 0.95, '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb,
        ${`${runKey}-classification-${businessId}`}, 0, 'completed', ${targetVertical}, 'resolved_high') RETURNING id`))[0];
    await db.execute(sql`INSERT INTO sfp_cohort_members
      (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical, classifier_version, classifier_outcome,
       classifier_confidence, classifier_matched_target, classifier_reasons, classifier_evidence_hash, geography_resolver_version, geography_outcome,
       geography_location_id, geography_reasons)
      VALUES (${targetCohort}::uuid, ${businessId}, 50, ${String(geography.evidenceClass)}, ${geographySource}, ${geography.countyFips}, ${targetVertical},
        ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, ${targetVertical}, '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash},
        ${geography.resolverVersion}, ${geography.outcome}, ${geography.winningLocationId}, ${JSON.stringify(geography.reasons)}::jsonb)`);
    await db.execute(sql`INSERT INTO sfp_cohort_decisions
      (cohort_run_id, business_id, disposition, geography_class, geography_source, vertical, roi_score, selected, classifier_version, classifier_outcome,
       classifier_confidence, classifier_matched_target, classifier_reasons, classifier_evidence_hash, classification_evidence_id,
       classification_policy_version, classification_evidence_hash, classification_classifier_version, geography_resolver_version, geography_outcome,
       geography_location_id, geography_reasons)
      VALUES (${targetCohort}::uuid, ${businessId}, 'selected', ${String(geography.evidenceClass)}, ${geographySource}, ${targetVertical}, 50, TRUE,
        ${CLASSIFIER_VERSION}, 'resolved_high', 0.95, ${targetVertical}, '["CERTIFICATION_FROZEN_V2_TARGET"]'::jsonb, ${evidenceHash},
        ${String(evidence.id)}::uuid, ${classificationPolicyVersion}, ${evidenceHash}, ${CLASSIFIER_VERSION}, ${geography.resolverVersion},
        ${geography.outcome}, ${geography.winningLocationId}, ${JSON.stringify(geography.reasons)}::jsonb)`);
  }

  interface Recipient { businessId: number; contactId: number; email: string; candidateId: string; vertical: string; eligibilityId: string }
  const recipients: Recipient[] = [];
  /** A business with a free-source address, a linked canonical contact and a governed preparation. */
  async function seedRecipient(tag: string, vertical: string, sequenceId: number): Promise<Recipient> {
    const label = randomUUID().replaceAll("-", "");
    const place = `${runKey}_${label}_place`;
    const business = (await pool.query(`INSERT INTO businesses (canonical_name,normalized_name,record_class,google_place_id,vertical,city,state,postal_code)
      VALUES($1,$2,'canonical',$3,$4,'Miami','FL','33130') RETURNING *`, [`${runKey} ${tag}`, `${runKey}${tag}${label}`.toLowerCase(), place, vertical])).rows[0];
    await pool.query(`INSERT INTO canonical_source_links (business_id,source_system,source_type,stable_key) VALUES($1,'google_maps','place',$2)`, [business.id, place]);
    const businessId = Number(business.id);
    await seedFrozenClassification(businessId, vertical);
    const email = `info@${tag}-${label.slice(0, 12)}.example.org`;
    const contact = (await pool.query(`INSERT INTO contacts (first_name,last_name,email,phone,company_name,record_class,email_status)
      VALUES('Front','Desk',$1,'',$2,'production','unvalidated') RETURNING id`, [email, `${business.canonical_name} LLC`])).rows[0];
    await pool.query(`INSERT INTO contact_source_events (contact_id,event_key,source_category,source_type,source_external_id,actor_type,actor_id,metadata)
      VALUES($1,$2,'import','google_maps_outscraper',$2,'system',$3,$4::jsonb)`,
      [contact.id, `${runKey}_${label}_event`, actor.actorId, JSON.stringify({ place_id: place })]);
    const preview = await previewContactBusinessSystemLinks({ afterContactId: Number(contact.id) - 1, limit: 1 });
    const linked = await applyContactBusinessSystemLink({ contactId: Number(contact.id), businessId, sourceLinkId: preview.rows[0].sourceLinkId!,
      sourceEntityId: preview.rows[0].sourceEntityId, snapshotHash: preview.rows[0].snapshotHash });
    assert.equal(linked.status, "applied");
    const prepared = await prepareCanonicalRecipient({ contactId: Number(contact.id), sequenceId, programId, actor, source: runKey });
    assert.ok(prepared.enrollmentId != null, `preparation owns a paused membership for ${tag} (${(prepared as any).reasonCode ?? ""})`);
    const sealed = seal("email", email);
    const candidate = rows(await db.execute(sql`INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source, attribution_scope, disposition, confidence, envelope_ciphertext, envelope_nonce,
       envelope_tag, envelope_key_version, normalized_value_hash, masked_value, created_at)
      VALUES (${String(generation.id)}::uuid, ${businessId}, 'email', 'business', ${`${tag}-${label.slice(0, 12)}.example.org`}, 'certification', 'role',
        'staged', 90, ${sealed.ciphertext}, ${sealed.nonce}, ${sealed.tag}, 1,
        ${createHash("sha256").update(`email\0${email.toLowerCase()}`).digest("hex")}, ${sealed.maskedValue}, NOW()) RETURNING id`))[0];
    return { businessId, contactId: Number(contact.id), email, candidateId: String(candidate.id), vertical, eligibilityId: "" };
  }

  const healthNames = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"];
  const health: Recipient[] = [];
  for (const n of healthNames) health.push(await seedRecipient(n, "Healthcare", healthcare.sequenceId));
  const auto: Recipient[] = [];
  for (const n of ["a1", "a2"]) auto.push(await seedRecipient(n, "Automotive", automotive.sequenceId));
  const suppressed = await seedRecipient("s1", "Healthcare", healthcare.sequenceId);
  recipients.push(...health, ...auto, suppressed);
  check(recipients.length === 11, "eleven recipients were prepared through the governed preparation writer");

  await db.execute(sql`UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid`);
  const preview = await previewSfpValidation(cohortRunId);
  check(preview.gateOpen && preview.addressesForValidation > 0, `validation preview is open (${preview.gateBlockedReason ?? "ok"}, ${preview.addressesForValidation} addresses)`);
  const result = await executeSfpValidation(cohortRunId, { idempotencyKey: `${runKey}-validation`, actorId: runKey, maxValidations: 25, snapshotHash: preview.snapshotHash });
  const eligible = rows(await db.execute(sql`SELECT e.id, e.business_id, e.status, e.validation_operation_id, e.reused_from_operation_id
    FROM sfp_outreach_eligibility e WHERE e.cohort_run_id=${cohortRunId}::uuid ORDER BY e.business_id`));
  console.log(`  (validation: providerRequests=${result.providerRequests} statuses=${JSON.stringify(eligible.map((r: any) => r.status))} zb=${zeroBounceCalls})`);
  const byBusiness = new Map(eligible.map((r: any) => [Number(r.business_id), r]));
  for (const r of recipients) {
    const e: any = byBusiness.get(r.businessId);
    check(e?.status === "validated_outreach_eligible" && Boolean(e.validation_operation_id || e.reused_from_operation_id),
      `recipient ${r.email} holds a governed, receipt-backed eligibility (${e?.status ?? "none"})`);
    r.eligibilityId = String(e.id);
  }

  // ── post-validation fact changes made through ordinary state, then real worker windows ──
  const crashRecipient = health[0];
  const healthEligible = health.slice(0, 8);
  // A persisted claim left behind by a crashed worker for crashRecipient (state only; recovery below is real code).
  const crashRun = rows(await db.execute(sql`INSERT INTO sfp_stage_runs
    (cohort_run_id, stage, idempotency_key, actor_id, state, max_items, provider_keys, estimated_cost_micros, claim_token, lease_expires_at)
    VALUES (${cohortRunId}::uuid, 'campaign_staging', ${`campaign-staging:crashed:${runKey}`}, 'system:sfp-campaign-staging', 'running', 3, '[]'::jsonb, 0,
            gen_random_uuid(), NOW() - INTERVAL '2 hours') RETURNING id`))[0];
  await db.execute(sql`INSERT INTO sfp_stage_items (stage_run_id, business_id, provider, state, claim_token, attempt_count, lease_expires_at)
    VALUES (${String(crashRun.id)}::uuid, ${crashRecipient.businessId}, 'campaign_staging', 'claimed', gen_random_uuid(), 1, NOW() - INTERVAL '2 hours')`);
  // The Automotive package is retired after validation: a permanent item-local refusal for exactly those recipients.
  await db.execute(sql`UPDATE sfp_campaign_package_versions SET lifecycle_state='superseded', superseded_at=NOW(), updated_at=NOW()
    WHERE package_key='sfp.automotive.v2' AND lifecycle_state='current'`);
  // The suppressed recipient's mailbox opts out after validation.
  await db.execute(sql`UPDATE contacts SET opted_out_email=TRUE, opt_out_status='opted_out' WHERE id=${suppressed.contactId}`);

  await db.execute(sql`UPDATE sfp_programs SET recurring_enabled=TRUE,
    schedule_config=jsonb_set(COALESCE(schedule_config,'{}'::jsonb),'{campaignStaging}','3') WHERE id=${programId}::uuid`);
  process.env.BACKGROUND_JOB_PROFILE = "selective:sfp-campaign-staging";
  const topology = await runtimeIdentityHelper.selectSfpRuntimeTestRelease(runKey);
  check(topology.currentReleaseSelected && topology.ownerLive && topology.ready, "the worker topology is bound to the selected test release");
  ownerHeartbeatError = undefined;

  const intentOf = async (r: Recipient) => rows(await db.execute(sql`SELECT id, state FROM sfp_campaign_staging_intents WHERE eligibility_id=${r.eligibilityId}::uuid`));
  const itemsOf = async (r: Recipient) => rows(await db.execute(sql`SELECT i.id, i.state, i.outcome_code, i.attempt_count, i.stage_run_id, i.redacted_result->'hold' AS hold
    FROM sfp_stage_items i WHERE i.provider='campaign_staging' AND i.business_id=${r.businessId} ORDER BY i.created_at, i.id`));
  let windowNo = 0;
  async function openWindow() {
    windowNo++;
    // A later 15-minute window: earlier runs keep their ledger rows but release their bucket key.
    await db.execute(sql`UPDATE sfp_stage_runs SET idempotency_key=idempotency_key||${`:w${windowNo}`}
      WHERE stage='campaign_staging' AND idempotency_key LIKE 'campaign-staging:%' AND idempotency_key NOT LIKE '%:crashed:%' AND idempotency_key !~ ':w[0-9]+$'
        AND state NOT IN ('pending','running')`);
  }
  const intentCount = async () => Number(rows(await db.execute(sql`SELECT count(*)::int AS n FROM sfp_campaign_staging_intents WHERE cohort_run_id=${cohortRunId}::uuid`))[0].n);

  // Window 1: also recovers the crashed worker's expired claim.
  const w1 = await processSfpCampaignStagingTick();
  console.log(`  (window 1: ${JSON.stringify({ enabled: w1.enabled, processed: w1.processed, succeeded: w1.succeeded, failed: w1.failed, runsRun: (w1 as any).runsRun, stop: w1.stopReason })})`);
  check(w1.enabled === true && w1.processed > 0, "window 1 processed recipients through the real worker");
  const crashIntent = await intentOf(crashRecipient);
  const crashItems = await itemsOf(crashRecipient);
  console.log(`  (crash recipient: intents=${JSON.stringify(crashIntent)} items=${JSON.stringify(crashItems)})`);
  check(crashIntent.length === 1 && crashIntent[0].state === "ready_held",
    "the crashed worker's expired claim was recovered: its recipient is staged exactly once");
  const crashRunState = rows(await db.execute(sql`SELECT state, lease_expires_at FROM sfp_stage_runs WHERE id=${String(crashRun.id)}::uuid`))[0];
  check(crashItems.filter((i: any) => i.state === "completed").length === 1,
    "the recipient has exactly one completed ledger row: recovery did not stage it a second time");
  const orphaned = crashItems.filter((i: any) => i.state === "claimed");
  console.log(`  (observation: crashed run now '${crashRunState.state}'; ${orphaned.length} expired 'claimed' ledger row(s) remain for the recipient staged by the next bucket's run - cosmetic, excluded from selection by its expired lease)`);
  check(crashRunState.state === "completed", "the crashed run was reclaimed and finished, not left as a stale expired-lease running run");

  // Window 2: two concurrent ticks.
  await openWindow();
  const before2 = await intentCount();
  const settled = await Promise.allSettled([processSfpCampaignStagingTick(), processSfpCampaignStagingTick()]);
  console.log(`  (window 2 concurrent: ${JSON.stringify(settled.map((t: any) => t.status === "fulfilled"
    ? { p: t.value.processed, s: t.value.succeeded, f: t.value.failed, runs: t.value.runsRun, stop: t.value.stopReason }
    : { rejected: String(t.reason?.message ?? t.reason) }))})`);
  check(settled.some((t) => t.status === "fulfilled") &&
    settled.every((t: any) => t.status === "fulfilled" || /SFP_CAMPAIGN_STAGING_RUN_ALREADY_CLAIMED/.test(String(t.reason?.message))),
    "of two concurrent ticks, at least one completes and the other either completes or is refused with the typed claim conflict");
  const intentsAfter2 = rows(await db.execute(sql`SELECT eligibility_id, count(*)::int AS n FROM sfp_campaign_staging_intents WHERE cohort_run_id=${cohortRunId}::uuid GROUP BY eligibility_id`));
  check(intentsAfter2.every((r: any) => Number(r.n) === 1), "two concurrent ticks never staged a recipient twice");
  const completedPerBusiness = rows(await db.execute(sql`SELECT business_id, count(*)::int AS n FROM sfp_stage_items
    WHERE provider='campaign_staging' AND state='completed' GROUP BY business_id`));
  check(completedPerBusiness.every((r: any) => Number(r.n) === 1), "no recipient has more than one completed staging ledger row");
  check(rows(await db.execute(sql`SELECT 1 FROM sfp_stage_items WHERE provider='campaign_staging' AND state='completed' GROUP BY business_id HAVING count(*)>1`)).length === 0, "no business was completed twice across all windows so far");
  check(await intentCount() > before2, "the concurrent window made progress on the backlog");

  // Drain the remaining windows.
  let drained = 0;
  for (let i = 0; i < 6; i++) {
    await openWindow();
    const t: any = await processSfpCampaignStagingTick();
    drained += Number(t.processed);
    if (Number(t.processed) === 0) break;
  }
  const healthStaged = [];
  for (const r of healthEligible) healthStaged.push((await intentOf(r)).length === 1);
  check(healthStaged.every(Boolean) && windowNo >= 3, `a backlog larger than one window (8 recipients, 3 per window) drained across ${windowNo + 1} windows, each staged once`);

  // Permanent hold: Automotive recipients are held, and later windows do not reselect them.
  const autoItems1 = await Promise.all(auto.map(itemsOf));
  check(autoItems1.every((items) => items.length === 1 && items[0].state === "dead_letter" && items[0].hold?.class === "permanent"),
    "a permanent item-local refusal is recorded as a revision-bound hold on the ledger row");
  check((await Promise.all(auto.map(intentOf))).every((i) => i.length === 0), "held recipients have no staging intent");
  for (let i = 0; i < 3; i++) { await openWindow(); await processSfpCampaignStagingTick(); }
  const autoItems2 = await Promise.all(auto.map(itemsOf));
  check(autoItems2.every((items) => items.length === 1), "three later windows did not re-select a permanently held recipient (no new ledger rows)");

  // Changed relevant fact: a new current Automotive package reopens them exactly once, and they stage.
  await seedPackage("Automotive", "automotive");
  await openWindow();
  const reopenTick: any = await processSfpCampaignStagingTick();
  console.log(`  (reopen window tick: ${JSON.stringify({ p: reopenTick.processed, s: reopenTick.succeeded, f: reopenTick.failed, runs: reopenTick.runsRun, stop: reopenTick.stopReason })})`);
  const autoItems3 = await Promise.all(auto.map(itemsOf));
  const autoIntents3 = await Promise.all(auto.map(intentOf));
  check(autoIntents3.every((i) => i.length === 1 && i[0].state === "ready_held"), "a changed package fact reopened the held recipients and they staged");
  check(autoItems3.every((items) => items.length === 2 && items[0].state === "dead_letter" && items[1].state === "completed"),
    "reconsideration happened exactly once: one earlier refusal row and one completed row per recipient");

  // Timed suppression hold.
  const sItems1 = await itemsOf(suppressed);
  console.log(`  (suppressed items: ${JSON.stringify(sItems1.map((x: any) => ({ s: x.state, c: x.outcome_code, h: x.hold?.class })))})`);
  check(sItems1.length === 1 && sItems1[0].state === "dead_letter" && /^SFP_STAGING_(ADDRESS_)?SUPPRESSED$/.test(String(sItems1[0].outcome_code)) && sItems1[0].hold?.class === "timed",
    "a real staging suppression refusal is recorded as a timed hold");
  for (let i = 0; i < 2; i++) { await openWindow(); await processSfpCampaignStagingTick(); }
  check((await itemsOf(suppressed)).length === 1, "while the timed hold is fresh, later windows do not re-select the suppressed recipient");
  // The suppression is really lifted. Within the recheck window nothing changes; after it, the next window stages.
  await db.execute(sql`UPDATE contacts SET opted_out_email=FALSE, opt_out_status=NULL WHERE id=${suppressed.contactId}`);
  await openWindow(); await processSfpCampaignStagingTick();
  check((await itemsOf(suppressed)).length === 1 && (await intentOf(suppressed)).length === 0,
    "inside the recheck window, a lifted suppression does not yet reopen the recipient (bounded, not permanent)");
  await db.execute(sql`UPDATE sfp_stage_items SET updated_at=NOW()-INTERVAL '13 hours' WHERE provider='campaign_staging' AND business_id=${suppressed.businessId}
    AND redacted_result->'hold'->>'class'='timed'`);
  await openWindow(); await processSfpCampaignStagingTick();
  const sIntent = await intentOf(suppressed);
  check(sIntent.length === 1 && sIntent[0].state === "ready_held",
    "after the recheck window, a lifted suppression is re-evaluated by the real worker and the recipient stages");

  // Nothing here sent, enrolled or dispatched.
  const sends = rows(await db.execute(sql`SELECT (SELECT count(*) FROM outbound_send_log WHERE created_at > NOW() - INTERVAL '1 day')::int AS sends`))[0];
  check(Number(sends.sends) === 0, "no outbound send was recorded by any worker window");
  check(zeroBounceCalls === 11, "provider traffic was limited to the fake validation transport");
  console.log(`\nStage 4B staging worker: ${assertions} assertions passed`);
} finally {
  if (ownerHeartbeat) clearInterval(ownerHeartbeat);
  await pool.end();
}
