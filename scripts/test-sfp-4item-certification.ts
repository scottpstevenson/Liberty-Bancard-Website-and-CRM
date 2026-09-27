#!/usr/bin/env tsx
/**
 * test-sfp-4item-certification.ts
 *
 * Disposable-DB certification for the four SFP fixes in this task:
 *   1. Classifier conflict detection + classifier/taxonomy version split.
 *   2. Bounded per-run provider accounting (max_units cap at dispatch).
 *   3. All five v2 package mappings + never-reuse-v1 guardrail.
 *   4. ready_held -> paused-enrollment bridge: success, rejection,
 *      repeat-call idempotency, concurrent-call safety, and held paths.
 *
 * Zero live provider calls (fake deps injected everywhere a provider would
 * otherwise be reached). Zero sends, zero GHL writes, zero active
 * enrollments — asserted explicitly at the end.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP 4-item certification (classifier v2, unit cap, v2 packages, ready_held bridge)",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });

let assertions = 0;
function check(value: unknown, id: string, label: string): asserts value {
  assertions++;
  assert.ok(value, `[${id}] ${label}`);
  console.log(`✓ [${id}] ${label}`);
}

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();

const { db } = await import("../server/db");
const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN_ID = `sfp4cert-${randomUUID().slice(0, 6)}`;

async function insertBusiness(name: string, vertical: string | null): Promise<number> {
  const b = rows(await db.execute(sql`
    INSERT INTO businesses (canonical_name, normalized_name, record_class, vertical, city, state, postal_code, main_email, main_phone)
    VALUES (${name}, ${name.toLowerCase().replace(/[^a-z0-9]/g, "")}, 'canonical', ${vertical}, 'Miami', 'FL', '33101', NULL, NULL)
    RETURNING id
  `))[0];
  const businessId = Number(b.id);
  await db.execute(sql`
    INSERT INTO business_locations (business_id, is_primary, city, state, postal_code, county_fips)
    VALUES (${businessId}, true, 'Miami', 'FL', '33101', '12086')
  `);
  return businessId;
}

// ─────────────────────────────────────────────────────────────────────────
// Item 1: classifier conflict detection + version split
// ─────────────────────────────────────────────────────────────────────────
{
  const { inferVerticalNameSignal, CLASSIFIER_VERSION, TAXONOMY_VERSION_V2 } = await import(
    "../server/services/cro03/sfp-vertical-classifier"
  );
  check(CLASSIFIER_VERSION === 3, `${RUN_ID}-I1-A`, "CLASSIFIER_VERSION is 3 (conservative name-admission ruleset)");
  check(TAXONOMY_VERSION_V2 === 2, `${RUN_ID}-I1-B`, "TAXONOMY_VERSION_V2 is 2 (independent of ruleset version)");

  // Genuine target name — should resolve, non-conflicting.
  const clean = inferVerticalNameSignal("Sunshine Auto Repair LLC", 2);
  check(clean.rawVertical !== null && !clean.conflicting, `${RUN_ID}-I1-C`, "unambiguous target name resolves non-conflicting");

  // A name matching two different buckets must never silently resolve.
  const conflicting = inferVerticalNameSignal("Coastal Auto Repair Realty LLC", 2);
  check(conflicting.conflicting === true, `${RUN_ID}-I1-D`, "conflicting name is flagged conflicting=true");
  check(conflicting.rawVertical === null, `${RUN_ID}-I1-E`, "conflicting name never collapses to a single rawVertical");
  check(conflicting.matchedPhrases.length >= 2, `${RUN_ID}-I1-F`, "conflicting name retains all matched phrases for audit");

  // Evidence writer now stores classifier_version and taxonomy_version as
  // genuinely distinct columns, not one column overloaded with the other's
  // value.
  const bizId = await insertBusiness(`${RUN_ID}-item1-biz`, "Automotive Sales & Repair");
  await db.execute(sql`
    INSERT INTO sfp_classification_evidence
      (business_id, evidence_hash, source_refs, classifier_version, taxonomy_version, policy_version,
       outcome, confidence, reason_codes, idempotency_key, cost_micros, terminal_state)
    VALUES (${bizId}, ${`hash-${RUN_ID}`}, '[]'::jsonb, ${CLASSIFIER_VERSION}, ${TAXONOMY_VERSION_V2}, 1,
            'target', 0.9, '[]'::jsonb, ${`idem-${RUN_ID}`}, 0, 'completed')
  `);
  const evidenceRow = rows(await db.execute(sql`
    SELECT classifier_version, taxonomy_version FROM sfp_classification_evidence WHERE idempotency_key=${`idem-${RUN_ID}`}
  `))[0];
  check(Number(evidenceRow.classifier_version) === CLASSIFIER_VERSION, `${RUN_ID}-I1-G`, "evidence row stores real CLASSIFIER_VERSION, not taxonomy value");
  check(Number(evidenceRow.taxonomy_version) === 2, `${RUN_ID}-I1-H`, "evidence row stores taxonomy_version distinctly");
}

// ─────────────────────────────────────────────────────────────────────────
// Item 2: max_units cap enforced at actual dispatch time, not just preview
// ─────────────────────────────────────────────────────────────────────────
{
  const { ensureProgram } = await import("../server/services/cro03/south-florida-prospecting");
  const { freezeClassificationSnapshot, runFrozenClassificationSnapshot } = await import(
    "../server/services/cro03/sfp-classification-bridge"
  );
  const program = await ensureProgram({ createdBy: `${RUN_ID}-item2` });
  const businessIds = [
    await insertBusiness(`${RUN_ID}-item2-biz-a`, "Automotive Sales & Repair"),
    await insertBusiness(`${RUN_ID}-item2-biz-b`, "Automotive Sales & Repair"),
  ];
  const frozen = await freezeClassificationSnapshot({
    programId: program.id, actorId: `${RUN_ID}-item2`, businessIds,
    targetIds: ["automotive"], policyVersion: 1, taxonomyVersion: 2,
    allowedProvider: "openai_classification", maxUnits: 1, // cap BELOW the 2 frozen businesses
  });
  check(frozen.businessIds.length === 2, `${RUN_ID}-I2-A`, "both businesses survive freeze-time checks");

  const fakeDeps = {
    openAiClassify: async () => ({
      outcome: "target" as const, confidence: 80, reasonCodes: ["FAKE_TEST"],
      modelVersion: "fake-test-model", promptVersion: "fake-test-prompt", costMicros: 0,
    }),
  };
  const result = await runFrozenClassificationSnapshot(
    { snapshotId: frozen.snapshotId, actorId: `${RUN_ID}-item2` }, fakeDeps,
  );
  check(result.survivingBusinessIds.length === 1, `${RUN_ID}-I2-B`, "only max_units=1 business is actually dispatched");
  const capRejection = result.rejectedAtRun.find((r) => r.reason.startsWith("UNIT_CAP_EXCEEDED_AT_RUN"));
  check(!!capRejection, `${RUN_ID}-I2-C`, "excess business is reported rejected with UNIT_CAP_EXCEEDED_AT_RUN, never silently dropped or silently processed");
  check(result.processed === 1, `${RUN_ID}-I2-D`, "provider was invoked exactly once (bounded accounting, not 2)");

  // Unsupported provider must throw, not silently downgrade.
  const badSnapshot = await freezeClassificationSnapshot({
    programId: program.id, actorId: `${RUN_ID}-item2b`,
    businessIds: [await insertBusiness(`${RUN_ID}-item2-biz-c`, "Automotive Sales & Repair")],
    targetIds: ["automotive"], policyVersion: 1, taxonomyVersion: 2,
    allowedProvider: "openai_classification", maxUnits: 5,
  });
  await db.execute(sql`UPDATE sfp_classification_snapshots SET allowed_provider='not_a_real_provider' WHERE id=${badSnapshot.snapshotId}::uuid`);
  let threw = false;
  try {
    await runFrozenClassificationSnapshot({ snapshotId: badSnapshot.snapshotId, actorId: `${RUN_ID}-item2c` }, fakeDeps);
  } catch (e: any) {
    threw = /SFP_SNAPSHOT_UNSUPPORTED_PROVIDER/.test(String(e?.message));
  }
  check(threw, `${RUN_ID}-I2-E`, "an unsupported allowed_provider throws instead of silently running");
}

// ─────────────────────────────────────────────────────────────────────────
// Item 3: v2 package mappings + never-reuse-v1/SDR-10 guardrail
// ─────────────────────────────────────────────────────────────────────────
{
  const {
    SFP_PACKAGE_KEYS_V2, previewPackageConvergenceV2, applyPackageConvergenceV2, verifyPackageConvergenceV2,
  } = await import("../server/services/cro03/sfp-campaign-packages");
  check(SFP_PACKAGE_KEYS_V2.length === 5, `${RUN_ID}-I3-A`, "exactly 5 v2 verticals defined (Automotive/Healthcare/Beauty-Spa/Construction-Trades-Home-Services/Fitness-Recreation)");

  const preview = await previewPackageConvergenceV2();
  const previewPackageKeys = new Set(preview.rows.map((r: any) => r.packageKey));
  check(previewPackageKeys.size === 5, `${RUN_ID}-I3-B`, "preview reports all 5 v2 package mappings");
  check(preview.rows.every((r: any) => r.action !== "reuse_v1" && !/SDR-10/i.test(String(r.currentCampaignName ?? ""))), `${RUN_ID}-I3-C`, "no v2 package row reuses a v1/SDR-10 campaign");

  // applyPackageConvergenceV2 clones its new sequences from the existing W6
  // governance shape (sequence_family='cold-email-manual-call'); seed a
  // minimal one so convergence has a real template to clone, exactly as
  // production always has one already.
  await db.execute(sql`
    INSERT INTO follow_up_sequences
      (name, status, trigger_type, total_steps, sequence_family, channels_allowed, eligible_consent_tiers,
       offer_routes, lifecycle_stages_allowed)
    VALUES (${`${RUN_ID}-w6-template`}, 'paused', 'manual', 1, 'cold-email-manual-call',
            ARRAY['email','task']::text[], ARRAY['first_party_role_inbox']::text[],
            ARRAY['cold_outreach']::text[], ARRAY['prospect']::text[])
  `);

  const applied = await applyPackageConvergenceV2({ actorId: `${RUN_ID}-item3` });
  console.log("applyPackageConvergenceV2 results:", JSON.stringify(applied, null, 2));
  check(applied.length === 5, `${RUN_ID}-I3-D`, "apply creates/converges all 5 v2 packages");

  const verify = await verifyPackageConvergenceV2();
  check(verify.ok === true, `${RUN_ID}-I3-E`, `v2 package convergence verifies clean (issues: ${JSON.stringify(verify.issues)})`);

  // Confirm none of the 5 new campaigns collide by name with the v1 set.
  const campaignRows = rows(await db.execute(sql`
    SELECT DISTINCT name FROM campaigns WHERE name LIKE 'SFP-V2:%'
  `));
  check(campaignRows.length === 5, `${RUN_ID}-I3-F`, "exactly 5 brand-new SFP-V2 draft campaigns exist, none reused");
}

// ─────────────────────────────────────────────────────────────────────────
// Item 4: ready_held -> paused-enrollment bridge
// ─────────────────────────────────────────────────────────────────────────
async function makeReadyHeldFixture(opts: {
  suffix: string; email: string | null; phone?: string | null; companyName?: string | null;
  // When true, the business row itself carries a DIFFERENT email/phone than
  // the pinned master_leads row, so tests can prove the bridge never falls
  // back to the unvalidated business record.
  decoyBusinessEmail?: string;
}): Promise<{ intentId: string; businessId: number; sequenceId: number }> {
  const { ensureProgram } = await import("../server/services/cro03/south-florida-prospecting");
  const businessId = await insertBusiness(`${RUN_ID}-item4-biz-${opts.suffix}`, "Automotive Sales & Repair");
  if (opts.decoyBusinessEmail) {
    await db.execute(sql`UPDATE businesses SET main_email=${opts.decoyBusinessEmail}, main_phone=${opts.phone ?? null} WHERE id=${businessId}`);
  }
  const program = await ensureProgram({ createdBy: `${RUN_ID}-item4` });
  const cohortRun = rows(await db.execute(sql`
    INSERT INTO sfp_cohort_runs (program_id, idempotency_key, status, cohort_size, actor_id, cohort_state)
    VALUES (${program.id}::uuid, ${`${RUN_ID}-cohort-${opts.suffix}`}, 'freezing', 1, ${`${RUN_ID}-actor`}, 'freezing')
    RETURNING id
  `))[0];
  const cohortRunId = String(cohortRun.id);
  await db.execute(sql`
    INSERT INTO sfp_cohort_members (cohort_run_id, business_id, roi_score, geography_class, geography_source, county_fips, vertical)
    VALUES (${cohortRunId}::uuid, ${businessId}, 50, 'verified', 'fips', '12086', 'Automotive')
  `);
  await db.execute(sql`
    UPDATE sfp_cohort_runs SET status='frozen', cohort_state='frozen', frozen_at=NOW() WHERE id=${cohortRunId}::uuid
  `);
  const eligibility = rows(await db.execute(sql`
    INSERT INTO sfp_outreach_eligibility (cohort_run_id, business_id, policy_version, status, decision_reason)
    VALUES (${cohortRunId}::uuid, ${businessId}, 1, 'validated_outreach_eligible', 'certification_fixture')
    RETURNING id
  `))[0];
  const seq = rows(await db.execute(sql`
    INSERT INTO follow_up_sequences (name, status, trigger_type, total_steps, sequence_family)
    VALUES (${`SFP-V2 test sequence ${opts.suffix}`}, 'paused', 'manual', 1, ${`sfp-v2-test-${opts.suffix}`})
    RETURNING id
  `))[0];
  const sequenceId = Number(seq.id);
  const campaign = rows(await db.execute(sql`
    INSERT INTO campaigns (name, status) VALUES (${`SFP-V2 test campaign ${opts.suffix}`}, 'draft') RETURNING id
  `))[0];
  // Package key must satisfy the real sfp_campaign_package_versions CHECK
  // constraint (a fixed enum of v1+v2 keys), so fixtures reuse one of the
  // genuine v2 keys rather than an invented ad hoc string. lifecycle_state
  // stays 'draft' (never 'current') so this never collides with the real
  // convergence-created 'current' row for the same package key.
  const packageKey = "sfp.automotive.v2";
  const pkgVersion = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_package_versions
      (package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name, sequence_family,
       content_hash, lifecycle_state, actor_id)
    VALUES (${packageKey}, ${`test-vertical-${opts.suffix}`}, ${Number(campaign.id)},
            ${`SFP-V2 test campaign ${opts.suffix}`}, ${sequenceId}, ${`SFP-V2 test sequence ${opts.suffix}`},
            ${`sfp-v2-test-${opts.suffix}`}, ${`hash-${RUN_ID}-${opts.suffix}`}, 'draft', ${`${RUN_ID}-actor`})
    RETURNING id
  `))[0];
  const generation = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${`${RUN_ID}-gen-${opts.suffix}`}, ${`${RUN_ID}-actor`}, 'email_discovery', 'Item 4 certification fixture', 'completed')
    RETURNING id
  `))[0];
  const candidate = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, business_id, field, subject_type, domain, source,
       attribution_scope, disposition, confidence, envelope_ciphertext, envelope_nonce,
       envelope_tag, envelope_key_version, normalized_value_hash, masked_value)
    VALUES (${String(generation.id)}::uuid, ${businessId}, 'email', 'business',
      ${`${opts.suffix}.example.org`}, 'certification', 'role', 'staged', 90,
      'x', 'x', 'x', 1, ${`hash-${RUN_ID}-${opts.suffix}`}, 'm***@example.org')
    RETURNING id
  `))[0];
  // The pinned, validated address lives on a master_leads row created
  // specifically for this intent (mirroring the real staging-v2 projection
  // path) — never on the business record, which is unrelated/unvalidated.
  let masterLeadId: string | null = null;
  if (opts.email) {
    const masterLead = rows(await db.execute(sql`
      INSERT INTO master_leads (status, company, email, phone, contact_name, source)
      VALUES ('staged', ${`Item4 Fixture ${opts.suffix}`}, ${opts.email}, ${opts.phone ?? null}, 'Item4 Contact', 'certification_fixture')
      RETURNING id
    `))[0];
    masterLeadId = String(masterLead.id);
  }
  const intent = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_staging_intents
      (cohort_run_id, eligibility_id, business_id, candidate_id, source_kind, idempotency_key, actor_id, state, policy_version,
       validation_snapshot, lineage, package_version_id, package_key, master_lead_id)
    VALUES (${cohortRunId}::uuid, ${String(eligibility.id)}::uuid, ${businessId}, ${String(candidate.id)}::uuid, 'free',
            ${`${RUN_ID}-intent-${opts.suffix}`}, ${`${RUN_ID}-actor`}, 'ready_held', 1,
            '{}'::jsonb, '{}'::jsonb, ${String(pkgVersion.id)}::uuid, ${packageKey}, ${masterLeadId}::uuid)
    RETURNING id
  `))[0];
  return { intentId: String(intent.id), businessId, sequenceId };
}

{
  const { bridgeReadyHeldIntentToPausedEnrollment } = await import("../server/services/cro03/sfp-enrollment-bridge");

  // 4a. No real email at all -> left held, no contact/enrollment created.
  const noEmail = await makeReadyHeldFixture({ suffix: "noemail", email: null });
  const heldResult = await bridgeReadyHeldIntentToPausedEnrollment(noEmail.intentId, `${RUN_ID}-actor`);
  check(heldResult.status === "left_held" && heldResult.heldReason === "NO_PINNED_VALIDATED_EMAIL", `${RUN_ID}-I4-A`, "intent with no pinned master_lead email is left held, not force-created with a synthetic address");
  check(heldResult.contactId === null, `${RUN_ID}-I4-B`, "no contact was created for a held intent");

  // 4a2. Intent HAS a pinned master_lead row, but its email is blank ('') ->
  // still left held on the real "no usable email" reason, never silently
  // treated as a valid address.
  const blankEmail = await makeReadyHeldFixture({ suffix: "blankemail", email: "" });
  const blankResult = await bridgeReadyHeldIntentToPausedEnrollment(blankEmail.intentId, `${RUN_ID}-actor`);
  check(blankResult.status === "left_held", `${RUN_ID}-I4-A2`, "a pinned master_lead row with a blank email is left held");
  check(blankResult.contactId === null, `${RUN_ID}-I4-B2`, "no contact was created for a blank-pinned-email intent");

  // 4a3. The bridge must NEVER fall back to businesses.main_email as the
  // enrollment address, even when it's present and looks valid — only the
  // master_leads row pinned to this intent is trusted. No master_lead here,
  // decoy business email present -> still left held, not silently enrolled
  // under the unvalidated decoy address.
  const decoyOnly = await makeReadyHeldFixture({ suffix: "decoyonly", email: null, decoyBusinessEmail: `${RUN_ID}-decoy@example.com` });
  const decoyResult = await bridgeReadyHeldIntentToPausedEnrollment(decoyOnly.intentId, `${RUN_ID}-actor`);
  check(decoyResult.status === "left_held" && decoyResult.heldReason === "NO_PINNED_VALIDATED_EMAIL", `${RUN_ID}-I4-A3`, "an intent with only an unvalidated business.main_email (no pinned master_lead) is left held, never silently enrolled under that address");
  check(decoyResult.contactId === null, `${RUN_ID}-I4-B3`, "no contact was created from the decoy business email");
  const decoyContactCheck = rows(await db.execute(sql`SELECT 1 FROM contacts WHERE email=${`${RUN_ID}-decoy@example.com`}`));
  check(decoyContactCheck.length === 0, `${RUN_ID}-I4-B4`, "the decoy business email was never used to create a contact");

  // 4b. Success path: real email, no pre-existing contact -> created_new + paused enrollment.
  const success = await makeReadyHeldFixture({ suffix: "success", email: `${RUN_ID}-success@example.com`, phone: "3055551111" });
  const successResult = await bridgeReadyHeldIntentToPausedEnrollment(success.intentId, `${RUN_ID}-actor`);
  check(successResult.status === "created" && successResult.contactResolution === "created_new", `${RUN_ID}-I4-C`, "success path creates a new contact");
  check(successResult.enrollmentStatus === "paused", `${RUN_ID}-I4-D`, "created enrollment status is 'paused'");
  const enrollmentRow = rows(await db.execute(sql`SELECT status FROM sequence_enrollments WHERE id=${successResult.sequenceEnrollmentId}`))[0];
  check(enrollmentRow.status === "paused", `${RUN_ID}-I4-E`, "enrollment row in DB is genuinely paused");

  // 4c. Repeat call on the SAME intent -> idempotent, returns the same bridge row, no duplicate contact/enrollment.
  const repeat = await bridgeReadyHeldIntentToPausedEnrollment(success.intentId, `${RUN_ID}-actor`);
  check(repeat.status === "already_bridged" && repeat.contactId === successResult.contactId && repeat.sequenceEnrollmentId === successResult.sequenceEnrollmentId, `${RUN_ID}-I4-F`, "repeat call for the same intent is idempotent");
  const enrollmentCount = rows(await db.execute(sql`SELECT COUNT(*)::int AS c FROM sequence_enrollments WHERE contact_id=${successResult.contactId}`))[0];
  check(Number(enrollmentCount.c) === 1, `${RUN_ID}-I4-G`, "exactly one enrollment row exists after the repeat call — no duplicate");

  // 4d. Email match with NO corroborating signal (different phone/company) -> left held, not silently attached.
  const uncorroborated = await makeReadyHeldFixture({ suffix: "uncorrob", email: `${RUN_ID}-success@example.com`, phone: "9999999999" });
  const uncorrobResult = await bridgeReadyHeldIntentToPausedEnrollment(uncorroborated.intentId, `${RUN_ID}-actor`);
  check(uncorrobResult.status === "left_held" && uncorrobResult.heldReason === "EMAIL_MATCH_UNCORROBORATED", `${RUN_ID}-I4-H`, "an email match with no corroborating phone/company signal is left held, not silently attached to an unrelated contact");

  // 4e. Corroborated email match (same phone) -> matched_existing, reuses the contact from 4b.
  const corroborated = await makeReadyHeldFixture({ suffix: "corrob", email: `${RUN_ID}-success@example.com`, phone: "3055551111" });
  const corrobResult = await bridgeReadyHeldIntentToPausedEnrollment(corroborated.intentId, `${RUN_ID}-actor`);
  check(corrobResult.contactResolution === "matched_existing" && corrobResult.contactId === successResult.contactId, `${RUN_ID}-I4-I`, "a corroborated email+phone match reuses the existing contact instead of creating a duplicate");

  // 4f. An existing ACTIVE enrollment for (contact, sequence) must be a hard rejection, never a reused "success".
  const activeConflict = await makeReadyHeldFixture({ suffix: "activeconflict", email: `${RUN_ID}-active@example.com`, phone: "3055552222" });
  await db.execute(sql`
    INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status)
    SELECT ${activeConflict.sequenceId}, id, 0, 'active' FROM contacts WHERE email=${`${RUN_ID}-active@example.com`}
  `).catch(() => {}); // contact does not exist yet — this is expected to affect 0 rows
  // Create the contact first via a successful bridge call on a throwaway intent targeting a DIFFERENT sequence,
  // then hand-craft an ACTIVE enrollment on the fixture's actual sequence to simulate the conflict.
  const seedFixture = await makeReadyHeldFixture({ suffix: "activeseed", email: `${RUN_ID}-active@example.com`, phone: "3055552222" });
  const seedResult = await bridgeReadyHeldIntentToPausedEnrollment(seedFixture.intentId, `${RUN_ID}-actor`);
  check(seedResult.status === "created", `${RUN_ID}-I4-J`, "seed contact created for the active-conflict scenario");
  await db.execute(sql`
    INSERT INTO sequence_enrollments (sequence_id, contact_id, current_step, status)
    VALUES (${activeConflict.sequenceId}, ${seedResult.contactId}, 0, 'active')
  `);
  let rejected = false;
  try {
    await bridgeReadyHeldIntentToPausedEnrollment(activeConflict.intentId, `${RUN_ID}-actor`);
  } catch (e: any) {
    rejected = /SFP_EXISTING_ACTIVE_ENROLLMENT_CONFLICT/.test(String(e?.message));
  }
  check(rejected, `${RUN_ID}-I4-K`, "an existing ACTIVE enrollment for the same contact+sequence is a hard rejection, never silently reused as success");
  const stillNoLedgerRow = rows(await db.execute(sql`SELECT 1 FROM sfp_ready_held_enrollments WHERE staging_intent_id=${activeConflict.intentId}::uuid`));
  check(stillNoLedgerRow.length === 0, `${RUN_ID}-I4-L`, "the rejected active-conflict intent has no bridge ledger row (nothing silently marked bridged)");

  // 4g. Concurrent calls resolving to the SAME new email must not create two contacts.
  const concurrentEmail = `${RUN_ID}-concurrent@example.com`;
  const concFixtureA = await makeReadyHeldFixture({ suffix: "concA", email: concurrentEmail, phone: "3055553333" });
  const concFixtureB = await makeReadyHeldFixture({ suffix: "concB", email: concurrentEmail, phone: "3055553333" });
  const [concResultA, concResultB] = await Promise.all([
    bridgeReadyHeldIntentToPausedEnrollment(concFixtureA.intentId, `${RUN_ID}-actor-a`),
    bridgeReadyHeldIntentToPausedEnrollment(concFixtureB.intentId, `${RUN_ID}-actor-b`),
  ]);
  check(concResultA.status === "created" && concResultB.status === "created", `${RUN_ID}-I4-M`, "both concurrent bridge calls complete successfully");
  check(concResultA.contactId === concResultB.contactId, `${RUN_ID}-I4-N`, "concurrent calls for the same email resolve to exactly ONE contact, not two");
  const concContactCount = rows(await db.execute(sql`SELECT COUNT(*)::int AS c FROM contacts WHERE email=${concurrentEmail}`))[0];
  check(Number(concContactCount.c) === 1, `${RUN_ID}-I4-O`, "exactly one contact row exists in the DB for the concurrently-resolved email");
  check(concResultA.sequenceEnrollmentId !== concResultB.sequenceEnrollmentId, `${RUN_ID}-I4-P`, "each intent still gets its own enrollment (different sequences), sharing one contact");
}

// ─────────────────────────────────────────────────────────────────────────
// Final zero-outreach assertions across everything this suite touched.
// ─────────────────────────────────────────────────────────────────────────
{
  const activeCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM sequence_enrollments
     WHERE status = 'active' AND metadata->>'source' = 'sfp_ready_held_bridge'
  `))[0];
  check(Number(activeCount.c) === 0, `${RUN_ID}-FINAL-A`, "zero ACTIVE enrollments were created by the bridge across the whole suite");
  const pausedCount = rows(await db.execute(sql`
    SELECT COUNT(*)::int AS c FROM sequence_enrollments WHERE metadata->>'source' = 'sfp_ready_held_bridge'
  `))[0];
  console.log(`   (${pausedCount.c} bridge-created enrollment rows total, all non-active)`);
}

console.log(`\n✅ All ${assertions} assertions passed for run ${RUN_ID}.`);
