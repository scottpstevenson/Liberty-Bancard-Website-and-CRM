import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertCampaignSchema, insertCampaignStepSchema, insertFollowUpSequenceSchema, insertSequenceEnrollmentSchema, insertSequenceStepSchema } from "@shared/schema";
import { getCampaignAnalytics, processSendQueue, queueCampaignMessages } from "../services/campaign-engine";
import { parse } from "csv-parse/sync";

export function registerCampaignsRoutes(app: Express) {
  // === CAMPAIGNS ===
  app.get("/api/campaigns", async (req, res) => {
    const campaigns = await storage.getCampaigns();
    res.json(campaigns);
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    const campaign = await storage.getCampaign(Number(req.params.id));
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });

  app.post("/api/campaigns", async (req, res) => {
    try {
      const input = insertCampaignSchema.parse(req.body);
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/campaigns/:id", async (req, res) => {
    const updated = await storage.updateCampaign(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Campaign not found" });
    res.json(updated);
  });

  app.get("/api/campaigns/:id/analytics", async (req, res) => {
    try {
      const analytics = await getCampaignAnalytics(Number(req.params.id));
      res.json(analytics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === CAMPAIGN STEPS ===
  app.get("/api/campaigns/:id/steps", async (req, res) => {
    const steps = await storage.getCampaignSteps(Number(req.params.id));
    res.json(steps);
  });

  app.post("/api/campaigns/:id/steps", async (req, res) => {
    try {
      const input = insertCampaignStepSchema.parse({ ...req.body, campaignId: Number(req.params.id) });
      const step = await storage.createCampaignStep(input);
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/campaign-steps/:id", async (req, res) => {
    const updated = await storage.updateCampaignStep(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Step not found" });
    res.json(updated);
  });

  app.delete("/api/campaign-steps/:id", async (req, res) => {
    await storage.deleteCampaignStep(Number(req.params.id));
    res.json({ message: "Step deleted" });
  });


  // === OUTBOUND MESSAGES ===
  app.get("/api/outbound-messages", async (req, res) => {
    const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
    const messages = await storage.getOutboundMessages(campaignId);
    res.json(messages);
  });

  app.post("/api/campaigns/:id/queue", async (req, res) => {
    try {
      const queued = await queueCampaignMessages(Number(req.params.id));
      res.json({ queued, message: `${queued} messages queued for sending` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/outbound/process-queue", async (req, res) => {
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
  app.get("/api/sequences", async (req, res) => {
    const sequences = await storage.getFollowUpSequences();
    res.json(sequences);
  });

  app.get("/api/sequences/:id", async (req, res) => {
    const seq = await storage.getFollowUpSequence(Number(req.params.id));
    if (!seq) return res.status(404).json({ message: "Not found" });
    res.json(seq);
  });

  app.post("/api/sequences", async (req, res) => {
    try {
      const input = insertFollowUpSequenceSchema.parse(req.body);
      const seq = await storage.createFollowUpSequence(input);
      await storage.createAuditLog({ action: "sequence_created", entityType: "sequence", entityId: seq.id, details: { name: seq.name } });
      res.status(201).json(seq);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/sequences/:id", async (req, res) => {
    const updated = await storage.updateFollowUpSequence(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/sequences/:id", async (req, res) => {
    await storage.deleteFollowUpSequence(Number(req.params.id));
    res.json({ success: true });
  });


  // === SEQUENCE STEPS ===
  app.get("/api/sequences/:sequenceId/steps", async (req, res) => {
    const steps = await storage.getSequenceSteps(Number(req.params.sequenceId));
    res.json(steps);
  });

  app.post("/api/sequences/:sequenceId/steps", async (req, res) => {
    try {
      const input = insertSequenceStepSchema.parse({ ...req.body, sequenceId: Number(req.params.sequenceId) });
      const step = await storage.createSequenceStep(input);
      const seq = await storage.getFollowUpSequence(Number(req.params.sequenceId));
      if (seq) {
        const steps = await storage.getSequenceSteps(seq.id);
        await storage.updateFollowUpSequence(seq.id, { totalSteps: steps.length });
      }
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/sequence-steps/:id", async (req, res) => {
    const updated = await storage.updateSequenceStep(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/sequence-steps/:id", async (req, res) => {
    await storage.deleteSequenceStep(Number(req.params.id));
    res.json({ success: true });
  });


  // === SEQUENCE ENROLLMENTS ===
  app.get("/api/sequence-enrollments", async (req, res) => {
    const sequenceId = req.query.sequenceId ? Number(req.query.sequenceId) : undefined;
    const enrollments = await storage.getSequenceEnrollments(sequenceId);
    res.json(enrollments);
  });

  app.post("/api/sequence-enrollments", async (req, res) => {
    try {
      const input = insertSequenceEnrollmentSchema.parse(req.body);
      const enrollment = await storage.createSequenceEnrollment(input);
      await storage.createAuditLog({ action: "sequence_enrolled", entityType: "contact", entityId: enrollment.contactId || 0, details: { sequenceId: String(enrollment.sequenceId) } });
      res.status(201).json(enrollment);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/sequence-enrollments/:id", async (req, res) => {
    const updated = await storage.updateSequenceEnrollment(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.get("/api/contacts/:contactId/enrollments", async (req, res) => {
    const enrollments = await storage.getContactEnrollments(Number(req.params.contactId));
    res.json(enrollments);
  });

}
