#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary, getBlockedCertificationNetworkAttemptCount } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Task #1999 post-merge audit certification", requireRedis: false });
// The shared disposable launcher enables this flag for the integrated suite.
// This certification's ordinary path remains transport-disabled; it opts in
// only around the isolated fake-dispatch reservation below.
if (process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== undefined &&
    process.env.CRO03_PROVIDER_TRANSPORT_ENABLED !== "true") {
  throw new Error("CRO03_PROVIDER_TRANSPORT_ENABLED has an invalid certification value");
}
delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
const rows = (result: any): any[] => result?.rows ?? result ?? [];
let assertions = 0;
let pgPool: { end: () => Promise<void> } | null = null;
function check(condition: unknown, label: string) {
  assert.ok(condition, label);
  assertions++;
  console.log(`✓ [Task #1999] ${label}`);
}
async function rejects(operation: () => Promise<unknown>, pattern: RegExp, label: string) {
  await assert.rejects(operation, pattern);
  assertions++;
  console.log(`✓ [Task #1999] ${label}`);
}

try {
  const [{ runDrizzleMigrations }, { db, pool }, classifier, gapModule, evidenceModule, providerOps, prospecting, costPreview, bridge, envelope] = await Promise.all([
    import("../server/db-migrate"),
    import("../server/db"),
    import("../server/services/cro03/sfp-vertical-classifier"),
    import("../server/services/cro03/sfp-contact-gap-vector"),
    import("../server/services/cro03/sfp-paid-evidence-writer"),
    import("../server/services/cro03/sfp-provider-operations"),
    import("../server/services/cro03/south-florida-prospecting"),
    import("../server/services/cro03/sfp-cost-preview"),
    import("../server/services/cro03/sfp-classification-bridge"),
    import("../server/services/cro03/candidate-evidence-service"),
  ]);
  pgPool = pool;
  await runDrizzleMigrations();
  const migration = rows(await pool.query(`
    SELECT to_regclass('public.sfp_classification_evidence') AS evidence_table,
           to_regclass('public.sfp_paid_candidate_evidence') AS paid_table,
           to_regclass('public.sfp_stage_items') AS stage_items,
           (SELECT count(*) FROM information_schema.columns WHERE table_name='sfp_stage_runs'
             AND column_name IN ('payload_hash','preview_snapshot_hash')) AS stage_hash_columns,
           (SELECT count(*) FROM information_schema.columns WHERE table_name='sfp_cohort_decisions'
             AND column_name IN ('classification_evidence_id','classification_evidence_hash',
               'classification_model_version','classification_prompt_version','classification_classifier_version')) AS pinned_columns
  `))[0];
  check(migration.evidence_table && migration.paid_table && migration.stage_items &&
    Number(migration.stage_hash_columns) === 2 && Number(migration.pinned_columns) === 5,
  "migration high-water installs evidence, hash, preview, and freeze-pinning columns");

  const checkDef = rows(await pool.query(`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
     WHERE conrelid='sfp_stage_items'::regclass AND conname='sfp_stage_items_candidate_ref_one_of_chk'
  `))[0]?.definition ?? "";
  check(String(checkDef).includes("serper") && String(checkDef).includes("paid_candidate_evidence_id"),
    "stage-item reference constraint preserves scoped paid-evidence linkage for Serper");

  const targets = ["Dental", "Med Spa", "Auto Repair", "Restaurant", "Retail"];
  const gap = await gapModule.computeSfpGapVector({
    businessId: 1, targetVerticalResolved: false, officialDomainKnown: false,
    hasFreeDiscoveryContactCandidate: false, verifiedLinkReuse: { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false },
    subjectSuppressions: [], businessWideSuppressionApplied: false,
  });
  check(gap.before.length === 6 && gap.before.every((entry) => entry.open),
    "gap vector reports all six missing dimensions, including business identity");
  const closed = await gapModule.computeSfpGapVector({
    businessId: 1, geographyResolved: true, targetVerticalResolved: true, officialDomainKnown: true,
    businessIdentityResolved: true, hasFreeDiscoveryContactCandidate: true,
    verifiedLinkReuse: { hasVerifiedContact: true, hasVerifiedNamedDecisionMaker: true },
    subjectSuppressions: [], businessWideSuppressionApplied: false,
  });
  check(closed.after.every((entry) => !entry.open), "gap-vector stop conditions reflect all actual resolved facts");
  const paidNamed = await gapModule.computeSfpGapVector({
    businessId: 1, geographyResolved: true, targetVerticalResolved: true, officialDomainKnown: true,
    businessIdentityResolved: true, hasFreeDiscoveryContactCandidate: true,
    hasPaidNamedDecisionMaker: true,
    verifiedLinkReuse: { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false },
    subjectSuppressions: [], businessWideSuppressionApplied: false,
  });
  check(paidNamed.before.find((entry) => entry.dimension === "named_decision_maker")?.closedBy ===
    "paid_named_decision_maker_evidence",
  "Apollo person evidence closes the named-decision-maker gap without fabricating a CRM link");
  check(gapModule.isResolvedSouthFloridaGeographyOutcome("resolved") === true &&
    ["outside_territory", "conflicting", "unresolved", ""].every((outcome) =>
      gapModule.isResolvedSouthFloridaGeographyOutcome(outcome) === false),
  "only the positive resolved geography outcome closes the geography gap");
  check(gapModule.hasResolvedBusinessIdentity({ mainPhone: "3055550100", streetAddress: "1 Main St", city: "Miami" }) === true &&
    gapModule.hasResolvedBusinessIdentity({ mainPhone: "3055550100", streetAddress: null, city: "Miami" }) === false,
  "business identity is independent from the contact-channel gap and requires usable phone/location evidence");
  check(classifier.classifyVertical("Dentistry", targets).outcome === "resolved_high",
    "classification remains deterministic and pure for a target alias");
  check(evidenceModule.resolveSfpCandidateReference && evidenceModule.getUnifiedSfpCandidates,
    "Task #2000 consumer exports a discriminated free/paid lineage resolver");

  await rejects(() => providerOps.reserveSfpProviderOperation({
    stageRunId: randomUUID(), cohortRunId: randomUUID(), businessId: 1, provider: "serper",
    purpose: "task1999_denial_certification", idempotencyKey: randomUUID(), actorId: "certification",
    workUnit: "request",
  }), /PROVIDER_TRANSPORT_DISABLED/, "unset transport is a hard provider reservation denial");

  const nonce = randomUUID().slice(0, 10);
  const serperControlBefore = rows(await pool.query(`
    SELECT enabled,circuit_state,local_budget_units,reserved_units,consumed_units
      FROM provider_controls WHERE provider='serper'
  `))[0];
  const priorSerperKey = process.env.SERPER_API_KEY;
  process.env.SERPER_API_KEY = "test-only-readiness-credential";
  try {
    await pool.query(`
      UPDATE provider_controls SET enabled=TRUE,circuit_state='closed',local_budget_units=NULL,
             reserved_units=0,consumed_units=0 WHERE provider='serper'
    `);
    check((await providerOps.getSfpProviderReadiness("serper")).ready,
      "enabled/closed provider remains ready when its local credit ceiling is unset");
    await pool.query(`
      UPDATE provider_controls SET local_budget_units=0,reserved_units=0,consumed_units=100 WHERE provider='serper'
    `);
    check((await providerOps.getSfpProviderReadiness("serper")).ready,
      "enabled/closed provider remains ready when historical local units are exhausted");
    await pool.query(`UPDATE provider_controls SET enabled=FALSE WHERE provider='serper'`);
    check(!(await providerOps.getSfpProviderReadiness("serper")).ready,
      "disabled provider remains blocked regardless of financial headroom");
    await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='open' WHERE provider='serper'`);
    check(!(await providerOps.getSfpProviderReadiness("serper")).ready,
      "circuit-open provider remains blocked regardless of financial headroom");
  } finally {
    if (priorSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = priorSerperKey;
    await pool.query(`
      UPDATE provider_controls SET enabled=$1,circuit_state=$2,local_budget_units=$3,
             reserved_units=$4,consumed_units=$5 WHERE provider='serper'
    `, [serperControlBefore.enabled, serperControlBefore.circuit_state, serperControlBefore.local_budget_units,
      serperControlBefore.reserved_units, serperControlBefore.consumed_units]);
  }
  const providerControlStateBefore = rows(await pool.query(`
    SELECT provider,enabled,circuit_state,local_budget_units,reserved_units,consumed_units FROM provider_controls
     WHERE provider IN ('serper','outscraper','apollo','openai') ORDER BY provider
  `));
  const program = await prospecting.ensureProgram({ createdBy: "task1999-certification", maxCohortSize: 1 });
  const targetVertical = `SFP Certification Vertical ${nonce}`;
  await pool.query(`UPDATE sfp_programs SET vertical_ids=ARRAY['${targetVertical}'] WHERE id='${program.id}'::uuid`);
  await prospecting.setProgramActivation({ active: true, actorId: "task1999-certification" });
  const costPreviewResult = await costPreview.buildSfpCostPreview({
    officialDomainGapCount: 0, businessIdentityGapCount: 0,
    decisionMakerGapCount: 0, ambiguousVerticalGapCount: 0,
  });
  check(!("aggregateCapMicros" in costPreviewResult) && !("aggregateRemainingMicros" in costPreviewResult) &&
    costPreviewResult.lines.every((line: any) => !("remainingProviderControlUnits" in line)),
  "cost preview contains optional estimates, not financial ceilings or provider-credit headroom");
  check(providerOps.sfpPriceEstimateReceipt(null).unitPriceEstimateStatus === "unknown" &&
    providerOps.sfpPriceEstimateReceipt(null).unitPriceEstimateMicros === null &&
    providerOps.sfpPriceEstimateReceipt(null).costEstimateStatus === "unknown" &&
    providerOps.sfpPriceEstimateReceipt(123).unitPriceEstimateStatus === "estimate" &&
    providerOps.sfpPriceEstimateReceipt(123).costEstimateStatus === "estimate",
  "provider-operation receipts distinguish unknown pricing from an estimated amount");

  const settlementReplayRunId = randomUUID();
  const settlementReplayBusiness = rows(await pool.query(`
    INSERT INTO businesses(canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
    VALUES ($1,$1,'Settlement Replay Fixture','Miami','FL','33101','active','canonical')
    RETURNING id
  `, [`SFP Cert Settlement Replay ${nonce}`]))[0];
  const settlementReplayBusinessId = Number(settlementReplayBusiness.id);
  await pool.query(`
    INSERT INTO sfp_classification_runs(
      id,program_id,idempotency_key,actor_id,state,max_businesses,policy_version,classifier_version,
      config_hash,reserved_cost_micros,started_at,lease_expires_at
    ) VALUES ($1::uuid,$2::uuid,$3,'task1999-certification','running',1,$4,$5,$6,0,NOW(),NOW()+INTERVAL '5 minutes')
  `, [settlementReplayRunId, program.id, `sfp1999-settlement-replay-${nonce}`,
    program.policyVersion, classifier.CLASSIFIER_VERSION, `settlement-replay-${nonce}`]);
  await pool.query(`
    INSERT INTO sfp_classification_items(run_id,business_id,state,lease_expires_at)
    VALUES ($1::uuid,$2,'running',NOW()+INTERVAL '5 minutes')
  `, [settlementReplayRunId, settlementReplayBusinessId]);

  const priorTransportEnabled = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const priorSettlementSerperKey = process.env.SERPER_API_KEY;
  const settlementControlBefore = rows(await pool.query(`
    SELECT enabled,circuit_state,reserved_units,consumed_units
      FROM provider_controls WHERE provider='serper'
  `))[0];
  let settlementReplayReservation: any;
  let firstSettlement: any;
  let replaySettlement: any;
  try {
    await (await import("./helpers/sfp-runtime-test-identity"))
      .selectSfpRuntimeTestRelease("task1999-certification");
    const { authorizePaidBudget, MI09_PAID_BUDGET_TYPED_CONFIRMATION } =
      await import("../server/services/mi09-pilot-authority");
    await authorizePaidBudget({
      authorizedBy: "task1999-certification",
      typedConfirmation: MI09_PAID_BUDGET_TYPED_CONFIRMATION,
    });
    process.env.SERPER_API_KEY = "test-only-settlement-replay-credential";
    process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
    await pool.query(`
      UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='serper'
    `);
    settlementReplayReservation = await providerOps.reservePreCohortSfpProviderOperation({
      runId: settlementReplayRunId, businessId: settlementReplayBusinessId, provider: "serper",
      purpose: "task1999_settlement_replay", idempotencyKey: `sfp1999-settlement-replay-op-${nonce}`,
      actorId: "task1999-certification", workUnit: "request",
    });
    let fakeDispatchCalls = 0;
    const fakeDispatchResult = await providerOps.invokePreCohortSfpProviderTransport(
      settlementReplayReservation,
      async () => {
        fakeDispatchCalls++;
        return { fixture: "settlement-replay" };
      },
    );
    check(fakeDispatchCalls === 1 && fakeDispatchResult.fixture === "settlement-replay",
      "settlement replay fixture crosses the normal fenced dispatch boundary using only fake transport");
    const settlementInput = {
      reservation: settlementReplayReservation,
      outcome: "completed" as const,
      observation: "valid" as const,
      businessId: settlementReplayBusinessId,
      resultData: { fixture: "settlement-replay" },
    };
    firstSettlement = await providerOps.settlePreCohortSfpProviderOperation(settlementInput);
    replaySettlement = await providerOps.settlePreCohortSfpProviderOperation(settlementInput);
  } finally {
    if (priorTransportEnabled === undefined) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = priorTransportEnabled;
    if (priorSettlementSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = priorSettlementSerperKey;
    await pool.query(`
      UPDATE sfp_classification_runs
         SET state='failed',lease_expires_at=NULL,completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE id=$1::uuid AND state='running'
    `, [settlementReplayRunId]);
    await pool.query(`
      UPDATE sfp_classification_items SET state='failed',lease_expires_at=NULL,
             completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
       WHERE run_id=$1::uuid AND state='running'
    `, [settlementReplayRunId]);
    await pool.query(`
      UPDATE provider_controls SET enabled=$1,circuit_state=$2,reserved_units=$3,consumed_units=$4
       WHERE provider='serper'
    `, [settlementControlBefore.enabled, settlementControlBefore.circuit_state,
      settlementControlBefore.reserved_units, settlementControlBefore.consumed_units]);
  }
  const replaySettlementState = rows(await pool.query(`
    SELECT r.reserved_cost_micros,r.settled_cost_micros,o.state AS operation_state,
           o.billing_state,o.target_fingerprint,o.sfp_dispatch_receipt_fingerprint,
           a.outcome AS attempt_outcome,a.dispatch_marked_at,
           (SELECT COUNT(*)::int FROM provider_observations WHERE operation_id=o.id) AS observations,
           (SELECT COUNT(*)::int FROM sfp_runtime_job_leases
             WHERE operation_id=o.id AND revoked_at IS NOT NULL) AS revoked_job_leases
      FROM sfp_classification_runs r
      JOIN provider_operations o ON o.id=$2::uuid
      JOIN provider_attempts a ON a.operation_id=o.id AND a.attempt_number=1
     WHERE r.id=$1::uuid
  `, [settlementReplayRunId, settlementReplayReservation?.operationId ?? null]))[0];
  check(firstSettlement.replayed === false && firstSettlement.currentFenceAtSettlement === true &&
    firstSettlement.finalizationAllowed === true &&
    replaySettlement.replayed === true && replaySettlement.currentFenceAtSettlement === false &&
    replaySettlement.finalizationAllowed === false &&
    replaySettlement.settledMicros === firstSettlement.settledMicros &&
    Number(replaySettlementState.reserved_cost_micros) === 0 &&
    Number(replaySettlementState.settled_cost_micros) === (firstSettlement.settledMicros ?? 0) &&
    replaySettlementState.operation_state === "completed" &&
    ["committed", "ambiguous"].includes(String(replaySettlementState.billing_state)) &&
    replaySettlementState.target_fingerprint === `business:${settlementReplayBusinessId}` &&
    Boolean(replaySettlementState.sfp_dispatch_receipt_fingerprint) &&
    replaySettlementState.attempt_outcome === "completed" &&
    replaySettlementState.dispatch_marked_at !== null &&
    Number(replaySettlementState.observations) === 1 &&
    Number(replaySettlementState.revoked_job_leases) === 1,
  "pre-cohort settlement replay is a fenced no-op: the authentic dispatch receipt and accounting effect persist, but replay cannot finalize");
  const seedPreCohortDispatchScope = async (name: string) => {
    const seededBusiness = rows(await pool.query(`
      INSERT INTO businesses(canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
      VALUES ($1,$1,'Transport Fence Fixture','Miami','FL','33101','active','canonical')
      RETURNING id
    `, [name]))[0];
    const seededBusinessId = Number(seededBusiness.id);
    const seededRunId = randomUUID();
    await pool.query(`
      INSERT INTO sfp_classification_runs(
        id,program_id,idempotency_key,actor_id,state,max_businesses,policy_version,classifier_version,
        config_hash,reserved_cost_micros,started_at,lease_expires_at
      ) VALUES ($1::uuid,$2::uuid,$3,'task1999-certification','running',1,$4,$5,$6,0,NOW(),NOW()+INTERVAL '5 minutes')
    `, [seededRunId, program.id, `${name}:run:${seededRunId}`, program.policyVersion,
      classifier.CLASSIFIER_VERSION, name]);
    await pool.query(`
      INSERT INTO sfp_classification_items(run_id,business_id,state,lease_expires_at)
      VALUES ($1::uuid,$2,'running',NOW()+INTERVAL '5 minutes')
    `, [seededRunId, seededBusinessId]);
    return { businessId: seededBusinessId, runId: seededRunId };
  };
  const killScope = await seedPreCohortDispatchScope(`sfp1999-kill-${nonce}`);
  const killRunId = killScope.runId;
  const serperControl = rows(await pool.query(`
    SELECT enabled,circuit_state,reserved_units,consumed_units FROM provider_controls WHERE provider='serper'
  `))[0];
  check(serperControl?.enabled === false, "kill-line fixture begins with the Serper control disabled");
  const priorKillTransportEnabled = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const priorKillSerperKey = process.env.SERPER_API_KEY;
  const killReservation = await (async () => {
    process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
    process.env.SERPER_API_KEY = "test-only-kill-line-credential";
    await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='serper'`);
    const reservation = await providerOps.reservePreCohortSfpProviderOperation({
      runId: killRunId, businessId: killScope.businessId, provider: "serper",
      purpose: "task1999_kill_line", idempotencyKey: `sfp1999-kill-op-${nonce}`,
      actorId: "task1999-certification", workUnit: "request",
    });
    await pool.query(`UPDATE provider_controls SET enabled=FALSE WHERE provider='serper'`);
    return reservation;
  })();
  let killLineTransportCalls = 0;
  try {
    await rejects(() => providerOps.invokePreCohortSfpProviderTransport(killReservation, async () => {
    killLineTransportCalls++;
    return "should never execute";
    }), /SFP_PROVIDER_DISPATCH_BOUNDARY_LOST/, "disabled provider-control row blocks at the final pre-I/O gate");
    check(killLineTransportCalls === 0, "fake provider transport spy remains at zero calls after kill-line rejection");
  } finally {
    await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='serper'`);
    await providerOps.settlePreCohortSfpProviderOperation({
      reservation: killReservation, outcome: "not_dispatched", observation: "transport", businessId: killScope.businessId,
    });
    await pool.query(`
      UPDATE sfp_classification_runs SET state='failed',lease_expires_at=NULL,completed_at=NOW()
       WHERE id=$1::uuid
    `, [killScope.runId]);
    await pool.query(`
      UPDATE sfp_classification_items SET state='failed',lease_expires_at=NULL,completed_at=NOW()
       WHERE run_id=$1::uuid
    `, [killScope.runId]);
    await pool.query(`
      UPDATE provider_controls SET enabled=$1,circuit_state=$2,reserved_units=$3,consumed_units=$4
       WHERE provider='serper'
    `, [serperControl.enabled, serperControl.circuit_state, serperControl.reserved_units, serperControl.consumed_units]);
    if (priorKillTransportEnabled === undefined) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = priorKillTransportEnabled;
    if (priorKillSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = priorKillSerperKey;
  }

  const providerControlForZeroCost = rows(await pool.query(`
    SELECT enabled,circuit_state,reserved_units,consumed_units FROM provider_controls WHERE provider='serper'
  `))[0];
  const zeroCostScope = await seedPreCohortDispatchScope(`sfp1999-zero-cost-${nonce}`);
  const priorZeroCostTransportEnabled = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const priorZeroCostSerperKey = process.env.SERPER_API_KEY;
  process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
  process.env.SERPER_API_KEY = "test-only-zero-cost-credential";
  await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='serper'`);
  const zeroCostReservation = await providerOps.reservePreCohortSfpProviderOperation({
    runId: zeroCostScope.runId, businessId: zeroCostScope.businessId, provider: "serper",
    purpose: "task1999_zero_cost_fence", idempotencyKey: `sfp1999-zero-cost-op-${nonce}`,
    actorId: "task1999-certification", workUnit: "result",
  });
  let zeroCostTransportCalls = 0;
  try {
    const fakeZeroCostResult = await providerOps.invokePreCohortSfpProviderTransport(zeroCostReservation, async () => {
      zeroCostTransportCalls++;
      return "fake-zero-cost-transport";
    });
    check(zeroCostTransportCalls === 1 && fakeZeroCostResult === "fake-zero-cost-transport" &&
      zeroCostReservation.amountMicros === null,
    "Phase-A fake transport passes its final fence with normal unknown-price reservation and zero monetary estimate");
    await providerOps.settlePreCohortSfpProviderOperation({
      reservation: zeroCostReservation, outcome: "no_result", observation: "no_result",
      businessId: zeroCostScope.businessId, resultData: { outcome: "no_result" },
    });
  } finally {
    await pool.query(`
      UPDATE sfp_classification_runs SET state='failed',lease_expires_at=NULL,completed_at=NOW()
       WHERE id=$1::uuid
    `, [zeroCostScope.runId]);
    await pool.query(`
      UPDATE sfp_classification_items SET state='failed',lease_expires_at=NULL,completed_at=NOW()
       WHERE run_id=$1::uuid
    `, [zeroCostScope.runId]);
    await pool.query(`UPDATE provider_controls SET enabled=$1,circuit_state=$2,reserved_units=$3,consumed_units=$4 WHERE provider='serper'`,
      [providerControlForZeroCost.enabled, providerControlForZeroCost.circuit_state,
        providerControlForZeroCost.reserved_units, providerControlForZeroCost.consumed_units]);
    if (priorZeroCostTransportEnabled === undefined) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = priorZeroCostTransportEnabled;
    if (priorZeroCostSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = priorZeroCostSerperKey;
  }

  const seedSouthFloridaBusiness = async (name: string, vertical: string, status = "active") => {
    const seeded = rows(await pool.query(`
      INSERT INTO businesses(canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
      VALUES ($1,$1,$2,'Miami','FL','33101',$3,'canonical') RETURNING id
    `, [name, vertical, status]))[0];
    await pool.query(`
      INSERT INTO business_locations(business_id,is_primary,city,state,postal_code,county_fips)
      VALUES ($1,TRUE,'Miami','FL','33101','12086')
    `, [seeded.id]);
    return Number(seeded.id);
  };
  const excludedBusinesses = [
    { id: await seedSouthFloridaBusiness(`SFP Cert DBPR ${nonce}`, "Healthcare"), reason: "dbpr" },
    { id: await seedSouthFloridaBusiness(`SFP Cert Inactive ${nonce}`, "Healthcare", "inactive"), reason: "inactive_entity" },
    { id: await seedSouthFloridaBusiness(`SFP Cert Customer ${nonce}`, "Healthcare"), reason: "existing_customer" },
    { id: await seedSouthFloridaBusiness(`SFP Cert Business Suppressed ${nonce}`, "Healthcare", "suppressed"), reason: "business_wide_suppression" },
  ];
  await pool.query(`
    INSERT INTO canonical_source_links(business_id,source_system,source_type,stable_key)
    VALUES ($1,'DBPR-HR','license','sfp1999-${nonce}')
  `, [excludedBusinesses[0].id]);
  await pool.query(`
    INSERT INTO sdr_merchants(business_id,business_name,existing_customer_flag)
    VALUES ($1,$2,TRUE)
  `, [excludedBusinesses[2].id, `SFP Cert Customer ${nonce}`]);
  const excludedIds = excludedBusinesses.map(({ id }) => id);
  const providerOpsBeforeExclusions = Number(rows(await pool.query(`
    SELECT COUNT(*)::int AS count FROM provider_operations
     WHERE target_fingerprint=ANY($1::text[])
  `, [excludedIds.map((id) => `business:${id}`)]))[0].count);
  let excludedOpenAiCalls = 0;
  let excludedSerperCalls = 0;
  const exclusionRun = await bridge.runPreCohortClassificationBridge({
    programId: String(program.id), idempotencyKey: `sfp1999-exclusion-${nonce}`,
    actorId: "task1999-certification", maxBusinesses: 10, targetIds: ["Med Spa", "Dental"],
    policyVersion: program.policyVersion, allowGovernedSerperDomainDiscovery: true,
    businessIdFilter: excludedIds,
  }, {
    openAiClassify: async () => {
      excludedOpenAiCalls++;
      return { outcome: "target", confidence: 0.9, reasonCodes: [], modelVersion: "fake", promptVersion: "fake", costMicros: 0 };
    },
    serperDomainLookup: async () => {
      excludedSerperCalls++;
      return { domain: "fake.example", costMicros: 0, reasonCode: "FAKE" };
    },
  });
  const excludedItemRows = rows(await pool.query(`
    SELECT business_id,outcome_code FROM sfp_classification_items WHERE run_id=$1::uuid
  `, [exclusionRun.runId]));
  const excludedReasonByBusiness = new Map(excludedItemRows.map((row: any) => [Number(row.business_id), String(row.outcome_code)]));
  const providerOpsAfterExclusions = Number(rows(await pool.query(`
    SELECT COUNT(*)::int AS count FROM provider_operations
     WHERE target_fingerprint=ANY($1::text[])
  `, [excludedIds.map((id) => `business:${id}`)]))[0].count);
  check(excludedBusinesses.every(({ id, reason }) => String(excludedReasonByBusiness.get(id)).includes(reason)) &&
    providerOpsBeforeExclusions === 0 && providerOpsAfterExclusions === 0 &&
    excludedOpenAiCalls === 0 && excludedSerperCalls === 0,
  "DBPR, inactive, customer, and explicit business-wide suppression fixtures are skipped before any provider operation/callback");

  const subjectSuppressedBusinessId = await seedSouthFloridaBusiness(`SFP Cert Subject Suppression ${nonce}`, "Healthcare");
  await pool.query(`
    INSERT INTO contacts(first_name,last_name,email,phone,business_id,unsubscribe_status)
    VALUES ('Certification','Contact',$1,'5550100',$2,'unsubscribed')
  `, [`subject-${nonce}@example.test`, subjectSuppressedBusinessId]);
  let subjectSuppressionOpenAiCalls = 0;
  const subjectSuppressionRun = await bridge.runPreCohortClassificationBridge({
    programId: String(program.id), idempotencyKey: `sfp1999-subject-suppression-${nonce}`,
    actorId: "task1999-certification", maxBusinesses: 1, targetIds: ["Med Spa", "Dental"],
    policyVersion: program.policyVersion, allowGovernedSerperDomainDiscovery: false,
    businessIdFilter: [subjectSuppressedBusinessId],
  }, {
    openAiClassify: async () => {
      subjectSuppressionOpenAiCalls++;
      return { outcome: "target", confidence: 0.9, reasonCodes: ["fake"], modelVersion: "fake", promptVersion: "fake", costMicros: 0 };
    },
  });
  const subjectSuppressionItem = rows(await pool.query(`
    SELECT state,outcome_code FROM sfp_classification_items WHERE run_id=$1::uuid AND business_id=$2
  `, [subjectSuppressionRun.runId, subjectSuppressedBusinessId]))[0];
  check(subjectSuppressionItem?.state === "completed" && subjectSuppressionOpenAiCalls === 1,
    "a subject-scoped contact suppression does not become a Phase-A business-wide exclusion");

  const replayBusinessId = await seedSouthFloridaBusiness(`SFP Cert Replay ${nonce}`, "Med Spa");
  const replayPayload = {
    programId: String(program.id), idempotencyKey: `sfp1999-replay-${nonce}`,
    actorId: "task1999-certification", maxBusinesses: 1, targetIds: ["Med Spa"],
    policyVersion: program.policyVersion, businessIdFilter: [replayBusinessId],
  };
  const firstReplayRun = await bridge.runPreCohortClassificationBridge(replayPayload);
  const sameReplayRun = await bridge.runPreCohortClassificationBridge(replayPayload);
  check(!firstReplayRun.replayed && sameReplayRun.replayed && firstReplayRun.runId === sameReplayRun.runId,
    "Phase A same-key/same-payload request replays the exact completed run");
  await rejects(() => bridge.runPreCohortClassificationBridge({
    ...replayPayload, maxBusinesses: 2,
  }), /SFP_CLASSIFICATION_DIVERGENT_REPLAY/, "Phase A same-key/changed-cap payload fails closed");

  const concurrentBusinessId = await seedSouthFloridaBusiness(`SFP Cert Concurrent ${nonce}`, "Healthcare");
  let concurrentFakeClassifications = 0;
  const concurrentPayload = {
    programId: String(program.id), idempotencyKey: `sfp1999-concurrent-${nonce}`,
    actorId: "task1999-certification", maxBusinesses: 1, targetIds: ["Med Spa", "Dental"],
    policyVersion: program.policyVersion, businessIdFilter: [concurrentBusinessId],
  };
  const concurrentCalls = await Promise.allSettled([
    bridge.runPreCohortClassificationBridge(concurrentPayload, {
      openAiClassify: async () => {
        concurrentFakeClassifications++;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { outcome: "target", confidence: 0.9, reasonCodes: ["fake"], modelVersion: "fake", promptVersion: "fake", costMicros: 0 };
      },
    }),
    bridge.runPreCohortClassificationBridge(concurrentPayload, {
      openAiClassify: async () => {
        concurrentFakeClassifications++;
        return { outcome: "target", confidence: 0.9, reasonCodes: ["fake"], modelVersion: "fake", promptVersion: "fake", costMicros: 0 };
      },
    }),
  ]);
  const concurrentOutcomeRows = rows(await pool.query(`
    SELECT COUNT(*)::int AS count FROM sfp_classification_evidence WHERE business_id=$1
  `, [concurrentBusinessId]));
  check(concurrentCalls.filter((call) => call.status === "fulfilled").length === 1 &&
    concurrentCalls.filter((call) => call.status === "rejected" &&
      /SFP_CLASSIFICATION_RUN_ALREADY_RUNNING/.test(String((call as PromiseRejectedResult).reason?.message))).length === 1 &&
    concurrentFakeClassifications === 1 && Number(concurrentOutcomeRows[0].count) === 1,
  "overlapping same-key Phase A calls serialize to one active run and one classification result");
  const businessName = `SFP Cert Business ${nonce}`;
  const business = rows(await pool.query(`
    INSERT INTO businesses(canonical_name,normalized_name,vertical,city,state,postal_code,status,record_class)
    VALUES ('${businessName}','${businessName}','${targetVertical}','Miami','FL','33101','active','canonical')
    RETURNING id
  `))[0];
  const businessId = Number(business.id);
  await pool.query(`
    INSERT INTO business_locations(business_id,is_primary,city,state,postal_code,county_fips)
    VALUES (${businessId},TRUE,'Miami','FL','33101','12086')
  `);
  const evidenceHash = classifier.classifyVertical(targetVertical, [targetVertical], 2).evidenceHash;
  const evidence = rows(await pool.query(`
    INSERT INTO sfp_classification_evidence(
      business_id,evidence_hash,source_refs,classifier_version,taxonomy_version,model_version,prompt_version,policy_version,
      outcome,confidence,reason_codes,idempotency_key,cost_micros,terminal_state,resolved_vertical_id,admission_tier
    ) VALUES (${businessId},'${evidenceHash}','[]'::jsonb,${classifier.CLASSIFIER_VERSION},2,'cert-model','cert-prompt',${program.policyVersion},
      'target',0.95,'[]'::jsonb,'sfp1999-cert-${nonce}',0,'completed','${targetVertical}','resolved_high') RETURNING id
  `))[0];
  const freeGeneration = rows(await pool.query(`
    INSERT INTO free_discovery_generations(run_key,actor_id,reason,state,completed_at)
    VALUES ('sfp1999-free-${nonce}','task1999-certification','typed candidate resolver fixture','completed',NOW())
    RETURNING id
  `))[0];
  const freeEnvelope = envelope.seal("email", `free-${nonce}@example.test`);
  // subject_type='business' pairs with attribution_scope='role' and a populated
  // business_id per free_discovery_candidates_subject_type_consistency_chk
  // (migration 0273) — a 'person'/'named' row must carry contact_id instead of
  // business_id, which is a different linkage this business-scoped resolver
  // does not cover.
  const freeCandidate = rows(await pool.query(`
    INSERT INTO free_discovery_candidates(
      generation_id,field,subject_type,business_id,domain,source,attribution_scope,
      envelope_ciphertext,envelope_nonce,envelope_tag,
      envelope_key_version,normalized_value_hash,masked_value,confidence
    ) VALUES ('${freeGeneration.id}'::uuid,'email','business',${businessId},'example.test','jsonld','role',
      '${freeEnvelope.ciphertext}','${freeEnvelope.nonce}','${freeEnvelope.tag}',1,
      '${freeEnvelope.normalizedValueHash}','${freeEnvelope.maskedValue}',80) RETURNING id
  `))[0];
  const paidCandidate = await evidenceModule.writeSfpPaidCandidateEvidence({
    businessId, provider: "outscraper", field: "email", value: `paid-${nonce}@example.test`,
    subjectType: "person", confidence: 78, personNameEvidence: "Certification Owner", personTitleEvidence: "Owner",
  });
  const freeResolved = await evidenceModule.resolveSfpCandidateReference({
    sourceKind: "free", freeDiscoveryCandidateId: String(freeCandidate.id),
  });
  const paidResolved = await evidenceModule.resolveSfpCandidateReference({
    sourceKind: "paid", paidCandidateEvidenceId: paidCandidate.id,
  });
  check(freeResolved?.sourceKind === "free" && freeResolved.businessId === businessId &&
    freeResolved.evidenceId === String(freeCandidate.id) && Boolean(freeResolved.maskedValue) &&
    paidResolved?.sourceKind === "paid" && paidResolved.businessId === businessId &&
    paidResolved.evidenceId === paidCandidate.id && Boolean(paidResolved.maskedValue) &&
    "subjectType" in freeResolved && "subjectType" in paidResolved,
  "Task #2000 resolver maps real free and paid rows into the same masked lineage shape");
  const unifiedCandidates = await evidenceModule.getUnifiedSfpCandidates([businessId]);
  check(unifiedCandidates.some((candidate: any) => candidate.sourceKind === "free" && candidate.evidenceId === String(freeCandidate.id)) &&
    unifiedCandidates.some((candidate: any) => candidate.sourceKind === "paid" && candidate.evidenceId === paidCandidate.id) &&
    !JSON.stringify(unifiedCandidates).includes(`free-${nonce}@example.test`) &&
    !JSON.stringify(unifiedCandidates).includes(`paid-${nonce}@example.test`),
  "unified free/paid candidate projection reads real schema columns and never returns plaintext values");
  const frozen = await prospecting.freezeCohort({
    idempotencyKey: `sfp1999-audit-freeze-${nonce}`, actorId: "task1999-certification", maxCohortSize: 1,
  });
  const gapSnapshotBeforeApollo = await costPreview.getSfpCohortGapSnapshot(frozen.run.id);
  await evidenceModule.writeSfpPaidCandidateEvidence({
    businessId, provider: "apollo", field: "email", value: `apollo-${nonce}@example.test`,
    subjectType: "person", confidence: 90,
    personNameEvidence: "Certification Decision Maker", personTitleEvidence: "Owner",
  });
  const gapSnapshotAfterApollo = await costPreview.getSfpCohortGapSnapshot(frozen.run.id);
  check(gapSnapshotAfterApollo.gapCounts.decisionMakerGapCount ===
    Math.max(0, gapSnapshotBeforeApollo.gapCounts.decisionMakerGapCount - 1) &&
    gapSnapshotAfterApollo.snapshotHash !== gapSnapshotBeforeApollo.snapshotHash,
  "persisted Apollo person evidence closes the live decision-maker gap and changes the execution snapshot");
  check(frozen.newlyFrozen === true &&
    frozen.run.id !== undefined &&
    Number(businessId) === Number(businessId) &&
    (await pool.query(`SELECT business_id FROM sfp_cohort_members WHERE cohort_run_id=$1::uuid`, [frozen.run.id]))
      .rows.map((r: any) => Number(r.business_id)).includes(Number(businessId)) &&
    (await pool.query(`SELECT business_id FROM sfp_cohort_members WHERE cohort_run_id=$1::uuid`, [frozen.run.id]))
      .rows.map((r: any) => Number(r.business_id)).length === 1,
  "the candidate-reference business, the frozen cohort member, and the gap-snapshot business are the exact same identity");
  check(gapSnapshotBeforeApollo.businessIds.length === 1 &&
    gapSnapshotBeforeApollo.businessIds[0] === Number(businessId) &&
    gapSnapshotAfterApollo.businessIds[0] === Number(businessId),
  "the gap snapshot's own business identity matches the candidate-reference business before and after the Apollo write");

  // Regression (post-merge audit correction): a business classified "target"
  // under a DIFFERENT targetIds set (replayBusinessId was classified against
  // ["Med Spa"] earlier in this run, not this program's own verticalIds) must
  // never be admitted into a cohort frozen for a program whose configured
  // verticalIds does not include that vertical. Proves program.verticalIds
  // remains authoritative even when unrelated Phase-A "target" evidence
  // exists for the same policy_version.
  const { selectRoiCohort } = await import("../server/services/cro03/roi-cohort-selector");
  const currentProgram = await prospecting.ensureProgram();
  const unrelatedVerticalSelection = await selectRoiCohort({
    maxCohort: 50, verticalIds: currentProgram.verticalIds, countyFips: currentProgram.countyFips,
    executor: db, persistScores: false,
  });
  const admittedIds = new Set(unrelatedVerticalSelection.eligible.map((c: any) => Number(c.canonicalBusinessId)));
  const excludedReplay = unrelatedVerticalSelection.excluded.find((c: any) => Number(c.canonicalBusinessId) === Number(replayBusinessId));
  check(!admittedIds.has(Number(replayBusinessId)) && excludedReplay !== undefined &&
    String(excludedReplay.dispositionReason ?? "").startsWith("excluded:vertical_"),
  "stale Phase-A 'target' evidence recorded under an unrelated targetIds set cannot admit a business whose vertical does not match the program's own configured verticalIds");

  const validationStage = rows(await pool.query(`
    INSERT INTO sfp_stage_runs(cohort_run_id,stage,idempotency_key,actor_id,state,max_items,provider_keys)
    VALUES ($1::uuid,'validation',$2,'task1999-certification','completed',1,'["zerobounce"]'::jsonb)
    RETURNING id
  `, [frozen.run.id, `sfp1999-zb-stage-${nonce}`]))[0];
  const zeroBounceItem = await pool.query(`
    INSERT INTO sfp_stage_items(stage_run_id,business_id,provider,candidate_id,state,outcome_code,completed_at)
    VALUES ($1::uuid,$2,'zerobounce',$3::uuid,'completed','valid',NOW())
  `, [validationStage.id, businessId, freeCandidate.id]);
  check(zeroBounceItem.rowCount === 1, "real ZeroBounce-style valid/invalid candidate linkage remains legal under the provider-scoped CHECK");
  const decision = rows(await pool.query(`
    SELECT classification_evidence_id,classification_evidence_hash,classification_model_version,
           classification_prompt_version,classification_classifier_version
      FROM sfp_cohort_decisions WHERE cohort_run_id='${frozen.run.id}'::uuid AND business_id=${businessId}
  `))[0];
  check(String(decision?.classification_evidence_id) === String(evidence.id) &&
    decision.classification_evidence_hash === evidenceHash && decision.classification_model_version === "cert-model" &&
    decision.classification_prompt_version === "cert-prompt" &&
    Number(decision.classification_classifier_version) === classifier.CLASSIFIER_VERSION,
  "frozen decision pins exact immutable Phase-A classification evidence and version metadata");
  await rejects(() => pool.query(`UPDATE sfp_classification_evidence SET confidence=0.1 WHERE id='${evidence.id}'::uuid`),
    /SFP_EVIDENCE_IMMUTABLE/, "database trigger rejects classification-evidence mutation");
  await rejects(() => pool.query(`DELETE FROM sfp_classification_evidence WHERE id='${evidence.id}'::uuid`),
    /SFP_EVIDENCE_IMMUTABLE/, "database trigger rejects classification-evidence deletion");

  const faultStageRunId = randomUUID();
  const priorFaultTransportEnabled = process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
  const priorFaultSerperKey = process.env.SERPER_API_KEY;
  const faultControlBefore = rows(await pool.query(`
    SELECT enabled,circuit_state,reserved_units,consumed_units
      FROM provider_controls WHERE provider='serper'
  `))[0];
  await pool.query(`
    INSERT INTO sfp_stage_runs(
      id,cohort_run_id,stage,idempotency_key,actor_id,state,max_items,reserved_cost_micros,provider_keys,
      started_at,lease_expires_at
    ) VALUES ($1::uuid,$2::uuid,'paid_waterfall',$3,'task1999-certification','running',1,0,'["serper"]'::jsonb,
      NOW(),NOW()+INTERVAL '5 minutes')
  `, [faultStageRunId, frozen.run.id, `sfp1999-fault-stage-${nonce}`]);
  process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
  process.env.SERPER_API_KEY = "test-only-fault-injection-credential";
  await pool.query(`UPDATE provider_controls SET enabled=TRUE,circuit_state='closed' WHERE provider='serper'`);
  const faultReservation = await providerOps.reserveSfpProviderOperation({
    stageRunId: faultStageRunId, cohortRunId: frozen.run.id, businessId,
    provider: "serper", purpose: "task1999_fault_injection",
    idempotencyKey: `sfp1999-fault-op-${nonce}`, actorId: "task1999-certification",
    workUnit: "request", units: 1,
  });
  try {
    await rejects(() => db.transaction(async (tx: any) => {
      await evidenceModule.writeSfpPaidCandidateEvidence({
        businessId, provider: "serper", field: "website_domain", value: `fault-${nonce}.example`,
        subjectType: "business", providerOperationId: faultReservation.operationId, confidence: 90,
      }, tx);
      throw new Error("TASK1999_FAULT_AFTER_EVIDENCE_BEFORE_SETTLEMENT");
    }), /TASK1999_FAULT_AFTER_EVIDENCE_BEFORE_SETTLEMENT/,
    "injected result-persistence failure rolls back before settlement/linkage");
    const firstCohortSettlement = await providerOps.settleSfpProviderOperation({
      reservation: faultReservation, outcome: "failed", observation: "transport", businessId,
    });
  const cohortSettlementStateBeforeReplay = rows(await pool.query(`
    SELECT processed_count,failed_count,reserved_cost_micros,settled_cost_micros
      FROM sfp_stage_runs WHERE id=$1::uuid
  `, [faultStageRunId]))[0];
  const replayedCohortSettlement = await providerOps.settleSfpProviderOperation({
    reservation: faultReservation, outcome: "failed", observation: "transport", businessId,
  });
  const cohortSettlementStateAfterReplay = rows(await pool.query(`
    SELECT processed_count,failed_count,reserved_cost_micros,settled_cost_micros
      FROM sfp_stage_runs WHERE id=$1::uuid
  `, [faultStageRunId]))[0];
  check(firstCohortSettlement.replayed === false && replayedCohortSettlement.replayed === true &&
    JSON.stringify(cohortSettlementStateBeforeReplay) === JSON.stringify(cohortSettlementStateAfterReplay),
  "cohort-bound settlement replay is a fenced no-op and cannot double-increment stage counters");
  await pool.query(`
    UPDATE sfp_stage_runs SET state='failed',terminal_reason='TASK1999_FAULT_INJECTION',
      completed_at=NOW(),claim_token=NULL,lease_expires_at=NULL,updated_at=NOW()
     WHERE id=$1::uuid
  `, [faultStageRunId]);
  await pool.query(`
    UPDATE sfp_stage_items SET state='failed',outcome_code='TASK1999_FAULT_INJECTION',
           claim_token=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW()
     WHERE stage_run_id=$1::uuid AND provider_operation_id=$2::uuid
  `, [faultStageRunId, faultReservation.operationId]);
  const faultState = rows(await pool.query(`
    SELECT o.state,o.billing_state,s.state AS stage_state,s.reserved_cost_micros,s.settled_cost_micros,
           i.state AS item_state,i.paid_candidate_evidence_id,
           (SELECT COUNT(*)::int FROM sfp_paid_candidate_evidence e WHERE e.provider_operation_id=o.id) AS evidence_count
      FROM provider_operations o
      JOIN sfp_stage_runs s ON s.id=$2::uuid
      JOIN sfp_stage_items i ON i.provider_operation_id=o.id
      WHERE o.id=$1::uuid
   `, [faultReservation.operationId, faultStageRunId]))[0];
  check(faultState.state === "failed" && faultState.billing_state === "committed" &&
    faultState.stage_state === "failed" &&
    Number(faultState.reserved_cost_micros) === 0 && Number(faultState.settled_cost_micros) === 0 &&
    faultState.item_state === "failed" && faultState.paid_candidate_evidence_id === null &&
    Number(faultState.evidence_count) === 0,
  "fault recovery reaches a terminal zero-cost operation and failed stage item with no candidate or evidence orphan");
  } finally {
    if (priorFaultTransportEnabled === undefined) delete process.env.CRO03_PROVIDER_TRANSPORT_ENABLED;
    else process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = priorFaultTransportEnabled;
    if (priorFaultSerperKey === undefined) delete process.env.SERPER_API_KEY;
    else process.env.SERPER_API_KEY = priorFaultSerperKey;
    await pool.query(`
      UPDATE provider_controls SET enabled=$1,circuit_state=$2,reserved_units=$3,consumed_units=$4
       WHERE provider='serper'
    `, [faultControlBefore.enabled, faultControlBefore.circuit_state,
      faultControlBefore.reserved_units, faultControlBefore.consumed_units]);
  }

  const before = await costPreview.getSfpCohortGapSnapshot(frozen.run.id);
  const snapshotMemberId = before.businessIds[0];
  check(snapshotMemberId !== undefined, "server-derived cost preview is bound to at least one frozen cohort member");
  await pool.query(`UPDATE businesses SET website_domain='audit-${nonce}.example' WHERE id=${snapshotMemberId}`);
  const after = await costPreview.getSfpCohortGapSnapshot(frozen.run.id);
  check(before.snapshotHash !== after.snapshotHash, "server-derived preview snapshot becomes stale when a frozen member's evidence changes");

  const providerControlStateAfter = rows(await pool.query(`
    SELECT provider,enabled,circuit_state,local_budget_units,reserved_units,consumed_units FROM provider_controls
     WHERE provider IN ('serper','outscraper','apollo','openai') ORDER BY provider
  `));
  check(JSON.stringify(providerControlStateBefore) === JSON.stringify(providerControlStateAfter) &&
    getBlockedCertificationNetworkAttemptCount() === 0,
    "certification records no provider activation and no live network attempt");

  const schemaText = await readFile(new URL("../shared/schema.ts", import.meta.url), "utf8");
  check(schemaText.includes("classificationEvidenceHash") && schemaText.includes("gapVector") &&
    schemaText.includes("sfpResultData"), "Drizzle schema exposes newly migrated Task #1999 contract fields");

  console.log(`TASK1999_POSTMERGE_CERTIFICATION_PASS assertions=${assertions}`);
} finally {
  await pgPool?.end();
}
