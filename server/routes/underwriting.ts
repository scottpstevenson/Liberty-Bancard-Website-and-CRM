import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { runUnderwritingEngine } from "../services/underwriting-engine";
import { z } from "zod";
import { pool } from "../db";
import { isGhlConfigured, createGhlTask } from "../services/ghl";

export function registerUnderwritingRoutes(app: Express) {
  // ── GET current rules config ─────────────────────────────────────────────
  app.get("/api/underwriting/rules", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const rules = await storage.getUnderwritingRules();
      res.json(rules);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── GET underwriting queue (pending review/hold deals) ───────────────────
  app.get("/api/underwriting/queue", requireRole("admin", "manager"), async (req, res) => {
    try {
      const decision = req.query.decision as "review" | "hold" | undefined;

      const params: any[] = [];
      let decisionFilter = `latest.decision IN ('review', 'hold')`;
      if (decision) {
        params.push(decision);
        decisionFilter = `latest.decision = $${params.length}`;
      }

      // Use DISTINCT ON to return only the latest decision per deal.
      // Overridden decisions are excluded from the queue.
      const { rows } = await pool.query(
        `
        WITH latest AS (
          SELECT DISTINCT ON (deal_id)
            ud.*
          FROM underwriting_decisions ud
          ORDER BY deal_id, ud.created_at DESC
        )
        SELECT
          latest.*,
          d.stage AS deal_stage,
          d.contact_id AS deal_contact_id,
          d.total_volume,
          d.effective_rate,
          d.pipeline,
          c.first_name,
          c.last_name,
          c.company_name,
          c.email
        FROM latest
        LEFT JOIN deals d ON d.id = latest.deal_id
        LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE latest.override_action IS NULL
          AND ${decisionFilter}
        ORDER BY
          CASE latest.decision WHEN 'hold' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
          latest.created_at DESC
        LIMIT 200
        `,
        params,
      );

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET today's auto-approved decisions ──────────────────────────────────
  app.get("/api/underwriting/approved-today", requireRole("admin", "manager"), async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { rows } = await pool.query(
        `
        SELECT
          ud.*,
          d.stage AS deal_stage,
          d.contact_id AS deal_contact_id,
          c.first_name,
          c.last_name,
          c.company_name
        FROM underwriting_decisions ud
        LEFT JOIN deals d ON d.id = ud.deal_id
        LEFT JOIN contacts c ON c.id = d.contact_id
        WHERE ud.decision = 'approve' AND ud.created_at >= $1
        ORDER BY ud.created_at DESC
        LIMIT 100
        `,
        [today],
      );

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── GET stats ────────────────────────────────────────────────────────────
  app.get("/api/underwriting/stats", requireRole("admin", "manager"), async (req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE decision = 'approve') AS approved_today,
          COUNT(*) FILTER (WHERE decision = 'review' AND override_action IS NULL) AS pending_review,
          COUNT(*) FILTER (WHERE decision = 'hold' AND override_action IS NULL) AS pending_hold,
          COUNT(*) FILTER (WHERE override_action IS NOT NULL) AS overridden_total
        FROM underwriting_decisions
        WHERE created_at >= $1
      `, [today]);

      const allTime = await storage.getUnderwritingStats();

      res.json({
        today: {
          approved: parseInt(rows[0]?.approved_today ?? "0"),
          pendingReview: parseInt(rows[0]?.pending_review ?? "0"),
          pendingHold: parseInt(rows[0]?.pending_hold ?? "0"),
          overridden: parseInt(rows[0]?.overridden_total ?? "0"),
        },
        allTime,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST manual approve override ─────────────────────────────────────────
  app.post(
    "/api/underwriting/deals/:id/approve",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseInt(req.params.id, 10);
        const { note } = req.body;
        const userId = (req.user as any)?.id?.toString() ?? null;

        const decision = await storage.getUnderwritingDecisionByDeal(dealId);
        if (!decision) {
          return res.status(404).json({ message: "No underwriting decision found for this deal" });
        }

        const updated = await storage.overrideUnderwritingDecision(
          decision.id,
          "approve",
          userId ?? "unknown",
          note,
        );

        const { advanceDealStage } = await import("../services/deal-stage-service");
        await advanceDealStage(dealId, "Proposal Sent", "underwriting_manual_approve").catch(() => {});

        if (isGhlConfigured()) {
          const deal = await storage.getDeal(dealId).catch(() => null);
          const contact = deal?.contactId ? await storage.getContact(deal.contactId).catch(() => null) : null;
          if (contact?.ghlContactId) {
            createGhlTask({
              contactId: contact.ghlContactId,
              title: `Underwriting Approved — Deal #${dealId}: ${deal?.companyName || "Unknown"} — advance to Proposal Sent`,
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              assignedTo: undefined,
            }).catch((err: Error) => console.warn("[Underwriting] createGhlTask (approve, non-critical):", err.message));
          }
        }

        await storage.createAuditLog({
          action: "underwriting_manual_approve",
          entityType: "deal",
          entityId: dealId,
          actorType: "user",
          actorId: userId,
          userId,
          details: {
            decisionId: decision.id,
            previousDecision: decision.decision,
            overrideNote: note,
            rulesSnapshot: decision.rulesSnapshot,
            timestamp: new Date().toISOString(),
          },
        });

        res.json({ ok: true, decision: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST manual reject/hold override ────────────────────────────────────
  app.post(
    "/api/underwriting/deals/:id/reject",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseInt(req.params.id, 10);
        const { note } = req.body;
        const userId = (req.user as any)?.id?.toString() ?? null;

        const decision = await storage.getUnderwritingDecisionByDeal(dealId);
        if (!decision) {
          return res.status(404).json({ message: "No underwriting decision found for this deal" });
        }

        const updated = await storage.overrideUnderwritingDecision(
          decision.id,
          "reject",
          userId ?? "unknown",
          note,
        );

        const { advanceDealStage } = await import("../services/deal-stage-service");
        await advanceDealStage(dealId, "Review In Progress", "underwriting_manual_reject").catch(() => {});

        await storage.createNotification({
          channel: "internal",
          title: "Underwriting Decision Rejected",
          message: `Deal #${dealId} was manually rejected and returned to Review In Progress.`,
          type: "alert",
          recipientId: userId ?? undefined,
          metadata: { dealId, decisionId: decision.id, eventType: "underwriting_rejected" },
        });

        if (isGhlConfigured()) {
          const deal = await storage.getDeal(dealId).catch(() => null);
          const contact = deal?.contactId ? await storage.getContact(deal.contactId).catch(() => null) : null;
          if (contact?.ghlContactId) {
            createGhlTask({
              contactId: contact.ghlContactId,
              title: `Underwriting Rejected — Deal #${dealId}: ${deal?.companyName || "Unknown"} — returned to Review In Progress${note ? ` — Note: ${note}` : ""}`,
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              assignedTo: undefined,
            }).catch((err: Error) => console.warn("[Underwriting] createGhlTask (reject, non-critical):", err.message));
          }
        }

        await storage.createAuditLog({
          action: "underwriting_manual_reject",
          entityType: "deal",
          entityId: dealId,
          actorType: "user",
          actorId: userId,
          userId,
          details: {
            decisionId: decision.id,
            previousDecision: decision.decision,
            overrideNote: note,
            rulesSnapshot: decision.rulesSnapshot,
            timestamp: new Date().toISOString(),
          },
        });

        res.json({ ok: true, decision: updated });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );

  // ── POST run underwriting engine on a specific deal (re-evaluate) ────────
  app.post(
    "/api/underwriting/deals/:id/evaluate",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const dealId = parseInt(req.params.id, 10);
        const deal = await storage.getDeal(dealId);
        if (!deal) return res.status(404).json({ message: "Deal not found" });

        const result = await runUnderwritingEngine({ deal });

        const decision = await storage.createUnderwritingDecision({
          dealId,
          decision: result.decision,
          score: result.score,
          reasons: result.reasons,
          rulesSnapshot: result.rulesSnapshot,
          decidedAt: new Date(),
        });

        res.json({ decision: result.decision, score: result.score, reasons: result.reasons, record: decision });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    },
  );
}
