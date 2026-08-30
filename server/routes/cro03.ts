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

function safeError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && /^CRO03(?:A|B)?_/.test(error.message)
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
      liveTransport: false, canaries: CRO03_CANARY_DEFINITIONS,
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
