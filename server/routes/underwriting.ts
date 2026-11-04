import type { Express } from "express";
import { applyUnderwritingOverride, OverrideError } from "../services/underwriting-override-service";
import { getQueuePage, getApprovedSincePage, getStatsSummary, normalizePage } from "../services/underwriting-read-model";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { runUnderwritingEngine } from "../services/underwriting-engine";
import { z } from "zod";
import { pool } from "../db";
import { isGhlConfigured, createGhlTask } from "../services/ghl";
import { serverError } from "../utils/server-error";
import { authorizeGhlRouteMutation } from "./ghl-mutation-pause";

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
      res.json(await getQueuePage(pool, { decision: raw as "review" | "hold" | undefined, limit, offset }));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET today's auto-approved decision EVENTS (paginated, uncapped total) ──────────────────────
  app.get("/api/underwriting/approved-today", requireRole("admin", "manager"), async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { limit, offset } = normalizePage(req.query.limit, req.query.offset);
      res.json(await getApprovedSincePage(pool, { since: today, limit, offset }));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── GET stats: `current` (deals waiting now, same cohort as the queue) vs decision-event history ──
  app.get("/api/underwriting/stats", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      res.json(await getStatsSummary(pool, today));
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ── Manual approve / reject override ─────────────────────────────────────
  // S5-08: the decision override, stage move, effect intents and audit row commit atomically (see
  // services/underwriting-override-service.ts). The optional GHL task is checked and attempted only AFTER commit.
  const overrideBody = z.object({ note: z.string().max(2000).nullish() }).strict();

  async function handleOverride(req: any, res: any, action: "approve" | "reject") {
    try {
      const dealId = Number(req.params.id);
      if (!Number.isInteger(dealId) || dealId <= 0) return res.status(400).json({ message: "Invalid deal ID" });
      const userId = typeof req.user?.id === "string" ? req.user.id : req.user?.id != null ? String(req.user.id) : null;
      if (!userId) return res.status(401).json({ message: "Authentication required" });
      const body = overrideBody.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ message: "Invalid request" });
      const note = body.data.note ?? undefined;

      const result = await applyUnderwritingOverride({ dealId, action, note, userId });

      // ── best-effort follow-ons (never change the committed outcome) ──
      if (action === "reject") {
        await storage.createNotification({
          channel: "internal",
          title: "Underwriting Decision Rejected",
          message: `Deal #${dealId} was manually rejected and returned to Review In Progress.`,
          type: "alert",
          recipientId: userId,
          metadata: { dealId, decisionId: result.decision.id, eventType: "underwriting_rejected" },
        }).catch((e: Error) => console.warn("[Underwriting] reject notification (non-critical):", e.message));
      }
      let ghlTask: "not_applicable" | "attempted" | "skipped_paused" = "not_applicable";
      try {
        if (isGhlConfigured()) {
          const deal = await storage.getDeal(dealId).catch(() => null);
          const contact = deal?.contactId ? await storage.getContact(deal.contactId).catch(() => null) : null;
          if (contact?.ghlContactId) {
            const ghlDecision = await authorizeGhlRouteMutation().catch(() => null);
            if (ghlDecision?.allowed) {
              ghlTask = "attempted";
              const company = deal?.companyName || "Unknown";
              createGhlTask({
                contactId: contact.ghlContactId,
                title: action === "approve"
                  ? `Underwriting Approved — Deal #${dealId}: ${company} — advance to Proposal Sent`
                  : `Underwriting Rejected — Deal #${dealId}: ${company} — returned to Review In Progress${note ? ` — Note: ${note}` : ""}`,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                assignedTo: undefined,
              }).catch((err: Error) => console.warn(`[Underwriting] createGhlTask (${action}, non-critical):`, err.message));
            } else {
              ghlTask = "skipped_paused";
            }
          }
        }
      } catch (e) {
        console.warn("[Underwriting] GHL follow-on (non-critical):", (e as Error).message);
      }

      res.json({ ok: true, decision: result.decision, stageMoved: result.stageMoved, ghlTask });
    } catch (err: any) {
      if (err instanceof OverrideError) return res.status(err.status).json({ message: err.message, code: err.code });
      serverError(res, err);
    }
  }

  app.post("/api/underwriting/deals/:id/approve", requireRole("admin", "manager"), (req, res) => handleOverride(req, res, "approve"));
  app.post("/api/underwriting/deals/:id/reject", requireRole("admin", "manager"), (req, res) => handleOverride(req, res, "reject"));

}
