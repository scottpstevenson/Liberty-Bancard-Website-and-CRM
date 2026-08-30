#!/usr/bin/env tsx
/**
 * CRO-03C disposable PostgreSQL/isolated Redis durability certification.
 * This suite never enables a provider: the certification deny boundary is
 * installed before service imports and only the internal-source executor runs.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";
import { stableCro03RecipeHash } from "../server/services/cro03/contracts";

process.env.NODE_ENV = "test";
process.env.VG_PROVIDER_DENY_MODE = "1";
process.env.RELEASE_SHA ??= "c".repeat(40);
const CRO03C_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIAc+oK2y8tsyfO+9Hd4lqNEah6wqmKbpCOwx7v2fiMID
-----END PRIVATE KEY-----`;
const CRO03C_TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAmdpjEODwaY43I1XQ6inirYsfZUDTK32G7mFVIu3kv8E=
-----END PUBLIC KEY-----`;
process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS = JSON.stringify(Object.fromEntries(
  ["operator", "data", "finance", "legal"].map((dimension) => [`cro03c-cert-${dimension}`, CRO03C_TEST_PUBLIC_KEY]),
));
process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS = JSON.stringify({
  "cro03c-cert-deployment": CRO03C_TEST_PUBLIC_KEY,
});
await assertDisposableTestInfrastructure({
  operation: "CRO-03C integration certification", requireRedis: true, reserveRedisNamespace: true,
}).then(async (infrastructure) => {
  try {
    applyCertificationProviderDenyBoundary({ fatal: true });
    const { db } = await import("../server/db");
    const { createCro03SourceBatch } = await import("../server/services/cro03/source-staging");
    const { createCro03aQualificationRun, processCro03aQualificationRunQueueSafe } =
      await import("../server/services/cro03a/qualification-service");
    const {
      createCro03cInitialRollout, cancelCro03cCommand, settleCro03cProviderOperation,
      assertCro03cAuthorityBeforeIo, CRO03C_PROVIDER_CONTRACTS, CRO03C_MIGRATION_HEAD,
      CRO03C_RECIPE_HASH, CRO03C_RECIPE_VERSION, CRO03C_REQUIRED_APPROVALS,
      revokeCro03cApprovalReceipt,
       assertCro03cDeploymentAuthorityBeforeIo,
       authorizeCro03cValidation,
    } = await import("../server/services/cro03/live-execution");
    const { createValidationIntent, hashEmailToken, processValidationIntent } =
      await import("../server/services/provider-readiness-control");
    const { CRO03B_UNIFIED_RECIPE } = await import("../server/services/cro03/recipe-contract");
    const {
      canonicalCro03cApprovalPayload, CRO03C_APPROVAL_ARTIFACT_VERSION,
    } = await import("../server/services/cro03/approval-artifact");
    const {
      canonicalCro03cDeploymentInventory, importCro03cDeploymentInventory,
      revokeCro03cDeploymentInventory, verifyCro03cDeploymentInventory,
      CRO03C_DEPLOYMENT_INVENTORY_VERSION,
    } = await import("../server/services/cro03/deployment-inventory");
    const { publishCro03cWorkerHeartbeat, cro03cHeartbeatKey } =
      await import("../server/services/cro03/runtime-heartbeat");
    const { getRedisConnection, getBullMqTestPrefix } =
      await import("../server/services/queue-connection");
    const { invalidatePauseStateCache } = await import("../server/services/outbound-pause-authority");
    const {
      claimNextCro03cGenerationForTest, dispatchCro03cLive,
    } = await import("../server/services/cro03/live-worker");
    const { hashCro03Evidence } = await import("../server/services/cro03/source-staging");

    const rows = (result: any): any[] => result?.rows ?? result ?? [];
    const run = crypto.randomUUID();
    const hash = (label: string) => hashCro03Evidence({ certification: "cro03c", run, label });
    const migrationRelations = rows(await db.execute(sql`
      SELECT to_regclass('public.cro03c_commands') AS commands,
             to_regclass('public.cro03c_stage_operations') AS operations,
             to_regclass('public.cro03c_dispatch_checkpoints') AS checkpoints,
             to_regclass('public.cro03c_approval_receipts') AS approval_receipts,
              to_regclass('public.cro03c_initial_subjects') AS initial_subjects,
               to_regclass('public.cro03c_stage_input_references') AS stage_input_references,
                to_regclass('public.cro03c_deployment_inventories') AS deployment_inventories,
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='cro03c_validation_revocations'
                    AND column_name='disposition'
               ) AS validation_cap_release
    `))[0];
    assert(migrationRelations?.commands && migrationRelations?.operations && migrationRelations?.checkpoints &&
      migrationRelations?.approval_receipts && migrationRelations?.initial_subjects &&
      migrationRelations?.stage_input_references && migrationRelations?.validation_cap_release &&
      migrationRelations?.deployment_inventories,
    "migrations 0195 through 0201 must provide the CRO-03C durable dispatch, validation-cap, and deployment journal");
    const adminId = `cro03c-cert-admin-${run}`;
    await db.execute(sql`
      INSERT INTO users(id,email,role,auth_provider,created_at,updated_at)
      VALUES (${adminId},${`${run}@cro03c.example.test`},'admin','test',NOW(),NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    const admin = { id: adminId };
    await db.execute(sql`
      INSERT INTO outbound_pause_control(state,reason,epoch,actor)
      SELECT 'paused','CRO03C certification',1,'cro03c-certification'
       WHERE NOT EXISTS (SELECT 1 FROM outbound_pause_control)
    `);
    await db.execute(sql`UPDATE outbound_pause_control SET state='paused',epoch=epoch+1,committed_at=NOW()`);
    invalidatePauseStateCache();
    const pauseEpoch = Number(rows(await db.execute(sql`
      SELECT epoch FROM outbound_pause_control ORDER BY id LIMIT 1
    `))[0].epoch);

    async function handoff(ordinal: number): Promise<string> {
      const subjectKey = `cro03c-cert-${run}-${ordinal}`;
      await createCro03SourceBatch({
        idempotencyKey: `cro03c-cert-source:${run}:${ordinal}`, actorType: "system",
        actorId: "cro03c-certification", purpose: "staging_review",
        subjects: [{
          subjectType: "prospect", subjectKey, sourceSystem: "prospects",
          sourceObservedAt: new Date().toISOString(), sourceEventKey: `cro03c-cert-event:${run}:${ordinal}`,
          timestampProvenance: "source", provenance: { certification: true },
          payload: { businessName: `CRO03C ${ordinal}`, website: `https://${subjectKey}.example.test`,
            email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
            city: "Miami", state: "FL", county: "Miami-Dade", industry: "Auto", entityStatus: "active" },
          candidateValues: { business_name: `CRO03C ${ordinal}`, website: `https://${subjectKey}.example.test`,
            email: `${subjectKey}@example.test`, phone: "3055550199", address: "100 Test Way",
            city: "Miami", state: "FL", category: "Auto", entity_status: "active" },
        }],
      });
      const occurrence = rows(await db.execute(sql`
        SELECT id FROM cro03_source_occurrences WHERE source_event_key=${`cro03c-cert-event:${run}:${ordinal}`}
      `))[0];
      const qualification = await createCro03aQualificationRun({
        idempotencyKey: `cro03c-cert-qualification:${run}:${ordinal}`, occurrenceIds: [occurrence.id],
        actorId: String(admin.id), actorRole: "admin",
      });
      await processCro03aQualificationRunQueueSafe(qualification.id);
      const result = rows(await db.execute(sql`
        SELECT id FROM cro03a_handoffs WHERE run_id=${qualification.id}::uuid
      `))[0];
      assert(result, "source fixture must produce an eligible CRO-03A handoff");
      return String(result.id);
    }

    const handoffs = await Promise.all([0, 1, 2, 3, 4].map(handoff));
    const policyId = crypto.randomUUID();
    const attestationId = crypto.randomUUID();
    const now = new Date();
    const expiry = new Date(now.getTime() + 10 * 60_000);
    const priceSchedules = Object.fromEntries(Object.entries(CRO03C_PROVIDER_CONTRACTS).map(([provider, contract]) => [
      provider,
      {
        version: 1,
        unitType: contract.unitType,
        currency: contract.currency,
        amountMicros: contract.billingSemantics === "not_billable" ? 0 : 1,
        billingSemantics: contract.billingSemantics,
      },
    ]));
    const stagePlanHash = stableCro03RecipeHash(CRO03B_UNIFIED_RECIPE.steps.map((step) => ({
      id: step.id, provider: step.provider, accountingOwner: step.accountingOwner,
    })));
    // Receipt scope is server-derived, not a fixture-defined approval scope.
    // Keep this byte-for-byte aligned with cro03cApprovalScope in live-execution.
    const approvalScope = {
      policyKey: "cro03c_live_activation",
      recipeVersion: CRO03C_RECIPE_VERSION,
      recipeHash: CRO03C_RECIPE_HASH,
      stagePlanHash,
      migrationHead: CRO03C_MIGRATION_HEAD,
      releaseSha: process.env.RELEASE_SHA ?? "",
      priceSchedules,
    };
    const approvalScopeHash = stableCro03RecipeHash(approvalScope);
    const receiptIds = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension) => [
      dimension, crypto.randomUUID(),
    ])) as Record<(typeof CRO03C_REQUIRED_APPROVALS)[number], string>;
    const approvalEvidence = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension) => [
      dimension,
      {
        approvalId: receiptIds[dimension],
        version: 1,
        approvedBy: `cro03c-cert-${dimension}`,
        approvedAt: now.toISOString(),
        scopeHash: approvalScopeHash,
      },
    ]));
    for (const dimension of CRO03C_REQUIRED_APPROVALS) {
      const idempotencyKey = `cro03c-cert-approval:${run}:${dimension}`;
      const issuerId = `cro03c-cert-${dimension}`;
      const signedPayload = {
        artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
        receiptId: receiptIds[dimension],
        idempotencyKey,
        issuerId,
        dimension,
        scope: approvalScope,
        scopeHash: approvalScopeHash,
        issuedAt: now.toISOString(),
        expiresAt: expiry.toISOString(),
      };
      const signature = crypto.sign(
        null, Buffer.from(canonicalCro03cApprovalPayload(signedPayload), "utf8"), CRO03C_TEST_PRIVATE_KEY,
      ).toString("base64");
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
      VALUES (${policyId}::uuid,${`cro03c-cert-policy:${run}`},'cro03c_live_activation',1,
              ${JSON.stringify(approvalScope)}::jsonb,${hash("policy")},${JSON.stringify(priceSchedules)}::jsonb,
              ${JSON.stringify(approvalEvidence)}::jsonb,
              'approved',1,'certification',${String(admin.id)})
    `);
    const inventoryId = crypto.randomUUID();
    const deploymentIdentity = "certification";
    const environmentIdentity = "test";
    const queueTopologyHash = "d".repeat(64);
    const workerIdentities = [`cro03c-cert-worker:${run}`];
    const workerBootIdentity = `cro03c-cert-boot:${run}`;
    const capturedHeartbeatAt = new Date(now.getTime() - 61_000);
    const inventoryPayload = {
      artifactVersion: CRO03C_DEPLOYMENT_INVENTORY_VERSION,
      inventoryId,
      issuerId: "cro03c-cert-deployment",
      deploymentIdentity,
      environmentIdentity,
      releaseSha: process.env.RELEASE_SHA!,
      queueTopologyHash,
      identityKind: "worker" as const,
      workerIdentities,
      expectedCount: workerIdentities.length,
      issuedAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
    };
    const inventoryArtifact = {
      payload: inventoryPayload,
      signature: crypto.sign(
        null, Buffer.from(canonicalCro03cDeploymentInventory(inventoryPayload), "utf8"),
        CRO03C_TEST_PRIVATE_KEY,
      ).toString("base64"),
    };
    await importCro03cDeploymentInventory({
      artifact: inventoryArtifact, actorId: String(admin.id), reason: "CRO-03C disposable certification",
    });
    const redis = await getRedisConnection() as any;
    const redisPrefix = getBullMqTestPrefix();
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: workerIdentities[0],
      bootIdentity: workerBootIdentity, queueTopologyHash, timestamp: now.toISOString(),
    });
    await db.execute(sql`
      INSERT INTO cro03c_runtime_attestations
        (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,web_boot_identity,
         worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,expires_at,attestation_hash,created_by)
      VALUES (${attestationId}::uuid,${`cro03c-cert-attestation:${run}`},${inventoryId}::uuid,
              ${JSON.stringify(workerIdentities)}::jsonb,${process.env.RELEASE_SHA},
              ${CRO03C_MIGRATION_HEAD},${deploymentIdentity},${environmentIdentity},'web-cert',${workerBootIdentity},
               ${queueTopologyHash},${capturedHeartbeatAt}::timestamptz,TRUE,TRUE,
               ${expiry}::timestamptz,${hash("attestation")},${String(admin.id)})
    `);
    // The immutable attestation capture heartbeat is over a minute old, while
    // the exact current Redis fleet member is fresh. Pre-I/O authority must
    // use that current fleet scan rather than treating capture evidence as a
    // second, shorter attestation expiration.
    await assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId });
    const heartbeatKey = cro03cHeartbeatKey(redisPrefix, workerBootIdentity);
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: workerIdentities[0],
      bootIdentity: workerBootIdentity, queueTopologyHash,
      timestamp: new Date(now.getTime() - 61_000).toISOString(),
    });
    await assert.rejects(
      assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId }),
      /CRO03C_WORKER_FLEET_INVALID/,
      "a stale matching Redis heartbeat revokes pre-I/O deployment authority",
    );
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: workerIdentities[0],
      bootIdentity: workerBootIdentity, queueTopologyHash, timestamp: new Date().toISOString(),
    });
    await redis.del(heartbeatKey);
    await assert.rejects(
      assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId }),
      /CRO03C_WORKER_FLEET_(?:INVALID|SCAN_INCOMPLETE)/,
      "missing heartbeat revokes pre-I/O deployment authority",
    );
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: workerIdentities[0],
      bootIdentity: workerBootIdentity, queueTopologyHash, timestamp: new Date().toISOString(),
    });
    const mixedBoot = `cro03c-cert-mixed-boot:${run}`;
    await publishCro03cWorkerHeartbeat(redis, redisPrefix, {
      releaseSha: process.env.RELEASE_SHA!, processIdentity: `cro03c-cert-mixed-worker:${run}`,
      bootIdentity: mixedBoot, queueTopologyHash, timestamp: new Date().toISOString(),
    });
    await assert.rejects(
      assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId }),
      /CRO03C_WORKER_FLEET_(?:INVALID|SCAN_INCOMPLETE)/,
      "mixed fleet membership revokes pre-I/O deployment authority",
    );
    await redis.del(cro03cHeartbeatKey(redisPrefix, mixedBoot));
    const trustedDeployments = process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS;
    process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS = "{}";
    await assert.rejects(
      assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId }),
      /CRO03C_DEPLOYMENT_INVENTORY_REVOKED/,
      "removing the issuer trust root revokes pre-I/O deployment authority",
    );
    process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS = trustedDeployments;
    const expiredInventory = {
      ...inventoryPayload, inventoryId: crypto.randomUUID(),
      issuedAt: new Date(now.getTime() - 120_000).toISOString(),
      expiresAt: new Date(now.getTime() - 60_000).toISOString(),
    };
    const expiredArtifact = {
      payload: expiredInventory,
      signature: crypto.sign(null, Buffer.from(canonicalCro03cDeploymentInventory(expiredInventory), "utf8"),
        CRO03C_TEST_PRIVATE_KEY).toString("base64"),
    };
    await assert.rejects(
      Promise.resolve().then(() => verifyCro03cDeploymentInventory(expiredArtifact)),
      /CRO03C_DEPLOYMENT_INVENTORY_EXPIRED/,
      "expired signed deployment inventory is denied",
    );
    const revokedInventory = crypto.randomUUID();
    const revokedPayload = { ...inventoryPayload, inventoryId: revokedInventory };
    const revokedArtifact = {
      payload: revokedPayload,
      signature: crypto.sign(null, Buffer.from(canonicalCro03cDeploymentInventory(revokedPayload), "utf8"),
        CRO03C_TEST_PRIVATE_KEY).toString("base64"),
    };
    await importCro03cDeploymentInventory({
      artifact: revokedArtifact, actorId: String(admin.id), reason: "revocation fixture",
    });
    await revokeCro03cDeploymentInventory({
      inventoryId: revokedInventory, idempotencyKey: `cro03c-cert-revoke:${run}`,
      reason: "revocation fixture", actorId: String(admin.id),
    });
    const revokedAttestationId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO cro03c_runtime_attestations
        (id,idempotency_key,inventory_id,worker_identities,artifact_sha,migration_head,deployment_identity,environment_identity,
         web_boot_identity,worker_boot_identity,queue_topology_hash,worker_heartbeat_at,db_healthy,redis_healthy,
         expires_at,attestation_hash,created_by)
      VALUES (${revokedAttestationId}::uuid,${`cro03c-cert-revoked-attestation:${run}`},${revokedInventory}::uuid,
              ${JSON.stringify(workerIdentities)}::jsonb,${process.env.RELEASE_SHA},${CRO03C_MIGRATION_HEAD},
              ${deploymentIdentity},${environmentIdentity},'web-cert',${workerBootIdentity},${queueTopologyHash},
              NOW(),TRUE,TRUE,${expiry}::timestamptz,${hash("revoked-attestation")},${String(admin.id)})
    `);
    await assert.rejects(
      assertCro03cDeploymentAuthorityBeforeIo({
        runtimeAttestationId: revokedAttestationId, inventoryId: revokedInventory,
      }),
      /CRO03C_DEPLOYMENT_INVENTORY_REVOKED/,
      "revoked inventory is denied while the primary signed inventory remains valid",
    );
    await assertCro03cDeploymentAuthorityBeforeIo({ runtimeAttestationId: attestationId, inventoryId });

    async function fixture(
      handoffId: string,
      stages: Array<[string, string]> = [["internal-source", "eligible"]],
      commandType: "micro_canary" | "initial_batch" = "micro_canary",
      authority: { policyId: string; revision: number; approvals: Record<string, unknown> } = {
        policyId, revision: 1, approvals: approvalEvidence,
      },
    ) {
      const commandId = crypto.randomUUID(), runId = crypto.randomUUID(), generationId = crypto.randomUUID();
      const snapshotHash = hash(`snapshot:${commandId}`);
      const commandCaps = commandType === "initial_batch" ? {
        provider: null, maxUnits: 0, maxAmountMicros: 0,
        validationMaxUnits: 1,
        validationMaxAmountMicros: Number(priceSchedules.zerobounce.amountMicros),
        validationPriceScheduleVersion: Number(priceSchedules.zerobounce.version),
        validationPriceScheduleHash: stableCro03RecipeHash(priceSchedules.zerobounce),
      } : {};
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO cro03c_commands
            (id,command_key,idempotency_key,command_type,actor_id,activation_policy_id,activation_revision,recipe_version,
             recipe_hash,stage_plan_hash,runtime_attestation_id,caps,stop_policy_hash,approval_evidence,expires_at,reason,pre_pause_epoch)
          VALUES (${commandId}::uuid,${`cro03c-cert-command:${commandId}`},${`cro03c-cert-key:${commandId}`},
                   ${commandType},${String(admin.id)},${authority.policyId}::uuid,${authority.revision},${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},${stagePlanHash},
                   ${attestationId}::uuid,${JSON.stringify(commandCaps)}::jsonb,${hash("stop")},${JSON.stringify(authority.approvals)}::jsonb,${expiry}::timestamptz,'certification',${String(pauseEpoch)})
        `);
        await tx.execute(sql`INSERT INTO cro03c_runs(id,command_id,run_key,mode) VALUES
          (${runId}::uuid,${commandId}::uuid,${`cro03c-cert-run:${runId}`},'cro03c_live_v1')`);
        const snapshot = rows(await tx.execute(sql`
          INSERT INTO cro03c_no_outbound_snapshots(command_id,run_id,phase,snapshot_hash,counters)
          VALUES (${commandId}::uuid,${runId}::uuid,'pre_run',${snapshotHash},
                  ${JSON.stringify({ pauseEpoch })}::jsonb) RETURNING id
        `))[0];
        await tx.execute(sql`UPDATE cro03c_commands SET pre_run_snapshot_id=${snapshot.id}::uuid WHERE id=${commandId}::uuid`);
        await tx.execute(sql`
          INSERT INTO cro03c_generations
            (id,handoff_id,recipe_version,recipe_hash,activation_revision,command_id,run_id,frozen_handoff_hash,
             stage_plan_hash,cohort_hash,runtime_attestation_id)
                   VALUES (${generationId}::uuid,${handoffId}::uuid,${CRO03C_RECIPE_VERSION},${CRO03C_RECIPE_HASH},${authority.revision},${commandId}::uuid,${runId}::uuid,
                  ${hash(`handoff:${handoffId}`)},${stagePlanHash},${hash(`cohort:${handoffId}`)},${attestationId}::uuid)
        `);
        const observation = rows(await tx.execute(sql`
          SELECT o.id,o.payload_hash
            FROM cro03a_handoffs h
            JOIN cro03_source_occurrences occurrence
              ON occurrence.id=ANY(ARRAY(SELECT jsonb_array_elements_text(h.occurrence_ids)::uuid))
            JOIN cro03_source_observations o ON o.id=occurrence.source_observation_id
           WHERE h.id=${handoffId}::uuid
           ORDER BY occurrence.source_observed_at DESC,occurrence.id DESC LIMIT 1
        `))[0];
        for (const [stageKey, disposition] of stages) {
          const evidenceHash = hash(`evidence:${stageKey}`);
          let referenceId: string | null = null;
          if (disposition === "eligible") {
            referenceId = crypto.randomUUID();
            await tx.execute(sql`
              INSERT INTO cro03c_stage_input_references
                (id,generation_id,stage_key,source_observation_id,source_payload_hash,evidence_hash,provider,
                 price_schedule_version,price_schedule_hash,reserved_units,units_hash,cap_hash)
              VALUES (${referenceId}::uuid,${generationId}::uuid,${stageKey},${observation.id}::uuid,
                      ${observation.payload_hash},${evidenceHash},'internal_source',1,
                      ${stableCro03RecipeHash(priceSchedules.internal_source)},0,
                      ${hashCro03Evidence({ provider: "internal_source", reservedUnits: 0 })},
                      ${hashCro03Evidence({ maxUnits: 0, maxAmountMicros: 0 })})
            `);
          }
          await tx.execute(sql`
            INSERT INTO cro03c_stage_dispositions
              (generation_id,stage_key,disposition,input_hash,evidence_hash,recipe_hash,policy_hash,reason_code,stage_input_reference_id)
            VALUES (${generationId}::uuid,${stageKey},${disposition},${hash(`input:${stageKey}`)},${evidenceHash},
                    ${hash(`recipe:${stageKey}`)},${hash("policy")},${disposition},${referenceId}::uuid)
          `);
        }
      });
      return { commandId, runId, generationId, snapshotHash };
    }

    const concurrent = await Promise.all([fixture(handoffs[0]), fixture(handoffs[1])]);
    const [claimA, claimB] = await Promise.all(concurrent.map(({ commandId }) => claimNextCro03cGenerationForTest(commandId)));
    assert(claimA && claimB && claimA.generation_id !== claimB.generation_id, "concurrent SKIP LOCKED claims are distinct");
    await db.execute(sql`UPDATE cro03c_generations SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=${claimA!.generation_id}::uuid`);
    const recovered = await claimNextCro03cGenerationForTest(claimA!.command_id);
    assert(recovered && recovered.claim_token !== claimA!.claim_token && recovered.execution_fence > claimA!.execution_fence,
      "expired lease is recovered with a new fenced claim");

    const cancelled = await fixture(handoffs[2]);
    const claim = await claimNextCro03cGenerationForTest(cancelled.commandId);
    assert(claim);
    const cancellation = await cancelCro03cCommand({
      commandId: cancelled.commandId,
      actorId: String(admin.id),
      idempotencyKey: `cro03c-cert-cancel:${run}`,
      expectedRevision: 1,
      reason: "certification cancellation",
    });
    assert.equal(cancellation.replayed, false);
    await assert.rejects(assertCro03cAuthorityBeforeIo({
      kind: "cro03c_live", provider: "internal_source", activationRevision: 1, generationId: claim!.generation_id,
      commandId: claim!.command_id, runId: claim!.run_id, stageKey: "internal-source", claimToken: claim!.claim_token,
      executionFence: claim!.execution_fence, runtimeAttestationId: attestationId, expiresAt: expiry,
      noOutboundSnapshotHash: cancelled.snapshotHash, caller: "server/services/cro03/live-worker.ts",
    }), /CRO03C_AUTHORITY_REVOKED/);

    const skipped = await fixture(handoffs[3], [["internal-source", "skipped_not_applicable"]]);
    assert.equal(await dispatchCro03cLive(skipped.commandId), "completed");
    assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM cro03c_stage_operations
      WHERE generation_id=${skipped.generationId}::uuid`))[0].n), 0, "skipped stages create zero operations");

    const settlement = await fixture(handoffs[4], [["internal-source", "eligible"]], "initial_batch");
    const operation = rows(await db.execute(sql`
      INSERT INTO cro03c_stage_operations(generation_id,command_id,run_id,stage_key,provider,operation_type,operation_key,
        caller,unit_type,currency,price_schedule_version,price_schedule_hash,max_reserved_units,max_reserved_amount_micros)
      VALUES (${settlement.generationId}::uuid,${settlement.commandId}::uuid,${settlement.runId}::uuid,'internal-source',
        'internal_source','evidence_receipt',${`cro03c-cert-settlement:${run}`},'server/services/cro03/live-worker.ts',
        'none','USD',1,${stableCro03RecipeHash(priceSchedules.internal_source)},0,0) RETURNING id
    `))[0];
    const settled = { operationId: String(operation.id), outcome: "success", settledUnits: 0, settledAmountMicros: 0,
      billingCertainty: "none" as const, evidenceHash: hash("settlement") };
    const [first, replay] = await Promise.all([settleCro03cProviderOperation(settled), settleCro03cProviderOperation(settled)]);
    assert(first.receiptId === replay.receiptId, "settlement converges to one immutable receipt");

    const ambiguous = await fixture(await handoff(5));
    await db.execute(sql`INSERT INTO cro03c_stage_operations(generation_id,command_id,run_id,stage_key,provider,operation_type,
      operation_key,caller,unit_type,currency,price_schedule_version,price_schedule_hash,dispatch_state,state,reconciliation_required)
      VALUES (${ambiguous.generationId}::uuid,${ambiguous.commandId}::uuid,${ambiguous.runId}::uuid,'internal-source',
      'internal_source','evidence_receipt',${`cro03c-cert-ambiguous:${run}`},'server/services/cro03/live-worker.ts','none','USD',
        1,${stableCro03RecipeHash(priceSchedules.internal_source)},'ambiguous','quarantined',TRUE)`);
    await assert.rejects(dispatchCro03cLive(ambiguous.commandId), /CRO03C_DISPATCH_RECONCILIATION_REQUIRED/);
    assert.equal(Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM cro03c_dispatch_checkpoints
      WHERE stage_operation_id=(SELECT id FROM cro03c_stage_operations WHERE operation_key=${`cro03c-cert-ambiguous:${run}`})`))[0].n), 0,
      "ambiguous dispatch is never replayed");

    const epochMismatch = await fixture(await handoff(6), [["internal-source", "skipped_not_applicable"]]);
    await db.execute(sql`UPDATE outbound_pause_control SET epoch=epoch+1,committed_at=NOW()`);
    invalidatePauseStateCache();
    await assert.rejects(dispatchCro03cLive(epochMismatch.commandId), /CRO03C_OUTBOUND_EPOCH_CHANGED/);
    assert.equal(Number(rows(await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM cro03c_no_outbound_snapshots
       WHERE command_id=${epochMismatch.commandId}::uuid AND phase='post_run'
    `))[0].n), 0, "an outbound epoch mismatch never writes a successful post-run snapshot");

    await assert.rejects(createCro03cInitialRollout({ commandId: settlement.commandId, activationRevision: 1,
      cohortHash: hash("rollout"), generationIds: [] }), /CRO03C_INITIAL_BATCH_SCOPE_INVALID/);
    await assert.rejects(createCro03cInitialRollout({ commandId: settlement.commandId, activationRevision: 1,
      cohortHash: hash("rollout"), generationIds: Array.from({ length: 101 }, () => settlement.generationId) }),
      /CRO03C_INITIAL_BATCH_SCOPE_INVALID/);
    await createCro03cInitialRollout({ commandId: settlement.commandId, activationRevision: 1,
      cohortHash: hash("rollout"), generationIds: [settlement.generationId] });
    await assert.rejects(createCro03cInitialRollout({ commandId: skipped.commandId, activationRevision: 1,
      cohortHash: hash("different-rollout"), generationIds: [skipped.generationId] }), /CRO03C_INITIAL_ROLLOUT_ALREADY_CONSUMED/);

    // Validation has a durable intent claim, not a CRO03C stage claim. These
    // races prove that its independently-authorized provider path still
    // revalidates all command authority before it can reserve or call a
    // provider.
    const savedZeroBounceControl = rows(await db.execute(sql`
      SELECT enabled,circuit_state,local_budget_units,reserved_units,consumed_units,version
        FROM provider_controls WHERE provider='zerobounce'
    `))[0];
    await db.execute(sql`
      INSERT INTO provider_controls
        (provider,capability,enabled,circuit_state,local_budget_units,reserved_units,consumed_units,version,updated_at)
      VALUES ('zerobounce','email_validation',TRUE,'closed',100,0,0,1,NOW())
      ON CONFLICT (provider) DO UPDATE SET enabled=TRUE,circuit_state='closed',
        local_budget_units=100,reserved_units=0,consumed_units=0,version=1,updated_at=NOW()
    `);
    async function authorizedValidationFixture(
      label: string,
      authority?: { policyId: string; revision: number; approvals: Record<string, unknown> },
    ) {
      const current = await fixture(await handoff(8 + (label === "superseded" ? 0 : 1)),
        [["internal-source", "eligible"]], "initial_batch", authority);
      const generationClaim = await claimNextCro03cGenerationForTest(current.commandId);
      assert(generationClaim, "validation fixture must have a current generation claim");
      const email = `cro03c-validation-${run}-${label}@example.test`;
      const emailHash = hashEmailToken(email);
      assert(emailHash, "validation fixture email must normalize");
      const contact = rows(await db.execute(sql`
        INSERT INTO contacts(first_name,last_name,email,phone,email_token_hash,email_mutation_generation)
        VALUES ('CRO03C','Validation',${email},'5550100000',${emailHash},1) RETURNING id
      `))[0];
      await db.transaction((tx) => createValidationIntent(tx, {
        contactId: Number(contact.id), email, generation: 1, purpose: "cro03_winning_email",
      }));
      const intent = rows(await db.execute(sql`
        SELECT id FROM validation_intents
         WHERE contact_id=${Number(contact.id)} AND normalized_email_token_hash=${emailHash}
           AND subject_generation=1 AND purpose='cro03_winning_email'
      `))[0];
      await authorizeCro03cValidation({
        intentId: String(intent.id), commandId: current.commandId, runId: current.runId,
        generationId: current.generationId, activationRevision: authority?.revision ?? 1, contactId: Number(contact.id),
        normalizedEmailHash: emailHash, subjectGeneration: 1, runtimeAttestationId: attestationId,
        expiresAt: expiry,
      });
      return { ...current, intentId: String(intent.id) };
    }
    async function assertValidationAuthorityRace(intentId: string, label: string) {
      const beforeOperations = Number(rows(await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM provider_operations WHERE provider='zerobounce'
      `))[0].n);
      const beforeAttempts = Number(rows(await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM provider_attempts a
          JOIN provider_operations o ON o.id=a.operation_id WHERE o.provider='zerobounce'
      `))[0].n);
      let transportCalls = 0;
      assert.equal(await processValidationIntent(intentId, {
        verifyEmail: async () => {
          transportCalls++;
          return { status: "valid", outcome: "completed" };
        },
      }), "failed", `${label} authority race blocks validation`);
      assert.equal(transportCalls, 0, `${label} authority race reaches no transport`);
      assert.equal(Number(rows(await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM provider_operations WHERE provider='zerobounce'
      `))[0].n), beforeOperations, `${label} authority race creates no provider operation`);
      assert.equal(Number(rows(await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM provider_attempts a
          JOIN provider_operations o ON o.id=a.operation_id WHERE o.provider='zerobounce'
      `))[0].n), beforeAttempts, `${label} authority race creates no provider attempt`);
      assert.equal(String(rows(await db.execute(sql`
        SELECT state FROM validation_intents WHERE id=${intentId}::uuid
      `))[0].state), "blocked", `${label} authority race terminalizes as blocked`);
    }
    try {
      // Race A: a receipt revoked after durable validation authorization but
      // before the worker claim makes every validation checkpoint fail closed.
      const approvalRevoked = await authorizedValidationFixture("approval-revoked");
      await revokeCro03cApprovalReceipt({
        receiptId: receiptIds.legal, idempotencyKey: `cro03c-cert-race-revoke:${run}`,
        expectedRevision: 1, reason: "validation race receipt revocation", actorId: String(admin.id),
      });
      await assertValidationAuthorityRace(approvalRevoked.intentId, "revoked-approval");

      // Build a new, independently signed revision after Race A so the
      // supersession test starts from wholly current approval authority.
      const revisionTwoReceipts = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension) => [
        dimension, crypto.randomUUID(),
      ])) as Record<(typeof CRO03C_REQUIRED_APPROVALS)[number], string>;
      const revisionTwoApprovals = Object.fromEntries(CRO03C_REQUIRED_APPROVALS.map((dimension) => [
        dimension, {
          approvalId: revisionTwoReceipts[dimension], version: 1,
          approvedBy: `cro03c-cert-${dimension}`, approvedAt: now.toISOString(), scopeHash: approvalScopeHash,
        },
      ]));
      for (const dimension of CRO03C_REQUIRED_APPROVALS) {
        const signedPayload = {
          artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION, receiptId: revisionTwoReceipts[dimension],
          idempotencyKey: `cro03c-cert-race-approval:${run}:${dimension}`,
          issuerId: `cro03c-cert-${dimension}`, dimension, scope: approvalScope, scopeHash: approvalScopeHash,
          issuedAt: now.toISOString(), expiresAt: expiry.toISOString(),
        };
        const signature = crypto.sign(null, Buffer.from(canonicalCro03cApprovalPayload(signedPayload), "utf8"),
          CRO03C_TEST_PRIVATE_KEY).toString("base64");
        await db.execute(sql`
          INSERT INTO cro03c_approval_receipts
            (id,idempotency_key,dimension,issuer_id,issuer_receipt_id,scope,scope_hash,issued_at,expires_at,signature,created_by)
          VALUES (${revisionTwoReceipts[dimension]}::uuid,${signedPayload.idempotencyKey},${signedPayload.dimension},${signedPayload.issuerId},
                  ${revisionTwoReceipts[dimension]},${JSON.stringify(approvalScope)}::jsonb,
                  ${approvalScopeHash},${now}::timestamptz,${expiry}::timestamptz,${signature},${String(admin.id)})
        `);
      }
      const revisionTwoPolicyId = crypto.randomUUID();
      await db.execute(sql`
        INSERT INTO cro03c_activation_policies
          (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
        VALUES (${revisionTwoPolicyId}::uuid,${`cro03c-cert-race-policy-2:${run}`},'cro03c_live_activation',2,
                ${JSON.stringify(approvalScope)}::jsonb,${hash("race-policy-2")},${JSON.stringify(priceSchedules)}::jsonb,
                ${JSON.stringify(revisionTwoApprovals)}::jsonb,'approved',2,'supersession race authority',${String(admin.id)})
      `);
      // Race B: a valid revision-2 authorization is invalidated by revision 3
      // before processValidationIntent reaches its claim checkpoint.
      const superseded = await authorizedValidationFixture("superseded", {
        policyId: revisionTwoPolicyId, revision: 2, approvals: revisionTwoApprovals,
      });
      await db.execute(sql`
        INSERT INTO cro03c_activation_policies
          (id,idempotency_key,policy_key,version,policy,policy_hash,price_schedules,required_approvals,status,expected_revision,reason,created_by)
        VALUES (${crypto.randomUUID()}::uuid,${`cro03c-cert-race-policy-3:${run}`},'cro03c_live_activation',3,
                ${JSON.stringify(approvalScope)}::jsonb,${hash("race-policy-3")},${JSON.stringify(priceSchedules)}::jsonb,
                ${JSON.stringify(revisionTwoApprovals)}::jsonb,'approved',3,'supersession race trigger',${String(admin.id)})
      `);
      await assertValidationAuthorityRace(superseded.intentId, "superseded-policy");
    } finally {
      if (savedZeroBounceControl) {
        await db.execute(sql`
          UPDATE provider_controls
             SET enabled=${savedZeroBounceControl.enabled},circuit_state=${savedZeroBounceControl.circuit_state},
                 local_budget_units=${savedZeroBounceControl.local_budget_units},
                 reserved_units=${savedZeroBounceControl.reserved_units},consumed_units=${savedZeroBounceControl.consumed_units},
                 version=${savedZeroBounceControl.version},updated_at=NOW()
           WHERE provider='zerobounce'
        `);
      } else {
        await db.execute(sql`DELETE FROM provider_controls WHERE provider='zerobounce'`);
      }
    }
    const revoked = await fixture(await handoff(7));
    const revokedClaim = await claimNextCro03cGenerationForTest(revoked.commandId);
    assert(revokedClaim);
    await assert.rejects(assertCro03cAuthorityBeforeIo({
      kind: "cro03c_live", provider: "internal_source", activationRevision: 1,
      generationId: revokedClaim.generation_id, commandId: revokedClaim.command_id,
      runId: revokedClaim.run_id, stageKey: "internal-source", claimToken: revokedClaim.claim_token,
      executionFence: revokedClaim.execution_fence, runtimeAttestationId: attestationId, expiresAt: expiry,
      noOutboundSnapshotHash: revoked.snapshotHash, caller: "server/services/cro03/live-worker.ts",
    }), /CRO03C_AUTHORITY_REVOKED/);
    // P0 regression: canonical source plaintext must not be duplicated into
    // any CRO-03C relation, including JSON receipts and legacy frozen_input.
    const sourcePlaintext = [
      `CRO03C 0`, `https://cro03c-cert-${run}-0.example.test`,
      `cro03c-cert-${run}-0@example.test`, "3055550199", "100 Test Way",
    ];
    const cro03cTables = rows(await db.execute(sql`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name LIKE 'cro03c_%'
    `)).map((row) => String(row.table_name));
    for (const table of cro03cTables) {
      assert.match(table, /^cro03c_[a-z0-9_]+$/);
      for (const plaintext of sourcePlaintext) {
        const found = rows(await db.execute(sql`
          SELECT COUNT(*)::int AS n FROM ${sql.identifier(table)} t
           WHERE to_jsonb(t)::text LIKE ${`%${plaintext}%`}
        `))[0];
        assert.equal(Number(found?.n ?? 0), 0, `${table} must not retain canonical source plaintext`);
      }
    }
    console.log("PASS CRO-03C disposable claim, cancellation, recovery, settlement, singleton, and no-outbound certification");
  } finally {
    await infrastructure.releaseRedisReservation();
    const { getSharedRedisClientIfReady } = await import("../server/services/queue-connection");
    getSharedRedisClientIfReady()?.disconnect();
  }
});