import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertCampaignSchema, insertCampaignStepSchema, insertFollowUpSequenceSchema, insertSequenceEnrollmentSchema, insertSequenceStepSchema } from "@shared/schema";
import type { AbTestConfig, AbTestResults } from "@shared/schema";
import { getCampaignAnalytics, processSendQueue, queueCampaignMessages } from "../services/campaign-engine";
import { parse } from "csv-parse/sync";
import { checkAbTestWinners } from "../services/ab-test-worker";

interface AbTestResultRow {
  sequenceId: number;
  sequenceName: string;
  stepId: number;
  stepOrder: number;
  actionType: string;
  variantA: { subject?: string; body?: string };
  variantB: { subject?: string; body?: string };
  abTestConfig: { splitRatio: number; minSampleSize: number; winnerCriteria: string };
  abTestResults: Partial<AbTestResults>;
}

export function registerCampaignsRoutes(app: Express) {
  // === CAMPAIGNS ===
  app.get("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const campaigns = await storage.getCampaigns();
      res.json(campaigns);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getCampaign(Number(req.params.id));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      res.json(campaign);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignSchema.parse(req.body);
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCampaign(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/campaigns/:id/analytics", isAuthenticated, async (req, res) => {
    try {
      const analytics = await getCampaignAnalytics(Number(req.params.id));
      res.json(analytics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === CAMPAIGN STEPS ===
  app.get("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getCampaignSteps(Number(req.params.id));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignStepSchema.parse({ ...req.body, campaignId: Number(req.params.id) });
      const step = await storage.createCampaignStep(input);
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/campaign-steps/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCampaignStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Step not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/campaign-steps/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCampaignStep(Number(req.params.id));
      res.json({ message: "Step deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === OUTBOUND MESSAGES ===
  app.get("/api/outbound-messages", isAuthenticated, async (req, res) => {
    try {
      const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
      const messages = await storage.getOutboundMessages(campaignId);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/campaigns/:id/queue", isAuthenticated, async (req, res) => {
    try {
      const queued = await queueCampaignMessages(Number(req.params.id));
      res.json({ queued, message: `${queued} messages queued for sending` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/outbound/process-queue", isAuthenticated, async (req, res) => {
    try {
      const result = await processSendQueue();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === OUTBOUND WEBHOOK (for GHL tracking) ===
  app.post("/api/outbound/webhook", async (req, res) => {
    try {
      const { messageId, event } = req.body;
      if (!messageId || !event) return res.status(400).json({ message: "Missing messageId or event" });

      const msg = await storage.getOutboundMessage(Number(messageId));
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const updates: Record<string, any> = {};
      if (event === "opened") { updates.status = "opened"; updates.openedAt = new Date(); }
      if (event === "replied") { updates.status = "replied"; updates.repliedAt = new Date(); }
      if (event === "bounced") { updates.status = "bounced"; updates.bouncedAt = new Date(); }
      if (event === "unsubscribed") {
        updates.status = "unsubscribed";
        if (msg.prospectId) {
          await storage.updateProspect(msg.prospectId, { doNotContact: true, status: "do_not_contact" });
        }
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateOutboundMessage(msg.id, updates);
      }

      res.json({ message: "Webhook processed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === FOLLOW-UP SEQUENCES (DRIP CAMPAIGNS) ===
  app.get("/api/sequences", isAuthenticated, async (req, res) => {
    try {
      const sequences = await storage.getFollowUpSequences();
      res.json(sequences);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sequences/:id", isAuthenticated, async (req, res) => {
    try {
      const seq = await storage.getFollowUpSequence(Number(req.params.id));
      if (!seq) return res.status(404).json({ message: "Not found" });
      res.json(seq);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequences", isAuthenticated, async (req, res) => {
    try {
      const input = insertFollowUpSequenceSchema.parse(req.body);
      const seq = await storage.createFollowUpSequence(input);
      await storage.createAuditLog({ action: "sequence_created", entityType: "sequence", entityId: seq.id, details: { name: seq.name } });
      res.status(201).json(seq);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequences/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateFollowUpSequence(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/sequences/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteFollowUpSequence(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === SEQUENCE STEPS ===
  app.get("/api/sequences/:sequenceId/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getSequenceSteps(Number(req.params.sequenceId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequences/:sequenceId/steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertSequenceStepSchema.parse({ ...req.body, sequenceId: Number(req.params.sequenceId) });
      const step = await storage.createSequenceStep(input);
      const seq = await storage.getFollowUpSequence(Number(req.params.sequenceId));
      if (seq) {
        const steps = await storage.getSequenceSteps(seq.id);
        await storage.updateFollowUpSequence(seq.id, { totalSteps: steps.length });
      }
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequence-steps/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateSequenceStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/sequence-steps/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteSequenceStep(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === SEQUENCE ENROLLMENTS ===
  app.get("/api/sequence-enrollments", isAuthenticated, async (req, res) => {
    try {
      const sequenceId = req.query.sequenceId ? Number(req.query.sequenceId) : undefined;
      const enrollments = await storage.getSequenceEnrollments(sequenceId);
      res.json(enrollments);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequence-enrollments", isAuthenticated, async (req, res) => {
    try {
      const input = insertSequenceEnrollmentSchema.parse(req.body);
      const enrollment = await storage.createSequenceEnrollment(input);
      await storage.createAuditLog({ action: "sequence_enrolled", entityType: "contact", entityId: enrollment.contactId || 0, details: { sequenceId: String(enrollment.sequenceId) } });
      res.status(201).json(enrollment);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequence-enrollments/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateSequenceEnrollment(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:contactId/enrollments", isAuthenticated, async (req, res) => {
    try {
      const enrollments = await storage.getContactEnrollments(Number(req.params.contactId));
      res.json(enrollments);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === A/B TEST RESULTS ===
  app.get("/api/sequences/ab-test-results", isAuthenticated, async (_req, res) => {
    try {
      const sequences = await storage.getFollowUpSequences();
      const results: AbTestResultRow[] = [];
      for (const seq of sequences) {
        const steps = await storage.getSequenceSteps(seq.id);
        for (const step of steps) {
          const cfg = step.abTestConfig as AbTestConfig | null;
          if (cfg && (step.variantBSubject || step.variantBBody)) {
            const r = (step.abTestResults as Partial<AbTestResults>) || {};
            results.push({
              sequenceId: seq.id,
              sequenceName: seq.name ?? "",
              stepId: step.id,
              stepOrder: step.stepOrder ?? 1,
              actionType: step.actionType ?? "email",
              variantA: { subject: step.subject ?? undefined, body: step.body ?? undefined },
              variantB: { subject: step.variantBSubject ?? undefined, body: step.variantBBody ?? undefined },
              abTestConfig: {
                splitRatio: cfg.splitRatio ?? 50,
                minSampleSize: cfg.minSampleSize ?? 100,
                winnerCriteria: cfg.winnerCriteria ?? "open_rate",
              },
              abTestResults: {
                variantASent: r.variantASent ?? 0,
                variantBSent: r.variantBSent ?? 0,
                aOpens: r.aOpens ?? 0,
                bOpens: r.bOpens ?? 0,
                aClicks: r.aClicks ?? 0,
                bClicks: r.bClicks ?? 0,
                aReplies: r.aReplies ?? 0,
                bReplies: r.bReplies ?? 0,
                winnerSelected: r.winnerSelected ?? null,
                winnerAt: r.winnerAt ?? null,
                startedAt: r.startedAt ?? null,
                statisticallySignificant: r.statisticallySignificant,
              },
            });
          }
        }
      }
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequence-steps/:id/ab-test-results", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        variantASent: z.number().int().min(0).optional(),
        variantBSent: z.number().int().min(0).optional(),
        aOpens: z.number().int().min(0).optional(),
        bOpens: z.number().int().min(0).optional(),
        aClicks: z.number().int().min(0).optional(),
        bClicks: z.number().int().min(0).optional(),
        aReplies: z.number().int().min(0).optional(),
        bReplies: z.number().int().min(0).optional(),
        winnerSelected: z.string().nullable().optional(),
        winnerAt: z.string().nullable().optional(),
        statisticallySignificant: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const step = await storage.updateSequenceStepAbTestResults(
        Number(req.params.id),
        {
          variantASent: parsed.data.variantASent ?? 0,
          variantBSent: parsed.data.variantBSent ?? 0,
          aOpens: parsed.data.aOpens ?? 0,
          bOpens: parsed.data.bOpens ?? 0,
          aClicks: parsed.data.aClicks ?? 0,
          bClicks: parsed.data.bClicks ?? 0,
          aReplies: parsed.data.aReplies ?? 0,
          bReplies: parsed.data.bReplies ?? 0,
          winnerSelected: parsed.data.winnerSelected ?? null,
          winnerAt: parsed.data.winnerAt ?? null,
          startedAt: null,
          statisticallySignificant: parsed.data.statisticallySignificant,
        }
      );
      if (!step) return res.status(404).json({ message: "Step not found" });
      res.json(step);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequences/trigger-ab-check", isAuthenticated, async (_req, res) => {
    try {
      const result = await checkAbTestWinners();
      res.json({ message: "A/B test check complete", ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-logs/:id/track-click", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.updateEmailLog(id, { clickedAt: new Date(), status: "clicked" });
      res.json({ message: "Click recorded" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
