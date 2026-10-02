import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import {
  advanceGhlInboundSyncStep,
  createGhlInboundPreview,
  executeGhlInboundSync,
  getGhlInboundSyncRun,
  getGhlInboundSyncStatus,
  setGhlInboundWebhookEnabled,
} from "../services/ghl-inbound-sync";

const UUID = z.string().uuid();
function sendError(res: any, error: unknown) {
  const raw = (error as Error)?.message || "";
  const code = /^[A-Z0-9_:-]{1,120}$/.test(raw) ? raw : "GHL_INBOUND_SYNC_ERROR";
  const status = code.includes("NOT_FOUND") ? 404
    : code.includes("LEASE") || code.includes("ACTIVE") || code.includes("HASH") || code.includes("NOT_READY") ||
      code.includes("PAUSED") || code.includes("PAGINATION") || code.includes("ACTOR") ||
      code.includes("EPOCH") || code.includes("LOCATION") || code.includes("IDEMPOTENCY") ? 409
    : code.includes("NOT_CONFIGURED") ? 503 : 500;
  res.status(status).json({ message: code, code });
}

export function registerGhlInboundSyncRoutes(app: Express) {
  app.get("/api/admin/ghl/inbound-contact-sync", requireRole("admin"), async (_req, res) => {
    try { res.json(await getGhlInboundSyncStatus()); }
    catch (error) { sendError(res, error); }
  });

  app.post("/api/admin/ghl/inbound-contact-sync/preview", requireRole("admin"), async (req, res) => {
    const key = UUID.safeParse(req.get("Idempotency-Key"));
    if (!key.success) return res.status(400).json({ code: "IDEMPOTENCY_KEY_UUID_REQUIRED", message: "A UUID Idempotency-Key header is required" });
    if (!z.object({}).strict().safeParse(req.body).success) return res.status(400).json({ code: "INVALID_PREVIEW_REQUEST" });
    const actor = (req as any).user;
    const actorId = String(actor?.id ?? actor?.claims?.sub ?? "");
    if (!actorId) return res.status(401).json({ code: "AUTHENTICATED_ACTOR_REQUIRED" });
    try { res.status(201).json({ run: await createGhlInboundPreview(key.data, actorId) }); }
    catch (error) { sendError(res, error); }
  });

  app.post("/api/admin/ghl/inbound-contact-sync/:runId/step", requireRole("admin"), async (req, res) => {
    const runId = UUID.safeParse(req.params.runId);
    if (!runId.success) return res.status(400).json({ code: "INVALID_RUN_ID" });
    if (!z.object({}).strict().safeParse(req.body).success) return res.status(400).json({ code: "INVALID_STEP_REQUEST" });
    try {
      const result = await advanceGhlInboundSyncStep(runId.data);
      if (result.busy) return res.status(409).json({ run: result.run, code: "GHL_INBOUND_LEASE_HELD" });
      res.json({ run: result.run });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/admin/ghl/inbound-contact-sync/:runId", requireRole("admin"), async (req, res) => {
    const runId = UUID.safeParse(req.params.runId);
    if (!runId.success) return res.status(400).json({ code: "INVALID_RUN_ID" });
    try {
      const run = await getGhlInboundSyncRun(runId.data);
      if (!run) return res.status(404).json({ code: "GHL_INBOUND_RUN_NOT_FOUND" });
      res.json({ run });
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/admin/ghl/inbound-contact-sync/:runId/execute", requireRole("admin"), async (req, res) => {
    const runId = UUID.safeParse(req.params.runId);
    const key = UUID.safeParse(req.get("Idempotency-Key"));
    const body = z.object({ previewHash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict().safeParse(req.body);
    if (!runId.success) return res.status(400).json({ code: "INVALID_RUN_ID" });
    if (!key.success) return res.status(400).json({ code: "IDEMPOTENCY_KEY_UUID_REQUIRED", message: "A UUID Idempotency-Key header is required" });
    if (!body.success) return res.status(400).json({ code: "INVALID_EXECUTE_REQUEST" });
    const actor = (req as any).user;
    const actorId = String(actor?.id ?? actor?.claims?.sub ?? "");
    if (!actorId) return res.status(401).json({ code: "AUTHENTICATED_ACTOR_REQUIRED" });
    try { res.json({ run: await executeGhlInboundSync(runId.data, body.data.previewHash, key.data, actorId) }); }
    catch (error) { sendError(res, error); }
  });

  app.patch("/api/admin/ghl/inbound-contact-sync/control", requireRole("admin"), async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!body.success) return res.status(400).json({ code: "INVALID_CONTROL_REQUEST" });
    const actor = (req as any).user;
    const actorId = String(actor?.id ?? actor?.claims?.sub ?? "");
    if (!actorId) return res.status(401).json({ code: "AUTHENTICATED_ACTOR_REQUIRED" });
    try { res.json(await setGhlInboundWebhookEnabled(body.data.enabled, { userId: actorId, actorId })); }
    catch (error) { sendError(res, error); }
  });
}