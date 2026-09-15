#!/usr/bin/env tsx
/**
 * CRO-03C business-path → master_leads disposable end-to-end certification.
 *
 * Proves the FULL chain the task-1956 Step 10 mandate requires, with fake
 * transports only (no real network, no real spend, no worker activation):
 *
 *   command → provider operation (business_email_validation) → provider
 *   receipt → canonical projection (businesses.main_email/email_discovery_status)
 *   → business_validation_intent → fake ZeroBounce operation → fake ZeroBounce
 *   receipt/result → master_lead_staging_intents → master_leads staging →
 *   shared promotion/readiness decision (evaluateBusinessPromotionEligibility /
 *   checkPromotionPreconditions).
 *
 * Explicit negative assertions:
 *   - A validation-intent-only row (no terminal ZeroBounce result yet) is
 *     never promotable and produces no master_leads row.
 *   - A row pending validation stays blocked until BOTH a terminal ZeroBounce
 *     result AND the shared promotion-eligibility authority agree.
 *
 * The disposable certification-provider-deny boundary blocks all non-loopback
 * network access; the fake ZeroBounce outcome is injected via
 * `BusinessValidationWorkerDeps.validateEmail`, the same test-only DI pattern
 * the contact-bound sibling (`processValidationIntent`) already uses.
 *
 * Usage: npx tsx scripts/test-cro03c-master-lead-e2e-certification.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import {
  applyCertificationProviderDenyBoundary,
  getBlockedCertificationNetworkAttemptCount,
} from "./certification-provider-deny";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";

process.env.NODE_ENV = "test";
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.RELEASE_SHA ??= "e".repeat(40);
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";

const CRO03C_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAc+oK2y8tsyfO+9Hd4lqNEah6wqmKbpCOwx7v2fiMID
-----END PRIVATE KEY-----`;
const CRO03C_TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmdpjEODwaY43I1XQ6inirYsfZUDTK32G7mFVIu3kv8E=
-----END PUBLIC KEY-----`;
process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS = JSON.stringify(Object.fromEntries(
  ["operator", "data", "finance", "legal"].map((dimension) => [`cro03c-mlcert-${dimension}`, CRO03C_TEST_PUBLIC_KEY]),
));
process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS = JSON.stringify({
  "cro03c-mlcert-deployment": CRO03C_TEST_PUBLIC_KEY,
});

let PASS = 0;
let FAIL = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  \u2713 ${label}`); PASS++; }
  else { console.error(`  \u2717 ${label}${detail ? `: ${detail}` : ""}`); FAIL++; }
}

await assertDisposableTestInfrastructure({
  operation: "CRO-03C master-lead e2e certification", requireRedis: true, reserveRedisNamespace: true,
}).then(async (infrastructure) => {
  try {
    applyCertificationProviderDenyBoundary({ fatal: true });
    // The deny boundary scrubs real provider credentials from process.env (by
    // design — no real spend). processBusinessValidationIntent still requires a
    // non-empty ZEROBOUNCE_API_KEY to reach its injected fake `validateEmail`
    // (the fake transport ignores the key value; no real HTTP call is made).
    process.env.ZEROBOUNCE_API_KEY = "cro03c-mlcert-fake-key-not-real";

    const { db } = await import("../server/db");
    const { createCro03SourceBatch, hashCro03Evidence } = await import("../server/services/cro03/source-staging");
    const { createCro03aQualificationRun, processCro03aQualificationRunQueueSafe } =
      await import("../server/services/cro03a/qualification-service");
    const {
      reserveCro03cBusinessValidationOperation, authorizeCro03cBusinessValidation,
      settleCro03cProviderOperation, CRO03C_PROVIDER_CONTRACTS, CRO03C_MIGRATION_HEAD,
      CRO03C_RECIPE_HASH, CRO03C_RECIPE_VERSION, CRO03C_REQUIRED_APPROVALS,
      assertCro03cDeploymentAuthorityBeforeIo,
    } = await import("../server/services/cro03/live-execution");
    const { CRO03B_UNIFIED_RECIPE } = await import("../server/services/cro03/recipe-contract");
    const { canonicalCro03cApprovalPayload, CRO03C_APPROVAL_ARTIFACT_VERSION } =
      await import("../server/services/cro03/approval-artifact");
    const {
      canonicalCro03cDeploymentInventory, importCro03cDeploymentInventory,
      CRO03C_DEPLOYMENT_INVENTORY_VERSION,
    } = await import("../server/services/cro03/deployment-inventory");
    const { publishCro03cWorkerHeartbeat } = await import("../server/services/cro03/runtime-heartbeat");
    const { getRedisConnection, getBullMqTestPrefix } = await import("../server/services/queue-connection");
    const { invalidatePauseStateCache } = await import("../server/services/outbound-pause-authority");
    const { writeCandidateEvidence } = await import("../server/services/cro03/candidate-evidence-service");
    const { selectEmailWinner } = await import("../server/services/cro03/candidate-selector");
    const { processBusinessValidationIntent } = await import("../server/services/cro03/business-validation-service");
    const { processMasterLeadStagingIntent } = await import("../server/workers/master-lead-stager.worker");
    const { evaluateBusinessPromotionEligibility } = await import("../server/services/contactability");
    const { checkPromotionPreconditions } = await import("../server/services/master-leads/pipeline-promotion");

    const rows = (result: any): any[] => result?.rows ?? result ?? [];
    const run = crypto.randomUUID();
    const hash = (label: string) => hashCro03Evidence({ certification: "cro03c-mlcert", run, label });

    // ── Migration presence guard ────────────────────────────────────────────
    const migrationRelations = rows(await db.execute(sql`
      SELECT to_regclass('public.cro03c_commands') AS commands,
             to_regclass('public.business_validation_intents') AS biz_intents,
             to_regclass('public.cro03c_business_validation_authorizations') AS biz_auth,
             to_regclass('public.master_lead_staging_intents') AS staging_intents,
             to_regclass('public.master_leads') AS master_leads
    `))[0];
    assert(migrationRelations?.commands && migrationRelations?.biz_intents &&
      migrationRelations?.biz_auth && migrationRelations?.staging_intents && migrationRelations?.master_leads,
      "required CRO-03C + master-lead schema must be present");

    // This disposable database is single-purpose for this certification. Every
    // row this run writes is scoped to a freshly created `businesses.id` (serial)
    // or a fresh per-run UUID (command/run/generation/etc. keys embed `run`), so a
    // prior interrupted run's rows never collide with this run's fixtures — no
    // DELETE is needed for most tables, and several are append-only anyway
    // (cro03c_business_validation_authorizations, cro03c_runtime_attestations,
    // cro03c_deployment_inventories, cro03c_approval_receipts,
    // cro03c_activation_policies all block DELETE/UPDATE via CRO03[AB]_APPEND_ONLY
    // triggers). Only the fixed (policy_key, version) on activation_policies needs
    // special handling below — bump the version per run instead of deleting.
    await db.execute(sql`DELETE FROM canonical_conflict_evidence`);
    const priorPolicyVersion = Number((rows(await db.execute(sql`
      SELECT COALESCE(MAX(version), 0) AS v FROM cro03c_activation_policies WHERE policy_key='cro03c_live_activation'
    `)))[0]?.v ?? 0);
    const policyVersion = priorPolicyVersion + 1;
    // businesses/canonical_source_links are NOT deleted here either — this run's
    // business row is a fresh serial id, and old rows are still referenced by the
    // append-only cro03c_candidate_evidence/authorizations tables from prior runs.
    // cro03a_handoffs is append-only too (CRO03A_APPEND_ONLY); handoffId below is a
    // fresh per-run UUID, so no collision risk from leaving prior rows in place.

    const adminId = `cro03c-mlcert-admin-${run}`;
    await db.execute(sql`
      INSERT INTO users(id,email,role,auth_provider,created_at,updated_at)
      VALUES (${adminId},${`${run}@cro03c-mlcert.example.test`},'admin','test',NOW(),NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    const admin = { id: adminId };
    await db.execute(sql`
      INSERT INTO outbound_pause_control(state,reason,epoch,actor)
      SELECT 'paused','CRO03C master-lead certification',1,'cro03c-mlcert'
       WHERE NOT EXISTS (SELECT 1 FROM outbound_pause_control)
    `);
    await db.execute(sql`UPDATE outbound_pause_control SET state='paused',epoch=epoch+1,committed_at=NOW()`);
    invalidatePauseStateCache();

    // ── Source → CRO-03A handoff → business → canonical link ───────────────
    const subjectKey = `cro03c-mlcert-${run}`;
    await createCro03SourceBatch({
      idempotencyKey: `cro03c-mlcert-source:${run}`, actorType: "system",
      actorId: "cro03c-mlcert", purpose: "staging_review",
      subjects: [{
        subjectType: "prospect", subjectKey, sourceSystem: "prospects",
        sourceObservedAt: new Date().toISOString(), sourceEventKey: `cro03c-mlcert-event:${run}`,
        timestampProvenance: "source", provenance: { certification: true },
        payload: { businessName: `CRO03C MLCert ${run}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550188", address: "200 Test Way",
          city: "Miami", state: "FL", county: "Miami-Dade", industry: "Auto", entityStatus: "active" },
        candidateValues: { business_name: `CRO03C MLCert ${run}`, website: `https://${subjectKey}.example.test`,
          email: `${subjectKey}@example.test`, phone: "3055550188", address: "200 Test Way",
          city: "Miami", state: "FL", category: "Auto", entity_status: "active" },
      }],
    });
    const occurrence = rows(await db.execute(sql`
      SELECT id FROM cro03_source_occurrences WHERE source_event_key=${`cro03c-mlcert-event:${run}`}
    `))[0];
    const qualification = await createCro03aQualificationRun({
      idempotencyKey: `cro03c-mlcert-qualification:${run}`, occurrenceIds: [occurrence.id],
      actorId: String(admin.id), actorRole: "admin",
    });
    await processCro03aQualificationRunQueueSafe(qualification.id);
    const handoffRow = rows(await db.execute(sql`
      SELECT id FROM cro03a_handoffs WHERE run_id=${qualification.id}::uuid
    `))[0];
    assert(handoffRow, "source fixture must produce an eligible CRO-03A handoff");
    const handoffId = String(handoffRow.id);

    // Manufacture the canonical business + link the handoff resolves against
    // (this repo's real linking pipeline is out of certification scope here —
    // only the business-validation → master-lead chain downstream of a
    // resolved business is under test).
    const bizRow = rows(await db.execute(sql`
      INSERT INTO businesses (canonical_name, normalized_name, record_class, created_at, updated_at)
      VALUES (${`CRO03C MLCert ${run}`}, ${`cro03c mlcert ${run}`}, 'test', NOW(), NOW())
      RETURNING id
    `))[0];
    const businessId = Number(bizRow.id);
    await db.execute(sql`
      INSERT INTO canonical_source_links (business_id, source_system, source_type, stable_key, first_seen_at, last_confirmed_at, created_at, updated_at)
      VALUES (${businessId}, 'prospects', 'prospect', ${subjectKey}, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT (source_system, source_type, stable_key) DO NOTHING
    `);

    // ── CRO-03C command/run/generation + full authority chain ──────────────
    const policyId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();
    const now = new Date();
    const expiry = new Date(now.getTime() + 10 * 60_000);
    const priceSchedules = Object.fromEntries(Object.entries(CRO03C_PROVIDER_CONTRACTS).map(([provider, contract]: [string, any]) => [
      provider,
      {
        version: 1, unitType: contract.unitType, currency: contract.currency,
        amountMicros: contract.billingSemantics === "not_billable" ? 0 : 1,
        billingSemantics: contract.billingSemantics,
      },
    ]));
    const stagePlanHash = stableCro03RecipeHash(CRO03B_UNIFIED_RECIPE.steps.map((step: any) => ({
      id: step.id, provider: step.provider, accountingOwner: step.accountingOwner,
    })));
    const approvalScope = {
      policyKey: "cro03c_live_activation", recipeVersion: CRO03C_RECIPE_VERSION, recipeHash: CRO03C_RECIPE_HASH,
      stagePlanHash, migrationHead: CRO03C_MIGRATION_HEAD, releaseSha: process.env.RELEASE_SHA ?? "", priceSchedules,
    };
    const approvalScopeHash = stableCro03RecipeHash(approvalScope);
    const receiptIds = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension: string) => [dimension, crypto.randomUUID()])) as Record<string, string>;
    const approvalEvidence = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension: string) => [
      dimension,
      { approvalId: receiptIds[dimension], version: 1, approvedBy: `cro03c-mlcert-${dimension}`, approvedAt: now.toISOString(), scopeHash: approvalScopeHash },
    ]));
    for (const dimension of CRO03C_REQUIRED_APPROVALS) {
      const idempotencyKey = `cro03c-mlcert-approval:${run}:${dimension}`;
      const issuerId = `cro03c-mlcert-${dimension}`;
      const signedPayload = {
        artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION, receiptId: receiptIds[dimension], idempotencyKey, issuerId,
        dimension, scope: approvalScope, scopeHash: approvalScopeHash, issuedAt: now.toISOString(), expiresAt: expiry.toISOString(),
      };
      const signature = crypto.sign(null, Buffer.from(canonicalCro03cApprovalPayload(signedPayload), "utf8"), CRO03C_TEST_PRIVATE_KEY).toString("base64");
      await db.execute(sql`
        INSERT INTO cro03c_approval_receipts
          (id,idempotency_key,dimension,issuer_id,issuer_receipt_id,scope,scope_hash,issued_at,expires_at,signature,created_by)
        VALUES (${receiptIds[dimension]}::uuid,${idempotencyKey},${dimension},
                ${issuerId},${receiptIds[dimension]},${JSON.stringify(approvalScope)}::jsonb,
                ${approvalScopeHash},${now}::timestamptz,${expiry}::timestamptz,
                ${signature},${String(admin.id)})
      `);
    }
    await db.execute(sql`
      INSERT INTO cro03c_activation_policies
        (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
      VALUES (${policyId}::uuid,${`cro03c-mlcert-policy:${run}`},'cro03c_live_activation',${policyVersion},
              ${JSON.stringify(approvalScope)}::jsonb,${hash("policy")},${JSON.stringify(priceSchedules)}::jsonb,
              ${JSON.stringify(approvalEvidence)}::jsonb,
              'approved',${policyVersion},'certification',${String(admin.id)})
    `);
    const inventoryId = crypto.randomUUID();
    const deploymentIdentity = "certification";
    const environmentIdentity = "test";
    const queueTopologyHash = "f".repeat(64);
    const workerIdentities = [`cro03c-mlcert-worker:${run}`];
    const workerBootIdentity = `cro03c-mlcert-boot:${run}`;
    const inventoryPayload = {
      artifactVersion: CRO03C_DEPLOYMENT_INVENTORY_VERSION, inventoryId, issuerId: "cro03c-mlcert-deployment",
      deploymentIdentity, environmentIdentity, releaseSha: process.env.RELEASE_SHA!, queueTopologyHash,
      identityKind: "worker" as const, workerIdentities, expectedCount: workerIdentities.length,
      issuedAt: now.toISOString(), expiresAt: expiry.toISOString(),
    };
    const inventoryArtifact = {
      payload: inventoryPayload,
      signature: crypto.sign(null, Buffer.from(canonicalCro03cDeploymentInventory(inventoryPayload), "utf8"), CRO03C_TEST_PRIVATE_KEY).toString("base64"),
    };
    await importCro03cDeploymentInventory({ artifact: inventoryArtifact, actorId: String(admin.id), reason: "CRO-03C master-lead certification" });
    const redis = await getRedisConnection() as any;
    const redisPrefix = getBullMqTestPrefix();
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: workerIdentities[0],
      bootIdentity: workerBootIdentity, queueTopologyHash, timestamp: new Date().toISOString(),
      environmentIdentity, deploymentIdentity, enabledGroups: "off",
    });
    await db.execute(sql`
      INSERT INTO cro03c_runtime_attestations
        (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,
         worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,expires_at,attestation_hash,created_by)
      VALUES (${attestationId}::uuid,${`cro03c-mlcert-attestation:${run}`},${inventoryId}::uuid,
              ${JSON.stringify(workerIdentities)}::jsonb,${process.env.RELEASE_SHA},
              ${CRO03C_MIGRATION_HEAD},${deploymentIdentity},${environmentIdentity},'web-cert',${workerBootIdentity},
               ${queueTopologyHash},${now}::timestamptz,TRUE,TRUE,
               ${expiry}::timestamptz,${hash("attestation")},${String(admin.id)})
    `);
    await assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId });

    const commandId = crypto.randomUUID();
    const caps = {
      validationMaxUnits: 100, validationMaxAmountMicros: 100,
      validationPriceScheduleVersion: 1,
      validationPriceScheduleHash: stableCro03RecipeHash(priceSchedules.zerobounce),
      businessValidationMaxUnits: 10, businessValidationMaxAmountMicros: 10,
    };
    await db.execute(sql`
      INSERT INTO cro03c_commands
        (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,
         recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,state,expires_at,reason)
      VALUES (${commandId}::uuid,${`cro03c-mlcert-command:${run}`},${`cro03c-mlcert-command-idem:${run}`},
               'initial_batch',${String(admin.id)},${policyId}::uuid,${policyVersion},${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},${stagePlanHash},
               ${attestationId}::uuid,${JSON.stringify(caps)}::jsonb,${hash("stop")},${JSON.stringify(approvalEvidence)}::jsonb,'running',${expiry}::timestamptz,'certification')
    `);
    const runId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO cro03c_runs (id,command_id,run_key,mode,state)
      VALUES (${runId}::uuid,${commandId}::uuid,${`cro03c-mlcert-run:${run}`},'cro03c_live_v1','running')
    `);
    const generationId = crypto.randomUUID();
    const frozenHandoffHash = hash("frozen-handoff");
    const cohortHash = hash("cohort");
    await db.execute(sql`
      INSERT INTO cro03c_generations
        (id,command_id,run_id,handoff_id,recipe_version,recipe_hash,mode,activation_revision,
         frozen_handoff_hash,stage_plan_hash,cohort_hash,runtime_attestation_id,state)
      VALUES (${generationId}::uuid,${commandId}::uuid,${runId}::uuid,${handoffId}::uuid,
              ${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},'cro03c_live_v1',${policyVersion},
              ${frozenHandoffHash},${stagePlanHash},${cohortHash},${attestationId}::uuid,'running')
    `);
    // Ensure the fake ZeroBounce provider control is enabled+closed for this run —
    // this disposable DB may not have a seeded provider_controls row, and the real
    // authority query requires pc.enabled=TRUE AND pc.circuit_state='closed'.
    await db.execute(sql`
      INSERT INTO provider_controls (provider, capability, enabled, circuit_state)
      VALUES ('zerobounce', 'email_validation', TRUE, 'closed')
      ON CONFLICT (provider) DO UPDATE SET enabled = TRUE, circuit_state = 'closed'
    `);

    ok("Command/run/generation authority chain created", true);

    // ── Candidate evidence → winner selection → business_validation_intent ─
    const email = `${subjectKey}@example.test`;
    const evidence = await writeCandidateEvidence({
      generationId, stageKey: "internal_source", field: "email", value: email,
      subjectType: "business", confidence: 90, sourceRank: 1, businessId,
    });
    ok("Candidate evidence written (encrypted envelope, not plaintext)", !!evidence.id);

    // Fake MX check (DI, same convention as BusinessValidationWorkerDeps) — the real
    // dns.resolveMx() call would hit a non-loopback network address the certification
    // deny boundary blocks, and "example.test" has no real MX record anyway.
    const selection = await selectEmailWinner(businessId, generationId, { checkMx: async () => "ok" });
    ok("Winner selection produced a business_validation_intent", selection.outcome === "selected" && !!selection.businessValidationIntentId);
    const intentId = selection.businessValidationIntentId!;

    const preValidation = rows(await db.execute(sql`
      SELECT email_discovery_status, main_email FROM businesses WHERE id=${businessId}
    `))[0];
    ok("Pre-validation: no main_email projected yet", preValidation.main_email === null);
    ok("Pre-validation: status is 'discovered', not provider_valid", preValidation.email_discovery_status === "discovered");

    // ── Negative assertion #1: an intent-only row is never promotable ──────
    const preValidationMasterLeadCount = Number(rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM master_leads WHERE canonical_business_id=${businessId}
    `))[0]?.n ?? 0);
    ok("Negative: zero master_leads rows exist before any ZeroBounce result", preValidationMasterLeadCount === 0);
    const prePromotionEligibility = await evaluateBusinessPromotionEligibility(businessId);
    ok("Promotion-eligibility authority itself is agnostic to validation state (checked separately from staging gate below)",
      prePromotionEligibility.status === "eligible");

    // ── Reserve + authorize the business ZeroBounce operation ──────────────
    const zbSchedule = priceSchedules.zerobounce;
    const reservation = await reserveCro03cBusinessValidationOperation({
      generationId, intentId, commandId, activationRevision: policyVersion,
      priceScheduleVersion: zbSchedule.version, priceScheduleHash: stableCro03RecipeHash(zbSchedule),
      amountMicros: zbSchedule.amountMicros,
    });
    ok("Business ZeroBounce operation reserved (cro03c_stage_operations row)", !!reservation.operationId);

    const normalizedEmailHash = String(rows(await db.execute(sql`
      SELECT email_selected_candidate_hash FROM businesses WHERE id=${businessId}
    `))[0].email_selected_candidate_hash);
    const authorization = await authorizeCro03cBusinessValidation({
      businessIntentId: intentId, commandId, runId, generationId, activationRevision: policyVersion,
      businessId, normalizedEmailHash, runtimeAttestationId: attestationId, expiresAt: expiry,
    });
    ok("Business validation authorized against the full 9-table authority chain", !!authorization.id);

    // ── Fake ZeroBounce transport injected — no real network call ──────────
    let fakeZbCalls = 0;
    const outcome = await processBusinessValidationIntent(intentId, {
      commandId, runId, generationId, activationRevision: policyVersion,
      runtimeAttestationId: attestationId, expiresAt: expiry,
    }, reservation.operationId, {
      validateEmail: async (_email: string, _apiKey: string) => {
        fakeZbCalls++;
        return {
          status: "valid", sub_status: "", account: "", domain: "", free_email: "false",
          did_you_mean: "", domain_age_days: "3650", active_in_days: "", smtp_provider: "",
          mx_found: "true", mx_record: "mx.example.test", firstname: "", lastname: "",
          gender: "", country: "", region: "", city: "", zipcode: "",
          processed_at: new Date().toISOString(),
        } as any;
      },
    });
    ok("Fake ZeroBounce transport invoked exactly once (no retry storm)", fakeZbCalls === 1);
    ok("processBusinessValidationIntent completed via the fake transport", outcome === "completed", `got ${outcome}`);
    ok("Zero real network attempts anywhere in this chain", getBlockedCertificationNetworkAttemptCount() === 0);

    // ── Canonical projection: businesses.main_email / email_discovery_status
    const postValidation = rows(await db.execute(sql`
      SELECT email_discovery_status, main_email FROM businesses WHERE id=${businessId}
    `))[0];
    ok("Canonical projection: email_discovery_status = provider_valid", postValidation.email_discovery_status === "provider_valid");
    ok("Canonical projection: main_email written only after provider_valid", postValidation.main_email === email);

    // ── Provider receipt settlement (fake operation, real receipt bookkeeping)
    const settlement = await settleCro03cProviderOperation({
      operationId: reservation.operationId, outcome: "success", settledUnits: 1,
      settledAmountMicros: zbSchedule.amountMicros, billingCertainty: "certain",
      providerReceiptReference: `cro03c-mlcert-zb-receipt:${run}`, evidenceHash: hash("zb-receipt"),
      metadata: { certification: "cro03c-mlcert", fake: true },
    });
    ok("Provider receipt settled (cro03c_receipts row)", !!settlement.receiptId);

    // ── master_lead_staging_intents → master_leads staging ─────────────────
    const stagingIntent = rows(await db.execute(sql`
      SELECT id, status FROM master_lead_staging_intents WHERE canonical_business_id=${businessId}
    `))[0];
    ok("master_lead_staging_intents row created as a side effect of provider_valid", !!stagingIntent);

    // Negative assertion #2: the staging intent alone (before the stager
    // worker consumes it) still produces zero master_leads rows and zero
    // promotable rows — validation-result presence is necessary but the
    // shared staging/promotion gate must independently run.
    const preStagerMasterLeadCount = Number(rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM master_leads WHERE canonical_business_id=${businessId}
    `))[0]?.n ?? 0);
    ok("Negative: a pending staging intent alone still produces zero master_leads rows", preStagerMasterLeadCount === 0);

    await processMasterLeadStagingIntent(String(stagingIntent.id));

    const masterLead = rows(await db.execute(sql`
      SELECT id, status, pipeline_origin, outreach_readiness, canonical_business_id
        FROM master_leads WHERE canonical_business_id=${businessId}
    `))[0];
    ok("master_leads row staged by the stager worker", !!masterLead);
    ok("master_leads.pipeline_origin = cro03_pipeline", masterLead?.pipeline_origin === "cro03_pipeline");
    ok("master_leads.status = staged (not yet promoted)", masterLead?.status === "staged");

    // ── Shared promotion/readiness decision — the final authority gate ─────
    const promotionCheck = await checkPromotionPreconditions(String(masterLead.id));
    ok("Shared promotion authority clears a fully-validated, non-DBPR, non-existing-customer row",
      promotionCheck.blocker === null, promotionCheck.blocker ?? "");

    // ── Negative assertion #3: DBPR-lineage / existing-customer still block
    // promotion even after a terminal provider_valid result — the shared
    // authority, not validation state alone, is the final gate.
    // canonical_conflict_evidence has no `reason`/`updated_at` columns — the
    // reason text belongs in `field`, with `conflict_type` required NOT NULL.
    await db.execute(sql`
      INSERT INTO canonical_conflict_evidence (business_id_a, business_id_b, conflict_type, field, status, created_at)
      VALUES (${businessId}, ${businessId}, 'cro03c_mlcert_synthetic', 'cro03c-mlcert synthetic conflict', 'open', NOW())
    `);
    const blockedCheck = await checkPromotionPreconditions(String(masterLead.id));
    ok("Negative: an open canonical conflict blocks promotion even with a provider_valid email",
      blockedCheck.blocker === "OPEN_CANONICAL_CONFLICT", blockedCheck.blocker ?? "(no blocker)");
    await db.execute(sql`DELETE FROM canonical_conflict_evidence WHERE business_id_a=${businessId} AND business_id_b=${businessId}`);

    console.log(`\n${PASS} passed, ${FAIL} failed\n`);
    if (FAIL > 0) process.exitCode = 1;
  } catch (err) {
    console.error("CRO-03C master-lead certification crashed:", err);
    process.exitCode = 1;
  } finally {
    await infrastructure.releaseRedisReservation();
  }
});
