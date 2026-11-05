import type { Express } from "express";
import { applyUnderwritingOverride, OverrideError } from "../services/underwriting-override-service";
import { getQueuePage, getApprovedSincePage, getStatsSummary, normalizePage, getBusinessDayWindow } from "../services/underwriting-read-model";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { pool } from "../db";
import { serverError } from "../utils/server-error";

export function registerUnderwritingRoutes(app: Express) {
  // ── GET current rules config ─────────────────────────────────────────────
  app.get("/api/underwriting/rules", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const rules = await storage.getUnderwritingRules();
      if (!rules) return res.status(404).json({ message: "Underwriting rules are not configured. An admin or manager must save them." });
      res.json(rules);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── PUT update rules config (admin/manager only) ─────────────────────────
  app.put(
    "/api/underwriting/rules",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const schema = z.object({
          minMonthlyVolume: z.coerce.number().min(0).optional(),
          maxMonthlyVolume: z.coerce.number().min(0).optional(),
          effectiveRateCeiling: z.coerce.number().min(0).max(100).optional(),
          chargebackRateLimit: z.coerce.number().min(0).max(100).optional(),
          chargebackRateHardLimit: z.coerce.number().min(0).max(100).optional(),
          volumeHardDeviationPct: z.coerce.number().min(0).max(100).optional(),
          blockedProcessors: z.array(z.string()).optional(),
          allowedProcessors: z.array(z.string()).optional(),
          autoApproveEnabled: z.boolean().optional(),
        });
        const updates = schema.parse(req.body);
        const updated = await storage.updateUnderwritingRules(updates as any);

        const userId = (req.user as any)?.id?.toString() ?? null;
        await storage.createAuditLog({
          action: "underwriting_rules_updated",
          entityType: "underwriting_rules",
          entityId: 1,
          actorType: "user",
          actorId: userId,
          userId,
          details: { updates, timestamp: new Date().toISOString() },
        });

        res.json(updated);
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ message: "Validation error", errors: err.errors });
        }
        serverError(res, err);
      }
    },
  );

  // ── GET underwriting queue (current work: latest decision per deal, review/hold, not overridden) ───
  // Paginated with an uncapped total: { rows, total, limit, offset, hasMore }.
  app.get("/api/underwriting/queue", requireRole("admin", "manager"), async (req, res) => {
    try {
      const raw = req.query.decision;
      if (raw !== undefined && raw !== "review" && raw !== "hold") {
        return res.status(400).json({ message: "decision must be review or hold" });
      }
      const { limit, offset } = normalizePage(req.query.limit, req.query.offset);
      const win = await getBusinessDayWindow(pool);
      res.json({ ...(await getQueuePage(pool, { decision: raw as "review" | "hold" | undefined, limit, offset })), unit: "deals", asOf: win.asOf, timezone: win.timezone });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET today's auto-approved decision EVENTS (paginated, uncapped total) ──────────────────────
  app.get("/api/underwriting/approved-today", requireRole("admin", "manager"), async (req, res) => {
    try {
      const win = await getBusinessDayWindow(pool);
      const { limit, offset } = normalizePage(req.query.limit, req.query.offset);
      res.json({ ...(await getApprovedSincePage(pool, { since: win.since, limit, offset })), unit: "decision_events", since: win.since, asOf: win.asOf, timezone: win.timezone });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET stats: `current` (deals waiting now, same cohort as the queue) vs decision-event history ──
  app.get("/api/underwriting/stats", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const win = await getBusinessDayWindow(pool);
      res.json({ ...(await getStatsSummary(pool, win.since)), window: { since: win.since, asOf: win.asOf, timezone: win.timezone } });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Manual approve / reject override ─────────────────────────────────────
  // The decision override, stage move, durable follow-on intents (GHL task, reject notification) and audit row commit
  // atomically (services/underwriting-override-service.ts). The reviewer presents the decision id + revision they saw,
  // a reason and a client command id; a stale review is a 409 before any local change, and a repeated command id replays.
  const overrideBody = z.object({
    expectedDecisionId: z.number().int().positive(),
    expectedRevision: z.string().min(8).max(64),
    reason: z.string().trim().min(3).max(2000),
    commandId: z.string().uuid(),
  }).strict();

  async function handleOverride(req: any, res: any, action: "approve" | "reject") {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal ID" });
      const userId = typeof req.user?.id === "string" ? req.user.id : req.user?.id != null ? String(req.user.id) : null;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const body = overrideBody.safeParse(req.body ?? {});
      if (!body.success) {
        return res.status(400).json({ message: "Invalid request", code: "invalid_override_request", fields: body.error.issues.map((i) => i.path.join(".")) });
      }
      const result = await applyUnderwritingOverride({ dealId, action, userId, ...body.data });
      res.status(200).json({
        ok: true, decision: result.decision, stageMoved: result.stageMoved, replayed: result.replayed,
        // Follow-ons are durable and executed later by the effect worker; none has happened yet.
        followOns: { state: result.replayed ? "recorded_earlier" : "queued", effects: result.followOns },
      });
    } catch (err: any) {
      if (err instanceof OverrideError) return res.status(err.status).json({ message: err.message, code: err.code });
      serverError(res, err);
    }
  }

  app.post("/api/underwriting/deals/:id/approve", requireRole("admin", "manager"), (req, res) => handleOverride(req, res, "approve"));
  app.post("/api/underwriting/deals/:id/reject", requireRole("admin", "manager"), (req, res) => handleOverride(req, res, "reject"));

  // ── Retired: re-running the engine from a button created decisions outside the queue's pipeline ──────────────
  // Decisions are produced by the statement-analysis pipeline. The route stays registered so callers get a stable,
  // authenticated answer instead of a 404; nothing is evaluated or written.
  app.post("/api/underwriting/deals/:id/evaluate", requireRole("admin", "manager"), (_req, res) => {
    res.status(410).json({
      code: "UNDERWRITING_EVALUATE_RETIRED", performed: false,
      message: "Manual re-evaluation was retired. Decisions come from statement analysis; review or override the current decision instead.",
    });
  });
}
