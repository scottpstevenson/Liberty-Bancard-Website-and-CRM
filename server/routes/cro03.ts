import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { isDashboardUser } from "../replit_integrations/auth";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  cancelCro03Batch, createCro03Batch, getCro03BatchStatus, getCro03Reconciliation,
} from "../services/cro03/enrichment-factory";
import { CRO03_CANARY_DEFINITIONS } from "../services/cro03/routing-policy";
import {
  admitCro03bHandoffs, cancelCro03bCommand, CRO03B_MAX_HANDOFFS_PER_COMMAND,
  CRO03B_RECIPE_HASH, CRO03B_RECIPE_VERSION, getCro03bCommand, reviewAndProjectCro03bItem,
} from "../services/cro03/admission-service";
import { CRO03B_UNIFIED_RECIPE } from "../services/cro03/recipe-contract";
import {
  activateCro03aPolicy,
  cancelCro03aRun,
  createCro03aQualificationRun,
  getCro03aRun,
  getCro03aSourceCensus,
  previewCro03aQualification,
  stageCro03aSourceCensus,
} from "../services/cro03a/qualification-service";
import {
  cancelCro03cCommand,
  createCro03cActivationPolicy,
  createCro03cCommand,
  createCro03cRuntimeAttestation,
  getCro03cStatus,
  importCro03cApprovalArtifact,
  revokeCro03cApprovalReceipt,
} from "../services/cro03/live-execution";
import {
  importCro03cDeploymentInventory, revokeCro03cDeploymentInventory,
} from "../services/cro03/deployment-inventory";

const createBatchSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  contactIds: z.array(z.number().int().positive()).max(1000),
  purpose: z.enum(["provider_pre_spend", "internal_test"]).optional(),
}).strict();

const occurrenceScopeSchema = z.object({
  occurrenceIds: z.array(z.string().uuid()).min(1).max(500),
}).strict();
const qualificationRunSchema = occurrenceScopeSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();
const policyActivationSchema = z.object({
  policyId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(8).max(500),
}).strict();
const censusStageSchema = z.object({
  limitPerSource: z.number().int().min(1).max(500).optional(),
  // Client-generated idempotency key. Required so that:
  //  - Retries with the same key produce no additional rows (replayed).
  //  - A new staging run requires a new key (changed payload → new batch).
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();
const cro03bCommandSchema = z.object({
  handoffIds: z.array(z.string().uuid()).min(1).max(CRO03B_MAX_HANDOFFS_PER_COMMAND),
  reason: z.string().trim().min(8).max(500).optional(),
}).strict();
const cro03cActivationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(8).max(500),
  confirm: z.literal("ACTIVATE CRO03C LIVE POLICY"),
}).strict();
const cro03cReceiptReferencesSchema = z.object({
  receiptIds: z.object({
    operator: z.string().uuid(), data: z.string().uuid(), finance: z.string().uuid(), legal: z.string().uuid(),
  }).strict(),
}).strict();
const cro03cReceiptRevocationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(8).max(500),
  confirm: z.literal("REVOKE CRO03C APPROVAL RECEIPT"),
}).strict();
const cro03cApprovalArtifactImportSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(8).max(500),
  artifact: z.object({
    payload: z.object({
      artifactVersion: z.literal("cro03c-approval-ed25519-v1"),
      receiptId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(8).max(200),
      issuerId: z.string().trim().min(1).max(200),
      dimension: z.enum(["operator", "data", "finance", "legal"]),
      scope: z.record(z.string(), z.unknown()),
      scopeHash: z.string().regex(/^[0-9a-f]{64}$/),
      issuedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    }).strict(),
    signature: z.string().min(1).max(200),
  }).strict(),
}).strict();
const cro03cAttestationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  ttlMs: z.number().int().min(1000).max(15 * 60_000).optional(),
}).strict();
const cro03cDeploymentInventoryImportSchema = z.object({
  reason: z.string().trim().min(8).max(500),
  artifact: z.object({
    payload: z.object({
      artifactVersion: z.literal("cro03c-deployment-inventory-ed25519-v1"),
      inventoryId: z.string().uuid(),
      issuerId: z.string().trim().min(1).max(200),
      deploymentIdentity: z.string().trim().min(1).max(200),
      environmentIdentity: z.string().trim().min(1).max(200),
      releaseSha: z.string().regex(/^[0-9a-f]{40}$/),
      queueTopologyHash: z.string().regex(/^[0-9a-f]{64}$/),
      identityKind: z.enum(["worker", "ordinal"]),
      workerIdentities: z.array(z.string().trim().min(1).max(200)).min(1).max(1000),
      expectedCount: z.number().int().min(1).max(1000),
      issuedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
    }).strict(),
    signature: z.string().min(1).max(200),
  }).strict(),
}).strict();
const cro03cDeploymentInventoryRevocationSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(8).max(500),
  confirm: z.literal("REVOKE CRO03C DEPLOYMENT INVENTORY"),
}).strict();
const cro03cCommandBaseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedActivationRevision: z.number().int().positive(),
  runtimeAttestationId: z.string().uuid(),
  handoffIds: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().trim().min(8).max(500),
  expiresAt: z.coerce.date(),
  confirm: z.literal("I UNDERSTAND THIS MAY USE LIVE PROVIDERS"),
});
const cro03cCommandSchema = z.discriminatedUnion("commandType", [
  cro03cCommandBaseSchema.extend({
    commandType: z.literal("micro_canary"),
    provider: z.enum(["internal_source", "first_party_web", "rdap", "jsonld", "serper", "outscraper", "openai", "apollo", "zerobounce"]),
    maxUnits: z.number().int().nonnegative(),
    maxAmountMicros: z.number().int().nonnegative(),
  }).strict(),
  // Initial validation authority is derived exclusively from frozen membership
  // and the approved ZeroBounce schedule. Contact cap (validationMaxUnits) is
  // server-derived from handoffIds.length. Business email validation cap is
  // caller-supplied and independently enforced via a separate authorization table.
  cro03cCommandBaseSchema.extend({
    commandType: z.literal("initial_batch"),
    businessValidationMaxUnits: z.number().int().nonnegative().max(10_000).optional(),
  }).strict(),
]);
const cro03cCancelSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(8).max(500),
  confirm: z.literal(true),
}).strict();

function safeError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && /^CRO03(?:A|B|C)?_/.test(error.message)
    ? error.message : "CRO03_REQUEST_FAILED";
  return { code, message: "The enrichment command could not be accepted." };
}

async function canManageBatch(req: any, batchId: string): Promise<boolean> {
  if (req.user?.role === "admin") return true;
  const result: any = await db.execute(sql`
    SELECT actor_id AS "actorId" FROM cro03_enrichment_batches
    WHERE id = ${batchId}::uuid
  `);
  const batch = (result?.rows ?? result ?? [])[0];
  return Boolean(batch && batch.actorId && String(batch.actorId) === String(req.user?.id));
}

export function registerCro03Routes(app: Express): void {
  // Read-only diagnostic: reports the exact facts this process would use to look up
  // (or self-attest against) its CRO-03C deployment inventory. Exists because these
  // facts (deploymentIdentity in particular) are only knowable from inside the live
  // process — REPL_ID differs between the dev workspace and a published deployment,
  // and cannot be discovered from outside it. No secrets are exposed.
  // Also returns live worker identities from Redis (needed by the ceremony script
  // to construct a signed deployment inventory before calling runtime-attestations).
  /**
   * W06: Truthful runtime identity with separated discovery and verification.
   *
   * This route performs DISCOVERY — it scans all live heartbeats without
   * asserting they match a pre-determined expected list.  A non-empty
   * workerIdentities result proves workers exist; it does NOT certify that the
   * fleet is complete or matches the signed deployment inventory.
   *
   * Verification (expected-fleet check) is done by the offline ceremony script
   * which supplies an independent --expected-workers count and compares against
   * the observed list rather than using the observed list as the expectation.
   *
   * Off-mode CRM: a profile=off process correctly reports zero workers and a
   * healthy HTTP role.  Discovery returning zero workers must not trigger a
   * workerFleetComplete=false sentinel that blocks a separately governed ceremony
   * against a process that intentionally has no workers (e.g. a web-only replica).
   */
  // ── GET /api/admin/cro03c/gate-diagnostics ───────────────────────────────
  // Owner-only truthful diagnostic: reports every prerequisite for attestation
  // issuance (inventory, worker fleet, attestation, closed-gate reason) without
  // exposing secrets or key material.
  app.get("/api/admin/cro03c/gate-diagnostics", isDashboardUser, requireRole("admin"), async (_req, res) => {
    const { getCro03cQueueTopologyHash } = await import("../services/queue-manager");
    const { getSharedRedisClient, getBullMqTestPrefix } = await import("../services/queue-connection");
    const { readCro03cWorkerFleet } = await import("../services/cro03/runtime-heartbeat");

    const releaseSha = process.env.RELEASE_SHA ?? null;
    const deploymentIdentity = process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? null;
    const environmentIdentity = process.env.NODE_ENV ?? null;
    const queueTopologyHash = getCro03cQueueTopologyHash();

    // ── Inventory diagnostic ──────────────────────────────────────────────────
    type InventoryDiag = { present: boolean; inventoryId?: string; releaseShaMatch?: boolean; environmentMatch?: boolean; deploymentMatch?: boolean; topologyMatch?: boolean; workerIdentitiesInInventory?: string[]; expectedCount?: number; issuedAt?: string; expiresAt?: string; expired?: boolean; ambiguous?: boolean };
    let inventory: InventoryDiag = { present: false };
    try {
      const invRows: any[] = ((await db.execute(sql`
        SELECT i.id::text, i.release_sha, i.environment_identity, i.deployment_identity,
               i.queue_topology_hash, i.worker_identities, i.expected_count,
               i.issued_at::text, i.expires_at::text
          FROM cro03c_deployment_inventories i
          LEFT JOIN cro03c_deployment_inventory_revocations r ON r.inventory_id = i.id
         WHERE r.inventory_id IS NULL AND i.expires_at > NOW()
           AND i.deployment_identity  = ${deploymentIdentity ?? ""}
           AND i.environment_identity = ${environmentIdentity ?? ""}
           AND i.release_sha          = ${releaseSha ?? ""}
           AND i.queue_topology_hash  = ${queueTopologyHash}
         ORDER BY i.issued_at DESC LIMIT 2
      `)) as any).rows ?? [];
      if (invRows.length === 0) {
        inventory = { present: false };
      } else {
        const row = invRows[0];
        const rawIds = row.worker_identities;
        const ids: string[] = typeof rawIds === "string" ? JSON.parse(rawIds) : Array.isArray(rawIds) ? rawIds : [];
        inventory = {
          present: true,
          ambiguous: invRows.length > 1,
          inventoryId: String(row.id),
          releaseShaMatch: String(row.release_sha) === releaseSha,
          environmentMatch: String(row.environment_identity) === environmentIdentity,
          deploymentMatch: String(row.deployment_identity) === deploymentIdentity,
          topologyMatch: String(row.queue_topology_hash) === queueTopologyHash,
          workerIdentitiesInInventory: ids,
          expectedCount: Number(row.expected_count),
          issuedAt: String(row.issued_at),
          expiresAt: String(row.expires_at),
          expired: new Date(row.expires_at).getTime() <= Date.now(),
        };
      }
    } catch { inventory = { present: false }; }

    // ── Worker fleet diagnostic ───────────────────────────────────────────────
    type ReleaseShaWarning = { apiSha: string; workerSha: string; processIdentity: string };
    type FleetDiag = {
      present: boolean; count: number; identities?: string[];
      oldestHeartbeatAgeMs?: number; complete?: boolean; errorCode?: string;
      /** Unique release SHAs seen in live heartbeats */
      workerReleaseShas?: string[];
      /** true when any worker's SHA differs from the API SHA — warning only, not a gate failure */
      shaWarning?: boolean;
      shaWarnings?: ReleaseShaWarning[];
    };
    let workerFleet: FleetDiag = { present: false, count: 0 };
    try {
      const redis = getSharedRedisClient();
      if (redis && /^[0-9a-f]{40}$/i.test(releaseSha ?? "")) {
        const now = new Date();
        const fleet = await readCro03cWorkerFleet({
          redis, prefix: getBullMqTestPrefix(),
          expectedReleaseSha: releaseSha ?? "",
          expectedQueueTopologyHash: queueTopologyHash,
          expectedProcessIdentities: [],
          expectedEnvironmentIdentity: environmentIdentity ?? undefined,
          expectedDeploymentIdentity: deploymentIdentity ?? undefined,
          now,
        });
        const nowMs = now.getTime();
        let oldestAgeMs: number | undefined;
        if (fleet.heartbeats.length > 0) {
          oldestAgeMs = Math.max(...fleet.heartbeats.map((h) => nowMs - new Date(h.timestamp).getTime()));
        }
        const workerReleaseShas = [...new Set(fleet.heartbeats.map((h) => h.releaseSha))];
        const hasShaWarning = (fleet.releaseShaWarnings?.length ?? 0) > 0;
        workerFleet = {
          present: fleet.heartbeats.length > 0,
          count: fleet.heartbeats.length,
          identities: fleet.heartbeats.map((h) => h.processIdentity).sort(),
          oldestHeartbeatAgeMs: oldestAgeMs,
          complete: fleet.complete,
          workerReleaseShas,
          shaWarning: hasShaWarning,
          shaWarnings: fleet.releaseShaWarnings,
        };
      } else if (!redis) {
        workerFleet = { present: false, count: 0, errorCode: "REDIS_NOT_INITIALIZED" };
      } else {
        workerFleet = { present: false, count: 0, errorCode: "RELEASE_SHA_MISSING_OR_INVALID" };
      }
    } catch (err: any) {
      workerFleet = { present: false, count: 0, errorCode: err?.message?.slice(0, 100) };
    }

    // ── Attestation diagnostic ────────────────────────────────────────────────
    type AttestDiag = { present: boolean; attestationId?: string; capturedAt?: string; expiresAt?: string; reason: string };
    let attestation: AttestDiag = { present: false, reason: "NO_LIVE_RUNTIME_ATTESTATION" };
    try {
      const attestRow: any = ((await db.execute(sql`
        SELECT id::text, captured_at::text, expires_at::text
          FROM cro03c_runtime_attestations
         WHERE expires_at > NOW()
         ORDER BY captured_at DESC LIMIT 1
      `)) as any).rows?.[0];
      if (attestRow) {
        attestation = {
          present: true,
          attestationId: String(attestRow.id),
          capturedAt: String(attestRow.captured_at),
          expiresAt: String(attestRow.expires_at),
          reason: "OK",
        };
      }
    } catch { /* already set to missing */ }

    // ── Compute exact closed-gate reason ─────────────────────────────────────
    // NOTE: API/worker release SHA equality is DIAGNOSTIC EVIDENCE ONLY — a SHA
    // difference appears as shaWarning=true in workerFleet but is NOT a hard gate.
    // Hard gates: missing/invalid API SHA, missing/expired/ambiguous inventory,
    // environment mismatch, empty worker fleet, scan incomplete, no attestation.
    let closedGateReason: string | null = null;
    if (!releaseSha || !/^[0-9a-f]{40}$/i.test(releaseSha)) {
      closedGateReason = "RELEASE_SHA_MISSING_OR_INVALID";
    } else if (!inventory.present) {
      closedGateReason = inventory.ambiguous ? "INVENTORY_AMBIGUOUS" : "INVENTORY_MISSING";
    } else if (inventory.expired) {
      closedGateReason = "INVENTORY_EXPIRED";
    } else if (!inventory.environmentMatch) {
      closedGateReason = "INVENTORY_ENVIRONMENT_MISMATCH";
    } else if (!workerFleet.present) {
      closedGateReason = "WORKER_FLEET_EMPTY";
    } else if (!workerFleet.complete) {
      closedGateReason = "WORKER_FLEET_SCAN_INCOMPLETE";
    } else if (!attestation.present) {
      closedGateReason = "NO_ATTESTATION";
    } else {
      closedGateReason = null; // gate is open
    }

    // SHA-difference is surfaced as a yellow warning in the UI, not a gate reason.
    const shaReleaseWarning = workerFleet.shaWarning
      ? `Worker SHA(s) differ from API SHA ${releaseSha?.slice(0, 12) ?? ""}… — diagnostic only`
      : null;

    res.json({
      deployedReleaseSha: releaseSha,
      deploymentIdentity,
      environmentIdentity,
      queueTopologyHash,
      inventory,
      workerFleet,
      attestation,
      closedGateReason,
      shaReleaseWarning,
    });
  });

  // ── POST /api/admin/cro03c/deployment-inventory/converge ─────────────────
  // Triggers an immediate deployment-inventory self-convergence using the
  // operator private key already in environment.  Idempotent: safe to call
  // after every deploy or whenever the gate shows "No attestation".
  app.post("/api/admin/cro03c/deployment-inventory/converge", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const { convergeCro03cDeploymentInventory } = await import("../services/cro03-inventory-convergence");
      const result = await convergeCro03cDeploymentInventory({
        actorId: String((req.user as any).id),
        workerWaitMs: 30_000,
      });
      if (result.converged) {
        return res.status(result.replayed ? 200 : 201).json(result);
      }
      return res.status(422).json({ code: result.reason, message: result.detail ?? result.reason });
    } catch (err: any) {
      res.status(500).json({ code: "CRO03C_CONVERGENCE_ERROR", message: err?.message });
    }
  });

  app.get("/api/admin/cro03c/runtime-identity", isDashboardUser, requireRole("admin"), async (_req, res) => {
    const { getCro03cQueueTopologyHash } = await import("../services/queue-manager");
    const { getSharedRedisClient, getBullMqTestPrefix } = await import("../services/queue-connection");
    const { readCro03cWorkerFleet } = await import("../services/cro03/runtime-heartbeat");
    const { getBackgroundProfile, getSelectiveGroups } = await import("../services/background-profile");
    const queueTopologyHash = getCro03cQueueTopologyHash();
    const releaseSha = process.env.RELEASE_SHA ?? null;
    const profile = getBackgroundProfile();

    let workerIdentities: string[] = [];
    // W06: discoveryComplete=true means the Redis scan finished within its
    // bounds and the result is exhaustive for this release/topology.
    // It does NOT mean the fleet matches a required expected count.
    let discoveryComplete = false;
    let discoveryErrorCode: string | null = null;

    try {
      const redis = getSharedRedisClient();
      if (redis && releaseSha && /^[0-9a-f]{40}$/i.test(releaseSha)) {
        // W06: Discovery mode — empty expectedProcessIdentities.
        // The fixed readCro03cWorkerFleet now returns complete=true in
        // discovery mode when the scan finishes, instead of throwing SIZE_MISMATCH.
        // W09: Bind discovery to this process's environment and deployment so
        // heartbeats from a different env/workspace sharing Redis are rejected.
        const fleet = await readCro03cWorkerFleet({
          redis, prefix: getBullMqTestPrefix(),
          expectedReleaseSha: releaseSha,
          expectedQueueTopologyHash: queueTopologyHash,
          expectedProcessIdentities: [],   // discovery mode
          expectedEnvironmentIdentity: process.env.NODE_ENV,
          expectedDeploymentIdentity: process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID,
          now: new Date(),
        });
        workerIdentities = fleet.heartbeats.map((h) => h.processIdentity).sort();
        discoveryComplete = fleet.complete;
      } else if (!redis) {
        discoveryErrorCode = "REDIS_NOT_INITIALIZED";
      } else if (!releaseSha || !/^[0-9a-f]{40}$/i.test(releaseSha)) {
        discoveryErrorCode = "RELEASE_SHA_MISSING_OR_INVALID";
      }
    } catch (err: unknown) {
      // Best-effort — ceremony caller can see discoveryComplete=false and retry
      discoveryErrorCode = err instanceof Error ? err.message.slice(0, 100) : "DISCOVERY_ERROR";
    }

    res.json({
      // Process-level identity
      deploymentIdentity: process.env.REPL_DEPLOYMENT_ID ?? process.env.REPL_ID ?? null,
      environmentIdentity: process.env.NODE_ENV ?? null,
      releaseSha,
      queueTopologyHash,
      // W06: renamed from workerFleetComplete to distinguish discovery from verification
      workerIdentities,
      workerFleetComplete: discoveryComplete,   // kept for ceremony script backward compat
      discoveryComplete,
      discoveryErrorCode,
      // W09: active profile so ceremony can confirm workers match their expected config
      activeProfile: profile,
      // W01: selected capability groups (populated when profile === "selective")
      selectedGroups: profile === "selective" ? getSelectiveGroups() : null,
      // W08: effective topology hash is already included in queueTopologyHash above
    });
  });

  app.post("/api/cro03c/deployment-inventories/import", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cDeploymentInventoryImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid signed deployment inventory." });
    try {
      const result = await importCro03cDeploymentInventory({ ...parsed.data, actorId: String((req.user as any).id) });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(/CONFLICT/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03c/deployment-inventories/:id/revoke", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cDeploymentInventoryRevocationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid deployment inventory revocation." });
    try {
      const { confirm: _confirm, ...input } = parsed.data;
      const result = await revokeCro03cDeploymentInventory({
        ...input, inventoryId: String(req.params.id), actorId: String((req.user as any).id),
      });
      res.status(result.replayed ? 200 : 202).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(/NOT_FOUND/.test(safe.code) ? 404 : /CONFLICT|ALREADY/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.get("/api/cro03c/status", isDashboardUser, requireRole("admin"), async (_req, res) => {
    try {
      res.json(await getCro03cStatus());
    } catch {
      res.status(503).json({ code: "CRO03C_STATUS_UNAVAILABLE", message: "Live enrichment status is unavailable." });
    }
  });

  app.post("/api/cro03c/activation-policies", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cActivationSchema.merge(cro03cReceiptReferencesSchema).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid activation policy." });
    try {
      // The browser may reference receipts but cannot create approval evidence,
      // pricing, or scope.  All are verified from immutable database receipts.
      const result = await createCro03cActivationPolicy({
        idempotencyKey: parsed.data.idempotencyKey, expectedRevision: parsed.data.expectedRevision,
        reason: parsed.data.reason, actorId: String((req.user as any).id),
        receiptIds: parsed.data.receiptIds,
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(/CONFLICT/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03c/approval-artifacts/import", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cApprovalArtifactImportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid signed approval artifact." });
    try {
      const result = await importCro03cApprovalArtifact({
        ...parsed.data, actorId: String((req.user as any).id),
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(/CONFLICT/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03c/approval-receipts/:id/revoke", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cReceiptRevocationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid receipt revocation." });
    try {
      const result = await revokeCro03cApprovalReceipt({
        receiptId: String(req.params.id), idempotencyKey: parsed.data.idempotencyKey, expectedRevision: parsed.data.expectedRevision,
        reason: parsed.data.reason, actorId: String((req.user as any).id),
      });
      res.status(result.replayed ? 200 : 202).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(safe.code === "CRO03C_APPROVAL_RECEIPT_NOT_FOUND" ? 404 : /CONFLICT|ALREADY/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03c/runtime-attestations", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cAttestationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid runtime attestation request." });
    try {
      // Release, migration, deployment, process identities, health, capture time,
      // and actor are server-derived. The browser supplies no authority fields.
      const result = await createCro03cRuntimeAttestation({
        idempotencyKey: parsed.data.idempotencyKey,
        actorId: String((req.user as any).id),
        ttlMs: parsed.data.ttlMs,
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      res.status(400).json(safeError(error));
    }
  });

  app.post("/api/cro03c/commands", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cCommandSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid live command." });
    try {
      const { confirm: _confirm, ...command } = parsed.data;
      const result = await createCro03cCommand({
        ...command, actorId: String((req.user as any).id),
      });
      res.status(result.replayed ? 200 : 202).json(result);
    } catch (error) {
      const safe = safeError(error);
      res.status(/CONFLICT|CONSUMED|ALREADY/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03c/commands/:id/cancel", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = cro03cCancelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03C_INVALID_REQUEST", message: "Invalid cancellation request." });
    try {
      const result = await cancelCro03cCommand({
        commandId: String(req.params.id),
        actorId: String((req.user as any).id),
        idempotencyKey: parsed.data.idempotencyKey,
        expectedRevision: parsed.data.expectedRevision,
        reason: parsed.data.reason,
      });
      res.status(result.replayed ? 200 : 202).json({
        commandId: req.params.id, state: "cancelled", revision: result.revision, replayed: result.replayed,
      });
    } catch (error) {
      const safe = safeError(error);
      res.status(safe.code === "CRO03C_COMMAND_NOT_FOUND" ? 404
        : /CONFLICT|NOT_CANCELLABLE|IDEMPOTENCY/.test(safe.code) ? 409 : 400).json(safe);
    }
  });

  app.post("/api/cro03/batches", requireRole("admin", "manager"), async (req, res) => {
    const parsed = createBatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03_INVALID_REQUEST", message: "Invalid enrichment batch request." });
    try {
      const result = await createCro03Batch({
        ...parsed.data, actorType: "user", actorId: String((req.user as any)?.id ?? ""),
      });
      res.status(result.replayed ? 200 : 202).json({
        batchId: result.id, statusUrl: `/api/cro03/batches/${result.id}`,
        ...result,
      });
    } catch (error) {
      const safe = safeError(error);
      res.status(safe.code === "CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH" ? 409 : 400).json(safe);
    }
  });

  app.get("/api/cro03/batches/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const batchId = String(req.params.id);
      if (!await canManageBatch(req, batchId)) {
        return res.status(404).json({ code: "not_found", message: "Not found" });
      }
      const status = await getCro03BatchStatus(batchId);
      if (!status) return res.status(404).json({ code: "not_found", message: "Not found" });
      res.json(status);
    } catch {
      res.status(404).json({ code: "not_found", message: "Not found" });
    }
  });

  app.post("/api/cro03/batches/:id/cancel", requireRole("admin", "manager"), async (req, res) => {
    try {
      const batchId = String(req.params.id);
      if (!await canManageBatch(req, batchId)) {
        return res.status(404).json({ code: "not_found", message: "Not found" });
      }
      const changed = await cancelCro03Batch(batchId);
      if (!changed) return res.status(404).json({ code: "not_found", message: "Not found" });
      res.status(202).json({ batchId, state: "cancelled" });
    } catch {
      res.status(404).json({ code: "not_found", message: "Not found" });
    }
  });

  // Reconciliation is an aggregate economic read, never a manager-scoped batch view.
  app.get("/api/cro03/reconciliation", requireRole("admin"), async (_req, res) => {
    res.json(await getCro03Reconciliation());
  });

  app.get("/api/cro03/policy", requireRole("admin"), (_req, res) => {
    res.json({
      schemaVersion: 1, routingPolicyVersion: 1, providers: ["zerobounce", "serper", "outscraper", "apollo"],
      liveTransport: process.env.CRO03_PROVIDER_TRANSPORT_ENABLED === "true", canaries: CRO03_CANARY_DEFINITIONS,
    });
  });

  app.post("/api/cro03b/commands", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    // Explicit empty-array guard — must return a CRO03B-prefixed code so safeError preserves
    // it instead of folding it into the opaque CRO03_REQUEST_FAILED fallback.  A zero-handoff
    // request from the UI after a 0-selected qualification run is the most common trigger.
    if (Array.isArray(req.body?.handoffIds) && req.body.handoffIds.length === 0) {
      return res.status(400).json({
        code: "CRO03B_ZERO_HANDOFFS",
        message: "No handoffs were selected — admission requires at least one qualified handoff.",
      });
    }
    const parsed = cro03bCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "CRO03B_INVALID_REQUEST", message: "Invalid recipe command." });
    }
    try {
      const user = req.user as any;
      const command = await admitCro03bHandoffs({
        ...parsed.data, actorId: String(user.id), actorRole: user.role,
      });
      res.status(command.replayed ? 200 : 202).json({
        commandId: command.id, statusUrl: `/api/cro03b/commands/${command.id}`, ...command,
      });
    } catch (error) {
      const safe = safeError(error);
      const status = safe.code === "CRO03B_HANDOFF_NOT_FOUND" ? 404
        : /CONFLICT|ALREADY_ADMITTED/.test(safe.code) ? 409 : 400;
      res.status(status).json(safe);
    }
  });

  app.get("/api/cro03b/commands/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      const command = await getCro03bCommand(String(req.params.id), String(user.id), String(user.role));
      if (!command) return res.status(404).json({ code: "not_found", message: "Not found" });
      res.json(command);
    } catch {
      res.status(404).json({ code: "not_found", message: "Not found" });
    }
  });

  app.post("/api/cro03b/commands/:id/cancel", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      const changed = await cancelCro03bCommand(String(req.params.id), String(user.id), String(user.role));
      if (!changed) return res.status(404).json({ code: "not_found", message: "Not found" });
      res.status(202).json({ commandId: req.params.id, state: "cancel_requested" });
    } catch {
      res.status(404).json({ code: "not_found", message: "Not found" });
    }
  });

  app.post("/api/cro03b/items/:id/review-and-project", isDashboardUser, requireRole("admin"), async (req, res) => {
    if (Object.keys(req.body ?? {}).length > 0) {
      return res.status(400).json({ code: "CRO03B_AUTHORITY_FIELDS_FORBIDDEN", message: "Review inputs are server-derived." });
    }
    try {
      const user = req.user as any;
      res.status(202).json(await reviewAndProjectCro03bItem(String(req.params.id), String(user.id)));
    } catch (error) {
      const safe = safeError(error);
      res.status(/NOT_FOUND|NOT_REVIEWABLE/.test(safe.code) ? 404 : 409).json(safe);
    }
  });

  app.get("/api/cro03b/recipe", isDashboardUser, requireRole("admin"), (_req, res) => {
    res.json({
      version: CRO03B_RECIPE_VERSION, hash: CRO03B_RECIPE_HASH,
      transportEnabled: false, recipe: CRO03B_UNIFIED_RECIPE,
    });
  });

  app.get("/api/cro03a/source-census", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    res.json(await getCro03aSourceCensus());
  });

  // ── GET /api/cro03a/pilot-cohort/eligible ────────────────────────────────
  // Returns a deterministic funnel: how many source occurrences pass each filter
  // step of the active Level-1 pilot definition (county=miami, vertical=auto).
  // Applies DBPR exclusion, existing-relationship exclusion, geography, vertical,
  // and evidence filters. Separates auto-eligible from review_required.
  // Never silently broadens geography, vertical, source, or evidence requirements.
  app.get("/api/cro03a/pilot-cohort/eligible", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    try {
      // ── 1. Load active Level-1 pilot definition ───────────────────────────
      const pilotDefRow: any = ((await db.execute(sql`
        SELECT id::text, level, county_scope, vertical_scope, max_cohort_size
          FROM mi09_pilot_definitions WHERE level = 1
         ORDER BY created_at DESC LIMIT 1
      `)) as any).rows?.[0];

      const pilotDef = pilotDefRow ? {
        id: String(pilotDefRow.id),
        level: Number(pilotDefRow.level),
        countyScope: (typeof pilotDefRow.county_scope === "string" ? JSON.parse(pilotDefRow.county_scope) : pilotDefRow.county_scope) as string[],
        verticalScope: (typeof pilotDefRow.vertical_scope === "string" ? JSON.parse(pilotDefRow.vertical_scope) : pilotDefRow.vertical_scope) as string[],
        maxCohortSize: Number(pilotDefRow.max_cohort_size),
      } : { id: null, level: 1, countyScope: ["miami"], verticalScope: ["auto"], maxCohortSize: 25 };

      // ── 2. Total staged occurrences ───────────────────────────────────────
      const totalRow: any = ((await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM cro03_source_occurrences
      `)) as any).rows?.[0];
      const totalStaged = Number(totalRow?.cnt ?? 0);

      // ── 3. Existing decision breakdown ────────────────────────────────────
      const decisionRows: any[] = ((await db.execute(sql`
        SELECT disposition, COUNT(*)::int AS cnt
          FROM cro03a_qualification_decisions
         GROUP BY disposition
      `)) as any).rows ?? [];
      const decisionCounts: Record<string, number> = {};
      for (const row of decisionRows) {
        decisionCounts[String(row.disposition)] = Number(row.cnt);
      }

      // ── 4. Undecided occurrences ──────────────────────────────────────────
      const undecidedRow: any = ((await db.execute(sql`
        SELECT COUNT(o.id)::int AS cnt
          FROM cro03_source_occurrences o
          LEFT JOIN cro03a_qualification_decisions qd ON qd.occurrence_id = o.id
         WHERE qd.id IS NULL
      `)) as any).rows?.[0];
      const undecidedCount = Number(undecidedRow?.cnt ?? 0);

      // ── 5. Handoffs created ───────────────────────────────────────────────
      const handoffRow: any = ((await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM cro03a_handoffs
      `)) as any).rows?.[0];
      const handoffCount = Number(handoffRow?.cnt ?? 0);

      // ── 6. Most recent completed qualification run with handoffs ──────────
      const lastRunRow: any = ((await db.execute(sql`
        SELECT qr.id::text, qr.completed_at::text,
               qr.policy_id::text, qr.policy_hash,
               qr.actor_id::text,
               COUNT(h.id)::int AS handoff_count
          FROM cro03a_qualification_runs qr
          LEFT JOIN cro03a_handoffs h ON h.run_id = qr.id
         WHERE qr.state = 'completed'
         GROUP BY qr.id, qr.completed_at, qr.policy_id, qr.policy_hash, qr.actor_id
         ORDER BY qr.completed_at DESC LIMIT 1
      `)) as any).rows?.[0];

      const lastQualificationRun = lastRunRow ? {
        runId: String(lastRunRow.id),
        completedAt: String(lastRunRow.completed_at),
        policyId: String(lastRunRow.policy_id),
        policyHash: String(lastRunRow.policy_hash ?? ""),
        handoffCount: Number(lastRunRow.handoff_count),
        actorId: String(lastRunRow.actor_id),
      } : null;

      // ── 7. Eligible candidates (automatic vs review_required) ─────────────
      const autoEligible = Number(decisionCounts["selected"] ?? 0);
      const reviewRequired = Number(decisionCounts["review_required"] ?? 0);
      const outsideGeography = Number(decisionCounts["outside_geography"] ?? 0);
      const existingRelationship = Number(decisionCounts["existing_relationship"] ?? 0);
      const insufficientEvidence = Number(decisionCounts["insufficient_evidence"] ?? 0);
      const inactiveEntity = Number(decisionCounts["inactive_entity"] ?? 0);
      const excluded = Number(decisionCounts["excluded"] ?? 0);
      const duplicate = Number(decisionCounts["duplicate"] ?? 0);

      const totalDecided = Object.values(decisionCounts).reduce((a, b) => a + b, 0);

      const eligible = autoEligible > 0 || reviewRequired > 0 ? `${autoEligible} auto-eligible, ${reviewRequired} review-required` : null;

      res.json({
        pilotDefinition: pilotDef,
        funnel: {
          totalSourceRecordsStaged: totalStaged,
          totalDecided,
          undecided: undecidedCount,
          // Exclusion breakdown (from completed qualification runs)
          outsideGeography,
          existingRelationship,
          insufficientEvidence,
          inactiveEntity,
          excluded,
          duplicate,
          reviewRequired,
          automaticallyEligible: autoEligible,
          // Terminal outcomes
          handoffsCreated: handoffCount,
          terminalWithoutHandoff: totalDecided - autoEligible - reviewRequired,
        },
        eligibleSummary: autoEligible === 0 && reviewRequired === 0
          ? `0 eligible candidates for the current pilot definition`
          : eligible,
        lastQualificationRun,
      });
    } catch (error) {
      res.status(500).json(safeError(error));
    }
  });

  // MI-03: Filtered census — accepts county_fips[], vertical[], source_type[] query params.
  app.get("/api/cro03a/census", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const toArray = (v: unknown): string[] | undefined => {
        if (!v) return undefined;
        const arr = Array.isArray(v) ? v : [v];
        const strs = arr.map(String).filter((s) => s.trim().length > 0);
        return strs.length ? strs : undefined;
      };
      const filters = {
        countyFips: toArray(req.query["county_fips[]"] ?? req.query.county_fips),
        vertical: toArray(req.query["vertical[]"] ?? req.query.vertical),
        sourceType: toArray(req.query["source_type[]"] ?? req.query.source_type),
      };
      res.json(await getCro03aSourceCensus(filters));
    } catch (error) {
      res.status(400).json(safeError(error));
    }
  });

  // MI-03: Read API for canonical conflict evidence (admin only, paginated, no raw payloads).
  app.get("/api/admin/canonical-conflicts", isDashboardUser, requireRole("admin"), async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const status = typeof req.query.status === "string" ? req.query.status : "open";

      const rows = ((await db.execute(sql`
        SELECT id, business_id_a, business_id_b, conflict_type, field, status,
               created_at, acknowledged_at, acknowledged_by
          FROM canonical_conflict_evidence
         WHERE (${status === "all"} OR status = ${status})
         ORDER BY created_at DESC
         LIMIT ${limit} OFFSET ${offset}
      `)) as any).rows ?? [];

      const total = (((await db.execute(sql`
        SELECT COUNT(*)::int AS total FROM canonical_conflict_evidence
         WHERE (${status === "all"} OR status = ${status})
      `)) as any).rows ?? [])[0]?.total ?? 0;

      res.json({
        items: rows.map((row: any) => ({
          id: row.id,
          businessIdA: row.business_id_a,
          businessIdB: row.business_id_b ?? null,
          conflictType: row.conflict_type,
          field: row.field ?? null,
          status: row.status,
          createdAt: row.created_at,
          acknowledgedAt: row.acknowledged_at ?? null,
          acknowledgedBy: row.acknowledged_by ?? null,
        })),
        total,
        limit,
        offset,
      });
    } catch (error) {
      res.status(500).json({ code: "CANONICAL_CONFLICTS_FETCH_FAILED", message: "Failed to load conflict evidence." });
    }
  });

  // ── POST /api/cro03a/source-census/stage ──────────────────────────────────
  // Async census staging: returns 202 + runId immediately; actual staging
  // work runs in a background promise bounded by a per-source statement
  // timeout. Poll GET /api/cro03a/source-census/stage/:runId for progress.
  //
  // Idempotency: the client-generated `idempotencyKey` scopes the run.
  //   - Same key while a run is queued/running → 200 with existing state.
  //   - Same key after a run completes → 200 with the cached result.
  //   - New key → 202 + fresh run.
  app.post("/api/cro03a/source-census/stage", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const parsed = censusStageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ code: "CRO03A_INVALID_REQUEST", message: "Invalid census scope." });
    const { idempotencyKey, limitPerSource } = parsed.data;
    const settingsKey = `cro03a_staging_job:${idempotencyKey}`;
    try {
      // Check if a run already exists under this key.
      const existing = ((await db.execute(sql`
        SELECT value FROM system_settings WHERE key = ${settingsKey}
      `)) as any).rows?.[0]?.value;
      if (existing) {
        const state = typeof existing === "string" ? JSON.parse(existing) : existing;
        return res.status(200).json(state);
      }

      // Register the run immediately so concurrent retries see it.
      const actorId = String((req.user as any).id);
      const now = new Date().toISOString();
      const initialState: Record<string, unknown> = {
        runId: idempotencyKey,
        status: "queued" as const,
        startedAt: now,
        queuedAt: now,
        limitPerSource: limitPerSource ?? 100,
        actorId,
      };
      await db.execute(sql`
        INSERT INTO system_settings (key, value) VALUES (${settingsKey}, ${JSON.stringify(initialState)})
        ON CONFLICT (key) DO NOTHING
      `);

      // Persist a pointer to the latest run so page-refresh can recover it.
      const latestRunPayload = JSON.stringify({ runId: idempotencyKey, actorId, startedAt: now });
      await db.execute(sql`
        INSERT INTO system_settings (key, value) VALUES ('cro03a_staging_job:latest', ${latestRunPayload})
        ON CONFLICT (key) DO UPDATE SET value = ${latestRunPayload}, updated_at = NOW()
      `).catch(() => { /* best-effort */ });

      // Safety ceiling: 10 minutes absolute max.  Stall detection uses heartbeat
      // age (see poll endpoints), NOT elapsed wall-clock time, so a slow-but-healthy
      // run is never falsely killed within this ceiling.
      const STAGE_TIMEOUT_MS = 10 * 60_000;

      setImmediate(async () => {
        // Mark the run as "running" so the poll endpoint can distinguish a live
        // run from a stalled one, and so the client shows a spinner.
        const runningState: Record<string, unknown> = {
          ...initialState, status: "running", runningAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
        };
        try {
          await db.execute(sql`
            INSERT INTO system_settings (key, value) VALUES (${settingsKey}, ${JSON.stringify(runningState)})
            ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(runningState)}, updated_at = NOW()
          `);
        } catch { /* best-effort — still attempt staging */ }

        // onProgress: called every HEARTBEAT_BATCH items.
        // Writes a live progress snapshot to system_settings so poll endpoints
        // can verify the run is alive using lastHeartbeat age, not elapsed time.
        const onProgress = async (p: { completed: number; total: number; currentStage: string }) => {
          const heartbeatState: Record<string, unknown> = {
            ...runningState,
            status: "running",
            completedItems: p.completed,
            totalItems: p.total,
            currentStage: p.currentStage,
            lastHeartbeat: new Date().toISOString(),
          };
          try {
            await db.execute(sql`
              INSERT INTO system_settings (key, value) VALUES (${settingsKey}, ${JSON.stringify(heartbeatState)})
              ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(heartbeatState)}, updated_at = NOW()
            `);
          } catch { /* non-fatal */ }
        };

        let finalState: Record<string, unknown>;
        try {
          const timeoutError = new Error("CRO03A_STAGING_TIMEOUT");
          const result = await Promise.race([
            stageCro03aSourceCensus({ actorId, limitPerSource, onProgress }),
            new Promise<never>((_, reject) => setTimeout(() => reject(timeoutError), STAGE_TIMEOUT_MS)),
          ]);
          finalState = {
            runId: idempotencyKey,
            status: "completed",
            completedAt: new Date().toISOString(),
            ...result,
          };
        } catch (err: any) {
          const isTimeout = err?.message === "CRO03A_STAGING_TIMEOUT";
          finalState = {
            runId: idempotencyKey,
            status: isTimeout ? "stalled" : "failed",
            failedAt: new Date().toISOString(),
            error: err?.message ?? String(err),
            timedOut: isTimeout,
            stallReason: isTimeout ? "Exceeded 10-minute safety ceiling — check DB pool health" : undefined,
          };
        }

        // Persist terminal state with up to 3 retries so a transient pool
        // exhaustion doesn't leave the run permanently in "running".
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await db.execute(sql`
              INSERT INTO system_settings (key, value) VALUES (${settingsKey}, ${JSON.stringify(finalState)})
              ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(finalState)}, updated_at = NOW()
            `);
            break;
          } catch (persistErr: any) {
            console.error(`[CensusStage] Failed to persist terminal state (attempt ${attempt + 1}):`, persistErr?.message);
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2_000));
          }
        }
      });

      return res.status(202).json(initialState);
    } catch (error) {
      res.status(400).json(safeError(error));
    }
  });

  // ── GET /api/cro03a/source-census/latest-run ─────────────────────────────
  // Returns the status of the most recently started staging run, allowing
  // the client to resume polling after a page refresh without losing the runId.
  app.get("/api/cro03a/source-census/latest-run", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    try {
      const latestRow = ((await db.execute(sql`
        SELECT value FROM system_settings WHERE key = 'cro03a_staging_job:latest'
      `)) as any).rows?.[0]?.value;
      if (!latestRow) return res.status(404).json({ code: "CRO03A_NO_RUNS" });
      const latestRef = typeof latestRow === "string" ? JSON.parse(latestRow) : latestRow;
      const runId: string = String(latestRef?.runId ?? "");
      if (!runId || runId.length < 8) return res.status(404).json({ code: "CRO03A_NO_RUNS" });

      const settingsKey = `cro03a_staging_job:${runId}`;
      const row = ((await db.execute(sql`
        SELECT value, updated_at FROM system_settings WHERE key = ${settingsKey}
      `)) as any).rows?.[0];
      if (!row) return res.status(404).json({ code: "CRO03A_RUN_NOT_FOUND", runId });
      const state = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      if (state.status === "running" || state.status === "queued") {
        // Prefer lastHeartbeat (written by onProgress microbatch callback) over
        // updated_at so a slow-but-healthy run is never falsely stalled.
        const heartbeatMs = state.lastHeartbeat
          ? new Date(state.lastHeartbeat).getTime()
          : (row.updated_at ? new Date(row.updated_at).getTime() : 0);
        const HEARTBEAT_STALL_MS = 90_000; // 90s without a heartbeat = stalled
        if (heartbeatMs && Date.now() - heartbeatMs > HEARTBEAT_STALL_MS) {
          return res.json({ ...state, status: "stalled", stalledAt: new Date().toISOString(), stallReason: "No heartbeat received within 90 s — background process may have crashed" });
        }
      }
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ code: "CRO03A_POLL_FAILED", message: err?.message });
    }
  });

  // ── GET /api/cro03a/source-census/stage/:runId ────────────────────────────
  // Poll for the status of an async census staging run.
  app.get("/api/cro03a/source-census/stage/:runId", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const runId = String(req.params.runId ?? "").trim();
    if (!runId || runId.length < 8) return res.status(400).json({ code: "CRO03A_INVALID_RUN_ID" });
    try {
      const settingsKey = `cro03a_staging_job:${runId}`;
      const row = ((await db.execute(sql`
        SELECT value, updated_at FROM system_settings WHERE key = ${settingsKey}
      `)) as any).rows?.[0];
      if (!row) return res.status(404).json({ code: "CRO03A_RUN_NOT_FOUND", runId });
      const state = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      // Stall detection: prefer lastHeartbeat (written by onProgress microbatch callback)
      // over updated_at so a slow-but-healthy run is never falsely stalled.
      if (state.status === "running" || state.status === "queued") {
        const heartbeatMs = state.lastHeartbeat
          ? new Date(state.lastHeartbeat).getTime()
          : (row.updated_at ? new Date(row.updated_at).getTime() : 0);
        const HEARTBEAT_STALL_MS = 90_000; // 90s without a heartbeat = stalled
        if (heartbeatMs && Date.now() - heartbeatMs > HEARTBEAT_STALL_MS) {
          return res.json({ ...state, status: "stalled", stalledAt: new Date().toISOString(), stallReason: "No heartbeat received within 90 s — background process may have crashed" });
        }
      }
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ code: "CRO03A_POLL_FAILED", message: err?.message });
    }
  });

  app.post("/api/cro03a/preview", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const parsed = occurrenceScopeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03A_INVALID_REQUEST", message: "Invalid occurrence scope." });
    try {
      res.json(await previewCro03aQualification(parsed.data.occurrenceIds));
    } catch (error) {
      const safe = safeError(error);
      res.status(400).json(safe);
    }
  });

  app.post("/api/cro03a/runs", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const parsed = qualificationRunSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03A_INVALID_REQUEST", message: "Invalid qualification command." });
    try {
      const user = req.user as any;
      const result = await createCro03aQualificationRun({
        ...parsed.data, actorId: String(user.id), actorRole: user.role,
      });
      res.status(result.replayed ? 200 : 202).json({ runId: result.id, statusUrl: `/api/cro03a/runs/${result.id}`, ...result });
    } catch (error) {
      const safe = safeError(error);
      res.status(safe.code === "CRO03A_IDEMPOTENCY_SCOPE_CONFLICT" ? 409 : 400).json(safe);
    }
  });

  app.get("/api/cro03a/runs/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const user = req.user as any;
      const run = await getCro03aRun(String(req.params.id), String(user.id), String(user.role));
      if (!run) return res.status(404).json({ code: "not_found", message: "Not found" });
      res.json(run);
    } catch {
      res.status(404).json({ code: "not_found", message: "Not found" });
    }
  });

  app.post("/api/cro03a/runs/:id/cancel", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const user = req.user as any;
    const changed = await cancelCro03aRun(String(req.params.id), String(user.id), String(user.role));
    if (!changed) return res.status(404).json({ code: "not_found", message: "Not found" });
    res.status(202).json({ runId: req.params.id, state: "cancelled" });
  });

  app.post("/api/cro03a/policies/activate", isDashboardUser, requireRole("admin"), async (req, res) => {
    const parsed = policyActivationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "CRO03A_INVALID_REQUEST", message: "Invalid policy activation." });
    try {
      res.json(await activateCro03aPolicy({ ...parsed.data, actorId: String((req.user as any).id) }));
    } catch (error) {
      const safe = safeError(error);
      res.status(safe.code === "CRO03A_POLICY_VERSION_CONFLICT" ? 409 : 400).json(safe);
    }
  });

}
