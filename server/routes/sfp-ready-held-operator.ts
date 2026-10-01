import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import type {
  SfpRuntimeReleaseSelectionInput,
  SfpRuntimeReleaseSelectionStatus,
} from "../services/cro03/sfp-provider-operations";

const MAX_BATCH_SIZE = 25;
const rows = (result: any): any[] => result?.rows ?? result ?? [];

export interface SfpReadyHeldOperatorRouteDependencies {
  verifyPackages: () => Promise<{ ok: boolean; issues: string[] }>;
  setSchedule: (input: { recurringEnabled: boolean; batchSize: number; actorId: string }) => Promise<unknown>;
  processBatch: (input: { limit: number; actorId: string }) => Promise<{
    enabled: boolean; discovered: number; attempted: number; completed: number; held: number;
    retrying: number; deadLettered: number; persistenceFailures: number; stopReason: string;
  }>;
  retryItem: (id: string) => Promise<{ id: string; stagingIntentId: string } | null>;
  getRuntimeReleaseSelectionStatus: () => Promise<SfpRuntimeReleaseSelectionStatus>;
  selectCurrentRuntimeRelease: (
    input: SfpRuntimeReleaseSelectionInput,
  ) => Promise<{ eventId: string; action: "bootstrap" | "transfer"; selectedRelease: unknown }>;
  audit: (input: {
    action: string; entityType: string; entityKey?: string; userId: string;
    details: Record<string, unknown>;
  }) => Promise<void>;
}

const productionDependencies: SfpReadyHeldOperatorRouteDependencies = {
  verifyPackages: async () => (await import("../services/cro03/sfp-campaign-packages")).verifyPackageConvergenceV2(),
  setSchedule: async (input) => (await import("../services/cro03/south-florida-prospecting")).setCampaignStagingSchedule(input),
  processBatch: async (input) => (await import("../services/cro03/sfp-ready-held-consumer")).processSfpReadyHeldConsumerBatch(input),
  retryItem: async (id) => {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const updated = rows(await db.execute(sql`
      UPDATE sfp_ready_held_consumer_items q
         SET state='pending', attempt_count=0, next_attempt_at=NOW(),
             outcome_code=NULL, result='{}'::jsonb,
             claim_token=NULL, lease_expires_at=NULL, completed_at=NULL, updated_at=NOW()
       WHERE q.id=${id}::uuid AND q.state IN ('held','dead_letter')
         AND EXISTS (
           SELECT 1 FROM sfp_campaign_staging_intents i
            WHERE i.id=q.staging_intent_id AND i.state='ready_held'
         )
       RETURNING q.id, q.staging_intent_id
    `))[0];
    return updated ? { id: String(updated.id), stagingIntentId: String(updated.staging_intent_id) } : null;
  },
  getRuntimeReleaseSelectionStatus: async () =>
    (await import("../services/cro03/sfp-provider-operations")).getSfpRuntimeReleaseSelectionStatus(),
  selectCurrentRuntimeRelease: async (input) =>
    (await import("../services/cro03/sfp-provider-operations")).selectCurrentSfpRuntimeRelease(input),
  audit: async (input) => {
    const { storage } = await import("../storage");
    await storage.createAuditLog({
      action: input.action,
      entityType: input.entityType,
      entityKey: input.entityKey,
      userId: input.userId,
      details: input.details,
    });
  },
};

function adminIdentity(req: { user?: unknown }): { id: string; actorId: string } | null {
  const id = String((req.user as any)?.id ?? "").trim();
  return id ? { id, actorId: `admin:${id}` } : null;
}

export function registerSfpReadyHeldOperatorRoutes(
  app: Express,
  dependencies: SfpReadyHeldOperatorRouteDependencies = productionDependencies,
) {
  app.get("/api/lead-ops/sfp/runtime-release-selection", requireRole("admin"), async (req, res) => {
    if (!adminIdentity(req)) return res.status(401).json({ error: "Authenticated admin identity required" });
    try {
      return res.json(await dependencies.getRuntimeReleaseSelectionStatus());
    } catch (error: any) {
      return res.status(503).json({
        error: "SFP_RUNTIME_RELEASE_STATUS_UNAVAILABLE",
        reason: String(error?.message ?? error).slice(0, 300),
      });
    }
  });

  const runtimeSelectionSchema = z.object({
    expectedPreviousSelectionVersion: z.number().int().positive().nullable(),
    expectedPreviousArtifactSha: z.string().regex(/^[0-9a-f]{40}$/i).nullable(),
    publisherVerifiedArtifactSha: z.string().regex(/^[0-9a-f]{40}$/i),
    publisherVerifiedDeploymentIdentity: z.string().trim().min(1).max(240),
    verificationReference: z.string().url().max(500).refine((value) => /^https:\/\//i.test(value)),
  }).strict().refine((input) =>
    (input.expectedPreviousSelectionVersion === null) === (input.expectedPreviousArtifactSha === null),
  );

  app.post("/api/lead-ops/sfp/runtime-release-selection/select", requireRole("admin"), async (req, res) => {
    const admin = adminIdentity(req);
    if (!admin) return res.status(401).json({ error: "Authenticated admin identity required" });
    const parsed = runtimeSelectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid runtime release evidence or selector compare-and-set", issues: parsed.error.issues });
    }
    try {
      const selection = await dependencies.selectCurrentRuntimeRelease({
        ...parsed.data,
        actorId: admin.id,
      });
      const status = await dependencies.getRuntimeReleaseSelectionStatus();
      return res.json({ selection, status });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const conflict = message.includes("PREVIOUS_RELEASE_MISMATCH") ||
        message.includes("ALREADY_SELECTED") ||
        message.includes("SELECTION_VERSION") ||
        message.includes("CAS");
      const invalidEvidence = message.includes("VERIFICATION_REFERENCE") ||
        message.includes("PUBLISHER_SHA") ||
        message.includes("DEPLOYMENT_MISMATCH") ||
        message.includes("ACTOR_REQUIRED");
      return res.status(conflict ? 409 : invalidEvidence ? 400 : 503).json({
        error: "SFP_RUNTIME_RELEASE_SELECTION_FAILED",
        reason: message.slice(0, 300),
      });
    }
  });

  app.post("/api/lead-ops/sfp/program/campaign-staging-schedule", requireRole("admin"), async (req, res) => {
    const admin = adminIdentity(req);
    if (!admin) return res.status(401).json({ error: "Authenticated admin identity required" });
    const recurringEnabled = req.body?.recurringEnabled;
    const batchSize = req.body?.batchSize;
    if (typeof recurringEnabled !== "boolean" || !Number.isInteger(batchSize) ||
        batchSize < 0 || batchSize > MAX_BATCH_SIZE || (recurringEnabled && batchSize < 1)) {
      return res.status(400).json({
        error: "recurringEnabled must be boolean and batchSize must be 0-25 (positive when recurring is enabled)",
      });
    }
    try {
      if (recurringEnabled) {
        const packageReadiness = await dependencies.verifyPackages();
        if (!packageReadiness.ok) {
          return res.status(409).json({ error: "SFP_V2_PACKAGES_NOT_READY", issues: packageReadiness.issues });
        }
      }
      const program = await dependencies.setSchedule({ recurringEnabled, batchSize, actorId: admin.actorId });
      return res.json({ program });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const status = message.includes("NOT_CONFIGURED") ? 404
        : message.includes("MUST_BE_ACTIVE") || message.includes("REQUIRES_POSITIVE") || message.includes("BATCH_MUST_BE") ? 409
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  app.post("/api/lead-ops/sfp/ready-held-consumer/run", requireRole("admin"), async (req, res) => {
    const admin = adminIdentity(req);
    if (!admin) return res.status(401).json({ error: "Authenticated admin identity required" });
    const requestedLimit = req.body?.limit === undefined ? MAX_BATCH_SIZE : Number(req.body.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_BATCH_SIZE) {
      return res.status(400).json({ error: "limit must be an integer from 1 through 25" });
    }
    try {
      const result = await dependencies.processBatch({ limit: requestedLimit, actorId: admin.actorId });
      await dependencies.audit({
        action: "sfp_ready_held_consumer_batch_requested",
        entityType: "sfp_ready_held_consumer",
        userId: admin.id,
        details: {
          limit: requestedLimit,
          discovered: result.discovered,
          attempted: result.attempted,
          completed: result.completed,
          held: result.held,
          retrying: result.retrying,
          deadLettered: result.deadLettered,
        },
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(503).json({
        error: "SFP_READY_HELD_CONSUMER_UNAVAILABLE",
        reason: String(error?.message ?? error).slice(0, 300),
      });
    }
  });

  app.post("/api/lead-ops/sfp/ready-held-consumer/items/:id/retry", requireRole("admin"), async (req, res) => {
    const admin = adminIdentity(req);
    if (!admin) return res.status(401).json({ error: "Authenticated admin identity required" });
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ error: "consumer item ID must be a UUID" });
    try {
      const updated = await dependencies.retryItem(parsed.data);
      if (!updated) {
        return res.status(409).json({
          error: "SFP_READY_HELD_ITEM_NOT_RETRYABLE",
          message: "Item is missing, not held/dead-lettered, or its source intent is no longer ready_held.",
        });
      }
      await dependencies.audit({
        action: "sfp_ready_held_consumer_item_retried",
        entityType: "sfp_ready_held_consumer_item",
        entityKey: updated.id,
        userId: admin.id,
        details: { consumerItemId: updated.id, stagingIntentId: updated.stagingIntentId },
      });
      return res.json({ ...updated, state: "pending" });
    } catch (error: any) {
      return res.status(400).json({ error: String(error?.message ?? "retry_failed") });
    }
  });
}