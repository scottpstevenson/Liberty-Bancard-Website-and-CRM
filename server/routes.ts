import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated, isAdmin, isAffiliate } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import bcrypt from "bcryptjs";
import { db, pool } from "./db";
import { users } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { z } from "zod";
import { insertContactSchema, insertDealSchema, insertTicketSchema, insertTaskSchema, insertCompanySchema, insertDocumentSchema, insertNotificationSchema, insertWorkflowSchema, insertRfiSchema, insertMessageTemplateSchema, insertCollateralPacketSchema, insertSlaConfigSchema, insertProspectSchema, insertProspectListSchema, insertEnrichmentJobSchema, insertCampaignSchema, insertCampaignStepSchema, insertOutboundMessageSchema, insertNoteSchema, insertEmailLogSchema, insertCallLogSchema, insertStageAutomationRuleSchema, insertFollowUpSequenceSchema, insertSequenceStepSchema, insertSequenceEnrollmentSchema, insertMerchantApplicationSchema, insertEquipmentOrderSchema, insertAgentSchema, insertResidualReportSchema, insertMerchantResidualSchema, insertHealthAlertSchema, insertDealCompetitorSchema, insertPartnerSchema, insertReferralSchema, insertKnowledgeBaseSchema, insertReviewRequestSchema, insertOnboardingStepSchema, insertMerchantProfileSchema, insertConsentAuditLogSchema, insertCalendarEventSchema, insertAgentQuotaSchema, insertDataDeleteRequestSchema, insertCommentSchema, insertTicketCommentSchema, insertContactCompanySchema, insertPipelineStageSchema, insertNotificationPreferenceSchema, insertSavedFilterSchema } from "@shared/schema";
import { isGhlConfigured, getGhlStatus, sendGhlEmail, sendGhlEmailForMerchant, sendGhlSms, sendTemplatedMessage, upsertGhlContact, handleGhlWebhook, getCalendarBookingUrl, sendDocumentForEsign, getDocumentStatus } from "./services/ghl";
import { enrichProspect, runEnrichmentJob, processEnrichmentQueue, enrichContactBatch, isContactEnrichRunning } from "./services/enrichment";
import { isSerperConfigured, getSerperUsage, resetSerperUsage } from "./services/serper";
import { queueCampaignMessages, processSendQueue, getCampaignAnalytics } from "./services/campaign-engine";
import { autoEnrollFromTrigger } from "./services/sequence-worker";
import { triggerWorkflowsByEvent, executeWorkflowActions } from "./services/workflow-executor";
import { scoreContact, calculateRevenuePotentialFn, calculateSwitchabilityFn, calculateUnderwritingConfidenceFn, calculateQuizBonusFn } from "./services/lead-scoring";
import { generateDealBlueprint } from "./services/deal-blueprint";
import { routeContact, getRoutingRecommendation, checkCompliance } from "./services/smart-router";
import { parseSunbizCsv, searchSunbiz, getEntityDetail, streamCorevtFromZip } from "./services/sunbiz-scraper";
import { getEmailSignatureHtml, getEmailSignaturePlainText, getStoredSignature, saveSignature } from "./services/email-signatures";
import { reEnrichAllSunbizEntities, promoteQualifiedToContacts, runDailyOutreach, startDailyOutreachWorker, stopDailyOutreachWorker, importFullCorevt, importCordataEnrichment, isWorkerRunning, runMassEnrichment, isMassEnrichmentRunning } from "./services/daily-outreach";
import { syncContactToGhl, fullSyncToGhl, fullSyncFromGhl, syncDealToGhl, getGhlSyncStatus } from "./services/ghl-sync";
import { enrichSunbizEntity, processSunbizEnrichmentQueue, convertToProspect, runBulkFastClassification, runBulkAIClassification, runDailyEnrichmentPipeline, isPipelineRunning, deepEnrichEntity, runAutoDeduplication } from "./services/sunbiz-enrichment";
import { estimateFromDeal, estimateFromContact, estimateFromProspect } from "./services/volume-estimator";
import { insertSunbizEntitySchema } from "@shared/schema";
import multer from "multer";
import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import os from "os";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadLarge = multer({ dest: os.tmpdir(), limits: { fileSize: 300 * 1024 * 1024 } });

async function trackReferral(referralCode: string | undefined, contactName: string, email: string, phone?: string, company?: string) {
  if (!referralCode) return;
  try {
    const partner = await storage.getPartnerByCode(referralCode);
    if (!partner) return;
    await storage.createReferral({
      partnerId: partner.id,
      referredName: contactName,
      referredEmail: email,
      referredPhone: phone || null,
      referredCompany: company || null,
      status: "pending",
      incentiveType: "commission",
      notes: `Auto-tracked from website form`,
    });
    await storage.updatePartner(partner.id, { totalReferrals: (partner.totalReferrals || 0) + 1 } as any);
  } catch (err) {
    console.error("Referral tracking error:", err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerAudioRoutes(app);

  // === CONTACTS ===
  app.get("/api/contacts", async (req, res) => {
    const contacts = await storage.getContacts();
    res.json(contacts);
  });

  app.post("/api/contacts", async (req, res) => {
    try {
      const input = insertContactSchema.parse(req.body);
      const contact = await storage.createContact(input);
      await storage.createAuditLog({ action: "contact_created", entityType: "contact", entityId: contact.id, details: { name: `${contact.firstName} ${contact.lastName}` } });
      triggerWorkflowsByEvent("contact_created", { entityType: "contact", entityId: contact.id, contactId: contact.id }).catch(err => console.error("Workflow trigger error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      autoEnrollFromTrigger("contact_created", { contactId: contact.id }).catch(err => console.error("Auto-enroll error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      res.status(201).json(contact);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      throw err;
    }
  });

  app.get("/api/contacts/:id", async (req, res) => {
    const contact = await storage.getContact(Number(req.params.id));
    if (!contact) return res.status(404).json({ message: "Not found" });
    res.json(contact);
  });

  app.put("/api/contacts/:id", async (req, res) => {
    const updated = await storage.updateContact(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.post("/api/contacts/enrich-batch", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const schema = z.object({
        contactIds: z.array(z.number().int().positive()).optional().default([]),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message, errors: parsed.error.errors });
      }

      if (isContactEnrichRunning()) {
        return res.status(409).json({ message: "Contact enrichment is already running. Check progress at /api/contacts/enrich-progress." });
      }

      if (!isSerperConfigured()) {
        return res.status(400).json({ message: "Serper API key not configured. Set SERPER_API_KEY environment variable." });
      }

      let contactIds = parsed.data.contactIds;
      const limit = parsed.data.limit;

      if (contactIds.length === 0) {
        const allContacts = await storage.getContacts();
        contactIds = allContacts
          .filter(c => !c.email || !c.phone)
          .slice(0, limit)
          .map(c => c.id);
      }

      if (contactIds.length === 0) {
        return res.json({ message: "No contacts need enrichment", processed: 0 });
      }

      res.json({
        message: `Enrichment started for ${contactIds.length} contacts`,
        total: contactIds.length,
        started: true,
      });

      enrichContactBatch(contactIds).catch(err =>
        console.error("[ContactEnrich API] Error:", err)
      );
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/enrich-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("contact_enrich_batch_progress");
    res.json(progress || { status: "idle" });
  });

  app.get("/api/serper/status", isAuthenticated, async (req, res) => {
    const configured = isSerperConfigured();
    const usage = await getSerperUsage();
    res.json({ configured, usage });
  });

  app.post("/api/serper/reset-usage", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    await resetSerperUsage();
    res.json({ success: true, message: "Serper usage stats reset" });
  });

  // === COMPANIES ===
  app.get("/api/companies", async (req, res) => {
    const companies = await storage.getCompanies();
    res.json(companies);
  });

  app.post("/api/companies", async (req, res) => {
    try {
      const input = insertCompanySchema.parse(req.body);
      const company = await storage.createCompany(input);
      res.status(201).json(company);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === DEALS ===
  app.get("/api/deals", async (req, res) => {
    const pipeline = req.query.pipeline as string | undefined;
    const deals = pipeline ? await storage.getDealsByPipeline(pipeline) : await storage.getDeals();
    res.json(deals);
  });

  app.post("/api/deals", async (req, res) => {
    try {
      const input = insertDealSchema.parse(req.body);
      const deal = await storage.createDeal(input);
      await storage.createAuditLog({ action: "deal_created", entityType: "deal", entityId: deal.id, details: { pipeline: deal.pipeline, stage: deal.stage } });
      if (deal.contactId) {
        scoreContact(deal.contactId).catch(err => console.error("Lead scoring error:", err));
      }
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint generation error:", err));
      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/deals/:id", async (req, res) => {
    const deal = await storage.getDeal(Number(req.params.id));
    if (!deal) return res.status(404).json({ message: "Not found" });
    res.json(deal);
  });

  app.put("/api/deals/:id", async (req, res) => {
    const old = await storage.getDeal(Number(req.params.id));
    const updated = await storage.updateDeal(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    if (old && old.stage !== updated.stage) {
      await storage.createAuditLog({ action: "deal_stage_changed", entityType: "deal", entityId: updated.id, details: { from: old.stage, to: updated.stage } });
      await storage.createNotification({ channel: "internal", title: "Deal Stage Changed", message: `Deal #${updated.id} moved from "${old.stage}" to "${updated.stage}"`, type: "info" });

      try {
        const matchingRules = await storage.getMatchingStageRules(updated.pipeline, old.stage, updated.stage);
        for (const rule of matchingRules) {
          const ruleActions = (rule.actions as any[]) || [];
          for (const action of ruleActions) {
            if (action.type === "create_task") {
              await storage.createTask({
                title: action.title || `Auto: Stage moved to ${updated.stage}`,
                assignedTo: action.assignedTo || updated.owner || "Unassigned",
                priority: action.priority || "medium",
                dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                dealId: updated.id,
                contactId: updated.contactId || undefined,
              });
            } else if (action.type === "send_notification") {
              await storage.createNotification({
                channel: action.channel || "internal",
                title: action.title || `Stage Automation: ${rule.name}`,
                message: action.message || `Deal moved to ${updated.stage}`,
                type: "info",
              });
            } else if (action.type === "create_follow_up") {
              const followUpDate = new Date(Date.now() + (action.delayHours || 24) * 3600000);
              await storage.createTask({
                title: action.title || `Follow up: ${updated.stage}`,
                assignedTo: updated.owner || "Unassigned",
                priority: "high",
                dueDate: followUpDate,
                dealId: updated.id,
                contactId: updated.contactId || undefined,
                description: action.description || `Auto-generated follow-up from stage automation rule: ${rule.name}`,
              });
            } else if (action.type === "enroll_sequence" && action.sequenceId) {
              await storage.createSequenceEnrollment({
                sequenceId: action.sequenceId,
                contactId: updated.contactId || undefined,
                dealId: updated.id,
                status: "active",
                nextActionAt: new Date(),
                currentStep: 0,
              });
            }
          }
          await storage.createAuditLog({
            action: "stage_rule_triggered",
            entityType: "deal",
            entityId: updated.id,
            details: { ruleName: rule.name, fromStage: old.stage, toStage: updated.stage },
          });
        }
      } catch (ruleErr) {
        console.error("Stage automation error:", ruleErr);
      }

      try {
        const contact = updated.contactId ? await storage.getContact(updated.contactId) : null;
        const volumeEst = estimateFromDeal(updated, contact);
        await storage.updateDeal(updated.id, {
          estimatedGrossProfitBps: volumeEst.estimatedGrossProfitBps,
          estimatedGrossProfitMonthly: volumeEst.estimatedGrossProfitMonthly,
          estimatedNetProfitMonthly: volumeEst.estimatedNetProfitMonthly,
          merchantTier: volumeEst.merchantTier,
        });
        if (contact) {
          await storage.updateContact(contact.id, {
            estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
            estimatedResidual: volumeEst.estimatedResidual,
            volumeConfidence: volumeEst.volumeConfidence,
          });
        }
      } catch (volErr) {
        console.error("Volume estimate recalc error:", volErr);
      }

      autoEnrollFromTrigger("deal_stage_changed", {
        contactId: updated.contactId || undefined,
        dealId: updated.id,
        toStage: updated.stage,
        fromStage: old.stage,
        pipeline: updated.pipeline,
      } as any).catch(err => console.error("Auto-enroll on stage change error:", err));

      triggerWorkflowsByEvent("deal_stage_changed", {
        entityType: "deal",
        entityId: updated.id,
        contactId: updated.contactId || undefined,
        dealId: updated.id,
      }, { toStage: updated.stage, fromStage: old.stage }).catch(err => console.error("Workflow trigger error:", err));
    }
    res.json(updated);
  });

  app.post("/api/deals/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const estimate = estimateFromDeal(deal, contact);
      await storage.updateDeal(deal.id, {
        estimatedGrossProfitBps: estimate.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: estimate.estimatedGrossProfitMonthly,
        estimatedNetProfitMonthly: estimate.estimatedNetProfitMonthly,
        merchantTier: estimate.merchantTier,
      });
      if (contact) {
        await storage.updateContact(contact.id, {
          estimatedProcessingVolume: estimate.estimatedProcessingVolume,
          estimatedResidual: estimate.estimatedResidual,
          volumeConfidence: estimate.volumeConfidence,
        });
      }
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const contact = await storage.getContact(Number(req.params.id));
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const estimate = estimateFromContact(contact);
      await storage.updateContact(contact.id, {
        estimatedProcessingVolume: estimate.estimatedProcessingVolume,
        estimatedResidual: estimate.estimatedResidual,
        volumeConfidence: estimate.volumeConfidence,
      });
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/prospects/:id/recalculate-volume", isAuthenticated, async (req, res) => {
    try {
      const prospect = await storage.getProspect(Number(req.params.id));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      const estimate = estimateFromProspect(prospect);
      await storage.updateProspect(prospect.id, {
        estimatedVolume: estimate.estimatedProcessingVolume,
        estimatedResidual: estimate.estimatedResidual,
        estimatedAvgTicket: estimate.estimatedAvgTicket,
      });
      res.json({ success: true, estimate });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === TICKETS ===
  app.get("/api/tickets", async (req, res) => {
    const tickets = await storage.getTickets();
    res.json(tickets);
  });

  app.post("/api/tickets", async (req, res) => {
    try {
      const input = insertTicketSchema.parse(req.body);
      const ticket = await storage.createTicket(input);
      await storage.createAuditLog({ action: "ticket_created", entityType: "ticket", entityId: ticket.id, details: { category: ticket.category, priority: ticket.priority } });
      await storage.createNotification({ channel: "internal", title: `New ${ticket.priority} Support Ticket`, message: `${ticket.subject} - Category: ${ticket.category}`, type: ticket.priority === "Urgent" ? "urgent" : "info" });
      triggerWorkflowsByEvent("ticket_created", { entityType: "ticket", entityId: ticket.id }).catch(err => console.error("Workflow trigger error:", err));
      res.status(201).json(ticket);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/tickets/:id", async (req, res) => {
    const ticket = await storage.getTicket(Number(req.params.id));
    if (!ticket) return res.status(404).json({ message: "Not found" });
    res.json(ticket);
  });

  app.put("/api/tickets/:id", async (req, res) => {
    const ticketId = Number(req.params.id);
    const existing = await storage.getTickets();
    const oldTicket = existing.find(t => t.id === ticketId);
    const updated = await storage.updateTicket(ticketId, req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });

    if (oldTicket && req.body.status && req.body.status !== oldTicket.status) {
      let contact: any = null;
      if (updated.contactId) {
        contact = await storage.getContact(updated.contactId);
      }
      const merchantName = contact?.firstName || "there";

      const statusMessages: Record<string, string> = {
        "In Progress": `Hi ${merchantName} — just a quick heads up that we've picked this up and are actively working on it. You don't need to do anything right now — we'll follow up as soon as we have something for you.\n\nIf anything changes on your end in the meantime, feel free to reply here or give us a call at 954-266-8214.`,
        "Waiting on Merchant": `Hey ${merchantName} — we've looked into this and we need a couple of things from your side before we can move forward. Check the notes above for details on what we need.\n\nNo rush, but the sooner we get that info the faster we can wrap this up for you. Just reply here or email support@libertybancard.com and we'll pick it right back up.`,
        "Resolved": `Hi ${merchantName} — good news, this one's been taken care of. Here's a quick recap of what we did:\n\nIf everything looks good on your end, you're all set. If anything comes up again or doesn't seem right, just let us know — we're always here.\n\nThanks for your patience, and thanks for being with Liberty Bancard.`,
        "Closed": `This ticket has been closed. If you need further help with this issue or anything else, you can always open a new request at libertybancard.com/support or call us at 954-266-8214.\n\nWe appreciate your business.`,
      };

      const statusMsg = statusMessages[req.body.status];
      if (statusMsg) {
        await storage.createTicketComment({
          ticketId,
          content: statusMsg,
          authorName: "Liberty Bancard Support",
          isInternal: false,
        });
      }
    }

    res.json(updated);
  });

  // === TASKS ===
  app.get("/api/tasks", async (req, res) => {
    const tasks = await storage.getTasks();
    res.json(tasks);
  });

  app.post("/api/tasks", async (req, res) => {
    try {
      const input = insertTaskSchema.parse(req.body);
      const task = await storage.createTask(input);
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/tasks/:id", async (req, res) => {
    const updated = await storage.updateTask(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // === DOCUMENTS ===
  app.get("/api/documents", async (req, res) => {
    const documents = await storage.getDocuments();
    res.json(documents);
  });

  app.post("/api/documents", async (req, res) => {
    try {
      const input = insertDocumentSchema.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/documents/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { type, contactId, dealId, accessScope } = req.body;
      const fileName = req.file.originalname;
      const storageKey = `uploads/${Date.now()}_${fileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const doc = await storage.createDocument({
        contactId: contactId ? Number(contactId) : null,
        dealId: dealId ? Number(dealId) : null,
        type: type || "general",
        fileName,
        storageKey,
        accessScope: accessScope || "internal",
      });

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/documents/download/:id", isAuthenticated, async (req, res) => {
    try {
      const docs = await storage.getDocuments();
      const doc = docs.find(d => d.id === Number(req.params.id));
      if (!doc) return res.status(404).json({ message: "Document not found" });

      const uploadsDir = path.join(process.cwd(), "uploads");
      const files = fs.readdirSync(uploadsDir);
      const matchingFile = files.find(f => doc.storageKey?.includes(f) || f.includes(doc.fileName));

      if (matchingFile) {
        res.download(path.join(uploadsDir, matchingFile), doc.fileName);
      } else {
        res.status(404).json({ message: "File not found on disk" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/documents/contact/:contactId", isAuthenticated, async (req, res) => {
    const docs = await storage.getDocuments();
    const contactDocs = docs.filter(d => d.contactId === Number(req.params.contactId));
    res.json(contactDocs);
  });

  app.post("/api/merchant-portal/upload-statement", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user as any;
      const fileName = req.file.originalname;
      const storageKey = `statements/${Date.now()}_${fileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const doc = await storage.createDocument({
        type: "merchant_statement",
        fileName,
        storageKey,
        accessScope: "merchant",
      });

      await storage.createNotification({
        channel: "internal",
        title: "New Statement Uploaded",
        message: `${user.firstName} ${user.lastName} uploaded a processing statement: ${fileName}`,
        type: "info",
      });

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === NOTIFICATIONS ===
  app.get("/api/notifications", async (req, res) => {
    const notifications = await storage.getNotifications();
    res.json(notifications);
  });

  app.put("/api/notifications/:id/read", async (req, res) => {
    await storage.markNotificationRead(Number(req.params.id));
    res.json({ success: true });
  });

  // === AUDIT LOGS ===
  app.get("/api/audit-logs", async (req, res) => {
    const logs = await storage.getAuditLogs();
    res.json(logs);
  });

  // === CONFIRMATION SMS HELPER ===
  async function sendConfirmationSms(contactId: number, firstName: string, formType: string, dealId?: number) {
    try {
      const { sendGhlSms } = await import("./services/ghl");
      const now = new Date();
      const estHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
      const isBusinessHours = estHour >= 9 && estHour < 17;
      const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

      let callTimeText: string;
      if (isBusinessHours && isWeekday) {
        callTimeText = "Would it be okay if a member of our team gives you a quick call now or within the next hour to chat about your processing needs?";
      } else {
        callTimeText = "Would it be okay if a member of our team gives you a call during business hours (9 AM - 5 PM EST) to chat about your processing needs?";
      }

      const formLabels: Record<string, string> = {
        free_analysis_quiz: "completing your free savings analysis",
        get_started: "your interest in getting started",
        statement_upload: "uploading your processing statement",
        callback: "requesting a callback",
        equipment_order: "your equipment order",
        estimate: "using our savings calculator",
        support: "reaching out for support",
      };
      const contextText = formLabels[formType] || "reaching out";

      const body = `Hi ${firstName}! This is Liberty Bancard confirming we received your submission. Thank you for ${contextText}!\n\n${callTimeText}\n\nReply YES for a call, or let us know a time that works best.\n\nReply STOP to opt out. Msg&data rates may apply.`;

      await sendGhlSms({ contactId, dealId, body });
    } catch (err: any) {
      console.error(`[ConfirmSMS] Failed for contact ${contactId}:`, err.message?.slice(0, 100));
    }
  }

  // === PUBLIC FORM SUBMISSIONS ===
  app.post("/api/public/statement-upload", async (req, res) => {
    try {
      const { businessName, contactName, email, mobile, vertical, currentProvider, interestedIn0Percent, needTerminal, notes, consentSms, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const tags = ["src_website", "lead_statement_upload", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`];
      if (utmSource) tags.push(`utm_src_${utmSource}`);

      const contact = await storage.createContact({
        firstName, lastName, email, phone: mobile,
        companyName: businessName, vertical, currentProvider,
        interestedIn0Percent: interestedIn0Percent === true,
        needTerminal: needTerminal === true,
        notes, consentSms: consentSms === true,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/upload-statement",
        status: "New",
        tags,
      });

      let offerPath = "Not Sure";
      if (interestedIn0Percent) offerPath = "0% Program";
      else if (needTerminal) offerPath = "Terminal Needed";

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "Statement Received",
        offerPath, notes: `Statement uploaded. ${notes || ""}`.trim(),
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      await storage.createTask({
        dealId: deal.id, contactId: contact.id,
        title: "Review statement + send breakdown",
        assignedTo: "Scott Stevenson",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        priority: "high",
      });

      await storage.createNotification({
        channel: "#sales", title: "New Statement Upload",
        message: `${firstName} ${lastName} from ${businessName || "Unknown"} (${vertical || "Unknown"}) uploaded a statement`,
        type: "alert",
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "statement_upload" },
        });
      }

      await storage.createAuditLog({ action: "statement_uploaded", entityType: "contact", entityId: contact.id, details: { source: "website" } });
      await storage.updateDeal(deal.id, { statementReceived: true, docReadinessScore: 1 });
      trackReferral(referralCode, contactName, email, mobile, businessName).catch(err => console.error("Referral tracking error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "statement_upload" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "statement_upload" }).catch(err => console.error("Workflow trigger error:", err));
      if (consentSms) sendConfirmationSms(contact.id, firstName, "statement_upload", deal.id).catch(err => console.error("Confirm SMS error:", err));

      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/estimate", async (req, res) => {
    try {
      const { contactName, email, phone, monthlyVolume, totalFees, currentProvider, notes, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const tags = ["src_website", "lead_estimate"];
      if (utmSource) tags.push(`utm_src_${utmSource}`);

      const contact = await storage.createContact({
        firstName, lastName, email, phone: phone || "",
        monthlyVolume, currentProvider, notes,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/estimate",
        status: "New",
        tags,
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        totalVolume: monthlyVolume, totalFees,
        notes: `Estimate request. Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Estimate Request",
        message: `${firstName} ${lastName} - Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        type: "info",
      });

      trackReferral(referralCode, contactName, email, phone).catch(err => console.error("Referral tracking error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "estimate" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "estimate" }).catch(err => console.error("Workflow trigger error:", err));
      // estimate form doesn't have explicit SMS consent — skip confirmation SMS
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/support", async (req, res) => {
    try {
      const { name, businessName, email, mobile, issueType, priority, message: msg, consentSms } = req.body;
      const nameParts = (name || "").trim().split(" ").filter(Boolean);
      const firstName = nameParts[0] || "there";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact = await storage.createContact({
        firstName, lastName, email, phone: mobile || "",
        companyName: businessName, consentSms: consentSms === true,
        status: "Active",
        tags: ["src_website", "support_request", `support_${(issueType || "other").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "support" },
        });
      }

      const ticket = await storage.createTicket({
        contactId: contact.id,
        subject: `${issueType || "Support"} - ${businessName || firstName}`,
        description: msg || "",
        priority: priority || "Normal",
        category: issueType || "Other",
      });

      const ackMessages: Record<string, string> = {
        "Funding / Deposits": `Hi ${firstName} — thanks for reaching out about a funding question. We know how important it is to have your deposits landing on time, so we're pulling up your account now.\n\nIf this is a same-day issue, feel free to call us directly at 954-266-8214 and we'll get right on it. Otherwise, someone from our team will follow up within a few hours with an update.\n\nHang tight — we're on it.`,
        "Terminal": `Hey ${firstName} — we got your message about your terminal. Whether it's acting up, needs a reset, or you're looking at a replacement, we deal with this stuff daily so we'll get you sorted out.\n\nIf your terminal is completely down and you can't take payments, call us at 954-266-8214 so we can walk you through a fix right away. Otherwise, expect a reply from our tech team shortly.\n\nAppreciate your patience.`,
        "Chargeback / Dispute": `Hi ${firstName} — thanks for letting us know about this. Chargebacks can be stressful, but the good news is we handle these all the time and we're going to walk you through exactly what to do.\n\nTime matters with disputes, so we've flagged this for priority review. A team member will reach out shortly with the specific documents you'll need and the steps to respond. In the meantime, don't worry — we've got your back on this.\n\nIf you have the transaction date and amount handy, that'll help us move faster.`,
        "PCI Compliance": `Hey ${firstName} — good on you for staying on top of PCI compliance. A lot of merchants overlook this until there's a problem, so we're glad you reached out.\n\nOur compliance team will take a look at your account status and let you know exactly where things stand — whether you need to complete your annual questionnaire, update anything, or if you're already good to go.\n\nYou'll hear from us soon. If you have any compliance notices or letters you've received, feel free to forward them to support@libertybancard.com so we can reference them.`,
      };
      const ackText = ackMessages[issueType] || `Hi ${firstName} — thanks for reaching out. We received your request and a team member is reviewing it now.\n\nYou can expect a personal follow-up within a few hours during business hours. If you need something handled immediately, you're always welcome to call us at 954-266-8214.\n\nWe appreciate your patience — we'll be in touch soon.`;

      await storage.createTicketComment({
        ticketId: ticket.id,
        content: ackText,
        authorName: "Liberty Bancard Support",
        isInternal: false,
      });

      await storage.createNotification({
        channel: "#support",
        title: `New ${priority || "Normal"} Support Ticket`,
        message: `${firstName} ${lastName} (${businessName || "N/A"}) — ${issueType || "General"}: ${(msg || "").slice(0, 120)}`,
        type: priority === "Urgent" ? "urgent" : "info",
        metadata: { ticketId: ticket.id, contactId: contact.id },
      });

      triggerWorkflowsByEvent("ticket_created", { entityType: "ticket", entityId: ticket.id }).catch(err => console.error("Workflow trigger error:", err));
      if (consentSms && mobile) sendConfirmationSms(contact.id, firstName, "support").catch(err => console.error("Confirm SMS error:", err));

      res.status(201).json({ success: true, ticketId: ticket.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/get-started", async (req, res) => {
    try {
      const { goal, vertical, monthlyVolume, needTerminal, interestedIn0Percent, firstName, lastName, email, phone, consentSms, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;

      let offerPath = "Not Sure";
      if (goal === "0% interest" || interestedIn0Percent) offerPath = "0% Program";
      else if (goal === "lower fees") offerPath = "Wholesale";
      else if (goal === "need terminal") offerPath = "Terminal Needed";
      else if (goal === "compare vs flat-rate") offerPath = "Compare vs Square/Stripe";

      const tags = ["src_website", "lead_quiz", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`];
      if (utmSource) tags.push(`utm_src_${utmSource}`);
      if (utmMedium) tags.push(`utm_med_${utmMedium}`);
      if (utmCampaign) tags.push(`utm_camp_${utmCampaign}`);

      const contact = await storage.createContact({
        firstName, lastName, email, phone: phone || "",
        vertical, monthlyVolume, primaryOfferPath: offerPath,
        interestedIn0Percent: interestedIn0Percent === true,
        needTerminal: needTerminal === true,
        consentSms: consentSms === true,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/get-started",
        status: "New",
        tags,
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "get_started" },
        });
      }

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        offerPath,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Quiz Lead",
        message: `${firstName} ${lastName} - ${vertical}, ${monthlyVolume}, Goal: ${goal}${utmSource ? ` (via ${utmSource})` : ""}`,
        type: "info",
      });

      trackReferral(referralCode, `${firstName} ${lastName}`, email, phone).catch(err => console.error("Referral tracking error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint gen error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "get_started" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "get_started" }).catch(err => console.error("Workflow trigger error:", err));
      if (consentSms && phone) sendConfirmationSms(contact.id, firstName, "get_started", deal.id).catch(err => console.error("Confirm SMS error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id, offerPath });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  // === CALLBACK REQUEST ===
  app.post("/api/public/callback", async (req, res) => {
    try {
      const { name, phone, bestTime, notes } = req.body;
      const nameParts = (name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const contact = await storage.createContact({
        firstName, lastName, email: "", phone: phone || "",
        status: "New",
        tags: ["src_website", "lead_callback", `callback_${(bestTime || "anytime").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        notes: `Callback request. Best time: ${bestTime || "Anytime"}. Notes: ${notes || "None"}`,
      });

      await storage.createNotification({
        channel: "#sales", title: "Callback Requested",
        message: `${firstName} ${lastName} - ${phone} - Best time: ${bestTime || "Anytime"}`,
        type: "alert",
      });

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "callback" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "callback" }).catch(err => console.error("Workflow trigger error:", err));
      // callback form: person explicitly requested a call, treat as implied consent for confirmation
      if (phone) sendConfirmationSms(contact.id, firstName, "callback", deal.id).catch(err => console.error("Confirm SMS error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/equipment-order", async (req, res) => {
    try {
      const { firstName, lastName, email, phone, businessName, message, items, referralCode, promoCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
      if (!firstName || typeof firstName !== "string" || firstName.length > 100) {
        return res.status(400).json({ message: "Valid first name is required" });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required" });
      }
      if (!phone || typeof phone !== "string" || phone.length > 30) {
        return res.status(400).json({ message: "Valid phone number is required" });
      }
      if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
        return res.status(400).json({ message: "At least one item is required" });
      }
      const validatedItems = items.map((i: any) => ({
        name: String(i.name || "").slice(0, 100),
        quantity: Math.min(Math.max(1, Number(i.quantity) || 1), 50),
        price: String(i.price || "").slice(0, 50),
      }));

      const safeLastName = String(lastName || "").slice(0, 100);
      const safeBusiness = String(businessName || "").slice(0, 200);
      const safeMessage = String(message || "").slice(0, 1000);
      const sanitizedPromo = promoCode
        ? String(promoCode).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
        : undefined;

      const orderTags = ["src_website", "lead_equipment_order", ...validatedItems.slice(0, 5).map((i: any) => `equip_${i.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`)];
      if (sanitizedPromo) orderTags.push(`promo_${sanitizedPromo.toLowerCase()}`);

      if (utmSource) orderTags.push(`utm_src_${utmSource}`);

      const contact = await storage.createContact({
        firstName: firstName.slice(0, 100), lastName: safeLastName, email: email.slice(0, 200), phone: phone.slice(0, 30),
        companyName: safeBusiness,
        promoCode: sanitizedPromo,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/shop",
        status: "New",
        tags: orderTags,
      });

      const itemSummary = validatedItems.map((i: any) => `${i.name} x${i.quantity} (${i.price})`).join(", ");
      const primaryTerminal = validatedItems[0]?.name || "Unknown";
      const allTerminals = validatedItems.map((i: any) => i.name).join(", ");
      const orderedAt = new Date();

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        notes: `Equipment order: ${itemSummary}. ${safeMessage}${sanitizedPromo ? `\nPromo Code: ${sanitizedPromo}` : ""}`.trim(),
        promoCode: sanitizedPromo,
        terminalRecommendation: allTerminals,
        terminalStatus: "Ordered — 24hr setup & testing before ship",
        hardwarePackage: allTerminals,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      for (const item of validatedItems) {
        await storage.createEquipmentOrder({
          dealId: deal.id,
          contactId: contact.id,
          equipmentType: item.name,
          quantity: item.quantity,
          status: "pending",
          orderedAt,
          notes: `Price: ${item.price}. 24-hour setup & testing period before shipment.`,
        });
      }

      await storage.createTask({
        dealId: deal.id, contactId: contact.id,
        title: `Setup & test terminal: ${primaryTerminal} (24hr processing)`.slice(0, 255),
        assignedTo: "Scott Stevenson",
        priority: "high", status: "open",
      });

      await storage.createNotification({
        channel: "#sales", title: "Equipment Order Received",
        message: `${firstName} ${safeLastName} ordered: ${itemSummary}${sanitizedPromo ? ` (promo: ${sanitizedPromo})` : ""}`.slice(0, 500),
        type: "alert",
      });

      trackReferral(referralCode, `${firstName} ${safeLastName}`, email, phone, safeBusiness).catch(err => console.error("Referral tracking error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "equipment_order" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "equipment_order" }).catch(err => console.error("Workflow trigger error:", err));
      // equipment order: customer placed an order, confirmation SMS is transactional
      if (phone) sendConfirmationSms(contact.id, firstName, "equipment_order", deal.id).catch(err => console.error("Confirm SMS error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  // === RFIs ===
  app.get("/api/rfis", async (req, res) => {
    const allRfis = await storage.getRfis();
    res.json(allRfis);
  });

  app.get("/api/rfis/:id", async (req, res) => {
    const rfi = await storage.getRfi(Number(req.params.id));
    if (!rfi) return res.status(404).json({ message: "Not found" });
    res.json(rfi);
  });

  app.post("/api/rfis", async (req, res) => {
    try {
      const input = insertRfiSchema.parse(req.body);
      const rfi = await storage.createRfi(input);
      await storage.createAuditLog({ action: "rfi_created", entityType: "rfi", entityId: rfi.id, details: { subject: rfi.subject, category: rfi.category } });
      await storage.createNotification({
        channel: "internal",
        title: `New RFI: ${rfi.subject}`,
        message: `Priority: ${rfi.priority} | Category: ${rfi.category} | Assigned to: ${rfi.assignedTo || "Unassigned"}`,
        type: rfi.priority === "Urgent" ? "urgent" : "info",
      });
      res.status(201).json(rfi);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/rfis/:id", async (req, res) => {
    try {
      const allowed = insertRfiSchema.partial().parse(req.body);
      const old = await storage.getRfi(Number(req.params.id));
      const updated = await storage.updateRfi(Number(req.params.id), allowed);
      if (!updated) return res.status(404).json({ message: "Not found" });
      if (old && old.status !== updated.status) {
        await storage.createAuditLog({ action: "rfi_status_changed", entityType: "rfi", entityId: updated.id, details: { from: old.status, to: updated.status } });
      }
      if (allowed.response && !old?.response) {
        await storage.createNotification({
          channel: "internal",
          title: `RFI Responded: ${updated.subject}`,
          message: `RFI #${updated.id} has been responded to`,
          type: "info",
        });
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === WORKFLOWS ===
  app.get("/api/workflows", async (req, res) => {
    const wfs = await storage.getWorkflows();
    res.json(wfs);
  });

  app.get("/api/workflows/:id", async (req, res) => {
    const wf = await storage.getWorkflow(Number(req.params.id));
    if (!wf) return res.status(404).json({ message: "Not found" });
    res.json(wf);
  });

  app.post("/api/workflows", async (req, res) => {
    try {
      const input = insertWorkflowSchema.parse(req.body);
      const wf = await storage.createWorkflow(input);
      await storage.createAuditLog({ action: "workflow_created", entityType: "workflow", entityId: wf.id, details: { name: wf.name, trigger: wf.triggerType } });
      res.status(201).json(wf);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/workflows/:id", async (req, res) => {
    try {
      const allowed = insertWorkflowSchema.partial().parse(req.body);
      const updated = await storage.updateWorkflow(Number(req.params.id), allowed);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/workflows/:id", async (req, res) => {
    await storage.deleteWorkflow(Number(req.params.id));
    res.json({ success: true });
  });

  app.get("/api/workflow-runs", async (req, res) => {
    const workflowId = req.query.workflowId ? Number(req.query.workflowId) : undefined;
    const runs = workflowId
      ? await storage.getWorkflowRunsByWorkflow(workflowId)
      : await storage.getWorkflowRuns();
    res.json(runs);
  });

  app.post("/api/workflows/:id/run", async (req, res) => {
    try {
      const wf = await storage.getWorkflow(Number(req.params.id));
      if (!wf) return res.status(404).json({ message: "Workflow not found" });
      if (!wf.enabled) return res.status(400).json({ message: "Workflow is disabled" });

      const actions = (wf.actions as any[]) || [];
      const result = await executeWorkflowActions(wf.id, actions, {
        entityType: req.body.entityType || undefined,
        entityId: req.body.entityId || undefined,
      });

      res.json({ success: true, runId: result.runId, status: result.status, steps: result.log });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Workflow execution failed" });
    }
  });

  // === AI ADVISOR ===
  app.post("/api/ai/chat", isAuthenticated, async (req, res) => {
    try {
      const { department, messages } = req.body;
      const basePrompt = `ROLE: Liberty Bancard AI Advisor - ${department || "General"}
GOAL: Increase conversion and operational efficiency while staying compliance-safe.
NON-NEGOTIABLES:
- Never promise savings, approval, or funding speed.
- Any mention of pricing, 0% programs, or next-day funding must include: "Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review."
- Do not provide legal or tax advice.
- Do not request or store PCI data, full card numbers, bank account numbers, or SSNs.
- Prefer structured outputs: next best action, draft message, checklist, tasks, routing.
- When uncertain: ask for a statement upload or suggest a 10-minute call.
OUTPUT FORMAT:
1) Summary (2-4 bullets)
2) Recommended action (single best next step)
3) Draft message (SMS + email; compliance-safe)
4) Internal tasks (with due times)`;

      const departmentPrompts: Record<string, string> = {
        sales: "You are the Sales Advisor. Prioritize statement upload + booked calls; draft follow-ups; recommend offer path based on vertical and volume.",
        support: "You are the Support Advisor. Classify tickets by category (Funding, Terminal, Chargeback, PCI, Other); request missing details; suggest macro response; escalate urgent issues.",
        onboarding: "You are the Onboarding Advisor. Generate doc checklists; go-live plans; terminal setup steps; Day 2/7/14/30 check-in messages.",
        marketing: "You are the Marketing Advisor. Create weekly content plans; repurpose proof into briefs; draft landing page variants; write ad copy (no claims without proof).",
        finance: "You are the Finance Advisor. Provide reconciliation checklists; commission tracking guidance; anomaly detection tips. Never give tax advice.",
        compliance: "You are the Compliance Advisor. Review copy and messages for claim risk; ensure disclaimers and consent language are present.",
        executive: "You are the Executive Advisor. Provide weekly KPI digests + bottleneck analysis + recommended changes (approval required for all external changes).",
      };

      const systemPrompt = `${basePrompt}\n\n${departmentPrompts[department] || departmentPrompts.sales}`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...(messages || []).map((m: any) => ({ role: m.role, content: m.content })),
        ],
        max_tokens: 1500,
      });

      res.json({ response: completion.choices[0]?.message?.content || "No response generated." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI service error" });
    }
  });

  // === GHL INTEGRATION ===
  app.get("/api/ghl/status", async (req, res) => {
    res.json(getGhlStatus());
  });

  app.post("/api/ghl/send-email", async (req, res) => {
    try {
      const { contactId, dealId, subject, body } = req.body;
      if (!contactId || !subject || !body) return res.status(400).json({ message: "contactId, subject, and body required" });
      const result = await sendGhlEmail({ contactId, dealId, subject, body });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/send-sms", async (req, res) => {
    try {
      const { contactId, dealId, body } = req.body;
      if (!contactId || !body) return res.status(400).json({ message: "contactId and body required" });
      const result = await sendGhlSms({ contactId, dealId, body });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/send-template", async (req, res) => {
    try {
      const { templateId, contactId, dealId, extraData } = req.body;
      if (!templateId || !contactId) return res.status(400).json({ message: "templateId and contactId required" });
      const result = await sendTemplatedMessage({ templateId, contactId, dealId, extraData });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ghl/sync-contact", async (req, res) => {
    try {
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ message: "contactId required" });
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      const ghlId = await upsertGhlContact(contact);
      res.json({ success: true, ghlContactId: ghlId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ghl/calendar-url", (req, res) => {
    const url = getCalendarBookingUrl({
      contactEmail: req.query.email as string,
      contactName: req.query.name as string,
      source: req.query.source as string,
    });
    res.json({ url });
  });

  app.get("/api/ghl/activity", async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getGhlActivityLogs(contactId);
    res.json(logs);
  });

  app.post("/api/webhooks/ghl", async (req, res) => {
    try {
      await handleGhlWebhook(req.body);
      res.json({ success: true });
    } catch (err: any) {
      console.error("GHL webhook error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // === BULK MESSAGING ===
  app.post("/api/bulk-message", isAuthenticated, async (req, res) => {
    try {
      const { contactIds, channel, subject, message: msgBody, templateId } = req.body;

      if (!contactIds?.length || !channel || !msgBody) {
        return res.status(400).json({ message: "contactIds, channel, and message are required" });
      }

      if (!["email", "sms"].includes(channel)) {
        return res.status(400).json({ message: "Channel must be email or sms" });
      }

      const results: { contactId: number; status: string; error?: string }[] = [];

      for (const contactId of contactIds) {
        try {
          const contact = await storage.getContact(contactId);
          if (!contact) {
            results.push({ contactId, status: "error", error: "Contact not found" });
            continue;
          }

          if (contact.doNotContact) {
            results.push({ contactId, status: "skipped", error: "Do Not Contact" });
            continue;
          }

          if (channel === "sms" && !contact.consentSms) {
            results.push({ contactId, status: "skipped", error: "No SMS consent" });
            continue;
          }

          const personalizedMsg = msgBody
            .replace(/\{\{firstName\}\}/g, contact.firstName || "")
            .replace(/\{\{lastName\}\}/g, contact.lastName || "")
            .replace(/\{\{companyName\}\}/g, contact.companyName || "")
            .replace(/\{\{email\}\}/g, contact.email || "");

          if (channel === "email") {
            if (isGhlConfigured() && contact.email) {
              await sendGhlEmail({ contactId, subject: subject || "Message from Liberty Bancard", body: personalizedMsg });
              results.push({ contactId, status: "sent" });
            } else {
              results.push({ contactId, status: "queued", error: "GHL not configured" });
            }
          } else {
            if (isGhlConfigured() && contact.phone) {
              await sendGhlSms({ contactId, body: personalizedMsg });
              results.push({ contactId, status: "sent" });
            } else {
              results.push({ contactId, status: "queued", error: "GHL not configured" });
            }
          }

          await storage.createAuditLog({
            action: `bulk_${channel}_sent`,
            entityType: "contact",
            entityId: contactId,
            details: { channel, subject },
          });
        } catch (err: any) {
          results.push({ contactId, status: "error", error: err.message });
        }
      }

      const sent = results.filter(r => r.status === "sent").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      const errors = results.filter(r => r.status === "error").length;

      res.json({ sent, skipped, errors, total: contactIds.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === BLAZE.AI INTEGRATION ===
  const BLAZE_SETTINGS_KEY = "blaze_integration";
  const defaultBlazeSettings = { enabled: false, webhookUrl: "", zapierConnected: false, lastSyncAt: null, contentTypes: ["email", "social", "blog", "newsletter"], workspaceId: "" };

  app.get("/api/integrations/blaze", isAuthenticated, async (req, res) => {
    const saved = await storage.getSystemSetting(BLAZE_SETTINGS_KEY);
    res.json(saved || defaultBlazeSettings);
  });

  app.post("/api/integrations/blaze", isAuthenticated, async (req, res) => {
    const { webhookUrl, workspaceId } = req.body;
    const current = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || { ...defaultBlazeSettings };
    const updated = {
      ...current,
      webhookUrl: webhookUrl || current.webhookUrl,
      workspaceId: workspaceId || current.workspaceId,
      enabled: !!(webhookUrl || workspaceId || current.webhookUrl || current.workspaceId),
    };
    await storage.setSystemSetting(BLAZE_SETTINGS_KEY, updated);
    await storage.createAuditLog({
      action: "blaze_settings_updated",
      entityType: "integration",
      details: { webhookUrl: !!webhookUrl, workspaceId: !!workspaceId },
    });
    res.json({ success: true, settings: updated });
  });

  app.post("/api/integrations/blaze/test", isAuthenticated, async (req, res) => {
    const saved = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || defaultBlazeSettings;
    if (!saved.webhookUrl && !saved.workspaceId) {
      return res.json({ success: false, message: "No Blaze.ai webhook URL or workspace ID configured. Use Zapier integration as the recommended approach." });
    }
    res.json({ success: true, message: "Settings saved. Connect via Zapier for the most reliable integration with Blaze.ai." });
  });

  app.post("/api/webhooks/blaze", async (req, res) => {
    try {
      const { type, content, metadata } = req.body;
      console.log(`[Blaze Webhook] Received: ${type}`, metadata);

      await storage.createAuditLog({
        action: "blaze_webhook_received",
        entityType: "integration",
        details: { type, metadata },
      });

      const current = (await storage.getSystemSetting(BLAZE_SETTINGS_KEY)) || { ...defaultBlazeSettings };
      current.lastSyncAt = new Date().toISOString();
      await storage.setSystemSetting(BLAZE_SETTINGS_KEY, current);

      if (type === "content_published" && content) {
        await storage.createNotification({
          channel: "internal",
          title: "Blaze.ai Content Published",
          message: `New ${metadata?.contentType || "content"}: ${content?.title || "Untitled"}`,
          type: "info",
          metadata: { source: "blaze", contentType: metadata?.contentType },
        });
      }

      res.json({ success: true, received: true });
    } catch (err: any) {
      console.error("Blaze webhook error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // === MESSAGE TEMPLATES ===
  app.get("/api/message-templates", async (req, res) => {
    const category = req.query.category as string | undefined;
    const templates = category
      ? await storage.getMessageTemplatesByCategory(category)
      : await storage.getMessageTemplates();
    res.json(templates);
  });

  app.get("/api/message-templates/:id", async (req, res) => {
    const template = await storage.getMessageTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Not found" });
    res.json(template);
  });

  app.post("/api/message-templates", async (req, res) => {
    try {
      const input = insertMessageTemplateSchema.parse(req.body);
      const template = await storage.createMessageTemplate(input);
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/message-templates/:id", async (req, res) => {
    const updated = await storage.updateMessageTemplate(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // === COLLATERAL PACKETS ===
  app.get("/api/collateral-packets", async (req, res) => {
    const packets = await storage.getCollateralPackets();
    res.json(packets);
  });

  app.post("/api/collateral-packets", async (req, res) => {
    try {
      const input = insertCollateralPacketSchema.parse(req.body);
      const packet = await storage.createCollateralPacket(input);
      res.status(201).json(packet);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === SLA CONFIGS ===
  app.get("/api/sla-configs", async (req, res) => {
    const configs = await storage.getSlaConfigs();
    res.json(configs);
  });

  app.post("/api/sla-configs", async (req, res) => {
    try {
      const input = insertSlaConfigSchema.parse(req.body);
      const config = await storage.createSlaConfig(input);
      res.status(201).json(config);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/sla-configs/:id", async (req, res) => {
    const updated = await storage.updateSlaConfig(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // === KPI DASHBOARD ===
  app.get("/api/kpi/summary", async (req, res) => {
    try {
      const [allDeals, allTickets, allContacts, allTasks] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getContacts(),
        storage.getTasks(),
      ]);

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding");
      const recentDeals = salesDeals.filter(d => d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);
      const closedWon = salesDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= thirtyDaysAgo);
      const closedLost = salesDeals.filter(d => d.stage === "Closed Lost" && d.closedAt && new Date(d.closedAt) >= thirtyDaysAgo);

      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const breachedTickets = allTickets.filter(t =>
        t.slaDeadline && new Date(t.slaDeadline) < now && !t.resolvedAt && t.status !== "Resolved" && t.status !== "Closed"
      );

      const pendingTasks = allTasks.filter(t => t.status === "pending");
      const overdueTasks = allTasks.filter(t => t.status === "pending" && t.dueDate && new Date(t.dueDate) < now);

      const stagesCount: Record<string, number> = {};
      salesDeals.forEach(d => { stagesCount[d.stage] = (stagesCount[d.stage] || 0) + 1; });

      const parseCurrency = (v: string | null | undefined): number => {
        if (!v) return 0;
        const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
        return isNaN(n) ? 0 : n;
      };

      const totalEstVolume = allContacts.reduce((s, c) => s + parseCurrency(c.estimatedProcessingVolume), 0);
      const totalEstResidual = allContacts.reduce((s, c) => s + parseCurrency(c.estimatedResidual), 0);
      const totalEstProfit = allDeals.reduce((s, d) => s + parseCurrency(d.estimatedGrossProfitMonthly), 0);

      res.json({
        pipeline: {
          totalActive: salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost").length,
          closedWon30d: closedWon.length,
          closedLost30d: closedLost.length,
          conversionRate: recentDeals.length > 0 ? Math.round((closedWon.length / recentDeals.length) * 100) : 0,
          stagesBreakdown: stagesCount,
          newLeads7d: salesDeals.filter(d => d.createdAt && new Date(d.createdAt) >= sevenDaysAgo).length,
        },
        onboarding: {
          active: onboardingDeals.filter(d => d.stage !== "Active (30 Days)").length,
          live: onboardingDeals.filter(d => d.stage === "Live (First Batch)" || d.stage === "Active (7 Days)" || d.stage === "Active (30 Days)").length,
        },
        support: {
          openTickets: openTickets.length,
          breachedSla: breachedTickets.length,
          avgResolutionHours: 0,
        },
        tasks: {
          pending: pendingTasks.length,
          overdue: overdueTasks.length,
        },
        contacts: {
          total: allContacts.length,
          new30d: allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo).length,
        },
        revenue: {
          totalEstVolume,
          totalEstResidual,
          totalEstProfit,
          avgDealProfit: allDeals.length > 0 ? Math.round(totalEstProfit / allDeals.length) : 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === KPI COMPARATIVE ===
  app.get("/api/kpi/comparative", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allContacts, allTickets] = await Promise.all([
        storage.getDeals(),
        storage.getContacts(),
        storage.getTickets(),
      ]);

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const thisMonthDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= thisMonthStart);
      const lastMonthDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= lastMonthStart && new Date(d.createdAt) <= lastMonthEnd);

      const thisMonthContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thisMonthStart);
      const lastMonthContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= lastMonthStart && new Date(c.createdAt) <= lastMonthEnd);

      const thisMonthWon = allDeals.filter(d => d.stage === "Closed Won" && d.updatedAt && new Date(d.updatedAt) >= thisMonthStart);
      const lastMonthWon = allDeals.filter(d => d.stage === "Closed Won" && d.updatedAt && new Date(d.updatedAt) >= lastMonthStart && new Date(d.updatedAt) <= lastMonthEnd);

      const thisMonthTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= thisMonthStart);
      const lastMonthTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= lastMonthStart && new Date(t.createdAt) <= lastMonthEnd);

      const calcChange = (current: number, previous: number) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      res.json({
        newDeals: { current: thisMonthDeals.length, previous: lastMonthDeals.length, change: calcChange(thisMonthDeals.length, lastMonthDeals.length) },
        newContacts: { current: thisMonthContacts.length, previous: lastMonthContacts.length, change: calcChange(thisMonthContacts.length, lastMonthContacts.length) },
        closedWon: { current: thisMonthWon.length, previous: lastMonthWon.length, change: calcChange(thisMonthWon.length, lastMonthWon.length) },
        tickets: { current: thisMonthTickets.length, previous: lastMonthTickets.length, change: calcChange(thisMonthTickets.length, lastMonthTickets.length) },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === PROSPECT LISTS ===
  app.get("/api/prospect-lists", async (req, res) => {
    const lists = await storage.getProspectLists();
    res.json(lists);
  });

  app.get("/api/prospect-lists/:id", async (req, res) => {
    const list = await storage.getProspectList(Number(req.params.id));
    if (!list) return res.status(404).json({ message: "List not found" });
    res.json(list);
  });

  app.post("/api/prospect-lists", async (req, res) => {
    try {
      const input = insertProspectListSchema.parse(req.body);
      const list = await storage.createProspectList(input);
      res.status(201).json(list);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === PROSPECTS ===
  app.get("/api/prospects", async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const prospects = await storage.getProspects(listId);
    res.json(prospects);
  });

  app.get("/api/prospects/:id", async (req, res) => {
    const prospect = await storage.getProspect(Number(req.params.id));
    if (!prospect) return res.status(404).json({ message: "Prospect not found" });
    res.json(prospect);
  });

  app.post("/api/prospects", async (req, res) => {
    try {
      const input = insertProspectSchema.parse(req.body);
      const prospect = await storage.createProspect(input);
      res.status(201).json(prospect);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/prospects/:id", async (req, res) => {
    const updated = await storage.updateProspect(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  });

  app.post("/api/prospects/:id/convert", isAuthenticated, async (req, res) => {
    try {
      const prospect = await storage.getProspect(Number(req.params.id));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (prospect.contactId) return res.json({ message: "Already converted", contactId: prospect.contactId });

      const contact = await storage.createContact({
        firstName: prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Unknown",
        lastName: prospect.ownerLastName || "",
        email: prospect.email || prospect.ownerEmail || "",
        phone: prospect.phone || prospect.ownerPhone || "",
        companyName: prospect.companyName || "",
        vertical: prospect.vertical || "",
        status: "new",
        notes: "Source: prospect_conversion",
        monthlyVolume: prospect.estimatedVolume || "",
        currentProvider: prospect.estimatedProcessor || "",
      });

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        owner: "Scott Stevenson",
        notes: `Estimated volume: ${prospect.estimatedVolume || "N/A"}`,
      });

      await storage.updateProspect(prospect.id, { contactId: contact.id, status: "converted" });

      scoreContact(contact.id).catch(err => console.error("Scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint error:", err));

      try {
        const { autoEnrollFromTrigger } = await import("./services/sequence-worker");
        await autoEnrollFromTrigger("contact_created", { contactId: contact.id });
      } catch {}

      try {
        const matchingRules = await storage.getMatchingStageRules("sales", null, "New Lead");
        for (const rule of matchingRules) {
          const ruleActions = (rule.actions as any[]) || [];
          for (const action of ruleActions) {
            if (action.type === "create_task") {
              await storage.createTask({
                title: action.title || "Auto: New Lead",
                assignedTo: action.assignedTo || "Scott Stevenson",
                priority: action.priority || "medium",
                dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                dealId: deal.id,
                contactId: contact.id,
              });
            } else if (action.type === "send_notification") {
              await storage.createNotification({
                channel: action.channel || "internal",
                title: action.title || `Stage Automation: ${rule.name}`,
                message: action.message || "New lead entered pipeline",
                type: "info",
              });
            } else if (action.type === "enroll_sequence" && action.sequenceName) {
              const seqs = await storage.getFollowUpSequences();
              const seq = seqs.find((s: any) => s.name === action.sequenceName);
              if (seq) {
                await storage.createSequenceEnrollment({
                  sequenceId: seq.id,
                  contactId: contact.id,
                  dealId: deal.id,
                  status: "active",
                  nextActionAt: new Date(),
                  currentStep: 0,
                });
              }
            }
          }
          await storage.createAuditLog({
            action: "stage_rule_triggered",
            entityType: "deal",
            entityId: deal.id,
            details: { ruleName: rule.name, fromStage: null, toStage: "New Lead", source: "prospect_conversion" },
          });
        }
      } catch (ruleErr) {
        console.error("Stage rule error on conversion:", ruleErr);
      }

      await storage.createAuditLog({
        action: "prospect_converted",
        entityType: "contact",
        entityId: contact.id,
        details: { prospectId: prospect.id, dealId: deal.id, company: prospect.companyName },
      });

      res.json({ contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/prospects/convert-batch", isAuthenticated, async (req, res) => {
    try {
      const { prospectIds } = req.body as { prospectIds: number[] };
      if (!prospectIds?.length) return res.status(400).json({ message: "No prospect IDs provided" });

      const results: Array<{ prospectId: number; contactId: number; dealId: number }> = [];
      for (const pid of prospectIds.slice(0, 50)) {
        const prospect = await storage.getProspect(pid);
        if (!prospect || prospect.contactId) continue;

        const contact = await storage.createContact({
          firstName: prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Unknown",
          lastName: prospect.ownerLastName || "",
          email: prospect.email || prospect.ownerEmail || "",
          phone: prospect.phone || prospect.ownerPhone || "",
          companyName: prospect.companyName || "",
          vertical: prospect.vertical || "",
          status: "new",
          notes: "Source: prospect_conversion",
          monthlyVolume: prospect.estimatedVolume || "",
          currentProvider: prospect.estimatedProcessor || "",
        });

        const deal = await storage.createDeal({
          contactId: contact.id,
          pipeline: "sales",
          stage: "New Lead",
          owner: "Scott Stevenson",
          notes: `Estimated volume: ${prospect.estimatedVolume || "N/A"}`,
        });

        await storage.updateProspect(pid, { contactId: contact.id, status: "converted" });

        scoreContact(contact.id).catch(() => {});
        routeContact(contact.id).catch(() => {});
        generateDealBlueprint(deal.id).catch(() => {});

        results.push({ prospectId: pid, contactId: contact.id, dealId: deal.id });
      }

      try {
        const { autoEnrollFromTrigger } = await import("./services/sequence-worker");
        for (const r of results) {
          await autoEnrollFromTrigger("contact_created", { contactId: r.contactId });
        }
      } catch {}

      try {
        const matchingRules = await storage.getMatchingStageRules("sales", null, "New Lead");
        for (const r of results) {
          for (const rule of matchingRules) {
            const ruleActions = (rule.actions as any[]) || [];
            for (const action of ruleActions) {
              if (action.type === "create_task") {
                await storage.createTask({
                  title: action.title || "Auto: New Lead",
                  assignedTo: action.assignedTo || "Scott Stevenson",
                  priority: action.priority || "medium",
                  dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 3600000) : undefined,
                  dealId: r.dealId,
                  contactId: r.contactId,
                });
              } else if (action.type === "send_notification") {
                await storage.createNotification({
                  channel: action.channel || "internal",
                  title: action.title || `Stage Automation: ${rule.name}`,
                  message: action.message || "New lead entered pipeline",
                  type: "info",
                });
              } else if (action.type === "enroll_sequence" && action.sequenceName) {
                const seqs = await storage.getFollowUpSequences();
                const seq = seqs.find((s: any) => s.name === action.sequenceName);
                if (seq) {
                  await storage.createSequenceEnrollment({
                    sequenceId: seq.id,
                    contactId: r.contactId,
                    dealId: r.dealId,
                    status: "active",
                    nextActionAt: new Date(),
                    currentStep: 0,
                  });
                }
              }
            }
            await storage.createAuditLog({
              action: "stage_rule_triggered",
              entityType: "deal",
              entityId: r.dealId,
              details: { ruleName: rule.name, fromStage: null, toStage: "New Lead", source: "batch_conversion" },
            });
          }
        }
      } catch (ruleErr) {
        console.error("Stage rule error on batch conversion:", ruleErr);
      }

      res.json({ converted: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // CSV Upload endpoint
  app.post("/api/prospects/import", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const csvContent = req.file.buffer.toString("utf-8");
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });

      const listName = (req.body.listName as string) || `Import ${new Date().toLocaleDateString()}`;
      const list = await storage.createProspectList({
        name: listName,
        fileName: req.file.originalname || "upload.csv",
        totalRecords: records.length,
      });

      const columnMap: Record<string, string> = {
        "company": "companyName", "company_name": "companyName", "business": "companyName", "business_name": "companyName", "name": "companyName",
        "dba": "dba", "doing_business_as": "dba",
        "email": "email", "email_address": "email", "contact_email": "email",
        "phone": "phone", "phone_number": "phone", "telephone": "phone", "contact_phone": "phone",
        "website": "website", "url": "website", "web": "website",
        "owner_first_name": "ownerFirstName", "first_name": "ownerFirstName", "firstname": "ownerFirstName", "owner_first": "ownerFirstName", "contact_first_name": "ownerFirstName",
        "owner_last_name": "ownerLastName", "last_name": "ownerLastName", "lastname": "ownerLastName", "owner_last": "ownerLastName", "contact_last_name": "ownerLastName",
        "owner_email": "ownerEmail",
        "owner_phone": "ownerPhone",
        "address": "address", "street": "address", "street_address": "address",
        "city": "city",
        "state": "state", "st": "state",
        "zip": "zip", "zipcode": "zip", "zip_code": "zip", "postal": "zip", "postal_code": "zip",
        "vertical": "vertical", "industry": "vertical", "category": "vertical", "type": "vertical",
        "volume": "estimatedVolume", "estimated_volume": "estimatedVolume", "monthly_volume": "estimatedVolume",
        "processor": "estimatedProcessor", "current_processor": "estimatedProcessor",
        "employees": "employeeCount", "employee_count": "employeeCount",
        "year_established": "yearEstablished", "established": "yearEstablished", "year": "yearEstablished",
        "google_rating": "googleRating", "rating": "googleRating",
        "google_reviews": "googleReviews", "reviews": "googleReviews",
      };

      const prospectInserts = (records as Record<string, string>[]).map((row: Record<string, string>) => {
        const mapped: Record<string, any> = { listId: list.id };
        for (const [csvCol, value] of Object.entries(row)) {
          const normalizedCol = csvCol.toLowerCase().trim().replace(/\s+/g, "_");
          const schemaField = columnMap[normalizedCol];
          if (schemaField && value) {
            mapped[schemaField] = value;
          }
        }
        return mapped;
      }).filter((p: Record<string, any>) => p.companyName || p.email || p.phone);

      const created = await storage.createProspectsBulk(prospectInserts);

      await storage.updateProspectList(list.id, {
        totalRecords: created.length,
      });

      res.status(201).json({
        list,
        imported: created.length,
        skipped: records.length - created.length,
      });
    } catch (err: any) {
      console.error("CSV import error:", err);
      res.status(500).json({ message: err.message || "Import failed" });
    }
  });

  // === ENRICHMENT ===
  app.get("/api/enrichment-jobs", async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const jobs = await storage.getEnrichmentJobs(listId);
    res.json(jobs);
  });

  app.post("/api/enrichment-jobs", async (req, res) => {
    try {
      const input = insertEnrichmentJobSchema.parse(req.body);
      const job = await storage.createEnrichmentJob(input);

      if (input.prospectId) {
        enrichProspect(input.prospectId).catch(console.error);
      } else if (input.listId) {
        const prospects = await storage.getProspects(input.listId);
        await storage.updateEnrichmentJob(job.id, { totalCount: prospects.length });
        runEnrichmentJob(job.id).catch(console.error);
      }

      res.status(201).json(job);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/enrichment/process-queue", async (req, res) => {
    processEnrichmentQueue().catch(console.error);
    res.json({ message: "Enrichment queue processing started" });
  });

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

  // === AI DASHBOARD COPILOT ===
  app.post("/api/ai/insights", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allTickets, allContacts, allTasks, allProspects] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getContacts(),
        storage.getTasks(),
        storage.getProspects(),
      ]);

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const activeDeals = salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const stallingDeals = activeDeals.filter(d => d.updatedAt && new Date(d.updatedAt) < sevenDaysAgo);
      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const breachedTickets = allTickets.filter(t => t.slaDeadline && new Date(t.slaDeadline) < now && !t.resolvedAt && t.status !== "Resolved" && t.status !== "Closed");
      const overdueTasks = allTasks.filter(t => t.status === "pending" && t.dueDate && new Date(t.dueDate) < now);
      const hotProspects = allProspects.filter(p => p.score === "hot" && p.status !== "converted");

      const dataContext = `CURRENT BUSINESS STATE:
- Active sales deals: ${activeDeals.length}
- Stalling deals (no activity 7+ days): ${stallingDeals.length}${stallingDeals.length > 0 ? ` (IDs: ${stallingDeals.slice(0, 5).map(d => d.id).join(", ")})` : ""}
- Open support tickets: ${openTickets.length}
- SLA breaches: ${breachedTickets.length}
- Overdue tasks: ${overdueTasks.length}
- Hot prospects not yet converted: ${hotProspects.length}
- Total contacts: ${allContacts.length}
- Pipeline stages: ${JSON.stringify(Object.fromEntries(activeDeals.reduce((acc, d) => { acc.set(d.stage, (acc.get(d.stage) || 0) + 1); return acc; }, new Map())))}
- Deal stages with most stalling: ${JSON.stringify(Object.fromEntries(stallingDeals.reduce((acc, d) => { acc.set(d.stage, (acc.get(d.stage) || 0) + 1); return acc; }, new Map())))}`;

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are the Liberty Bancard AI Operations Copilot. Analyze the current business metrics and provide actionable insights.
RULES:
- Be specific and data-driven. Reference actual numbers.
- Prioritize urgent items (SLA breaches, stalling deals, overdue tasks).
- Give 3-5 insights, each with a clear action recommendation.
- Use short, punchy language. No filler.
- Never promise savings or make compliance-unsafe claims.
- Format each insight as: **Title** followed by 1-2 sentences with action.
- End with a single "Priority Action" that is the most important thing to do right now.`
          },
          { role: "user", content: dataContext }
        ],
        max_tokens: 800,
      });

      res.json({ insights: completion.choices[0]?.message?.content || "No insights available." });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI insights error" });
    }
  });

  // === AI EMAIL COMPOSER ===
  app.post("/api/ai/compose-email", isAuthenticated, async (req, res) => {
    try {
      const { contactId, prospectId, context, tone } = req.body;

      let recipientData = "";
      if (contactId) {
        const contact = await storage.getContact(Number(contactId));
        if (contact) recipientData = `Recipient: ${contact.firstName} ${contact.lastName}, Company: ${contact.companyName || "N/A"}, Email: ${contact.email}, Status: ${contact.status}, Vertical: ${contact.vertical || "N/A"}`;
      } else if (prospectId) {
        const prospect = await storage.getProspect(Number(prospectId));
        if (prospect) recipientData = `Prospect: ${prospect.companyName}, Contact: ${prospect.ownerFirstName || ""} ${prospect.ownerLastName || ""}, Email: ${prospect.email || "N/A"}, Vertical: ${prospect.vertical || "N/A"}, Score: ${prospect.score || "N/A"}, Website: ${prospect.website || "N/A"}`;
      }

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Liberty Bancard's AI Email Composer. Draft a professional outreach email.
RULES:
- Tone: ${tone || "consultative and professional"}
- Never promise savings without statement review
- Include this disclaimer at the bottom: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Keep subject line under 60 characters
- Email body should be 3-5 short paragraphs
- Be value-first: lead with what you can do for them
- End with a clear call-to-action (book a call or reply)
FORMAT your response as JSON: {"subject": "...", "body": "..."}`
          },
          { role: "user", content: `${recipientData}\n\nAdditional context: ${context || "General outreach for payment processing services."}` }
        ],
        max_tokens: 800,
      });

      const raw = completion.choices[0]?.message?.content || "";
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { subject: "Liberty Bancard - Let's Talk Processing", body: raw };
        res.json(parsed);
      } catch {
        res.json({ subject: "Liberty Bancard - Let's Talk Processing", body: raw });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Email compose error" });
    }
  });

  // === UNIVERSAL SMART SEARCH ===
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase().trim();
      if (!q || q.length < 2) return res.json({ results: [] });

      const [contacts, deals, tickets, tasks, prospects] = await Promise.all([
        storage.getContacts(),
        storage.getDeals(),
        storage.getTickets(),
        storage.getTasks(),
        storage.getProspects(),
      ]);

      const results: Array<{ type: string; id: number; title: string; subtitle: string; href: string }> = [];

      contacts.forEach(c => {
        const searchStr = `${c.firstName} ${c.lastName} ${c.email} ${c.companyName || ""} ${c.phone || ""}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "contact", id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: c.companyName || c.email, href: "/dashboard/contacts" });
      });

      deals.forEach(d => {
        const searchStr = `${d.offerPath || ""} ${d.stage} ${d.pipeline} deal #${d.id}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "deal", id: d.id, title: `Deal #${d.id}`, subtitle: `${d.stage} - ${d.offerPath || d.pipeline}`, href: "/dashboard/pipeline" });
      });

      tickets.forEach(t => {
        const searchStr = `${t.subject} ${t.category || ""} ${t.status}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "ticket", id: t.id, title: t.subject, subtitle: `${t.status} - ${t.category || "General"}`, href: "/dashboard/tickets" });
      });

      tasks.forEach(t => {
        const searchStr = `${t.title} ${t.description || ""} ${t.status}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "task", id: t.id, title: t.title, subtitle: t.status || "pending", href: "/dashboard/tasks" });
      });

      prospects.forEach(p => {
        const searchStr = `${p.companyName || ""} ${p.ownerFirstName || ""} ${p.ownerLastName || ""} ${p.email || ""} ${p.vertical || ""}`.toLowerCase();
        if (searchStr.includes(q)) results.push({ type: "prospect", id: p.id, title: p.companyName || "Unknown", subtitle: `${p.vertical || "Unknown"} - ${p.score || "unscored"}`, href: "/dashboard/prospects" });
      });

      res.json({ results: results.slice(0, 20) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AUTO-LEAD ROUTING ===
  app.post("/api/ai/route-prospect", isAuthenticated, async (req, res) => {
    try {
      const { prospectId } = req.body;
      if (!prospectId) return res.status(400).json({ message: "prospectId required" });

      const prospect = await storage.getProspect(Number(prospectId));
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });

      const campaigns = await storage.getCampaigns();
      const activeCampaigns = campaigns.filter(c => c.name.startsWith("SDR-"));

      let bestCampaign = activeCampaigns[0];
      const vert = (prospect.vertical || "").toLowerCase();

      for (const camp of activeCampaigns) {
        const campVerticals = (camp.targetVerticals || []).join(" ").toLowerCase();
        const campName = camp.name.toLowerCase();
        if (campVerticals.includes(vert) || campName.includes(vert)) {
          bestCampaign = camp;
          break;
        }
        if (vert.includes("restaurant") && campName.includes("restaurant")) { bestCampaign = camp; break; }
        if ((vert.includes("medical") || vert.includes("dental") || vert.includes("healthcare")) && campName.includes("medical")) { bestCampaign = camp; break; }
        if ((vert.includes("retail") || vert.includes("ecommerce")) && campName.includes("retail")) { bestCampaign = camp; break; }
        if ((vert.includes("salon") || vert.includes("spa") || vert.includes("beauty")) && campName.includes("salon")) { bestCampaign = camp; break; }
        if ((vert.includes("auto") || vert.includes("trades")) && campName.includes("auto")) { bestCampaign = camp; break; }
        if ((vert.includes("professional") || vert.includes("legal") || vert.includes("accounting")) && campName.includes("professional")) { bestCampaign = camp; break; }
      }

      if (!bestCampaign) {
        bestCampaign = activeCampaigns.find(c => c.name.includes("Statement Review")) || activeCampaigns[0];
      }

      await storage.updateProspect(Number(prospectId), { status: "campaign_assigned" });

      res.json({ campaignId: bestCampaign?.id, campaignName: bestCampaign?.name, prospectId: prospect.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Routing error" });
    }
  });

  app.post("/api/ai/route-prospects-bulk", isAuthenticated, async (req, res) => {
    try {
      const { prospectIds } = req.body;
      if (!prospectIds || !Array.isArray(prospectIds)) return res.status(400).json({ message: "prospectIds array required" });

      const campaigns = await storage.getCampaigns();
      const sdrCampaigns = campaigns.filter(c => c.name.startsWith("SDR-"));
      const results: Array<{ prospectId: number; campaignId: number; campaignName: string }> = [];

      for (const pid of prospectIds.slice(0, 100)) {
        const prospect = await storage.getProspect(Number(pid));
        if (!prospect) continue;

        const vert = (prospect.vertical || "").toLowerCase();
        let matched = sdrCampaigns.find(c => {
          const name = c.name.toLowerCase();
          const verts = (c.targetVerticals || []).join(" ").toLowerCase();
          return verts.includes(vert) || name.includes(vert);
        });
        if (!matched) matched = sdrCampaigns.find(c => c.name.includes("Statement Review")) || sdrCampaigns[0];

        if (matched) {
          await storage.updateProspect(Number(pid), { status: "campaign_assigned" });
          results.push({ prospectId: prospect.id, campaignId: matched.id, campaignName: matched.name });
        }
      }

      res.json({ routed: results.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AI SMART TASK GENERATOR ===
  app.post("/api/ai/generate-tasks", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allTickets, allTasks, allContacts] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getTasks(),
        storage.getContacts(),
      ]);

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

      const newTasks: Array<{ title: string; description: string; priority: string; dueDate: Date; relatedType: string; relatedId: number }> = [];
      const existingTaskTitles = new Set(allTasks.map(t => t.title));

      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      for (const deal of salesDeals) {
        if (deal.updatedAt && new Date(deal.updatedAt) < sevenDaysAgo) {
          const title = `Follow up on stalling Deal #${deal.id}`;
          if (!existingTaskTitles.has(title)) {
            newTasks.push({ title, description: `Deal #${deal.id} (${deal.stage}) has had no activity for 7+ days. Reach out to re-engage.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), relatedType: "deal", relatedId: deal.id });
          }
        }
      }

      const openTickets = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      for (const ticket of openTickets) {
        if (ticket.slaDeadline && new Date(ticket.slaDeadline) < now) {
          const title = `Urgent: SLA breached on ticket "${ticket.subject}"`;
          if (!existingTaskTitles.has(title)) {
            newTasks.push({ title, description: `Ticket #${ticket.id} "${ticket.subject}" has breached its SLA deadline. Immediate action required.`, priority: "urgent", dueDate: now, relatedType: "ticket", relatedId: ticket.id });
          }
        }
      }

      const newLeads = allContacts.filter(c => c.status === "new" && c.createdAt && new Date(c.createdAt) < threeDaysAgo);
      for (const lead of newLeads) {
        const title = `Contact new lead: ${lead.firstName} ${lead.lastName}`;
        if (!existingTaskTitles.has(title)) {
          newTasks.push({ title, description: `${lead.firstName} ${lead.lastName} (${lead.companyName || lead.email}) has been a new lead for 3+ days with no contact. Reach out before they go cold.`, priority: "high", dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), relatedType: "contact", relatedId: lead.id });
        }
      }

      const created = [];
      for (const task of newTasks.slice(0, 10)) {
        const result = await storage.createTask({
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: "pending",
          dueDate: task.dueDate,
        });
        created.push(result);
      }

      res.json({ generated: created.length, tasks: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AUTO DEAL STAGE PROGRESSION ===
  app.post("/api/ai/auto-progress-deals", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const progressions: Array<{ dealId: number; from: string; to: string; reason: string }> = [];

      const stageOrder = ["New Lead", "Statement Collected", "Under Review", "Proposal Sent", "Negotiation", "Verbal Commit", "Closed Won"];

      for (const deal of salesDeals) {
        const currentIndex = stageOrder.indexOf(deal.stage);
        if (currentIndex < 0) continue;

        let shouldAdvance = false;
        let reason = "";

        if (deal.stage === "New Lead" && deal.lastStatementReviewDate) {
          shouldAdvance = true;
          reason = "Statement document received - advancing to review";
        }
        if (deal.stage === "Statement Collected" && deal.recommendedPath) {
          shouldAdvance = true;
          reason = "Statement review completed with recommendation - advancing to proposal";
        }
        if (deal.stage === "Under Review" && deal.effectiveRate) {
          shouldAdvance = true;
          reason = "Review analysis complete - advancing to proposal sent";
        }

        if (shouldAdvance && currentIndex + 1 < stageOrder.length) {
          const nextStage = stageOrder[currentIndex + 1];
          await storage.updateDeal(deal.id, { stage: nextStage });
          progressions.push({ dealId: deal.id, from: deal.stage, to: nextStage, reason });
          await storage.createAuditLog({ action: "deal_auto_progressed", entityType: "deal", entityId: deal.id, details: { from: deal.stage, to: nextStage, reason } });
        }
      }

      res.json({ progressed: progressions.length, progressions });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ACTIVITY TIMELINE ===
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const { entityType, entityId } = req.query;
      const allLogs = await storage.getAuditLogs();
      let filtered = allLogs;
      if (entityType && entityId) {
        filtered = allLogs.filter(l =>
          l.entityType === entityType && l.entityId === Number(entityId)
        );
      }
      const ghlLogs = await storage.getGhlActivityLogs(entityType === "contact" && entityId ? Number(entityId) : undefined);
      const timeline = [
        ...filtered.map(l => ({
          id: `audit-${l.id}`,
          type: "audit" as const,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          details: l.details,
          createdAt: l.createdAt,
        })),
        ...ghlLogs.map(g => ({
          id: `ghl-${g.id}`,
          type: "ghl" as const,
          action: g.channel,
          entityType: "contact",
          entityId: g.contactId,
          details: { direction: g.direction, channel: g.channel, subject: g.subject },
          createdAt: g.createdAt,
        })),
      ];
      timeline.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      res.json(timeline.slice(0, 100));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AI TICKET CLASSIFICATION ===
  app.post("/api/ai/classify-ticket", isAuthenticated, async (req, res) => {
    try {
      const { ticketId } = req.body;
      if (!ticketId) return res.status(400).json({ message: "ticketId required" });
      const ticket = await storage.getTicket(Number(ticketId));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a support ticket classifier for Liberty Bancard, a merchant payment processing company.
Analyze the ticket and return JSON with these fields:
- category: one of ["Billing & Fees", "Terminal / Equipment", "Deposits & Funding", "Chargebacks & Disputes", "Compliance / PCI", "Onboarding", "Account Changes", "Other"]
- priority: one of ["Low", "Normal", "High", "Urgent"]
- suggestedResponse: a professional, helpful draft response (3-5 sentences) addressing the merchant's concern
- tags: array of 2-4 relevant tags
- estimatedResolutionHours: number estimate
Respond ONLY with valid JSON.`
          },
          {
            role: "user",
            content: `Subject: ${ticket.subject}\nDescription: ${ticket.description}\nCurrent Category: ${ticket.category}\nCurrent Priority: ${ticket.priority}`
          }
        ],
        max_tokens: 600,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ message: "AI returned invalid response" });

      const result = JSON.parse(jsonMatch[0]);
      await storage.updateTicket(Number(ticketId), {
        category: result.category,
        priority: result.priority,
      });
      await storage.createAuditLog({
        action: "ticket_ai_classified",
        entityType: "ticket",
        entityId: ticket.id,
        details: result,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Classification error" });
    }
  });

  // === AI COMMAND CENTER STATUS ===
  app.get("/api/ai/command-center", isAuthenticated, async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      const aiActions = [
        { key: "generate_tasks", label: "Smart Task Generation", actionType: "ai_tasks_generated" },
        { key: "auto_progress", label: "Deal Auto-Progression", actionType: "deal_auto_progressed" },
        { key: "route_prospects", label: "Prospect Routing", actionType: "prospect_routed" },
        { key: "classify_tickets", label: "Ticket Classification", actionType: "ticket_ai_classified" },
        { key: "insights", label: "AI Insights", actionType: "ai_insights_generated" },
        { key: "statement_analysis", label: "Statement Analysis", actionType: "statement_analyzed" },
      ];

      const result = aiActions.map(action => {
        const relevant = logs.filter(l => l.action === action.actionType);
        const lastRun = relevant.length > 0 ? relevant[0].createdAt : null;
        return {
          ...action,
          totalRuns: relevant.length,
          lastRun,
        };
      });

      const workflowRunsList = await storage.getWorkflowRuns();
      const totalWorkflowRuns = workflowRunsList.length;
      const recentRuns = workflowRunsList.filter(r => {
        const created = new Date(r.createdAt || 0);
        return created > new Date(Date.now() - 24 * 60 * 60 * 1000);
      }).length;

      res.json({
        aiActions: result,
        workflowStats: { totalRuns: totalWorkflowRuns, last24h: recentRuns },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AI STATEMENT ANALYSIS ===
  app.post("/api/ai/analyze-statement", isAuthenticated, async (req, res) => {
    try {
      const { contactId, dealId, statementData } = req.body;
      if (!statementData) return res.status(400).json({ message: "statementData required" });

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Liberty Bancard's AI Statement Analyst. Analyze merchant processing statement data and provide a detailed fee analysis.
RULES:
- Never promise specific savings without full statement review
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Be specific about fee types and rates found
- Recommend the best offer path based on the data

Return JSON with:
- effectiveRate: estimated effective rate as percentage string
- monthlyVolume: estimated monthly volume
- currentFees: object with fee breakdowns { interchange: string, markup: string, monthlyFees: string, pciFees: string, otherFees: string }
- recommendedPath: one of ["Cash Discount", "Dual Pricing", "Tiered Reduction", "Interchange Plus"]
- keyFindings: array of 3-5 specific findings about their current processing
- riskFlags: array of any concerning items (high rates, non-compliant fees, etc.)
- nextSteps: array of recommended next steps
- overallAssessment: 2-3 sentence summary`
          },
          { role: "user", content: `Statement Data:\n${typeof statementData === 'string' ? statementData : JSON.stringify(statementData)}` }
        ],
        max_tokens: 1000,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { overallAssessment: raw };

      if (dealId) {
        await storage.updateDeal(Number(dealId), {
          effectiveRate: analysis.effectiveRate,
          recommendedPath: analysis.recommendedPath,
        });
      }

      await storage.createAuditLog({
        action: "statement_analyzed",
        entityType: dealId ? "deal" : "contact",
        entityId: dealId ? Number(dealId) : (contactId ? Number(contactId) : undefined),
        details: analysis,
      });

      res.json(analysis);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Analysis error" });
    }
  });

  app.post("/api/ai/generate-proposal", isAuthenticated, async (req, res) => {
    try {
      const { dealId, statementData } = req.body;
      if (!dealId) return res.status(400).json({ message: "dealId required" });

      const deal = await storage.getDeal(Number(dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;

      const volume = parseFloat((statementData?.monthlyVolume || deal.totalVolume || "0").toString().replace(/[^0-9.]/g, ""));
      const effectiveRate = parseFloat((statementData?.effectiveRate || deal.effectiveRate || "3.0").toString().replace(/[^0-9.]/g, ""));
      const avgTicket = parseFloat((statementData?.avgTicket || deal.avgTicket || "50").toString().replace(/[^0-9.]/g, ""));
      const currentMonthlyFees = volume * (effectiveRate / 100);

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are Liberty Bancard's AI Pricing Strategist. Generate a competitive savings proposal for a merchant.

BUSINESS CONTEXT:
- Liberty Bancard is a merchant payment processor offering better rates
- Goal: Show the merchant EXACTLY where they save and how much per year
- Pricing should be 20-30% lower than their current processing fees
- Liberty Bancard still needs healthy margin (target 15-25 basis points net profit on volume)
- Generate THREE pricing plans the sales rep can present

PLAN TYPES:
1. "Cash Discount / Compliant Surcharging" - Merchant effectively pays 0% processing. Customer pays a small service fee at point of sale. Liberty Bancard earns from the surcharge program management fee.
2. "Interchange Plus" - Transparent pricing: interchange cost + small fixed markup. Merchant still saves significantly vs their current tiered/bundled pricing. This is the "honest" plan.
3. "Tiered Reduction" - Simplified tiered pricing but with rates 20-30% lower than current. Good for merchants who want simplicity.

RULES:
- All savings must be realistic and mathematically sound
- Include disclaimer: "Eligibility, underwriting, card brand rules, and applicable laws apply. Savings estimates based on statement data provided. Actual results may vary."
- Never promise exact savings without full underwriting
- Be specific with dollar amounts
- Include strong urgency CTAs

Return valid JSON with this exact structure:
{
  "merchantName": "string",
  "currentState": {
    "monthlyVolume": number,
    "effectiveRate": "string (e.g. 3.2%)",
    "monthlyFees": number,
    "annualFees": number,
    "avgTicket": number,
    "topIssues": ["string array of 3-5 specific fee problems found"]
  },
  "plans": [
    {
      "name": "Cash Discount / Compliant Surcharging",
      "shortName": "cashDiscount",
      "headline": "string - compelling one-liner",
      "effectiveRate": "string (e.g. 0.00%)",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string - 2-3 sentence explanation",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Interchange Plus",
      "shortName": "interchangePlus",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    },
    {
      "name": "Tiered Reduction",
      "shortName": "tieredReduction",
      "headline": "string",
      "effectiveRate": "string",
      "monthlyFees": number,
      "monthlySavings": number,
      "annualSavings": number,
      "savingsPercent": number,
      "howItWorks": "string",
      "pros": ["string array"],
      "cons": ["string array"],
      "bestFor": "string",
      "libertyMarginBps": number,
      "libertyMonthlyRevenue": number
    }
  ],
  "recommendedPlan": "shortName of best plan for this merchant",
  "recommendedReason": "string - why this plan is best",
  "urgencyCtas": ["3 strong CTA messages to close the deal ASAP"],
  "complianceDisclaimer": "string",
  "feeBreakdown": {
    "currentInterchange": "string estimate",
    "currentMarkup": "string estimate",
    "currentMonthlyFees": "string estimate",
    "currentPciFees": "string estimate",
    "hiddenFees": ["string array of fees they're overpaying"]
  }
}`
          },
          {
            role: "user",
            content: `Generate a savings proposal for this merchant:
Merchant: ${contact?.companyName || contact?.firstName + " " + contact?.lastName || "Unknown Business"}
Industry: ${contact?.vertical || "General Retail"}
Monthly Volume: $${volume.toLocaleString()}
Current Effective Rate: ${effectiveRate}%
Current Monthly Fees: $${currentMonthlyFees.toFixed(2)}
Average Ticket: $${avgTicket.toFixed(2)}
Current Provider: ${contact?.currentProvider || "Unknown"}
Additional Statement Data: ${statementData ? JSON.stringify(statementData) : "None provided"}
Notes: ${deal.notes || "None"}`
          }
        ],
        max_tokens: 2000,
      });

      const raw = completion.choices[0]?.message?.content || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ message: "Failed to generate structured proposal" });
      }

      let proposal: any;
      try {
        proposal = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        return res.status(500).json({ message: "AI returned malformed JSON. Please try again." });
      }

      if (!proposal.plans || !Array.isArray(proposal.plans) || proposal.plans.length === 0) {
        return res.status(500).json({ message: "Proposal missing required plan data. Please try again." });
      }

      for (const plan of proposal.plans) {
        plan.monthlySavings = typeof plan.monthlySavings === "number" ? plan.monthlySavings : 0;
        plan.annualSavings = typeof plan.annualSavings === "number" ? plan.annualSavings : plan.monthlySavings * 12;
        plan.savingsPercent = typeof plan.savingsPercent === "number" ? plan.savingsPercent : 0;
        plan.libertyMarginBps = typeof plan.libertyMarginBps === "number" ? plan.libertyMarginBps : 0;
        plan.libertyMonthlyRevenue = typeof plan.libertyMonthlyRevenue === "number" ? plan.libertyMonthlyRevenue : 0;
      }

      if (!proposal.currentState) {
        proposal.currentState = { monthlyVolume: volume, effectiveRate: `${effectiveRate}%`, monthlyFees: currentMonthlyFees, annualFees: currentMonthlyFees * 12, avgTicket, topIssues: [] };
      }

      proposal.generatedAt = new Date().toISOString();
      proposal.dealId = deal.id;

      const bestPlan = proposal.plans?.find((p: any) => p.shortName === proposal.recommendedPlan) || proposal.plans?.[0];

      await storage.updateDeal(deal.id, {
        savingsProposal: proposal,
        proposalGeneratedAt: new Date(),
        recommendedPath: bestPlan?.name || deal.recommendedPath,
        effectiveRate: deal.effectiveRate || `${effectiveRate}%`,
        totalVolume: deal.totalVolume || `$${volume.toLocaleString()}`,
        totalFees: deal.totalFees || `$${currentMonthlyFees.toFixed(2)}`,
        avgTicket: deal.avgTicket || `$${avgTicket.toFixed(2)}`,
        estimatedGrossProfitBps: bestPlan?.libertyMarginBps || deal.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: bestPlan?.libertyMonthlyRevenue ? `$${bestPlan.libertyMonthlyRevenue.toFixed(2)}` : deal.estimatedGrossProfitMonthly,
        lastStatementReviewDate: new Date(),
      });

      await storage.createAuditLog({
        action: "proposal_generated",
        entityType: "deal",
        entityId: deal.id,
        details: {
          recommendedPlan: proposal.recommendedPlan,
          plans: proposal.plans?.map((p: any) => ({ name: p.name, annualSavings: p.annualSavings, savingsPercent: p.savingsPercent })),
        },
      });

      await storage.createNotification({
        channel: "internal",
        title: "Savings Proposal Generated",
        message: `Proposal ready for ${contact?.companyName || contact?.firstName || "Unknown"} - recommended: ${bestPlan?.name || "N/A"}, annual savings: $${bestPlan?.annualSavings?.toLocaleString() || "N/A"}`,
        type: "info",
        metadata: { dealId: deal.id, contactId: deal.contactId },
      });

      res.json(proposal);
    } catch (err: any) {
      console.error("Proposal generation error:", err);
      res.status(500).json({ message: err.message || "Proposal generation error" });
    }
  });

  app.get("/api/deals/:id/proposal", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.id));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      if (!deal.savingsProposal) return res.status(404).json({ message: "No proposal generated yet" });
      res.json(deal.savingsProposal);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ANALYTICS / REPORTING ===
  app.get("/api/analytics/pipeline", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const salesDeals = allDeals.filter(d => d.pipeline === "sales");
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding");

      const stageDistribution: Record<string, number> = {};
      salesDeals.forEach(d => { stageDistribution[d.stage] = (stageDistribution[d.stage] || 0) + 1; });

      const closedWon = salesDeals.filter(d => d.stage === "Closed Won");
      const closedLost = salesDeals.filter(d => d.stage === "Closed Lost");
      const active = salesDeals.filter(d => d.stage !== "Closed Won" && d.stage !== "Closed Lost");
      const winRate = (closedWon.length + closedLost.length) > 0
        ? Math.round((closedWon.length / (closedWon.length + closedLost.length)) * 100)
        : 0;

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const newLast30 = salesDeals.filter(d => d.createdAt && new Date(d.createdAt) > thirtyDaysAgo);
      const wonLast30 = closedWon.filter(d => d.updatedAt && new Date(d.updatedAt) > thirtyDaysAgo);

      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const stallingDeals = active.filter(d => d.updatedAt && new Date(d.updatedAt) < sevenDaysAgo);

      res.json({
        sales: {
          total: salesDeals.length,
          active: active.length,
          closedWon: closedWon.length,
          closedLost: closedLost.length,
          winRate,
          stageDistribution,
          newLast30Days: newLast30.length,
          wonLast30Days: wonLast30.length,
          stallingDeals: stallingDeals.length,
        },
        onboarding: {
          total: onboardingDeals.length,
          active: onboardingDeals.filter(d => d.stage !== "Live" && d.stage !== "Cancelled").length,
          completed: onboardingDeals.filter(d => d.stage === "Live").length,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/support", isAuthenticated, async (req, res) => {
    try {
      const allTickets = await storage.getTickets();
      const now = new Date();

      const open = allTickets.filter(t => t.status !== "Resolved" && t.status !== "Closed");
      const resolved = allTickets.filter(t => t.status === "Resolved" || t.status === "Closed");
      const breached = allTickets.filter(t => t.slaDeadline && new Date(t.slaDeadline) < now && t.status !== "Resolved" && t.status !== "Closed");

      const categoryBreakdown: Record<string, number> = {};
      allTickets.forEach(t => { categoryBreakdown[t.category || "Other"] = (categoryBreakdown[t.category || "Other"] || 0) + 1; });

      const priorityBreakdown: Record<string, number> = {};
      allTickets.forEach(t => { priorityBreakdown[t.priority || "Normal"] = (priorityBreakdown[t.priority || "Normal"] || 0) + 1; });

      const resolvedWithTimes = resolved.filter(t => t.createdAt && t.resolvedAt);
      const avgResolutionHours = resolvedWithTimes.length > 0
        ? Math.round(resolvedWithTimes.reduce((sum, t) => sum + (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt!).getTime()) / (1000 * 60 * 60), 0) / resolvedWithTimes.length)
        : 0;

      res.json({
        total: allTickets.length,
        open: open.length,
        resolved: resolved.length,
        slaBreaches: breached.length,
        avgResolutionHours,
        categoryBreakdown,
        priorityBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/tasks", isAuthenticated, async (req, res) => {
    try {
      const allTasks = await storage.getTasks();
      const now = new Date();
      const pending = allTasks.filter(t => t.status === "pending");
      const inProgress = allTasks.filter(t => t.status === "in_progress");
      const completed = allTasks.filter(t => t.status === "completed");
      const overdue = allTasks.filter(t => t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now);

      const priorityBreakdown: Record<string, number> = {};
      allTasks.forEach(t => { priorityBreakdown[t.priority || "normal"] = (priorityBreakdown[t.priority || "normal"] || 0) + 1; });

      res.json({
        total: allTasks.length,
        pending: pending.length,
        inProgress: inProgress.length,
        completed: completed.length,
        overdue: overdue.length,
        priorityBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/lead-sources", isAuthenticated, async (req, res) => {
    try {
      const allContacts = await storage.getContacts();
      const allDeals = await storage.getDeals();
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const recentContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo);

      const sourceMap: Record<string, { leads: number; deals: number; won: number }> = {};
      recentContacts.forEach(c => {
        const src = c.utmSource || c.leadSource || "direct";
        if (!sourceMap[src]) sourceMap[src] = { leads: 0, deals: 0, won: 0 };
        sourceMap[src].leads++;
      });

      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);
      salesDeals.forEach(d => {
        const src = d.leadSource || "direct";
        const normalizedSrc = src.startsWith("utm:") ? src.slice(4) : src;
        if (!sourceMap[normalizedSrc]) sourceMap[normalizedSrc] = { leads: 0, deals: 0, won: 0 };
        sourceMap[normalizedSrc].deals++;
        if (d.stage === "Closed Won") sourceMap[normalizedSrc].won++;
      });

      const sources = Object.entries(sourceMap)
        .map(([source, data]) => ({
          source,
          leads: data.leads,
          deals: data.deals,
          won: data.won,
          conversionRate: data.leads > 0 ? Math.round((data.won / data.leads) * 100) : 0,
        }))
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 10);

      res.json({ sources });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/conversion-funnel", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const allContacts = await storage.getContacts();
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recentContacts = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= thirtyDaysAgo);
      const salesDeals = allDeals.filter(d => d.pipeline === "sales" && d.createdAt && new Date(d.createdAt) >= thirtyDaysAgo);

      const stages = ["New Lead", "Statement Received", "Review In Progress", "Call Booked", "Proposal Sent", "Negotiation / Follow-Up", "Closed Won"];
      const funnel = stages.map(stage => {
        const atOrPast = salesDeals.filter(d => {
          const stageIdx = stages.indexOf(d.stage);
          const targetIdx = stages.indexOf(stage);
          return stageIdx >= targetIdx || d.stage === stage;
        });
        return { stage, count: atOrPast.length };
      });

      res.json({
        totalLeads: recentContacts.length,
        totalDeals: salesDeals.length,
        funnel,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/analytics/daily-leads", isAuthenticated, async (req, res) => {
    try {
      const allContacts = await storage.getContacts();
      const allDeals = await storage.getDeals();
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const dailyData: Record<string, { leads: number; deals: number }> = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split("T")[0];
        dailyData[key] = { leads: 0, deals: 0 };
      }

      allContacts.forEach(c => {
        if (!c.createdAt) return;
        const key = new Date(c.createdAt).toISOString().split("T")[0];
        if (dailyData[key]) dailyData[key].leads++;
      });

      allDeals.filter(d => d.pipeline === "sales").forEach(d => {
        if (!d.createdAt) return;
        const key = new Date(d.createdAt).toISOString().split("T")[0];
        if (dailyData[key]) dailyData[key].deals++;
      });

      const today = now.toISOString().split("T")[0];
      const todayLeads = dailyData[today]?.leads || 0;
      const todayDeals = dailyData[today]?.deals || 0;

      const trend = Object.entries(dailyData)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

      res.json({ todayLeads, todayDeals, trend });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/analytics/weekly-digest", isAuthenticated, async (req, res) => {
    try {
      const [allDeals, allContacts, allTickets, allTasks] = await Promise.all([
        storage.getDeals(),
        storage.getContacts(),
        storage.getTickets(),
        storage.getTasks(),
      ]);

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const newLeads = allContacts.filter(c => c.createdAt && new Date(c.createdAt) >= sevenDaysAgo).length;
      const newDeals = allDeals.filter(d => d.createdAt && new Date(d.createdAt) >= sevenDaysAgo).length;
      const closedWon = allDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
      const closedLost = allDeals.filter(d => d.stage === "Closed Lost" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo).length;
      const proposalsSent = allDeals.filter(d => d.stage === "Proposal Sent" && d.updatedAt && new Date(d.updatedAt) >= sevenDaysAgo).length;
      const newTickets = allTickets.filter(t => t.createdAt && new Date(t.createdAt) >= sevenDaysAgo).length;
      const resolvedTickets = allTickets.filter(t => t.resolvedAt && new Date(t.resolvedAt) >= sevenDaysAgo).length;
      const overdueTaskCount = allTasks.filter(t => t.status !== "completed" && t.dueDate && new Date(t.dueDate) < now).length;

      const parseCurrency = (v: string | null | undefined): number => {
        if (!v) return 0;
        const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
        return isNaN(n) ? 0 : n;
      };
      const wonDeals = allDeals.filter(d => d.stage === "Closed Won" && d.closedAt && new Date(d.closedAt) >= sevenDaysAgo);
      const weeklyRevenue = wonDeals.reduce((s, d) => s + parseCurrency(d.estimatedGrossProfitMonthly), 0);

      const conversionRate = (newDeals > 0) ? Math.round((closedWon / newDeals) * 100) : 0;

      const sourceBreakdown: Record<string, number> = {};
      allContacts
        .filter(c => c.createdAt && new Date(c.createdAt) >= sevenDaysAgo)
        .forEach(c => {
          const src = c.utmSource || c.leadSource || "direct";
          sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
        });

      const digest = {
        period: `${sevenDaysAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`,
        newLeads,
        newDeals,
        proposalsSent,
        closedWon,
        closedLost,
        conversionRate,
        weeklyRevenue: Math.round(weeklyRevenue),
        newTickets,
        resolvedTickets,
        overdueTaskCount,
        sourceBreakdown,
      };

      const adminEmail = req.body?.email || process.env.ADMIN_DIGEST_EMAIL;
      if (adminEmail && isGhlConfigured()) {
        const emailBody = `
<h2>Liberty Bancard — Weekly KPI Digest</h2>
<p><strong>Period:</strong> ${digest.period}</p>
<hr>
<h3>Pipeline</h3>
<ul>
  <li>New Leads: <strong>${digest.newLeads}</strong></li>
  <li>New Deals: <strong>${digest.newDeals}</strong></li>
  <li>Proposals Sent: <strong>${digest.proposalsSent}</strong></li>
  <li>Closed Won: <strong>${digest.closedWon}</strong></li>
  <li>Closed Lost: <strong>${digest.closedLost}</strong></li>
  <li>Conversion Rate: <strong>${digest.conversionRate}%</strong></li>
  <li>Revenue (Est.): <strong>$${digest.weeklyRevenue.toLocaleString()}</strong></li>
</ul>
<h3>Support</h3>
<ul>
  <li>New Tickets: <strong>${digest.newTickets}</strong></li>
  <li>Resolved: <strong>${digest.resolvedTickets}</strong></li>
  <li>Overdue Tasks: <strong>${digest.overdueTaskCount}</strong></li>
</ul>
<h3>Lead Sources</h3>
<ul>
  ${Object.entries(digest.sourceBreakdown).map(([s, c]) => `<li>${s}: <strong>${c}</strong></li>`).join("")}
</ul>
<p style="color:#888;font-size:12px;">Auto-generated by Liberty Bancard CRM</p>`;

        try {
          await sendGhlEmailForMerchant({ email: adminEmail, subject: "Weekly KPI Digest — Liberty Bancard", body: emailBody });
          res.json({ ...digest, emailSent: true, emailRecipient: adminEmail });
          return;
        } catch (emailErr) {
          console.error("Weekly digest email error:", emailErr);
          res.json({ ...digest, emailSent: false, emailError: String(emailErr) });
          return;
        }
      }

      res.json({ ...digest, emailSent: false, emailError: !adminEmail ? "No admin email configured" : "GHL not configured" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === AI ONBOARDING STATUS ===
  app.get("/api/ai/onboarding-status", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const onboardingDeals = allDeals.filter(d => d.pipeline === "onboarding" && d.stage !== "Live" && d.stage !== "Cancelled");
      const allTasks = await storage.getTasks();

      const statuses = onboardingDeals.map(deal => {
        const milestones = [
          { name: "Kickoff Complete", done: !!deal.notes?.includes("kickoff") },
          { name: "Application Submitted", done: deal.stage !== "Kickoff" },
          { name: "Underwriting Approved", done: ["Equipment Ordered", "Terminal Shipped", "Installation", "Training", "Live"].includes(deal.stage) },
          { name: "Equipment Ordered", done: ["Terminal Shipped", "Installation", "Training", "Live"].includes(deal.stage) },
          { name: "Terminal Shipped", done: ["Installation", "Training", "Live"].includes(deal.stage) },
          { name: "Installation Complete", done: ["Training", "Live"].includes(deal.stage) },
          { name: "Training Done", done: deal.stage === "Live" },
        ];
        const completedMilestones = milestones.filter(m => m.done).length;
        const progress = Math.round((completedMilestones / milestones.length) * 100);

        const dealTasks = allTasks.filter(t => t.dealId === deal.id);
        const pendingTasks = dealTasks.filter(t => t.status !== "completed");

        let nextStep = "Continue processing";
        const nextMilestone = milestones.find(m => !m.done);
        if (nextMilestone) nextStep = `Complete: ${nextMilestone.name}`;

        return {
          dealId: deal.id,
          contactId: deal.contactId,
          stage: deal.stage,
          progress,
          milestones,
          pendingTasks: pendingTasks.length,
          nextStep,
          updatedAt: deal.updatedAt,
        };
      });

      res.json(statuses);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === DOCUMENTS LIST ===
  app.get("/api/documents", isAuthenticated, async (req, res) => {
    try {
      const docs = await storage.getDocuments();
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === WORKFLOW TRIGGER EXECUTION ===
  app.post("/api/webhooks/trigger", async (req, res) => {
    try {
      const { event, entityType, entityId, data } = req.body;
      if (!event) return res.status(400).json({ message: "event required" });

      const results = await triggerWorkflowsByEvent(event, {
        entityType: entityType || undefined,
        entityId: entityId ? Number(entityId) : undefined,
        data,
      });

      res.json({ triggered: results.length, workflows: results.map(r => r.workflowName), results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === NOTES ===
  app.get("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const { entityType, entityId } = req.query;
      if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
      const notesList = await storage.getNotes(String(entityType), Number(entityId));
      res.json(notesList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/notes", isAuthenticated, async (req, res) => {
    try {
      const input = insertNoteSchema.parse(req.body);
      const note = await storage.createNote(input);
      res.status(201).json(note);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/notes/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteNote(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === GLOBAL SEARCH ===
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = String(req.query.q || "").toLowerCase().trim();
      if (!q) return res.json({ contacts: [], deals: [], tickets: [], tasks: [] });
      
      const [allContacts, allDeals, allTickets, allTasks] = await Promise.all([
        storage.getContacts(),
        storage.getDeals(),
        storage.getTickets(),
        storage.getTasks(),
      ]);
      
      const matchContacts = allContacts.filter(c => 
        c.firstName.toLowerCase().includes(q) || c.lastName.toLowerCase().includes(q) || 
        c.email?.toLowerCase().includes(q) || c.companyName?.toLowerCase().includes(q) || c.phone?.includes(q)
      ).slice(0, 10);
      
      const matchDeals = allDeals.filter(d => 
        d.stage?.toLowerCase().includes(q) || d.offerPath?.toLowerCase().includes(q) || 
        d.notes?.toLowerCase().includes(q) || d.pipeline?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      const matchTickets = allTickets.filter(t => 
        t.subject?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || 
        t.category?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      const matchTasks = allTasks.filter(t => 
        t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || 
        t.assignedTo?.toLowerCase().includes(q)
      ).slice(0, 10);
      
      res.json({ contacts: matchContacts, deals: matchDeals, tickets: matchTickets, tasks: matchTasks });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CONTACT DETAIL AGGREGATE ===
  app.get("/api/contacts/:id/detail", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Not found" });
      
      const [allDeals, allTickets, allTasks, contactNotes] = await Promise.all([
        storage.getDeals(),
        storage.getTickets(),
        storage.getTasks(),
        storage.getNotes("contact", contactId),
      ]);
      
      const contactDeals = allDeals.filter(d => d.contactId === contactId);
      const contactTickets = allTickets.filter(t => t.contactId === contactId);
      const contactTasks = allTasks.filter(t => t.contactId === contactId);
      
      res.json({ contact, deals: contactDeals, tickets: contactTickets, tasks: contactTasks, notes: contactNotes });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === EXPORT CSV ===
  app.get("/api/export/contacts", isAuthenticated, async (req, res) => {
    try {
      const allContacts = await storage.getContacts();
      const headers = ["ID","First Name","Last Name","Email","Phone","Company","Status","Tags","Created"];
      const rows = allContacts.map(c => [
        c.id, c.firstName, c.lastName, c.email, c.phone, c.companyName || "", c.status || "", 
        (c.tags || []).join(";"), c.createdAt ? new Date(c.createdAt).toISOString() : ""
      ]);
      const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/export/deals", isAuthenticated, async (req, res) => {
    try {
      const allDeals = await storage.getDeals();
      const allContacts = await storage.getContacts();
      const contactMap = new Map(allContacts.map(c => [c.id, c]));
      const headers = ["ID","Contact","Company","Pipeline","Stage","Offer Path","Volume","Fees","Profit/mo","Created"];
      const rows = allDeals.map(d => {
        const c = d.contactId ? contactMap.get(d.contactId) : null;
        return [
          d.id, c ? `${c.firstName} ${c.lastName}` : "", c?.companyName || "", d.pipeline, d.stage, d.offerPath || "",
          d.totalVolume || "", d.totalFees || "", d.estimatedNetProfitMonthly || "",
          d.createdAt ? new Date(d.createdAt).toISOString() : ""
        ];
      });
      const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=deals.csv");
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/export/tickets", isAuthenticated, async (req, res) => {
    try {
      const allTickets = await storage.getTickets();
      const headers = ["ID","Subject","Category","Priority","Status","Assigned To","SLA Deadline","Created"];
      const rows = allTickets.map(t => [
        t.id, t.subject, t.category || "", t.priority || "", t.status || "", t.assignedTo || "",
        t.slaDeadline ? new Date(t.slaDeadline).toISOString() : "",
        t.createdAt ? new Date(t.createdAt).toISOString() : ""
      ]);
      const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=tickets.csv");
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === EMAIL LOGS ===
  app.get("/api/email-logs", async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getEmailLogs(contactId);
    res.json(logs);
  });

  app.get("/api/email-logs/contact/:contactId", async (req, res) => {
    const logs = await storage.getEmailLogs(Number(req.params.contactId));
    res.json(logs);
  });

  app.post("/api/email-logs", async (req, res) => {
    try {
      const input = insertEmailLogSchema.parse(req.body);
      const log = await storage.createEmailLog(input);
      await storage.createAuditLog({ action: "email_logged", entityType: "contact", entityId: log.contactId || 0, details: { direction: log.direction, subject: log.subject || "" } });
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === CALL LOGS ===
  app.get("/api/call-logs", async (req, res) => {
    const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
    const logs = await storage.getCallLogs(contactId);
    res.json(logs);
  });

  app.get("/api/call-logs/contact/:contactId", async (req, res) => {
    const logs = await storage.getCallLogs(Number(req.params.contactId));
    res.json(logs);
  });

  app.post("/api/call-logs", async (req, res) => {
    try {
      const input = insertCallLogSchema.parse(req.body);
      const log = await storage.createCallLog(input);
      await storage.createAuditLog({ action: "call_logged", entityType: "contact", entityId: log.contactId || 0, details: { direction: log.direction, outcome: log.outcome || "", duration: String(log.duration || 0) } });
      if (log.outcome === "Appointment Set" || log.outcome === "Interested") {
        await storage.createNotification({ channel: "internal", title: "Positive Call Outcome", message: `Call with contact #${log.contactId}: ${log.outcome}`, type: "info" });
      }
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/call-follow-ups/generate", async (req, res) => {
    try {
      const { contactId, dealId, outcome, callNotes, firefliesRecap, duration } = req.body;
      if (!contactId || !outcome) return res.status(400).json({ message: "contactId and outcome are required" });

      const contact = await storage.getContact(Number(contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      let deal = null;
      if (dealId) deal = await storage.getDeal(Number(dealId));

      const contactName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "there";
      const companyName = contact.companyName || "";
      const vertical = contact.vertical || "";
      const monthlyVolume = contact.monthlyVolume || deal?.totalVolume || "";

      const outcomeContext: Record<string, string> = {
        "Connected - Send Review Summary": "The merchant had a good call and wants to see a summary of how Liberty Bancard can save them money. They're interested but want to see the numbers. Follow up should reference the conversation specifics and promise the detailed review is coming.",
        "Connected - Needs Proposal": "The merchant is ready for a formal proposal. They're comparing options and want specifics on pricing. Follow up should be confident, reference what was discussed, and set expectations for when they'll receive the proposal.",
        "Connected - Not a Fit": "The merchant isn't a match for our services right now. Send a polite, professional wrap-up thanking them for their time. Leave the door open in case things change.",
        "No Show": "The merchant missed the scheduled call. Follow up should be understanding (not guilt-trippy), offer to reschedule, and gently convey that you had valuable info to share.",
        "Not Now (Nurture)": "The merchant is interested but the timing isn't right. Maybe they're in a contract, busy season, or just not ready to switch. Follow up should be warm, no-pressure, and position you as someone they can reach out to when they're ready.",
        "Closed Won": "Congratulations! The merchant signed up. Send a warm welcome message, set expectations for onboarding next steps, and make them feel confident about their decision.",
        "Closed Lost": "The merchant decided to go another direction. Send a gracious, professional message. No hard feelings. Leave the door open and wish them well.",
      };

      const context = outcomeContext[outcome] || "Follow up after a sales call. Be professional and personable.";

      const recapSection = firefliesRecap
        ? `\n\nCALL TRANSCRIPT/RECAP FROM FIREFLIES:\n${firefliesRecap.slice(0, 3000)}`
        : "";
      const notesSection = callNotes ? `\n\nAGENT'S CALL NOTES:\n${callNotes}` : "";

      const { OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: `You are a sales follow-up writer for Liberty Bancard, a merchant payment processing company. You write follow-up emails and texts that sound like they're from a real person — not a template, not a bot.

Rules:
- Use the merchant's first name naturally
- Reference specific things from the call if recap/notes are provided
- Keep SMS under 300 characters, conversational, no formal sign-offs
- Emails should be 3-5 short paragraphs, warm but professional
- Never use phrases like "per our conversation" or "as discussed" — those sound corporate
- Include the phone number 954-266-8214 for direct contact
- Sign emails as "The Liberty Bancard Team" or the agent's name if available
- For SMS, end with "- Liberty Bancard" and "Reply STOP to opt out"
- Never promise specific savings percentages or make unsubstantiated claims
- Always include: "Reply STOP to opt out" in SMS messages`
          },
          {
            role: "user",
            content: `Generate a follow-up email AND SMS for this sales call:

MERCHANT: ${contactName}${companyName ? ` (${companyName})` : ""}
INDUSTRY: ${vertical || "Not specified"}
MONTHLY VOLUME: ${monthlyVolume || "Not specified"}
CALL OUTCOME: ${outcome}
CALL DURATION: ${duration ? `${duration} minutes` : "Not recorded"}

CONTEXT: ${context}${recapSection}${notesSection}

Respond in this exact JSON format:
{
  "emailSubject": "...",
  "emailBody": "...",
  "smsBody": "...",
  "callSummary": "Brief 2-3 sentence summary of the call for internal records",
  "nextSteps": "What should happen next with this lead",
  "sentiment": "positive/neutral/negative"
}`
          }
        ],
      });

      let parsed;
      try {
        const raw = aiResponse.choices[0]?.message?.content || "{}";
        const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          emailSubject: `Following up on our call, ${contactName}`,
          emailBody: `Hi ${contactName},\n\nThanks for taking the time to chat today. I wanted to follow up while everything's fresh.\n\nI'll be pulling together the details we talked about and will have something over to you shortly. In the meantime, if anything comes to mind or you have questions, just reply here or call me directly at 954-266-8214.\n\nTalk soon,\nThe Liberty Bancard Team`,
          smsBody: `Hey ${contactName}, thanks for the call today! I'll have those details over to you soon. Questions? Call me at 954-266-8214. - Liberty Bancard. Reply STOP to opt out`,
          callSummary: `Call with ${contactName}. Outcome: ${outcome}.`,
          nextSteps: "Follow up with details discussed on the call.",
          sentiment: "neutral",
        };
      }

      res.json({
        email: {
          subject: parsed.emailSubject || `Following up, ${contactName}`,
          body: parsed.emailBody || "",
        },
        sms: {
          body: parsed.smsBody || "",
        },
        callSummary: parsed.callSummary || "",
        nextSteps: parsed.nextSteps || "",
        sentiment: parsed.sentiment || "neutral",
        contactName,
        companyName,
      });
    } catch (err: any) {
      console.error("Follow-up generation error:", err);
      res.status(500).json({ message: err.message || "Failed to generate follow-ups" });
    }
  });

  app.post("/api/call-follow-ups/send", async (req, res) => {
    try {
      const {
        contactId, dealId, outcome, callNotes, firefliesRecap, duration,
        emailSubject, emailBody, smsBody,
        sendEmail, sendSms,
        callSummary, nextSteps, sentiment,
        nextFollowUpDate,
        interestedIn0Percent, needsTerminal, sendPacketNow,
      } = req.body;

      if (!contactId || !outcome) return res.status(400).json({ message: "contactId and outcome are required" });

      const contact = await storage.getContact(Number(contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const OUTCOME_TO_STAGE: Record<string, string> = {
        "Connected - Send Review Summary": "Review In Progress",
        "Connected - Needs Proposal": "Proposal Sent",
        "Connected - Not a Fit": "Closed Lost",
        "No Show": "Negotiation / Follow-Up",
        "Not Now (Nurture)": "Nurture / Not Now",
        "Closed Won": "Closed Won",
        "Closed Lost": "Closed Lost",
      };

      const callLog = await storage.createCallLog({
        contactId: Number(contactId),
        dealId: dealId ? Number(dealId) : undefined,
        direction: "outbound",
        duration: duration ? Number(duration) : undefined,
        outcome,
        summary: callNotes || undefined,
        aiSummary: callSummary || undefined,
        nextSteps: nextSteps || undefined,
        sentiment: sentiment || undefined,
        metadata: firefliesRecap ? { firefliesRecap: firefliesRecap.slice(0, 5000) } : undefined,
      });

      await storage.createAuditLog({
        action: "call_logged",
        entityType: "contact",
        entityId: Number(contactId),
        details: { direction: "outbound", outcome, duration: String(duration || 0), hasRecap: !!firefliesRecap },
      });

      if (dealId) {
        const newStage = OUTCOME_TO_STAGE[outcome];
        if (newStage) {
          await storage.updateDeal(Number(dealId), { stage: newStage });
          if (nextFollowUpDate) {
            await storage.updateDeal(Number(dealId), { nextFollowUp: new Date(nextFollowUpDate) });
          }
        }
      }

      let emailSent = false;
      let smsSent = false;

      if (sendEmail && emailBody && contact.email) {
        try {
          const { sendGhlEmail } = await import("./services/ghl");
          const result = await sendGhlEmail({
            contactId: Number(contactId),
            subject: emailSubject || "Following up on our call",
            body: emailBody,
          });
          emailSent = result?.success === true;
        } catch (emailErr: any) {
          console.log("[Call Follow-Up] GHL email not configured, logging locally:", emailErr.message);
        }
        if (!emailSent) {
          await storage.createEmailLog({
            contactId: Number(contactId),
            dealId: dealId ? Number(dealId) : undefined,
            direction: "outbound",
            subject: emailSubject || "Following up on our call",
            body: emailBody,
            status: "pending",
          });
          emailSent = true;
        }
      }

      if (sendSms && smsBody && contact.phone && contact.consentSms) {
        try {
          const { sendGhlSms } = await import("./services/ghl");
          const result = await sendGhlSms({
            contactId: Number(contactId),
            body: smsBody,
          });
          smsSent = result?.success === true;
        } catch (smsErr: any) {
          console.log("[Call Follow-Up] GHL SMS not configured:", smsErr.message);
          smsSent = false;
        }
      }

      if (nextFollowUpDate) {
        await storage.createTask({
          contactId: Number(contactId),
          dealId: dealId ? Number(dealId) : undefined,
          title: `Follow up: ${outcome} - ${contact.firstName} ${contact.lastName || ""}`.trim(),
          description: nextSteps || `Follow up after call. Outcome: ${outcome}`,
          dueDate: new Date(nextFollowUpDate),
          priority: "normal",
        });
      }

      const OUTCOME_TO_SEQUENCE: Record<string, string> = {
        "Connected - Send Review Summary": "Post-Call Review Follow-Up",
        "Connected - Needs Proposal": "Proposal Follow-Up",
        "No Show": "No-Show Reschedule",
        "Not Now (Nurture)": "Long-Term Nurture",
      };

      let sequenceEnrolled: string | null = null;
      if (sendEmail || sendSms) {
        const sequenceName = OUTCOME_TO_SEQUENCE[outcome];
        if (sequenceName) {
          const allSequences = await storage.getFollowUpSequences();
          const matchedSeq = allSequences.find((s) => s.name === sequenceName);
          if (matchedSeq) {
            await storage.createSequenceEnrollment({
              sequenceId: matchedSeq.id,
              contactId: Number(contactId),
              currentStep: 0,
              status: "active",
            });
            sequenceEnrolled = sequenceName;
          }
        }
      }

      const isPositive = ["Connected - Send Review Summary", "Connected - Needs Proposal", "Closed Won"].includes(outcome);
      if (isPositive) {
        await storage.createNotification({
          channel: "#sales",
          title: "Positive Call Outcome",
          message: `${contact.firstName} ${contact.lastName || ""} (${contact.companyName || "N/A"}) — ${outcome}. ${nextSteps || ""}`.trim(),
          type: "info",
          metadata: { contactId: Number(contactId), dealId: dealId ? Number(dealId) : undefined, callLogId: callLog.id },
        });
      }

      res.json({
        success: true,
        callLogId: callLog.id,
        emailSent,
        smsSent,
        stageUpdated: !!dealId && !!OUTCOME_TO_STAGE[outcome],
        newStage: dealId ? (OUTCOME_TO_STAGE[outcome] || null) : null,
        sequenceEnrolled,
      });
    } catch (err: any) {
      console.error("Call follow-up send error:", err);
      res.status(500).json({ message: err.message || "Failed to process call follow-up" });
    }
  });

  // === STAGE AUTOMATION RULES ===
  app.get("/api/stage-rules", async (req, res) => {
    const pipeline = req.query.pipeline as string | undefined;
    const rules = await storage.getStageAutomationRules(pipeline);
    res.json(rules);
  });

  app.get("/api/stage-rules/:id", async (req, res) => {
    const rule = await storage.getStageAutomationRule(Number(req.params.id));
    if (!rule) return res.status(404).json({ message: "Not found" });
    res.json(rule);
  });

  app.post("/api/stage-rules", async (req, res) => {
    try {
      const input = insertStageAutomationRuleSchema.parse(req.body);
      const rule = await storage.createStageAutomationRule(input);
      await storage.createAuditLog({ action: "stage_rule_created", entityType: "stage_rule", entityId: rule.id, details: { name: rule.name, pipeline: rule.pipeline } });
      res.status(201).json(rule);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/stage-rules/:id", async (req, res) => {
    const updated = await storage.updateStageAutomationRule(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/stage-rules/:id", async (req, res) => {
    await storage.deleteStageAutomationRule(Number(req.params.id));
    res.json({ success: true });
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

  // === UNIFIED ACTIVITY FEED ===
  app.get("/api/contacts/:contactId/activity", async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const [emails, calls, contactNotes, auditLogsList, ghlLogs] = await Promise.all([
        storage.getEmailLogs(contactId),
        storage.getCallLogs(contactId),
        storage.getNotes("contact", contactId),
        storage.getAuditLogs(),
        storage.getGhlActivityLogs(contactId),
      ]);

      const filteredAudit = auditLogsList.filter(a => (a.entityType === "contact" && a.entityId === contactId) || (a.entityType === "deal" && a.details && (a.details as any).contactId === contactId));

      const activities = [
        ...emails.map(e => ({ id: `email-${e.id}`, type: "email" as const, data: e, createdAt: e.createdAt })),
        ...calls.map(c => ({ id: `call-${c.id}`, type: "call" as const, data: c, createdAt: c.createdAt })),
        ...contactNotes.map(n => ({ id: `note-${n.id}`, type: "note" as const, data: n, createdAt: n.createdAt })),
        ...filteredAudit.map(a => ({ id: `audit-${a.id}`, type: "audit" as const, data: a, createdAt: a.createdAt })),
        ...ghlLogs.map(g => ({ id: `ghl-${g.id}`, type: "ghl" as const, data: g, createdAt: g.createdAt })),
      ].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());

      res.json(activities);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ENHANCED DEAL STAGE CHANGE WITH AUTOMATION ===
  // (Stage automation is now handled in the existing PUT /api/deals/:id route enhancement)

  // === SUNBIZ LEAD GEN CLEANER ===
  app.get("/api/sunbiz/entities", isAuthenticated, async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const entities = await storage.getSunbizEntities(listId);
    res.json(entities);
  });

  app.get("/api/sunbiz/entities/:id", isAuthenticated, async (req, res) => {
    const entity = await storage.getSunbizEntity(Number(req.params.id));
    if (!entity) return res.status(404).json({ message: "Entity not found" });
    res.json(entity);
  });

  app.get("/api/sunbiz/stats", isAuthenticated, async (req, res) => {
    const listId = req.query.listId ? Number(req.query.listId) : undefined;
    const stats = await storage.getSunbizStats(listId);
    res.json(stats);
  });

  app.post("/api/sunbiz/search", isAuthenticated, async (req, res) => {
    try {
      const { query, entityType } = req.body;
      if (!query) return res.status(400).json({ message: "Search query required" });
      const results = await searchSunbiz(query, entityType);
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/import-detail", isAuthenticated, async (req, res) => {
    try {
      const { detailUrl, listId } = req.body;
      if (!detailUrl) return res.status(400).json({ message: "Detail URL required" });
      const detail = await getEntityDetail(detailUrl);
      if (!detail) return res.status(404).json({ message: "Could not fetch entity detail" });

      const existing = detail.filingNumber ? await storage.getSunbizEntityByFiling(detail.filingNumber) : null;
      if (existing) return res.json(existing);

      const entity = await storage.createSunbizEntity({
        entityName: detail.entityName,
        filingNumber: detail.filingNumber || undefined,
        feiEinNumber: detail.feiEinNumber || undefined,
        entityType: detail.entityType || undefined,
        entityStatus: detail.entityStatus || undefined,
        filingDate: detail.filingDate || undefined,
        lastEvent: detail.lastEvent || undefined,
        lastEventDate: detail.lastEventDate || undefined,
        principalAddress: detail.principalAddress || undefined,
        principalCity: detail.principalCity || undefined,
        principalState: detail.principalState || "FL",
        principalZip: detail.principalZip || undefined,
        mailingAddress: detail.mailingAddress || undefined,
        registeredAgentName: detail.registeredAgentName || undefined,
        registeredAgentAddress: detail.registeredAgentAddress || undefined,
        officers: detail.officers.length > 0 ? detail.officers : undefined,
        detailUrl: detail.detailUrl || undefined,
        listId: listId || undefined,
        source: "sunbiz",
        enrichmentStatus: "pending",
      });

      res.json(entity);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const content = req.file.buffer.toString("utf-8");
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });

      const listName = req.body.listName || `Sunbiz Import ${new Date().toLocaleDateString()}`;
      const list = await storage.createProspectList({
        name: listName,
        description: `Sunbiz directory upload: ${req.file.originalname}`,
        fileName: req.file.originalname,
        totalRecords: records.length,
        status: "processing",
      });

      const parsed = parseSunbizCsv(records as Record<string, string>[]);
      const entities = parsed.map(p => ({
        entityName: p.entityName || "",
        filingNumber: p.filingNumber || undefined,
        feiEinNumber: p.feiEinNumber || undefined,
        entityType: p.entityType || undefined,
        entityStatus: p.entityStatus || "Active",
        filingDate: p.filingDate || undefined,
        principalAddress: p.principalAddress || undefined,
        principalCity: p.principalCity || undefined,
        principalState: p.principalState || "FL",
        principalZip: p.principalZip || undefined,
        mailingAddress: p.mailingAddress || undefined,
        registeredAgentName: p.registeredAgentName || undefined,
        registeredAgentAddress: p.registeredAgentAddress || undefined,
        officers: p.officers || undefined,
        dba: p.dba || undefined,
        website: p.website || undefined,
        email: p.email || undefined,
        phone: p.phone || undefined,
        detailUrl: p.detailUrl || undefined,
        listId: list.id,
        source: "sunbiz",
        enrichmentStatus: "pending" as const,
        searchQuery: listName,
      }));

      const created = await storage.createSunbizEntitiesBulk(entities);

      await storage.updateProspectList(list.id, {
        totalRecords: created.length,
        status: "ready",
      });

      res.json({ list, imported: created.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/upload-corevt", isAuthenticated, uploadLarge.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path;
      const listName = req.body.listName || `Sunbiz Corevt Import ${new Date().toLocaleDateString()}`;
      const maxRecords = parseInt(req.body.maxRecords) || 10000;
      const onlyWithAddress = req.body.onlyWithAddress === "true";

      const list = await storage.createProspectList({
        name: listName,
        description: `Sunbiz corevt fixed-width upload: ${req.file.originalname}`,
        fileName: req.file.originalname || "corevt.zip",
        totalRecords: 0,
        status: "processing",
      });

      let totalImported = 0;

      try {
        for await (const batch of streamCorevtFromZip(filePath, { maxRecords })) {
          const filtered = onlyWithAddress
            ? batch.filter(e => e.principalAddress || e.principalCity)
            : batch;

          if (filtered.length === 0) continue;

          const entities = filtered.map(p => ({
            entityName: p.entityName || "",
            filingNumber: p.filingNumber || undefined,
            feiEinNumber: p.feiEinNumber || undefined,
            entityType: p.entityType || undefined,
            entityStatus: p.entityStatus || "Active",
            filingDate: p.filingDate || undefined,
            principalAddress: p.principalAddress || undefined,
            principalCity: p.principalCity || undefined,
            principalState: p.principalState || "FL",
            principalZip: p.principalZip || undefined,
            mailingAddress: p.mailingAddress || undefined,
            registeredAgentName: p.registeredAgentName || undefined,
            registeredAgentAddress: p.registeredAgentAddress || undefined,
            officers: p.officers && p.officers.length > 0 ? p.officers : undefined,
            dba: p.dba || undefined,
            website: p.website || undefined,
            email: p.email || undefined,
            phone: p.phone || undefined,
            detailUrl: p.detailUrl || undefined,
            listId: list.id,
            source: "corevt",
            enrichmentStatus: "pending" as const,
            searchQuery: listName,
          }));

          const created = await storage.createSunbizEntitiesBulk(entities);
          totalImported += created.length;
        }
      } finally {
        try { fs.unlinkSync(filePath); } catch {}
      }

      await storage.updateProspectList(list.id, {
        totalRecords: totalImported,
        status: "ready",
      });

      res.json({ list: { ...list, totalRecords: totalImported }, imported: totalImported });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/entities/:id/enrich", isAuthenticated, async (req, res) => {
    try {
      const result = await enrichSunbizEntity(Number(req.params.id));
      if (!result) return res.status(404).json({ message: "Entity not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/enrich-batch", isAuthenticated, async (req, res) => {
    try {
      const limit = req.body.limit || 10;
      const processed = await processSunbizEnrichmentQueue(limit);
      res.json({ processed });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/entities/:id/convert", isAuthenticated, async (req, res) => {
    try {
      const prospectId = await convertToProspect(Number(req.params.id), req.body.listId);
      if (!prospectId) return res.status(404).json({ message: "Entity not found" });
      res.json({ prospectId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sunbiz/convert-batch", isAuthenticated, async (req, res) => {
    try {
      const { entityIds, listId } = req.body;
      if (!entityIds || !Array.isArray(entityIds)) return res.status(400).json({ message: "entityIds array required" });
      const results: number[] = [];
      for (const id of entityIds) {
        const prospectId = await convertToProspect(id, listId);
        if (prospectId) results.push(prospectId);
      }
      res.json({ converted: results.length, prospectIds: results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sunbiz/entities/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateSunbizEntity(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Entity not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sunbiz/export", isAuthenticated, async (req, res) => {
    try {
      const listId = req.query.listId ? Number(req.query.listId) : undefined;
      const entities = await storage.getSunbizEntities(listId);
      const enrichedOnly = req.query.enrichedOnly === "true";
      const filtered = enrichedOnly ? entities.filter(e => e.enrichmentStatus === "enriched") : entities;

      const headers = ["Entity Name", "DBA", "Filing Number", "Entity Type", "Status", "Filing Date", "Principal Address", "City", "State", "Zip", "Owner Name", "Owner Email", "Owner Phone", "Website", "Email", "Phone", "Vertical", "Score", "AI Summary", "Officers"];
      const csvRows = [headers.join(",")];
      for (const e of filtered) {
        const officers = (e.officers as any[]) || [];
        const officerStr = officers.map((o: any) => `${o.title}: ${o.name}`).join("; ");
        csvRows.push([
          `"${(e.entityName || "").replace(/"/g, '""')}"`,
          `"${(e.dba || "").replace(/"/g, '""')}"`,
          e.filingNumber || "",
          e.entityType || "",
          e.entityStatus || "",
          e.filingDate || "",
          `"${(e.principalAddress || "").replace(/"/g, '""')}"`,
          e.principalCity || "",
          e.principalState || "",
          e.principalZip || "",
          `"${(e.ownerName || "").replace(/"/g, '""')}"`,
          e.ownerEmail || "",
          e.ownerPhone || "",
          e.website || "",
          e.email || "",
          e.phone || "",
          e.vertical || "",
          e.score || "",
          `"${(e.aiSummary || "").replace(/"/g, '""')}"`,
          `"${officerStr.replace(/"/g, '""')}"`,
        ].join(","));
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="sunbiz-leads-${Date.now()}.csv"`);
      res.send(csvRows.join("\n"));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === LEAD INTELLIGENCE ENGINE ===
  app.post("/api/lead-intelligence/score/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const breakdown = await scoreContact(contactId);
      if (!breakdown) return res.status(404).json({ message: "Contact not found" });
      res.json(breakdown);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/score/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contact = await storage.getContact(Number(req.params.contactId));
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      res.json({
        leadScore: contact.leadScore || 0,
        revPotentialScore: contact.revPotentialScore || 0,
        switchabilityScore: contact.switchabilityScore || 0,
        uwConfidenceScore: contact.uwConfidenceScore || 0,
        engagementScore: contact.engagementScore || 0,
        scoreBreakdown: contact.scoreBreakdown || null,
        lastScoredAt: contact.lastScoredAt,
        tier: (contact.leadScore || 0) >= 70 ? "hot" : (contact.leadScore || 0) >= 45 ? "warm" : (contact.leadScore || 0) >= 20 ? "cold" : "unqualified",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/blueprint/:dealId", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      const blueprint = await generateDealBlueprint(dealId);
      if (!blueprint) return res.status(404).json({ message: "Deal not found or blueprint generation failed" });
      res.json(blueprint);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/blueprint/:dealId", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      res.json({
        dealBlueprint: deal.dealBlueprint,
        recommendedProgram: deal.recommendedProgram,
        hardwarePackage: deal.hardwarePackage,
        estMonthlyRevenue: deal.estMonthlyRevenue,
        underwritingPath: deal.underwritingPath,
        competitivePositioning: deal.competitivePositioning,
        repBriefing: deal.repBriefing,
        repOpener: deal.repOpener,
        likelyObjections: deal.likelyObjections,
        blueprintGeneratedAt: deal.blueprintGeneratedAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/route/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const result = await routeContact(contactId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/routing/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const recommendation = await getRoutingRecommendation(contactId);
      res.json(recommendation);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/doc-readiness/:dealId", isAuthenticated, async (req, res) => {
    try {
      const deal = await storage.getDeal(Number(req.params.dealId));
      if (!deal) return res.status(404).json({ message: "Deal not found" });

      const docs = {
        statementReceived: deal.statementReceived || false,
        voidedCheckReceived: deal.voidedCheckReceived || false,
        idReceived: deal.idReceived || false,
        appCompleted: deal.appCompleted || false,
      };
      const completed = Object.values(docs).filter(Boolean).length;
      const total = 4;

      let stage = "Lead";
      if (completed >= 4) stage = "Submit to Processor";
      else if (completed >= 3) stage = "Underwriting Ready";
      else if (completed >= 2) stage = "Proposal Stage";
      else if (completed >= 1) stage = "Qualified";

      const missing: string[] = [];
      if (!docs.statementReceived) missing.push("Processing Statement");
      if (!docs.appCompleted) missing.push("Merchant Application");
      if (!docs.voidedCheckReceived) missing.push("Voided Check");
      if (!docs.idReceived) missing.push("Owner ID");

      res.json({
        ...docs,
        docReadinessScore: completed,
        docReadinessMax: total,
        docReadinessPercent: Math.round((completed / total) * 100),
        readinessStage: stage,
        missing,
        lastNudgeAt: deal.lastNudgeAt,
        nextNudgeAt: deal.nextNudgeAt,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/lead-intelligence/full/:contactId", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Contact not found" });

      const contactDeals = await storage.getDealsByContact(contactId);
      const primaryDeal = contactDeals[0] || null;

      const scoring = {
        leadScore: contact.leadScore || 0,
        revPotentialScore: contact.revPotentialScore || 0,
        switchabilityScore: contact.switchabilityScore || 0,
        uwConfidenceScore: contact.uwConfidenceScore || 0,
        engagementScore: contact.engagementScore || 0,
        scoreBreakdown: typeof contact.scoreBreakdown === 'object' && contact.scoreBreakdown
          ? (contact.scoreBreakdown as any).summary || JSON.stringify(contact.scoreBreakdown)
          : contact.scoreBreakdown || "",
        lastScoredAt: contact.lastScoredAt,
        tier: (contact.leadScore || 0) >= 70 ? "hot" : (contact.leadScore || 0) >= 45 ? "warm" : (contact.leadScore || 0) >= 20 ? "cold" : "unqualified",
      };

      let blueprint = null;
      let docReadiness = null;

      if (primaryDeal) {
        blueprint = {
          dealId: primaryDeal.id,
          recommendedProgram: primaryDeal.recommendedProgram,
          hardwarePackage: primaryDeal.hardwarePackage,
          estMonthlyRevenue: primaryDeal.estMonthlyRevenue,
          underwritingPath: primaryDeal.underwritingPath,
          competitivePositioning: primaryDeal.competitivePositioning,
          repBriefing: primaryDeal.repBriefing,
          repOpener: primaryDeal.repOpener,
          likelyObjections: primaryDeal.likelyObjections,
          blueprintGeneratedAt: primaryDeal.blueprintGeneratedAt,
        };

        const docs = {
          statementReceived: primaryDeal.statementReceived || false,
          voidedCheckReceived: primaryDeal.voidedCheckReceived || false,
          idReceived: primaryDeal.idReceived || false,
          appCompleted: primaryDeal.appCompleted || false,
        };
        const completed = Object.values(docs).filter(Boolean).length;
        const missing: string[] = [];
        if (!docs.statementReceived) missing.push("Processing Statement");
        if (!docs.appCompleted) missing.push("Merchant Application");
        if (!docs.voidedCheckReceived) missing.push("Voided Check");
        if (!docs.idReceived) missing.push("Owner ID");

        docReadiness = {
          ...docs,
          score: completed,
          max: 4,
          percent: Math.round((completed / 4) * 100),
          missing,
        };
      }

      const routingRec = await getRoutingRecommendation(contactId);

      const complianceStatus = {
        doNotContact: contact.doNotContact || false,
        consentSms: contact.consentSms || false,
        consentEmail: contact.consentEmail || false,
        smsOptInAt: contact.smsOptInAt,
        coolingUntil: contact.coolingUntil,
        contactAttempts: contact.contactAttempts || 0,
        dncReason: contact.dncReason,
      };

      res.json({
        contact: {
          id: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          company: contact.companyName,
          vertical: contact.vertical,
          monthlyVolume: contact.monthlyVolume,
          currentProvider: contact.currentProvider,
          painPoints: contact.painPoints,
          contractStatus: contact.contractStatus,
          lookingReason: contact.lookingReason,
          referralSource: contact.referralSource,
        },
        scoring,
        blueprint,
        docReadiness,
        routing: routingRec,
        compliance: complianceStatus,
        deal: primaryDeal ? {
          id: primaryDeal.id,
          stage: primaryDeal.stage,
          pipeline: primaryDeal.pipeline,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/lead-intelligence/score-batch", isAuthenticated, async (req, res) => {
    try {
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds)) return res.status(400).json({ message: "contactIds array required" });
      let scored = 0;
      for (const id of contactIds.slice(0, 50)) {
        try {
          await scoreContact(id);
          scored++;
        } catch (e) {}
      }
      res.json({ scored, total: contactIds.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === MERCHANT APPLICATIONS ===
  app.post("/api/merchant-applications", async (req, res) => {
    try {
      const input = insertMerchantApplicationSchema.parse(req.body);
      const application = await storage.createMerchantApplication(input);
      res.status(201).json(application);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/user/:userId", async (req, res) => {
    try {
      const application = await storage.getMerchantApplicationByUser(req.params.userId);
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/:id", async (req, res) => {
    try {
      const application = await storage.getMerchantApplication(Number(req.params.id));
      if (!application) return res.status(404).json({ message: "Not found" });
      res.json(application);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/merchant-applications/:id", async (req, res) => {
    try {
      const updated = await storage.updateMerchantApplication(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/merchant-applications/:id/send-esign", isAuthenticated, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });

      const templateId = process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID;
      if (!templateId) {
        return res.status(400).json({
          message: "GHL document template not configured. Set GHL_MERCHANT_AGREEMENT_TEMPLATE_ID.",
          requiresConfig: true,
        });
      }

      const recipientName = `${application.ownerFirstName || ""} ${application.ownerLastName || ""}`.trim() || application.legalBusinessName || "Merchant";
      const recipientEmail = application.ownerEmail || application.businessEmail || "";
      if (!recipientEmail) {
        return res.status(400).json({ message: "No email address found on application" });
      }

      const result = await sendDocumentForEsign({
        documentTemplateId: templateId,
        recipientName,
        recipientEmail,
        applicationId: appId,
      });

      if (!result.success) {
        return res.status(500).json({ message: result.error || "Failed to send document for e-signature" });
      }

      await storage.updateMerchantApplication(appId, {
        esignStatus: "sent",
        esignDocumentId: result.documentId || null,
        esignSigningUrl: result.signingUrl || null,
      });

      res.json({
        success: true,
        message: "E-signature document sent via GoHighLevel",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-applications/request-esign", async (req, res) => {
    try {
      const { applicationId, email } = req.body;
      if (!applicationId || !email) {
        return res.status(400).json({ message: "Application ID and email are required" });
      }
      const application = await storage.getMerchantApplication(Number(applicationId));
      if (!application) return res.status(404).json({ message: "Application not found" });

      if (application.businessEmail !== email && application.ownerEmail !== email) {
        return res.status(403).json({ message: "Email does not match application" });
      }

      if (application.esignStatus === "sent" && application.esignDocumentId) {
        return res.json({ status: "sent", message: "E-signature document already sent to your email" });
      }

      const templateId = process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID;
      if (!templateId) {
        return res.json({ status: "pending", message: "Your agreement will be sent for signature shortly" });
      }

      const recipientName = `${application.ownerFirstName || ""} ${application.ownerLastName || ""}`.trim() || application.legalBusinessName || "Merchant";
      const recipientEmail = application.ownerEmail || application.businessEmail || "";

      const result = await sendDocumentForEsign({
        documentTemplateId: templateId,
        recipientName,
        recipientEmail,
        applicationId: Number(applicationId),
      });

      if (result.success) {
        await storage.updateMerchantApplication(Number(applicationId), {
          esignStatus: "sent",
          esignDocumentId: result.documentId || null,
          esignSigningUrl: result.signingUrl || null,
        });
        return res.json({ status: "sent", message: "E-signature document sent to your email" });
      }

      res.json({ status: "pending", message: "Your agreement will be sent for signature shortly" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-applications/:id/esign-status", isAuthenticated, async (req, res) => {
    try {
      const appId = Number(req.params.id);
      const application = await storage.getMerchantApplication(appId);
      if (!application) return res.status(404).json({ message: "Application not found" });

      if (!application.esignDocumentId) {
        return res.json({ status: application.esignStatus || "pending" });
      }

      const docStatus = await getDocumentStatus(application.esignDocumentId);

      if (docStatus.status === "completed" || docStatus.status === "signed") {
        await storage.updateMerchantApplication(appId, {
          esignStatus: "signed",
          esignedAt: new Date(),
        });
      }

      res.json({
        status: docStatus.status === "completed" || docStatus.status === "signed" ? "signed" : application.esignStatus,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/webhooks/ghl-document", async (req, res) => {
    try {
      const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
      if (webhookSecret) {
        const signature = req.headers["x-ghl-signature"] || req.headers["x-webhook-signature"];
        if (!signature || signature !== webhookSecret) {
          console.warn("[GHL Document Webhook] Invalid signature, rejecting");
          return res.status(401).json({ received: false });
        }
      }

      const { documentId, status, contactId } = req.body;
      console.log("[GHL Document Webhook] Received:", { documentId, status, contactId });

      if (documentId && (status === "completed" || status === "signed")) {
        const applications = await storage.getMerchantApplications();
        const app = applications.find((a: any) => a.esignDocumentId === documentId);
        if (app) {
          await storage.updateMerchantApplication(app.id, {
            esignStatus: "signed",
            esignedAt: new Date(),
          });
          console.log(`[GHL Document Webhook] Application #${app.id} e-sign completed`);
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("[GHL Document Webhook] Error:", err.message);
      res.json({ received: true });
    }
  });

  // === MERCHANT PROFILES ===
  app.get("/api/merchant-profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "Not found" });
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/merchant-profiles", isAuthenticated, async (req, res) => {
    try {
      const input = insertMerchantProfileSchema.parse(req.body);
      const profile = await storage.createMerchantProfile(input);
      res.status(201).json(profile);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  // === EQUIPMENT ORDERS ===
  app.get("/api/equipment-orders", isAuthenticated, async (req, res) => {
    try {
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      const orders = dealId ? await storage.getEquipmentOrdersByDeal(dealId) : await storage.getEquipmentOrders();
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/equipment-orders/:id", isAuthenticated, async (req, res) => {
    try {
      const order = await storage.getEquipmentOrder(Number(req.params.id));
      if (!order) return res.status(404).json({ message: "Not found" });
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/equipment-orders", isAuthenticated, async (req, res) => {
    try {
      const input = insertEquipmentOrderSchema.parse(req.body);
      const order = await storage.createEquipmentOrder(input);
      res.status(201).json(order);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/equipment-orders/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateEquipmentOrder(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === ONBOARDING STEPS ===
  app.get("/api/onboarding-steps/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByDeal(Number(req.params.dealId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/onboarding-steps/application/:applicationId", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getOnboardingStepsByApplication(Number(req.params.applicationId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/onboarding-steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertOnboardingStepSchema.parse(req.body);
      const step = await storage.createOnboardingStep(input);
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/onboarding-steps/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateOnboardingStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === AGENTS ===
  app.get("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const agentsList = await storage.getAgents();
      res.json(agentsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const agent = await storage.getAgent(Number(req.params.id));
      if (!agent) return res.status(404).json({ message: "Not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const input = insertAgentSchema.parse(req.body);
      const agent = await storage.createAgent(input);
      res.status(201).json(agent);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/agents/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateAgent(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === AGENT QUOTAS ===
  app.get("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const quotas = await storage.getAgentQuotas();
      res.json(quotas);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agent-quotas", isAuthenticated, async (req, res) => {
    try {
      const input = insertAgentQuotaSchema.parse(req.body);
      const quota = await storage.createAgentQuota(input);
      res.status(201).json(quota);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.put("/api/agent-quotas/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateAgentQuota(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === RESIDUAL REPORTS ===
  app.get("/api/residual-reports", isAuthenticated, async (req, res) => {
    try {
      const reports = await storage.getResidualReports();
      res.json(reports);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/residual-reports", isAuthenticated, async (req, res) => {
    try {
      const input = insertResidualReportSchema.parse(req.body);
      const report = await storage.createResidualReport(input);
      res.status(201).json(report);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/residual-reports/:id", isAuthenticated, async (req, res) => {
    try {
      const report = await storage.getResidualReport(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Not found" });
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/merchant-residuals", isAuthenticated, async (req, res) => {
    try {
      const month = req.query.month as string | undefined;
      const dealId = req.query.dealId ? Number(req.query.dealId) : undefined;
      if (dealId) {
        const residuals = await storage.getMerchantResidualsByDeal(dealId);
        res.json(residuals);
      } else if (month) {
        const residuals = await storage.getMerchantResidualsByMonth(month);
        res.json(residuals);
      } else {
        const residuals = await storage.getMerchantResiduals();
        res.json(residuals);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === HEALTH ALERTS ===
  app.get("/api/health-alerts", isAuthenticated, async (req, res) => {
    try {
      const alerts = await storage.getActiveHealthAlerts();
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/health-alerts/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const alerts = await storage.getHealthAlertsByDeal(Number(req.params.dealId));
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/health-alerts", isAuthenticated, async (req, res) => {
    try {
      const input = insertHealthAlertSchema.parse(req.body);
      const alert = await storage.createHealthAlert(input);
      res.status(201).json(alert);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/health-alerts/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateHealthAlert(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === DEAL COMPETITORS ===
  app.get("/api/deal-competitors", isAuthenticated, async (req, res) => {
    try {
      const competitors = await storage.getDealCompetitors();
      res.json(competitors);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/deal-competitors/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const competitors = await storage.getDealCompetitorsByDeal(Number(req.params.dealId));
      res.json(competitors);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deal-competitors", isAuthenticated, async (req, res) => {
    try {
      const input = insertDealCompetitorSchema.parse(req.body);
      const competitor = await storage.createDealCompetitor(input);
      res.status(201).json(competitor);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/deal-competitors/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateDealCompetitor(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === PARTNERS ===
  app.get("/api/partners", isAuthenticated, async (req, res) => {
    try {
      const partnersList = await storage.getPartners();
      res.json(partnersList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/partners/:id", isAuthenticated, async (req, res) => {
    try {
      const partner = await storage.getPartner(Number(req.params.id));
      if (!partner) return res.status(404).json({ message: "Not found" });
      res.json(partner);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/partners", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const input = insertPartnerSchema.parse(req.body);
      const partner = await storage.createPartner(input);
      res.status(201).json(partner);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/partners/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    try {
      const { status, commissionPercent, notes } = req.body;
      const updates: any = {};
      if (status && ["active", "pending", "suspended", "inactive"].includes(status)) updates.status = status;
      if (commissionPercent !== undefined) updates.commissionPercent = Math.min(Math.max(0, Number(commissionPercent) || 0), 100);
      if (notes !== undefined) updates.notes = String(notes).slice(0, 2000);
      const updated = await storage.updatePartner(Number(req.params.id), updates);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === REFERRALS ===
  app.get("/api/referrals", isAuthenticated, async (req, res) => {
    try {
      const partnerId = req.query.partnerId ? Number(req.query.partnerId) : undefined;
      const referralsList = partnerId ? await storage.getReferralsByPartner(partnerId) : await storage.getReferrals();
      res.json(referralsList);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/referrals", isAuthenticated, async (req, res) => {
    try {
      const input = insertReferralSchema.parse(req.body);
      const referral = await storage.createReferral(input);
      res.status(201).json(referral);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/referrals/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReferral(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === KNOWLEDGE BASE ===
  app.get("/api/knowledge-base", async (req, res) => {
    try {
      const articles = await storage.getPublishedArticles();
      res.json(articles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/knowledge-base/category/:category", async (req, res) => {
    try {
      const articles = await storage.getKnowledgeBaseByCategory(req.params.category);
      res.json(articles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/knowledge-base/:id", async (req, res) => {
    try {
      const article = await storage.getKnowledgeBaseArticle(Number(req.params.id));
      if (!article) return res.status(404).json({ message: "Not found" });
      res.json(article);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/knowledge-base", isAuthenticated, async (req, res) => {
    try {
      const input = insertKnowledgeBaseSchema.parse(req.body);
      const article = await storage.createKnowledgeBaseArticle(input);
      res.status(201).json(article);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/knowledge-base/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateKnowledgeBaseArticle(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === REVIEW REQUESTS ===
  app.get("/api/review-requests", isAuthenticated, async (req, res) => {
    try {
      const requests = await storage.getReviewRequests();
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/review-requests/deal/:dealId", isAuthenticated, async (req, res) => {
    try {
      const requests = await storage.getReviewRequestsByDeal(Number(req.params.dealId));
      res.json(requests);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/review-requests", isAuthenticated, async (req, res) => {
    try {
      const input = insertReviewRequestSchema.parse(req.body);
      const request = await storage.createReviewRequest(input);
      res.status(201).json(request);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/review-requests/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateReviewRequest(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // === CONSENT AUDIT LOGS ===
  app.get("/api/consent-audit", isAuthenticated, async (req, res) => {
    const logs = await storage.getConsentAuditLogs();
    res.json(logs);
  });

  app.get("/api/consent-audit/contact/:contactId", isAuthenticated, async (req, res) => {
    const logs = await storage.getConsentAuditLogsByContact(Number(req.params.contactId));
    res.json(logs);
  });

  app.post("/api/consent-audit", async (req, res) => {
    try {
      const input = insertConsentAuditLogSchema.parse(req.body);
      const log = await storage.createConsentAuditLog(input);
      res.status(201).json(log);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === CONTACT ACTIVITY TIMELINE ===
  app.get("/api/contacts/:id/activity", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const events: any[] = [];

      const auditEntries = await storage.getAuditLogs();
      const contactAudit = auditEntries.filter(a =>
        (a.entityType === "contact" && a.entityId === contactId) ||
        (a.details as any)?.contactId === contactId
      );
      contactAudit.forEach(a => {
        events.push({
          id: `audit_${a.id}`,
          type: "audit",
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId || 0,
          details: a.details || {},
          createdAt: a.createdAt,
        });
      });

      const contactNotes = await storage.getNotes("contact", contactId);
      contactNotes.forEach(n => {
        events.push({
          id: `note_${n.id}`,
          type: "note",
          action: "note_added",
          entityType: "note",
          entityId: n.id,
          details: { content: (n.content || "").substring(0, 200), author: n.authorId || "" },
          createdAt: n.createdAt,
        });
      });

      const contactEmails = await storage.getEmailLogs(contactId);
      contactEmails.forEach(e => {
        events.push({
          id: `email_${e.id}`,
          type: "ghl",
          action: "email",
          entityType: "email",
          entityId: e.id,
          details: { subject: e.subject, direction: e.direction, status: e.status },
          createdAt: e.createdAt,
        });
      });

      const contactCalls = await storage.getCallLogs(contactId);
      contactCalls.forEach(c => {
        events.push({
          id: `call_${c.id}`,
          type: "call",
          action: "call_logged",
          entityType: "call",
          entityId: c.id,
          details: { outcome: c.outcome, duration: c.duration, notes: (c as any).notes },
          createdAt: c.createdAt,
        });
      });

      events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === CALENDAR EVENTS ===
  app.get("/api/calendar-events", isAuthenticated, async (req, res) => {
    try {
      const { start, end } = req.query;
      if (start && end) {
        const events = await storage.getCalendarEventsByDateRange(new Date(start as string), new Date(end as string));
        res.json(events);
      } else {
        const events = await storage.getCalendarEvents();
        res.json(events);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/calendar-events", isAuthenticated, async (req, res) => {
    try {
      const input = insertCalendarEventSchema.parse(req.body);
      const event = await storage.createCalendarEvent(input);
      res.status(201).json(event);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/calendar-events/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCalendarEvent(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/calendar-events/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCalendarEvent(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === FORECASTING ===
  app.get("/api/forecasting/summary", isAuthenticated, async (req, res) => {
    try {
      const deals = await storage.getDeals();
      const activeDeals = deals.filter(d => d.pipeline === "sales" && d.stage !== "Closed Lost");

      const stageWeights: Record<string, number> = {
        "New Lead": 0.1, "Contacted": 0.2, "Statement Collected": 0.4,
        "Proposal": 0.6, "Negotiation": 0.75, "Closed Won": 1.0, "Closed Lost": 0
      };

      let totalPipeline = 0;
      let weightedForecast = 0;
      const stageBreakdown: Record<string, { count: number; volume: number; profit: number; weight: number }> = {};

      activeDeals.forEach(d => {
        const profit = parseFloat(d.estimatedGrossProfitMonthly || "0");
        const volume = parseFloat(d.totalVolume || "0");
        const weight = stageWeights[d.stage] || 0.1;

        totalPipeline += profit;
        weightedForecast += profit * weight;

        if (!stageBreakdown[d.stage]) {
          stageBreakdown[d.stage] = { count: 0, volume: 0, profit: 0, weight: weight * 100 };
        }
        stageBreakdown[d.stage].count++;
        stageBreakdown[d.stage].volume += volume;
        stageBreakdown[d.stage].profit += profit;
      });

      const now = new Date();
      const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);

      const thisMonth = activeDeals.filter(d => d.nextFollowUp && new Date(d.nextFollowUp) <= thisMonthEnd)
        .reduce((sum, d) => sum + parseFloat(d.estimatedGrossProfitMonthly || "0") * (stageWeights[d.stage] || 0.1), 0);
      const nextMonth = activeDeals.filter(d => d.nextFollowUp && new Date(d.nextFollowUp) > thisMonthEnd && new Date(d.nextFollowUp) <= nextMonthEnd)
        .reduce((sum, d) => sum + parseFloat(d.estimatedGrossProfitMonthly || "0") * (stageWeights[d.stage] || 0.1), 0);

      res.json({ totalPipeline, weightedForecast, thisMonthForecast: thisMonth, nextMonthForecast: nextMonth, stageBreakdown });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === ADMIN: USER MANAGEMENT ===
  app.get("/api/admin/users", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      authProvider: users.authProvider,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    }).from(users).orderBy(desc(users.createdAt));
    res.json(allUsers);
  });

  app.put("/api/admin/users/:id/role", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const { role } = req.body;
    if (!['admin', 'manager', 'agent', 'merchant'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const [updated] = await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
    if (!updated) return res.status(404).json({ message: "User not found" });
    const { passwordHash, ...safeUser } = updated;
    res.json(safeUser);
  });

  // === DATA DELETE REQUESTS ===
  app.post("/api/data-requests", async (req, res) => {
    try {
      const input = insertDataDeleteRequestSchema.parse(req.body);
      const request = await storage.createDataDeleteRequest(input);
      res.status(201).json(request);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.get("/api/data-requests", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const requests = await storage.getDataDeleteRequests();
    res.json(requests);
  });

  app.put("/api/data-requests/:id", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const updated = await storage.updateDataDeleteRequest(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // === COMMENTS (Threaded) ===
  app.get("/api/comments", isAuthenticated, async (req, res) => {
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
    const result = await storage.getComments(String(entityType), Number(entityId));
    res.json(result);
  });

  app.post("/api/comments", isAuthenticated, async (req, res) => {
    try {
      const input = insertCommentSchema.parse(req.body);
      const comment = await storage.createComment({
        ...input,
        authorId: (req.user as any)?.id || null,
        authorName: (req.user as any)?.firstName ? `${(req.user as any).firstName} ${(req.user as any).lastName || ''}`.trim() : (req.user as any)?.email || 'System',
      });
      res.status(201).json(comment);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/comments/:id", isAuthenticated, async (req, res) => {
    await storage.deleteComment(Number(req.params.id));
    res.json({ success: true });
  });

  app.put("/api/comments/:id", isAuthenticated, async (req, res) => {
    const updated = await storage.updateComment(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  // === TICKET COMMENTS (Conversation Threading) ===
  app.get("/api/tickets/:id/comments", isAuthenticated, async (req, res) => {
    const result = await storage.getTicketComments(Number(req.params.id));
    res.json(result);
  });

  app.post("/api/tickets/:id/comments", isAuthenticated, async (req, res) => {
    try {
      const input = insertTicketCommentSchema.parse({
        ...req.body,
        ticketId: Number(req.params.id),
      });
      const comment = await storage.createTicketComment({
        ...input,
        authorId: (req.user as any)?.id || null,
        authorName: (req.user as any)?.firstName ? `${(req.user as any).firstName} ${(req.user as any).lastName || ''}`.trim() : (req.user as any)?.email || 'System',
      });
      res.status(201).json(comment);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  // === CONTACT-COMPANY ASSOCIATIONS ===
  app.get("/api/contacts/:id/companies", isAuthenticated, async (req, res) => {
    const result = await storage.getContactCompanies(Number(req.params.id));
    res.json(result);
  });

  app.post("/api/contacts/:id/companies", isAuthenticated, async (req, res) => {
    try {
      const input = insertContactCompanySchema.parse({
        ...req.body,
        contactId: Number(req.params.id),
      });
      const link = await storage.addContactCompany(input);
      res.status(201).json(link);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/contact-companies/:id", isAuthenticated, async (req, res) => {
    await storage.removeContactCompany(Number(req.params.id));
    res.json({ success: true });
  });

  // === PIPELINE STAGES CONFIGURATION ===
  app.get("/api/pipeline-stages", isAuthenticated, async (req, res) => {
    const pipeline = req.query.pipeline ? String(req.query.pipeline) : undefined;
    const stages = await storage.getPipelineStages(pipeline);
    res.json(stages);
  });

  app.post("/api/pipeline-stages", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const input = insertPipelineStageSchema.parse(req.body);
      const stage = await storage.createPipelineStage(input);
      res.status(201).json(stage);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.put("/api/pipeline-stages/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const updated = await storage.updatePipelineStage(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  });

  app.delete("/api/pipeline-stages/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    await storage.deletePipelineStage(Number(req.params.id));
    res.json({ success: true });
  });

  app.post("/api/pipeline-stages/reorder", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const { stages } = req.body;
    if (!Array.isArray(stages)) return res.status(400).json({ message: "stages array required" });
    for (const s of stages) {
      await storage.updatePipelineStage(s.id, { sortOrder: s.sortOrder });
    }
    res.json({ success: true });
  });

  // === NOTIFICATION PREFERENCES ===
  app.get("/api/notification-preferences", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.id;
    const prefs = await storage.getNotificationPreferences(userId);
    res.json(prefs);
  });

  app.put("/api/notification-preferences", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.id;
    const { eventType, enabled } = req.body;
    if (!eventType) return res.status(400).json({ message: "eventType required" });
    const pref = await storage.upsertNotificationPreference({ userId, eventType, enabled: !!enabled });
    res.json(pref);
  });

  // === MARK ALL NOTIFICATIONS READ ===
  app.put("/api/notifications/mark-all-read", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.id;
    await storage.markAllNotificationsRead(userId);
    res.json({ success: true });
  });

  app.delete("/api/notifications/clear-all", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.id;
    await storage.clearAllNotifications(userId);
    res.json({ success: true });
  });

  // === SAVED FILTERS ===
  app.get("/api/saved-filters", isAuthenticated, async (req, res) => {
    const userId = (req.user as any)?.id;
    const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
    const filters = await storage.getSavedFilters(userId, entityType);
    res.json(filters);
  });

  app.post("/api/saved-filters", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const input = insertSavedFilterSchema.parse({ ...req.body, userId });
      const filter = await storage.createSavedFilter(input);
      res.status(201).json(filter);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.delete("/api/saved-filters/:id", isAuthenticated, async (req, res) => {
    await storage.deleteSavedFilter(Number(req.params.id));
    res.json({ success: true });
  });

  // === ARCHIVE / RESTORE ===
  app.post("/api/contacts/:id/archive", isAuthenticated, async (req, res) => {
    const result = await storage.archiveContact(Number(req.params.id));
    if (!result) return res.status(404).json({ message: "Not found" });
    await storage.createAuditLog({ action: "contact_archived", entityType: "contact", entityId: result.id, userId: (req.user as any)?.id });
    res.json(result);
  });

  app.post("/api/contacts/:id/restore", isAuthenticated, async (req, res) => {
    const result = await storage.restoreContact(Number(req.params.id));
    if (!result) return res.status(404).json({ message: "Not found" });
    res.json(result);
  });

  app.post("/api/deals/:id/archive", isAuthenticated, async (req, res) => {
    const result = await storage.archiveDeal(Number(req.params.id));
    if (!result) return res.status(404).json({ message: "Not found" });
    await storage.createAuditLog({ action: "deal_archived", entityType: "deal", entityId: result.id, userId: (req.user as any)?.id });
    res.json(result);
  });

  app.post("/api/deals/:id/restore", isAuthenticated, async (req, res) => {
    const result = await storage.restoreDeal(Number(req.params.id));
    if (!result) return res.status(404).json({ message: "Not found" });
    res.json(result);
  });

  // === BULK OPERATIONS ===
  app.post("/api/deals/bulk-stage", isAuthenticated, async (req, res) => {
    const { dealIds, stage } = req.body;
    if (!Array.isArray(dealIds) || !stage) return res.status(400).json({ message: "dealIds array and stage required" });
    await storage.bulkUpdateDealStage(dealIds, stage);
    await storage.createAuditLog({ action: "bulk_stage_update", entityType: "deal", details: { dealIds, stage }, userId: (req.user as any)?.id });
    res.json({ success: true, count: dealIds.length });
  });

  app.post("/api/tasks/bulk-assign", isAuthenticated, async (req, res) => {
    const { taskIds, assignedTo } = req.body;
    if (!Array.isArray(taskIds) || !assignedTo) return res.status(400).json({ message: "taskIds array and assignedTo required" });
    await storage.bulkAssignTasks(taskIds, assignedTo);
    res.json({ success: true, count: taskIds.length });
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
    await storage.deleteTask(Number(req.params.id));
    res.json({ success: true });
  });

  // === DUPLICATE DETECTION & MERGE ===
  app.get("/api/contacts/duplicates", isAuthenticated, async (req, res) => {
    const duplicates = await storage.findDuplicateContacts();
    res.json(duplicates);
  });

  app.post("/api/contacts/merge", isAuthenticated, async (req, res) => {
    const { primaryId, duplicateId } = req.body;
    if (!primaryId || !duplicateId) return res.status(400).json({ message: "primaryId and duplicateId required" });
    const result = await storage.mergeContacts(Number(primaryId), Number(duplicateId));
    if (!result) return res.status(404).json({ message: "Contact not found" });
    await storage.createAuditLog({ action: "contacts_merged", entityType: "contact", entityId: result.id, details: { mergedFrom: duplicateId }, userId: (req.user as any)?.id });
    res.json(result);
  });

  // === ADVANCED SEARCH ===
  app.get("/api/search/advanced", isAuthenticated, async (req, res) => {
    const { q, dateFrom, dateTo, assignedTo, entityType, tags } = req.query;
    const query = String(q || '').toLowerCase().trim();
    const results: any = { contacts: [], deals: [], tickets: [], tasks: [] };

    if (!entityType || entityType === 'contact') {
      const allContacts = await storage.getContacts();
      results.contacts = allContacts.filter(c => {
        if (query && !`${c.firstName} ${c.lastName} ${c.email} ${c.companyName || ''}`.toLowerCase().includes(query)) return false;
        if (dateFrom && new Date(c.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(c.createdAt!) > new Date(String(dateTo))) return false;
        if (tags) {
          const tagList = String(tags).split(',');
          if (!c.tags?.some(t => tagList.includes(t))) return false;
        }
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'deal') {
      const allDeals = await storage.getDeals();
      results.deals = allDeals.filter(d => {
        if (query && !`${d.stage} ${d.pipeline} ${d.notes || ''} ${d.owner || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && d.owner !== String(assignedTo)) return false;
        if (dateFrom && new Date(d.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(d.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'ticket') {
      const allTickets = await storage.getTickets();
      results.tickets = allTickets.filter(t => {
        if (query && !`${t.subject} ${t.description} ${t.category || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && t.assignedTo !== String(assignedTo)) return false;
        if (dateFrom && new Date(t.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(t.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    if (!entityType || entityType === 'task') {
      const allTasks = await storage.getTasks();
      results.tasks = allTasks.filter(t => {
        if (query && !`${t.title} ${t.description || ''}`.toLowerCase().includes(query)) return false;
        if (assignedTo && t.assignedTo !== String(assignedTo)) return false;
        if (dateFrom && new Date(t.createdAt!) < new Date(String(dateFrom))) return false;
        if (dateTo && new Date(t.createdAt!) > new Date(String(dateTo))) return false;
        return true;
      }).slice(0, 50);
    }

    res.json(results);
  });

  // === EMAIL SIGNATURES ===
  app.get("/api/email-signatures/:type", isAuthenticated, async (req, res) => {
    const type = req.params.type as "sales" | "support" | "onboarding";
    const sig = await getStoredSignature(type);
    res.json({
      signature: sig,
      html: getEmailSignatureHtml(type, sig),
      plainText: getEmailSignaturePlainText(type, sig),
    });
  });

  app.put("/api/email-signatures/:type", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const type = req.params.type as "sales" | "support" | "onboarding";
    await saveSignature(type, req.body);
    const sig = await getStoredSignature(type);
    res.json({
      signature: sig,
      html: getEmailSignatureHtml(type as any, sig),
      plainText: getEmailSignaturePlainText(type as any, sig),
    });
  });

  app.get("/api/email-signatures", isAuthenticated, async (req, res) => {
    const types = ["sales", "support", "onboarding"];
    const signatures: Record<string, any> = {};
    for (const type of types) {
      const sig = await getStoredSignature(type);
      signatures[type] = {
        signature: sig,
        html: getEmailSignatureHtml(type as any, sig),
        plainText: getEmailSignaturePlainText(type as any, sig),
      };
    }
    res.json(signatures);
  });

  // === FULL COREVT IMPORT ===
  app.post("/api/sunbiz/import-corevt-full", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const maxRecords = Number(req.body.maxRecords) || Infinity;
    const onlyActive = req.body.onlyActive !== false;
    res.json({ message: `Full corevt import started (max: ${maxRecords === Infinity ? 'unlimited' : maxRecords}, active only: ${onlyActive})`, started: true });
    importFullCorevt({ maxRecords, onlyActive }).catch(err => console.error("[Import API] Error:", err));
  });

  app.get("/api/sunbiz/import-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("corevt_import_progress");
    const cordataProgress = await storage.getSystemSetting("cordata_import_progress");
    const entityCount = await storage.getSunbizEntityCount();
    res.json({ progress: progress || { status: "idle" }, cordataProgress: cordataProgress || { status: "idle" }, totalInDb: entityCount });
  });

  app.post("/api/sunbiz/import-cordata", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const maxRecords = req.body.maxRecords ? parseInt(req.body.maxRecords) : Infinity;
    const download = req.body.download !== false;
    res.json({ message: `Cordata import started (download: ${download}, max: ${maxRecords === Infinity ? 'unlimited' : maxRecords})`, started: true });
    importCordataEnrichment({ maxRecords, download }).catch(err => console.error("[Cordata Import API] Error:", err));
  });

  app.get("/api/sunbiz/cordata-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("cordata_import_progress");
    res.json({ progress: progress || { status: "idle" } });
  });

  app.post("/api/sunbiz/fast-classify", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    res.json({ message: "Bulk fast classification started for all pending entities.", started: true });
    runBulkFastClassification().catch(err => console.error("[FastClassify API] Error:", err));
  });

  app.get("/api/sunbiz/classify-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("bulk_classify_progress");
    res.json({ progress: progress || { status: "idle" } });
  });

  // === BATCH RE-ENRICHMENT & CLASSIFICATION ===
  app.post("/api/sunbiz/re-enrich-all", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const limit = Number(req.body?.limit) || 200;
    res.json({ message: `Re-enrichment started for up to ${limit} entities.`, started: true });
    reEnrichAllSunbizEntities(limit).catch(err => console.error("[Re-Enrich API] Error:", err));
  });

  app.get("/api/sunbiz/enrichment-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("enrichment_progress");
    res.json(progress || { status: "idle" });
  });

  app.post("/api/sunbiz/mass-enrich", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    if (isMassEnrichmentRunning()) return res.status(409).json({ message: "Mass enrichment is already running" });
    const limit = Number(req.body?.limit) || 2000;
    res.json({ message: `Mass enrichment started for up to ${limit} hot/warm entities.`, started: true });
    runMassEnrichment(limit).catch(err => console.error("[Mass Enrich API] Error:", err));
  });

  app.get("/api/sunbiz/mass-enrich-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("mass_enrichment_progress");
    res.json({ progress: progress || { status: "idle" }, running: isMassEnrichmentRunning() });
  });

  app.post("/api/sunbiz/promote-qualified", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const result = await promoteQualifiedToContacts();
    res.json(result);
  });

  app.post("/api/sunbiz/bulk-ai-classify", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const limit = Number(req.body?.limit) || 5000;
    res.json({ message: `AI classification started for up to ${limit} entities.`, started: true });
    runBulkAIClassification(limit).catch(err => console.error("[AI Classify API] Error:", err));
  });

  app.get("/api/sunbiz/ai-classify-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("ai_classify_progress");
    res.json({ progress: progress || { status: "idle" } });
  });

  app.post("/api/sunbiz/run-pipeline", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    if (isPipelineRunning()) return res.status(409).json({ message: "Pipeline is already running" });
    const classifyLimit = req.body?.classifyLimit !== undefined ? Number(req.body.classifyLimit) : 5000;
    const enrichLimit = req.body?.enrichLimit !== undefined ? Number(req.body.enrichLimit) : 1000;
    res.json({ message: `Full pipeline started: classify ${classifyLimit}, enrich ${enrichLimit}.`, started: true });
    runDailyEnrichmentPipeline({ classifyLimit, enrichLimit }).catch(err => console.error("[Pipeline API] Error:", err));
  });

  app.get("/api/sunbiz/pipeline-progress", isAuthenticated, async (req, res) => {
    const progress = await storage.getSystemSetting("daily_pipeline_progress");
    res.json({ progress: progress || { status: "idle" }, running: isPipelineRunning() });
  });

  app.post("/api/sunbiz/deep-enrich/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const result = await deepEnrichEntity(Number(req.params.id));
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Enrichment failed" });
    }
  });

  app.post("/api/sunbiz/deduplicate", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const limit = Number(req.body?.limit) || 500;
    const result = await runAutoDeduplication(limit);
    res.json({ message: `Deduplication complete: checked ${result.checked} groups, merged ${result.merged} records.`, ...result });
  });

  app.get("/api/sunbiz/enrichment-dashboard", isAuthenticated, async (req, res) => {
    try {
      const dashboard = await storage.getSunbizEnrichmentDashboard();
      const pipelineProgress = await storage.getSystemSetting("daily_pipeline_progress");
      res.json({
        ...dashboard,
        pipeline: { progress: pipelineProgress || { status: "idle" }, running: isPipelineRunning() },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch dashboard" });
    }
  });

  app.get("/api/sunbiz/verticals", isAuthenticated, async (req, res) => {
    try {
      const dashboard = await storage.getSunbizEnrichmentDashboard();
      const verticals = Object.entries(dashboard.verticals)
        .filter(([name]) => name !== "Unclassified" && name !== "Other")
        .map(([name, data]: [string, any]) => ({
          name,
          total: data.total,
          withContact: data.withContact,
          contactRate: data.total > 0 ? Math.round((data.withContact / data.total) * 100) : 0,
        }))
        .sort((a, b) => b.withContact - a.withContact);
      res.json({ verticals, totalClassified: dashboard.classified, readyForOutreach: dashboard.readyForOutreach });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch verticals" });
    }
  });

  // === GHL 2-WAY SYNC ===
  app.get("/api/ghl/sync-status", isAuthenticated, async (req, res) => {
    const status = await getGhlSyncStatus();
    res.json(status);
  });

  app.post("/api/ghl/sync-all-to-ghl", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Syncing all contacts to GHL...", started: true });
    fullSyncToGhl().catch(err => console.error("[GHL Sync API] Error:", err));
  });

  app.post("/api/ghl/sync-all-from-ghl", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Syncing contacts from GHL...", started: true });
    fullSyncFromGhl().catch(err => console.error("[GHL Sync API] Error:", err));
  });

  app.post("/api/ghl/sync-contact/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const result = await syncContactToGhl(Number(req.params.id));
    res.json(result);
  });

  app.post("/api/ghl/sync-deal/:id", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    const result = await syncDealToGhl(Number(req.params.id));
    res.json(result);
  });

  // === DAILY OUTREACH AUTOMATION ===
  app.post("/api/outreach/run-daily", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    res.json({ message: "Daily outreach cycle started.", started: true });
    runDailyOutreach().catch(err => console.error("[Daily Outreach API] Error:", err));
  });

  app.post("/api/outreach/start-worker", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const intervalMinutes = Number(req.body.intervalMinutes) || 60;
    startDailyOutreachWorker(intervalMinutes);
    res.json({ message: `Outreach worker started (runs every ${intervalMinutes} minutes)`, started: true });
  });

  app.post("/api/outreach/stop-worker", isAuthenticated, async (req, res) => {
    if ((req.user as any)?.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    stopDailyOutreachWorker();
    res.json({ message: "Outreach worker stopped", stopped: true });
  });

  app.get("/api/outreach/status", isAuthenticated, async (req, res) => {
    const [entityStats, verticalBreakdown, prospectStats, contactStats, dealStats, ghlStatus, importProgress, cordataProgress, enrichmentProgress, lastOutreachRun, workerStatus] = await Promise.all([
      storage.getSunbizAggregateStats(),
      storage.getSunbizVerticalBreakdown(),
      storage.getProspectAggregateStats(),
      storage.getContactAggregateStats(),
      storage.getDealAggregateStats(),
      getGhlSyncStatus(),
      storage.getSystemSetting("corevt_import_progress"),
      storage.getSystemSetting("cordata_import_progress"),
      storage.getSystemSetting("enrichment_progress"),
      storage.getSystemSetting("daily_outreach_last_run"),
      storage.getSystemSetting("outreach_worker_status"),
    ]);

    const campaigns = await storage.getCampaigns();
    const activeCampaigns = campaigns.filter(c => c.status === "active").length;

    const serperUsage = await getSerperUsage();

    res.json({
      entities: entityStats,
      prospects: prospectStats,
      contacts: contactStats,
      deals: dealStats,
      activeCampaigns,
      verticalBreakdown,
      ghlSync: ghlStatus,
      importProgress: importProgress || { status: "idle" },
      cordataProgress: cordataProgress || { status: "idle" },
      enrichmentProgress: enrichmentProgress || { status: "idle" },
      lastOutreachRun,
      workerRunning: isWorkerRunning(),
      workerStatus,
      serper: {
        configured: isSerperConfigured(),
        usage: serperUsage,
      },
    });
  });

  app.get("/sitemap.xml", (_req, res) => {
    const baseUrl = "https://libertybancard.com";
    const today = new Date().toISOString().split("T")[0];

    const publicPages: Array<{ url: string; priority: string; changefreq: string }> = [
      { url: "/", priority: "1.0", changefreq: "weekly" },
      { url: "/get-started", priority: "0.9", changefreq: "monthly" },
      { url: "/upload-statement", priority: "0.9", changefreq: "monthly" },
      { url: "/0-percent-processing", priority: "0.9", changefreq: "monthly" },
      { url: "/beat-square-stripe", priority: "0.8", changefreq: "monthly" },
      { url: "/about-contact", priority: "0.7", changefreq: "monthly" },
      { url: "/estimate", priority: "0.8", changefreq: "monthly" },
      { url: "/support", priority: "0.6", changefreq: "monthly" },
      { url: "/merchant-application", priority: "0.8", changefreq: "monthly" },
      { url: "/savings-calculator", priority: "0.8", changefreq: "monthly" },
      { url: "/compare-rates", priority: "0.8", changefreq: "monthly" },
      { url: "/blog", priority: "0.8", changefreq: "weekly" },
      { url: "/faq", priority: "0.9", changefreq: "monthly" },
      { url: "/affiliate", priority: "0.7", changefreq: "monthly" },
      { url: "/why-liberty-bancard", priority: "0.8", changefreq: "monthly" },
      { url: "/case-studies", priority: "0.8", changefreq: "monthly" },
      { url: "/compare/square", priority: "0.8", changefreq: "monthly" },
      { url: "/compare/stripe", priority: "0.8", changefreq: "monthly" },
      { url: "/compare/clover", priority: "0.8", changefreq: "monthly" },
      { url: "/compare/toast", priority: "0.8", changefreq: "monthly" },
      { url: "/compare/paypal", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/restaurant-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/retail-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/healthcare-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/salon-spa-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/auto-repair-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/professional-services-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/ecommerce-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/industries/construction-payment-processing", priority: "0.8", changefreq: "monthly" },
      { url: "/privacy-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/terms", priority: "0.3", changefreq: "yearly" },
      { url: "/cookie-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/advertising-disclosure", priority: "0.2", changefreq: "yearly" },
      { url: "/accessibility", priority: "0.3", changefreq: "yearly" },
      { url: "/sms-terms", priority: "0.2", changefreq: "yearly" },
      { url: "/esign-consent", priority: "0.2", changefreq: "yearly" },
      { url: "/surcharging-disclosure", priority: "0.3", changefreq: "yearly" },
      { url: "/merchant-policies", priority: "0.2", changefreq: "yearly" },
      { url: "/regulatory-notices", priority: "0.2", changefreq: "yearly" },
      { url: "/security-compliance", priority: "0.3", changefreq: "yearly" },
      { url: "/do-not-sell", priority: "0.2", changefreq: "yearly" },
      { url: "/data-processing-agreement", priority: "0.2", changefreq: "yearly" },
      { url: "/responsible-ai", priority: "0.2", changefreq: "yearly" },
      { url: "/testimonials-disclosure", priority: "0.2", changefreq: "yearly" },
      { url: "/law-enforcement", priority: "0.2", changefreq: "yearly" },
      { url: "/dispute-resolution", priority: "0.2", changefreq: "yearly" },
      { url: "/data-retention", priority: "0.2", changefreq: "yearly" },
      { url: "/tcpa-consent", priority: "0.2", changefreq: "yearly" },
      { url: "/refund-policy", priority: "0.3", changefreq: "yearly" },
      { url: "/california-privacy", priority: "0.3", changefreq: "yearly" },
      { url: "/ada-compliance", priority: "0.3", changefreq: "yearly" },
    ];

    const blogSlugs = [
      "how-to-read-credit-card-processing-statement",
      "cash-discount-vs-surcharging",
      "hidden-fees-payment-processing-guide",
      "how-to-switch-payment-processors",
      "best-payment-processing-restaurants-2025",
      "interchange-plus-vs-flat-rate",
      "pci-compliance-checklist-small-business",
      "how-much-does-credit-card-processing-cost",
      "what-is-interchange-plus-pricing",
      "emv-chip-cards-explained",
      "contactless-payments-nfc-apple-pay-google-pay",
      "understanding-chargebacks-prevention-response-recovery",
      "ach-vs-credit-card-processing",
      "what-is-a-payment-gateway-how-it-works",
      "level-2-level-3-processing-b2b-savings",
      "keyed-vs-swiped-transactions-entry-method-matters",
      "payment-processing-ecommerce-complete-guide",
      "mobile-payment-solutions-field-service",
      "accept-payments-trade-shows-pop-up-events",
      "restaurant-payment-processing-tips-pos-savings",
      "healthcare-payment-processing-hipaa-compliance",
      "salon-spa-payment-solutions-booking-tips-recurring",
      "auto-repair-shop-payment-processing-invoicing",
      "construction-industry-payments-progress-billing",
      "pci-dss-4-what-changed-merchants",
      "how-to-prevent-credit-card-fraud-business",
      "tokenization-vs-encryption-payment-data",
      "tcpa-compliance-merchant-services-text-call-rules",
      "ada-website-compliance-payment-pages",
      "surcharging-laws-by-state",
      "data-breach-response-plan-small-business",
      "understanding-pci-self-assessment-questionnaire-saq",
      "how-to-negotiate-lower-credit-card-processing-rates",
      "dual-pricing-vs-cash-discount-which-program-is-right",
      "true-cost-of-free-payment-processing-offers",
      "when-to-switch-payment-processors-warning-signs",
      "processing-volume-tiers-how-higher-volume-gets-better-rates",
      "same-day-vs-next-day-funding-settlement-speed-explained",
      "merchant-account-reserves-what-they-are-how-to-avoid",
      "annual-fee-pci-fee-statement-fee-breaking-down-monthly-charges",
      "pos-system-buying-guide-2025",
      "virtual-terminal-vs-payment-gateway",
      "recurring-billing-subscription-payment-processing",
      "payment-processing-for-nonprofits",
      "multi-location-payment-processing",
      "international-payment-processing",
      "payment-processing-trends-2025",
      "how-to-read-effective-rate",
      "integrated-vs-non-integrated-payments",
      "buy-now-pay-later-for-merchants-bnpl",
    ];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of publicPages) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}${page.url}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
      xml += `    <priority>${page.priority}</priority>\n`;
      xml += `  </url>\n`;
    }

    for (const slug of blogSlugs) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/blog/${slug}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      xml += `  </url>\n`;
    }

    xml += `  <url>\n`;
    xml += `    <loc>${baseUrl}/help</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>monthly</changefreq>\n`;
    xml += `    <priority>0.7</priority>\n`;
    xml += `  </url>\n`;

    const helpArticles: { category: string; slugs: string[] }[] = [
      { category: "getting-started", slugs: ["setting-up-your-merchant-account", "running-your-first-transaction", "connecting-your-pos-system", "understanding-your-pricing", "next-day-funding-setup"] },
      { category: "billing-statements", slugs: ["reading-your-monthly-statement", "understanding-processing-fees", "disputing-a-charge-on-your-statement", "managing-chargebacks", "understanding-refunds-and-credits"] },
      { category: "technical-support", slugs: ["terminal-troubleshooting", "gateway-setup-configuration", "resolving-batch-settlement-issues", "wifi-and-network-connectivity", "contactless-and-nfc-troubleshooting"] },
      { category: "account-management", slugs: ["updating-business-information", "adding-users-and-permissions", "changing-your-processing-settings", "adding-a-new-location", "closing-or-pausing-your-account"] },
      { category: "compliance-security", slugs: ["pci-compliance-basics", "protecting-customer-data", "fraud-prevention-tips", "handling-a-data-breach", "understanding-emv-and-liability-shift"] },
      { category: "general-faq", slugs: ["what-is-payment-processing", "how-long-does-approval-take", "what-are-interchange-fees", "do-i-need-a-contract", "what-is-a-merchant-id", "can-i-accept-amex", "what-is-a-cash-discount-program", "how-to-read-your-rate", "what-is-next-day-funding", "how-to-switch-processors", "what-is-pci-compliance"] },
    ];
    for (const group of helpArticles) {
      xml += `  <url>\n`;
      xml += `    <loc>${baseUrl}/help/${group.category}</loc>\n`;
      xml += `    <lastmod>${today}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n`;
      xml += `    <priority>0.6</priority>\n`;
      xml += `  </url>\n`;
      for (const slug of group.slugs) {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/help/${group.category}/${slug}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>monthly</changefreq>\n`;
        xml += `    <priority>0.5</priority>\n`;
        xml += `  </url>\n`;
      }
    }

    xml += `</urlset>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  });

  app.post("/api/affiliate/signup", async (req, res) => {
    try {
      const { firstName, lastName, email, phone, companyName, website, howHeard, password } = req.body;
      if (!firstName || typeof firstName !== "string" || firstName.length > 100) {
        return res.status(400).json({ message: "Valid first name is required." });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required." });
      }
      if (!phone || typeof phone !== "string" || phone.length > 30) {
        return res.status(400).json({ message: "Valid phone number is required." });
      }
      if (!password || typeof password !== "string" || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters." });
      }
      const existing = await storage.getPartnerByEmail(email.toLowerCase());
      if (existing) {
        return res.status(409).json({ message: "An affiliate account with this email already exists." });
      }
      const existingUser = await authStorage.getUserByEmail(email.toLowerCase());
      if (existingUser) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      let code = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        code = (firstName.slice(0, 3) + (lastName?.slice(0, 3) || "") + Math.random().toString(36).slice(2, 6)).toLowerCase().replace(/[^a-z0-9]/g, "");
        const dup = await storage.getPartnerByCode(code);
        if (!dup) break;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const partner = await storage.createPartner({
        companyName: (companyName || `${firstName} ${lastName || ""}`.trim()).slice(0, 200),
        contactName: `${firstName} ${lastName || ""}`.trim().slice(0, 200),
        email: email.toLowerCase().slice(0, 200),
        phone: phone.slice(0, 30),
        passwordHash,
        partnerType: "affiliate",
        affiliateCode: code,
        status: "active",
        commissionPercent: 10,
        website: website ? String(website).slice(0, 500) : null,
        howHeard: howHeard ? String(howHeard).slice(0, 500) : null,
      });
      const user = await authStorage.upsertUser({
        email: email.toLowerCase(),
        firstName,
        lastName: lastName || "",
        passwordHash,
        role: "affiliate",
        authProvider: "local",
      });
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(201).json({
            message: "Welcome to the Liberty Bancard Affiliate Program!",
            affiliateCode: partner.affiliateCode,
          });
        }
        return res.status(201).json({
          message: "Welcome to the Liberty Bancard Affiliate Program!",
          affiliateCode: partner.affiliateCode,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/affiliate/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
      }
      const partner = await storage.getPartnerByEmail(email.toLowerCase());
      if (!partner || !partner.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const valid = await bcrypt.compare(password, partner.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      if (partner.status !== "active") {
        return res.status(403).json({ message: "Your affiliate account is not active." });
      }
      let user = await authStorage.getUserByEmail(email.toLowerCase());
      if (!user) {
        const nameParts = (partner.contactName || "").split(" ");
        user = await authStorage.upsertUser({
          email: email.toLowerCase(),
          firstName: nameParts[0] || "Affiliate",
          lastName: nameParts.slice(1).join(" ") || "",
          passwordHash: partner.passwordHash,
          role: "affiliate",
          authProvider: "local",
        });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Login failed." });
        }
        return res.json({
          affiliateCode: partner.affiliateCode,
          name: partner.contactName,
          email: partner.email,
        });
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/session", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByEmail(user.email);
      if (!partner) {
        return res.status(404).json({ message: "Affiliate account not found." });
      }
      return res.json({
        affiliateCode: partner.affiliateCode,
        name: partner.contactName,
        email: partner.email,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/affiliate/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out" });
      });
    });
  });

  app.get("/api/affiliate/stats/:code", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByCode(req.params.code);
      if (!partner) return res.status(404).json({ message: "Affiliate not found." });
      if (user.role !== "admin" && partner.email !== user.email) {
        return res.status(403).json({ message: "Access denied." });
      }
      const referralsList = await storage.getReferralsByPartner(partner.id);
      const pending = referralsList.filter(r => r.status === "pending" || r.status === "contacted").length;
      const qualified = referralsList.filter(r => r.status === "qualified").length;
      const converted = referralsList.filter(r => r.status === "converted" || r.status === "paid").length;
      const totalEarnings = referralsList.filter(r => r.status === "paid").reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);
      const pendingEarnings = referralsList.filter(r => r.status === "converted").reduce((sum, r) => sum + parseFloat(r.incentiveAmount || "0"), 0);
      res.json({
        affiliate: {
          name: partner.contactName,
          code: partner.affiliateCode,
          commissionPercent: partner.commissionPercent,
          status: partner.status,
          joinedAt: partner.createdAt,
        },
        stats: {
          totalClicks: partner.totalClicks || 0,
          totalReferrals: referralsList.length,
          pending,
          qualified,
          converted,
          conversionRate: referralsList.length > 0 ? Math.round((converted / referralsList.length) * 100) : 0,
          totalEarnings: totalEarnings.toFixed(2),
          pendingEarnings: pendingEarnings.toFixed(2),
        },
        recentReferrals: referralsList.slice(0, 20).map(r => ({
          id: r.id,
          status: r.status,
          date: r.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/public/:code", async (req, res) => {
    try {
      const partner = await storage.getPartnerByCode(req.params.code);
      if (!partner || partner.status !== "active") {
        return res.status(404).json({ message: "Affiliate not found" });
      }
      res.json({
        name: partner.contactName,
        company: partner.companyName || undefined,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/affiliate/track-click", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) return res.status(400).json({ message: "Code required" });
      const partner = await storage.getPartnerByCode(code);
      if (!partner) return res.status(404).json({ message: "Invalid affiliate code" });
      await storage.updatePartner(partner.id, { totalClicks: (partner.totalClicks || 0) + 1 } as any);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/public/free-analysis", async (req, res) => {
    try {
      const {
        businessType, industry, monthlyVolume, currentProcessor,
        painPoint, painPoints: painPointsArr,
        firstName, lastName, email, phone, companyName,
        consentSms, consentEmail, referralCode, promoCode,
        utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
      } = req.body;

      if (!firstName || !email) {
        return res.status(400).json({ message: "First name and email are required." });
      }

      const sanitizedPromo = promoCode
        ? promoCode.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
        : undefined;

      const resolvedPainPoints: string[] = Array.isArray(painPointsArr) ? painPointsArr
        : painPoint ? (typeof painPoint === "string" ? painPoint.split(",").map((s: string) => s.trim()) : [painPoint])
        : [];

      const industryMap: Record<string, string> = {
        "restaurant": "Restaurant", "retail": "Retail",
        "healthcare": "Medical/Dental/Medspa", "medical": "Medical/Dental/Medspa",
        "automotive": "Automotive", "home-services": "Home Services", "home_services": "Home Services",
        "ecommerce": "E-commerce", "e-commerce": "E-commerce", "other": "Other",
      };
      const normalizedIndustry = industryMap[(industry || "other").toLowerCase().replace(/[^a-z-]/g, "")] || industry || "Other";

      const volumeRanges: Record<string, number> = {
        "under-5k": 2500, "5k-15k": 10000, "15k-50k": 32500,
        "50k-150k": 100000, "150k-plus": 200000,
        "Under $5,000": 2500, "$5,000 - $10,000": 7500,
        "$5,000 - $15,000": 10000, "$10,001 - $25,000": 17500,
        "$15,000 - $50,000": 32500, "$25,001 - $50,000": 37500,
        "$50,000 - $150,000": 100000, "$50,001+": 75000,
        "$150,000+": 200000, "Not sure": 15000,
      };
      const volumeNum = volumeRanges[monthlyVolume] || parseFloat((monthlyVolume || "0").replace(/[^0-9.]/g, "")) || 15000;
      let estimatedSavings = 0;
      let recommendedProgram = "Wholesale";
      let recommendedTerminal = "Clover Flex 3";

      const processorRates: Record<string, number> = {
        "square": 2.6, "stripe": 2.9, "toast": 2.49, "clover": 2.6,
        "clover_go": 2.6, "bank-processor": 2.5, "bank_processor": 2.5,
        "paypal": 2.7, "shopify": 2.6, "other": 2.5, "none": 3.0,
      };
      const processorKey = (currentProcessor || "other").toLowerCase().replace(/[^a-z_-]/g, "");
      const currentRate = processorRates[processorKey] || processorRates[processorKey.replace(/-/g, "_")] || 2.5;
      const ourRate = 1.59;
      const rateDiff = (currentRate - ourRate) / 100;
      estimatedSavings = Math.round(volumeNum * rateDiff * 12);

      if (volumeNum > 10000) {
        recommendedProgram = "0% Processing (Dual Pricing)";
        estimatedSavings = Math.round(volumeNum * (currentRate / 100) * 12);
      } else if (volumeNum > 5000) {
        recommendedProgram = "Wholesale Interchange+";
      }

      const terminalMap: Record<string, string> = {
        "Restaurant": "Clover Station Duo", "Retail": "Clover Mini 3",
        "Home Services": "SwipeSimple B250", "Automotive": "PAX A920",
        "Medical/Dental/Medspa": "Dejavoo QD4", "E-commerce": "Clover Flex 3",
      };
      recommendedTerminal = terminalMap[normalizedIndustry] || "Clover Flex 3";

      const industryTag = `vertical_${(normalizedIndustry || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`;
      const tags = ["src_quiz", "lead_free_analysis", industryTag];
      if (sanitizedPromo) tags.push(`promo_${sanitizedPromo.toLowerCase()}`);
      if (utmSource) tags.push(`utm_src_${utmSource}`);
      if (utmMedium) tags.push(`utm_med_${utmMedium}`);
      if (utmCampaign) tags.push(`utm_camp_${utmCampaign}`);

      const contact = await storage.createContact({
        firstName,
        lastName: lastName || "",
        email,
        phone: phone || "",
        companyName: companyName || undefined,
        vertical: normalizedIndustry || undefined,
        monthlyVolume: monthlyVolume || undefined,
        currentProvider: currentProcessor || undefined,
        primaryOfferPath: recommendedProgram,
        consentSms: consentSms === true,
        consentEmail: consentEmail === true,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: "/free-analysis",
        promoCode: sanitizedPromo,
        painPoints: resolvedPainPoints.length > 0 ? resolvedPainPoints : undefined,
        estimatedResidual: estimatedSavings ? String(estimatedSavings) : undefined,
        status: "New",
        tags,
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "free_analysis_quiz",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "free_analysis" },
        });
      }

      const quizNotes = [
        `Quiz Results:`,
        `Business Type: ${businessType || "N/A"}`,
        `Industry: ${normalizedIndustry || "N/A"}`,
        `Monthly Volume: ${monthlyVolume || "N/A"}`,
        `Current Processor: ${currentProcessor || "N/A"}`,
        `Pain Points: ${resolvedPainPoints.length > 0 ? resolvedPainPoints.join(", ") : "N/A"}`,
        `Estimated Annual Savings: $${estimatedSavings.toLocaleString()}`,
        `Recommended Program: ${recommendedProgram}`,
        `Recommended Terminal: ${recommendedTerminal}`,
        sanitizedPromo ? `Promo Code: ${sanitizedPromo}` : null,
      ].filter(Boolean).join("\n");

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        offerPath: recommendedProgram,
        notes: quizNotes,
        leadSource: "free_analysis_quiz",
        promoCode: sanitizedPromo,
        terminalRecommendation: recommendedTerminal,
        recommendedProgram,
        totalVolume: monthlyVolume || undefined,
      });

      await storage.createNotification({
        channel: "#sales",
        title: "New Quiz Lead",
        message: `New quiz lead: ${firstName} ${lastName || ""} from ${normalizedIndustry || "Unknown"}, est. savings $${estimatedSavings.toLocaleString()}${sanitizedPromo ? ` (promo: ${sanitizedPromo})` : ""}`,
        type: "alert",
        metadata: {
          contactId: contact.id,
          dealId: deal.id,
          industry,
          estimatedSavings,
          monthlyVolume,
        },
      });

      trackReferral(referralCode, `${firstName} ${lastName || ""}`, email, phone, companyName).catch(err => console.error("Referral tracking error:", err));

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint gen error:", err));

      (async () => {
        try {
          const searchName = companyName || `${firstName} ${lastName || ""}`;
          const matches = await storage.searchSunbizEntitiesByNameCity(searchName);
          if (matches.length > 0) {
            const match = matches[0];
            const enrichUpdates: Record<string, any> = {};
            if (match.vertical && !contact.vertical) enrichUpdates.vertical = match.vertical;
            if (match.ownerName) enrichUpdates.notes = `${contact.notes || ""}\nSunbiz Match: ${match.entityName} (Filing: ${match.filingNumber || "N/A"})`.trim();
            const existingTags = contact.tags || [];
            enrichUpdates.tags = [...existingTags, "sunbiz_matched"];
            if (match.aiSummary) {
              enrichUpdates.notes = `${enrichUpdates.notes || contact.notes || ""}\nSunbiz AI: ${match.aiSummary}`.trim();
            }
            await storage.updateContact(contact.id, enrichUpdates);
            await storage.updateSunbizEntity(match.id, {
              tags: [...(match.tags || []), "quiz_lead_linked"],
              notes: `${match.notes || ""}\nLinked to quiz contact #${contact.id} (${firstName} ${lastName || ""})`.trim(),
            });
          }
        } catch (err) {
          console.error("Sunbiz match error:", err);
        }
      })();

      triggerWorkflowsByEvent("form_submitted", {
        entityType: "contact",
        entityId: contact.id,
        contactId: contact.id,
        dealId: deal.id,
      }, { formType: "free_analysis" }).catch(err => console.error("Workflow trigger error:", err));

      autoEnrollFromTrigger("form_submitted", {
        contactId: contact.id,
        dealId: deal.id,
        formType: "free_analysis",
      }).catch(err => console.error("Auto-enroll error:", err));

      autoEnrollFromTrigger("quiz_completed", {
        contactId: contact.id,
        dealId: deal.id,
      }).catch(err => console.error("Auto-enroll quiz error:", err));

      if (consentSms && phone) sendConfirmationSms(contact.id, firstName, "free_analysis_quiz", deal.id).catch(err => console.error("Confirm SMS error:", err));

      res.status(201).json({
        success: true,
        contactId: contact.id,
        dealId: deal.id,
        estimatedSavings,
        recommendedProgram,
        recommendedTerminal,
        monthlyVolume: monthlyVolume || "0",
      });
    } catch (err: any) {
      console.error("Free analysis submission error:", err);
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/affiliate/referral", async (req, res) => {
    try {
      const { affiliateCode, name, email, phone, company, source } = req.body;
      if (!affiliateCode || !name || !email) {
        return res.status(400).json({ message: "Affiliate code, name, and email are required." });
      }
      const partner = await storage.getPartnerByCode(affiliateCode);
      if (!partner) return res.status(404).json({ message: "Invalid affiliate code." });
      const referral = await storage.createReferral({
        partnerId: partner.id,
        referredName: name,
        referredEmail: email,
        referredPhone: phone || null,
        referredCompany: company || null,
        status: "pending",
        incentiveType: "commission",
        notes: source ? `Source: ${source}` : null,
      });
      await storage.updatePartner(partner.id, { totalReferrals: (partner.totalReferrals || 0) + 1 } as any);
      res.status(201).json({ success: true, referralId: referral.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === MASS SCORING ===
  app.post("/api/contacts/mass-score", async (req, res) => {
    const batchSize = 500;
    let totalScored = 0;
    const tierCounts = { hot: 0, warm: 0, cold: 0, unqualified: 0 };

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM contacts WHERE archived_at IS NULL AND (last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours')`
      );
      const totalContacts = parseInt(countResult.rows[0].cnt, 10);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendProgress({ type: "start", totalContacts });

      let lastId = 0;
      while (true) {
        const batchResult = await pool.query(
          `SELECT id FROM contacts WHERE archived_at IS NULL AND (last_scored_at IS NULL OR last_scored_at < NOW() - INTERVAL '24 hours') AND id > $1 ORDER BY id LIMIT $2`,
          [lastId, batchSize]
        );

        if (batchResult.rows.length === 0) break;

        for (const row of batchResult.rows) {
          lastId = row.id;
          try {
            const contact = await storage.getContact(row.id);
            if (!contact) continue;

            const contactDeals = await storage.getDealsByContact(row.id);
            const primaryDeal = contactDeals[0] || null;

            const revPotential = calculateRevenuePotentialFn(contact, primaryDeal);
            const switchability = calculateSwitchabilityFn(contact);
            const uwConfidence = calculateUnderwritingConfidenceFn(contact, primaryDeal);
            const quizBonus = calculateQuizBonusFn(contact);

            const engagementScore = 5;

            const total = revPotential.score + switchability.score + uwConfidence.score + engagementScore + quizBonus.score;
            const tier = total >= 70 ? "hot" : total >= 45 ? "warm" : total >= 20 ? "cold" : "unqualified";
            tierCounts[tier]++;

            await storage.updateContact(row.id, {
              leadScore: total,
              revPotentialScore: revPotential.score,
              switchabilityScore: switchability.score,
              uwConfidenceScore: uwConfidence.score,
              engagementScore: engagementScore,
              scoreBreakdown: {
                revPotential: { score: revPotential.score, max: 30, factors: revPotential.factors },
                switchability: { score: switchability.score, max: 25, factors: switchability.factors },
                uwConfidence: { score: uwConfidence.score, max: 25, factors: uwConfidence.factors },
                engagement: { score: engagementScore, max: 20, factors: { default: 5 } },
                quizBonus: { score: quizBonus.score, max: 20, factors: quizBonus.factors },
                total,
                tier,
              },
              lastScoredAt: new Date(),
            });

            totalScored++;
          } catch (err) {
            console.error(`Mass scoring failed for contact ${row.id}:`, err);
          }
        }

        sendProgress({ type: "progress", scored: totalScored, total: totalContacts, tierCounts });
      }

      sendProgress({ type: "complete", totalScored, tierCounts });
      res.end();
    } catch (err: any) {
      console.error("Mass scoring error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // === MASS DEAL CREATION ===
  app.post("/api/contacts/mass-create-deals", async (req, res) => {
    const batchSize = 500;
    let dealsCreated = 0;
    let skipped = 0;

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM contacts c WHERE c.archived_at IS NULL AND c.lead_score >= 45 AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id)`
      );
      const totalEligible = parseInt(countResult.rows[0].cnt, 10);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendProgress({ type: "start", totalEligible });

      let lastId = 0;
      while (true) {
        const batchResult = await pool.query(
          `SELECT c.id, c.lead_score, c.vertical, c.monthly_volume, c.lead_source, c.first_name, c.last_name, c.company_name
           FROM contacts c
           WHERE c.archived_at IS NULL AND c.lead_score >= 45
             AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id = c.id)
             AND c.id > $1
           ORDER BY c.id
           LIMIT $2`,
          [lastId, batchSize]
        );

        if (batchResult.rows.length === 0) break;

        for (const row of batchResult.rows) {
          lastId = row.id;
          try {
            const score = row.lead_score || 0;
            const isHot = score >= 70;
            const stage = isHot ? "New Lead" : "Nurture / Not Now";
            const merchantTier = isHot ? "Strategic" : score >= 50 ? "Growth" : "Starter";

            await storage.createDeal({
              contactId: row.id,
              pipeline: "sales",
              stage,
              priorityScore: score,
              merchantTier,
              leadSource: row.lead_source || "imported",
              totalVolume: row.monthly_volume || null,
              notes: `Auto-created from mass scoring. Contact: ${row.first_name} ${row.last_name}${row.company_name ? ` (${row.company_name})` : ""}. Score: ${score}, Tier: ${isHot ? "hot" : "warm"}.`,
            });
            dealsCreated++;
          } catch (err) {
            console.error(`Deal creation failed for contact ${row.id}:`, err);
            skipped++;
          }
        }

        sendProgress({ type: "progress", created: dealsCreated, skipped, total: totalEligible });
      }

      sendProgress({ type: "complete", dealsCreated, skipped });
      res.end();
    } catch (err: any) {
      console.error("Mass deal creation error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // === DEDUPLICATE CONTACTS ===
  app.post("/api/contacts/deduplicate", async (req, res) => {
    try {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendProgress = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const duplicates = await storage.findDuplicateContacts();
      sendProgress({ type: "start", duplicateGroups: duplicates.length });

      let merged = 0;
      let errors = 0;

      for (const group of duplicates) {
        try {
          const sorted = group.contacts.sort((a, b) => {
            const aCompleteness = [a.email, a.phone, a.companyName, a.vertical, a.monthlyVolume, a.leadScore].filter(Boolean).length;
            const bCompleteness = [b.email, b.phone, b.companyName, b.vertical, b.monthlyVolume, b.leadScore].filter(Boolean).length;
            if (bCompleteness !== aCompleteness) return bCompleteness - aCompleteness;
            return (b.leadScore || 0) - (a.leadScore || 0);
          });

          const primary = sorted[0];
          for (let i = 1; i < sorted.length; i++) {
            await storage.mergeContacts(primary.id, sorted[i].id);
            merged++;
          }
        } catch (err) {
          console.error("Merge error:", err);
          errors++;
        }
      }

      sendProgress({ type: "complete", duplicateGroups: duplicates.length, merged, errors });
      res.end();
    } catch (err: any) {
      console.error("Deduplication error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // === PIPELINE STATS (contacts by tier, deals by stage, outreach stats) ===
  app.get("/api/kpi/pipeline-stats", async (req, res) => {
    try {
      const tierResult = await pool.query(`
        SELECT
          CASE
            WHEN lead_score >= 70 THEN 'hot'
            WHEN lead_score >= 45 THEN 'warm'
            WHEN lead_score >= 20 THEN 'cold'
            ELSE 'unqualified'
          END as tier,
          COUNT(*) as count
        FROM contacts
        WHERE archived_at IS NULL
        GROUP BY tier
        ORDER BY count DESC
      `);

      const stageResult = await pool.query(`
        SELECT stage, COUNT(*) as count
        FROM deals
        WHERE archived_at IS NULL AND pipeline = 'sales'
        GROUP BY stage
        ORDER BY count DESC
      `);

      const scoredResult = await pool.query(`
        SELECT COUNT(*) as count FROM contacts WHERE archived_at IS NULL AND last_scored_at IS NOT NULL
      `);

      const unscoredResult = await pool.query(`
        SELECT COUNT(*) as count FROM contacts WHERE archived_at IS NULL AND last_scored_at IS NULL
      `);

      const totalDealsResult = await pool.query(`
        SELECT COUNT(*) as count FROM deals WHERE archived_at IS NULL
      `);

      const awaitingOutreach = await pool.query(`
        SELECT COUNT(*) as count FROM contacts c
        WHERE c.archived_at IS NULL AND c.lead_score >= 45
          AND c.last_contacted_at IS NULL
          AND (c.do_not_contact IS NULL OR c.do_not_contact = false)
      `);

      const pipelineValue = await pool.query(`
        SELECT
          COALESCE(SUM(
            CASE WHEN estimated_gross_profit_monthly IS NOT NULL
              AND REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') != ''
            THEN CAST(REGEXP_REPLACE(estimated_gross_profit_monthly, '[^0-9.]', '', 'g') AS DECIMAL)
            ELSE 0 END
          ), 0) as total_value
        FROM deals
        WHERE archived_at IS NULL AND pipeline = 'sales' AND stage NOT IN ('Closed Won', 'Closed Lost')
      `);

      const contactsByTier: Record<string, number> = {};
      for (const row of tierResult.rows) {
        contactsByTier[row.tier] = parseInt(row.count, 10);
      }

      const dealsByStage: Record<string, number> = {};
      for (const row of stageResult.rows) {
        dealsByStage[row.stage] = parseInt(row.count, 10);
      }

      res.json({
        contactsByTier,
        dealsByStage,
        scored: parseInt(scoredResult.rows[0].count, 10),
        unscored: parseInt(unscoredResult.rows[0].count, 10),
        totalDeals: parseInt(totalDealsResult.rows[0].count, 10),
        awaitingOutreach: parseInt(awaitingOutreach.rows[0].count, 10),
        pipelineValue: parseFloat(pipelineValue.rows[0].total_value) || 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/leaderboard", isAffiliate, async (_req, res) => {
    try {
      const leaders = await storage.getAffiliateLeaderboard();
      res.json(leaders.map((p, idx) => ({
        rank: idx + 1,
        name: p.contactName || p.companyName,
        referrals: p.totalReferrals || 0,
        conversions: p.totalConversions || 0,
        earnings: p.totalPayouts || "0",
      })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/affiliate/commission-report/:code", isAffiliate, async (req, res) => {
    try {
      const user = req.user as any;
      const partner = await storage.getPartnerByCode(req.params.code);
      if (!partner) return res.status(404).json({ message: "Affiliate not found." });
      if (user.role !== "admin" && partner.email !== user.email) {
        return res.status(403).json({ message: "Access denied." });
      }
      const allReferrals = await storage.getReferralsByPartner(partner.id);
      const tiers = await storage.getCommissionTiers();
      const converted = allReferrals.filter(r => r.status === "converted" || r.status === "paid");

      function getCommissionForReferralCount(count: number): string {
        if (tiers.length === 0) return "100";
        for (const tier of tiers) {
          if (count >= tier.minReferrals && (tier.maxReferrals === null || count <= tier.maxReferrals)) {
            return tier.commissionAmount;
          }
        }
        return tiers[tiers.length - 1]?.commissionAmount || "100";
      }

      const monthlyBreakdown: Record<string, any[]> = {};
      let grandTotal = 0;
      for (const ref of converted) {
        const date = ref.createdAt ? new Date(ref.createdAt) : new Date();
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        if (!monthlyBreakdown[monthKey]) monthlyBreakdown[monthKey] = [];
        const commAmt = ref.commissionAmount || ref.incentiveAmount || getCommissionForReferralCount(converted.length);
        const amtNum = parseFloat(commAmt) || 0;
        grandTotal += amtNum;
        monthlyBreakdown[monthKey].push({
          referralId: ref.id,
          merchantName: ref.referredCompany || ref.referredName || "Unknown",
          signupDate: ref.createdAt,
          status: ref.status,
          commissionAmount: commAmt,
        });
      }

      const report = Object.entries(monthlyBreakdown)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([month, entries]) => ({
          month,
          entries,
          total: entries.reduce((sum: number, e: any) => sum + parseFloat(e.commissionAmount || "0"), 0).toFixed(2),
        }));

      res.json({
        affiliate: { name: partner.contactName, code: partner.affiliateCode },
        tiers,
        currentTierReferrals: converted.length,
        currentCommissionRate: getCommissionForReferralCount(converted.length),
        report,
        totalEarnings: grandTotal.toFixed(2),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/commission-tiers", async (_req, res) => {
    try {
      const tiers = await storage.getCommissionTiers();
      res.json(tiers);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/commission-tiers", isAdmin, async (req, res) => {
    try {
      const { minReferrals, maxReferrals, commissionAmount, label } = req.body;
      const min = Number(minReferrals) || 1;
      const max = maxReferrals ? Number(maxReferrals) : null;
      const amount = parseFloat(String(commissionAmount || "100"));
      if (min < 1) return res.status(400).json({ message: "Min referrals must be at least 1." });
      if (max !== null && max < min) return res.status(400).json({ message: "Max referrals must be >= min referrals." });
      if (isNaN(amount) || amount <= 0) return res.status(400).json({ message: "Commission amount must be a positive number." });
      const tier = await storage.createCommissionTier({
        minReferrals: min,
        maxReferrals: max,
        commissionAmount: amount.toString(),
        label: label || null,
      });
      res.status(201).json(tier);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/commission-tiers/:id", isAdmin, async (req, res) => {
    try {
      const updated = await storage.updateCommissionTier(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Tier not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/commission-tiers/:id", isAdmin, async (req, res) => {
    try {
      await storage.deleteCommissionTier(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  return httpServer;
}
