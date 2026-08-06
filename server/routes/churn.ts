import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { computeAndPersistChurnScore } from "../services/churn-score";
import { serverError } from "../utils/server-error";

export function registerChurnRoutes(app: Express) {
  // GET all merchant health scores (with optional filters)
  app.get("/api/churn-scores", isDashboardUser, async (req, res) => {
    try {
      const { riskTier, vertical, agentOwner } = req.query as Record<string, string>;
      const scores = await storage.getMerchantHealthScores({
        riskTier: riskTier && riskTier !== "all" ? riskTier : undefined,
        vertical: vertical && vertical !== "all" ? vertical : undefined,
        agentOwner: agentOwner && agentOwner !== "all" ? agentOwner : undefined,
      });

      // Batch-fetch all contacts in a single IN (...) query instead of N individual lookups
      const contactIds = scores.map(s => s.contactId).filter((id): id is number => id != null);
      const contactRows = await storage.getContactsByIds(contactIds);
      const contactMap = new Map(contactRows.map(c => [c.id, c]));

      const enriched = scores.map(s => {
        const contact = s.contactId != null ? contactMap.get(s.contactId) ?? null : null;
        return {
          ...s,
          contact: contact
            ? {
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName,
                companyName: contact.companyName,
                vertical: contact.vertical,
                email: contact.email,
              }
            : null,
        };
      });

      res.json(enriched);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET churn risk summary (count per tier)
  app.get("/api/churn-scores/summary", isDashboardUser, async (req, res) => {
    try {
      const summary = await storage.getChurnRiskSummary();
      res.json(summary);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET churn score for a specific contact
  app.get("/api/churn-scores/contact/:contactId", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const score = await storage.getMerchantHealthScoreByContact(contactId);
      res.json(score || null);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST trigger churn score recomputation for a specific contact
  app.post("/api/churn-scores/contact/:contactId/compute", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const score = await computeAndPersistChurnScore(contactId);
      res.json(score);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST override churn score (admin/manager only)
  app.post("/api/churn-scores/contact/:contactId/override", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const { overrideScore, overrideNote } = req.body;

      if (overrideScore === undefined || overrideScore === null) {
        return res.status(400).json({ message: "overrideScore is required" });
      }
      if (!overrideNote || !overrideNote.trim()) {
        return res.status(400).json({ message: "overrideNote (justification) is required" });
      }
      if (overrideScore < 0 || overrideScore > 100) {
        return res.status(400).json({ message: "overrideScore must be between 0 and 100" });
      }

      const user = (req as any).user;
      const overriddenBy = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Admin";

      let existing = await storage.getMerchantHealthScoreByContact(contactId);
      if (!existing) {
        existing = await computeAndPersistChurnScore(contactId);
      }

      const tierFromScore = (s: number) => s > 85 ? "Critical" : s > 70 ? "High" : s >= 40 ? "Medium" : "Low";

      const newTier = tierFromScore(overrideScore);
      const updated = await storage.updateMerchantHealthScore(existing.id, {
        overrideScore,
        overrideNote: overrideNote.trim(),
        overriddenAt: new Date(),
        overriddenBy,
        riskTier: newTier,
      });

      // Propagate override tier immediately to the contacts record
      try {
        await storage.updateContact(contactId, { churnRiskTier: newTier });
      } catch {}

      await storage.createAuditLog({
        action: "churn_score_override",
        entityType: "contact",
        entityId: contactId,
        details: {
          originalScore: existing.churnScore,
          overrideScore,
          overrideNote: overrideNote.trim(),
          overriddenBy,
          overriddenAt: new Date().toISOString(),
        },
      });

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // DELETE override (revert to computed score)
  app.delete("/api/churn-scores/contact/:contactId/override", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const existing = await storage.getMerchantHealthScoreByContact(contactId);
      if (!existing) return res.status(404).json({ message: "No churn score found for this contact" });

      const tierFromScore = (s: number) => s > 85 ? "Critical" : s > 70 ? "High" : s >= 40 ? "Medium" : "Low";
      const revertedTier = tierFromScore(existing.churnScore);
      const updated = await storage.updateMerchantHealthScore(existing.id, {
        overrideScore: null,
        overrideNote: null,
        overriddenAt: null,
        overriddenBy: null,
        riskTier: revertedTier,
      });

      // Propagate reverted tier immediately to the contacts record
      try {
        await storage.updateContact(contactId, { churnRiskTier: revertedTier });
      } catch {}

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET churn score weights config
  app.get("/api/churn-score-weights", isDashboardUser, async (req, res) => {
    try {
      const weights = await storage.getChurnScoreWeights();
      res.json(weights);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PUT update a churn score weight (admin only)
  app.put("/api/churn-score-weights/:signalKey", requireRole("admin", "manager"), async (req, res) => {
    try {
      const signalKey = req.params.signalKey as string;
      const { weight } = req.body;
      if (weight === undefined || weight < 0 || weight > 5) {
        return res.status(400).json({ message: "weight must be between 0 and 5" });
      }
      const updated = await storage.upsertChurnScoreWeight(signalKey, weight);
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
