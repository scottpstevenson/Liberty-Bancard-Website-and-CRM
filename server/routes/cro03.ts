import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  cancelCro03Batch, createCro03Batch, getCro03BatchStatus, getCro03Reconciliation,
} from "../services/cro03/enrichment-factory";
import { CRO03_CANARY_DEFINITIONS } from "../services/cro03/routing-policy";

const createBatchSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  contactIds: z.array(z.number().int().positive()).max(1000),
  purpose: z.enum(["provider_pre_spend", "internal_test"]).optional(),
}).strict();

function safeError(error: unknown): { code: string; message: string } {
  const code = error instanceof Error && error.message.startsWith("CRO03_")
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
}
