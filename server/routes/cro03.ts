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
  // and the approved ZeroBounce schedule. There are deliberately no browser
  // fields for either validation cap.
  cro03cCommandBaseSchema.extend({
    commandType: z.literal("initial_batch"),
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

  app.post("/api/cro03a/source-census/stage", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    const parsed = censusStageSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ code: "CRO03A_INVALID_REQUEST", message: "Invalid census scope." });
    try {
      res.status(202).json(await stageCro03aSourceCensus({
        actorId: String((req.user as any).id), ...parsed.data,
      }));
    } catch (error) {
      res.status(400).json(safeError(error));
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
