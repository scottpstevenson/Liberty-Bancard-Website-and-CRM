import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { z } from "zod";
import { insertContactSchema, insertDealSchema, insertTicketSchema, insertTaskSchema, insertCompanySchema, insertDocumentSchema, insertNotificationSchema, insertWorkflowSchema, insertRfiSchema, insertMessageTemplateSchema, insertCollateralPacketSchema, insertSlaConfigSchema, insertProspectSchema, insertProspectListSchema, insertEnrichmentJobSchema, insertCampaignSchema, insertCampaignStepSchema, insertOutboundMessageSchema, insertNoteSchema, insertEmailLogSchema, insertCallLogSchema, insertStageAutomationRuleSchema, insertFollowUpSequenceSchema, insertSequenceStepSchema, insertSequenceEnrollmentSchema } from "@shared/schema";
import { isGhlConfigured, getGhlStatus, sendGhlEmail, sendGhlSms, sendTemplatedMessage, upsertGhlContact, handleGhlWebhook, getCalendarBookingUrl } from "./services/ghl";
import { enrichProspect, runEnrichmentJob, processEnrichmentQueue } from "./services/enrichment";
import { queueCampaignMessages, processSendQueue, getCampaignAnalytics } from "./services/campaign-engine";
import multer from "multer";
import { parse } from "csv-parse/sync";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
      const contactWorkflows = await storage.getWorkflowsByTrigger("contact_created");
      for (const wf of contactWorkflows.filter(w => w.enabled)) {
        await storage.createWorkflowRun({ workflowId: wf.id, status: "completed", entityType: "contact", entityId: contact.id, log: { autoTriggered: true, event: "contact_created" } });
      }
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
    }
    res.json(updated);
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
      const ticketWorkflows = await storage.getWorkflowsByTrigger("ticket_created");
      for (const wf of ticketWorkflows.filter(w => w.enabled)) {
        await storage.createWorkflowRun({ workflowId: wf.id, status: "completed", entityType: "ticket", entityId: ticket.id, log: { autoTriggered: true, event: "ticket_created" } });
      }
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
    const updated = await storage.updateTicket(Number(req.params.id), req.body);
    if (!updated) return res.status(404).json({ message: "Not found" });
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

  // === PUBLIC FORM SUBMISSIONS ===
  app.post("/api/public/statement-upload", async (req, res) => {
    try {
      const { businessName, contactName, email, mobile, vertical, currentProvider, interestedIn0Percent, needTerminal, notes, consentSms } = req.body;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const contact = await storage.createContact({
        firstName, lastName, email, phone: mobile,
        companyName: businessName, vertical, currentProvider,
        interestedIn0Percent: interestedIn0Percent === true,
        needTerminal: needTerminal === true,
        notes, consentSms: consentSms === true,
        status: "New",
        tags: ["src_website", "lead_statement_upload", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      let offerPath = "Not Sure";
      if (interestedIn0Percent) offerPath = "0% Program";
      else if (needTerminal) offerPath = "Terminal Needed";

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "Statement Received",
        offerPath, notes: `Statement uploaded. ${notes || ""}`.trim(),
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

      await storage.createAuditLog({ action: "statement_uploaded", entityType: "contact", entityId: contact.id, details: { source: "website" } });

      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/estimate", async (req, res) => {
    try {
      const { contactName, email, phone, monthlyVolume, totalFees, currentProvider, notes } = req.body;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const contact = await storage.createContact({
        firstName, lastName, email, phone: phone || "",
        monthlyVolume, currentProvider, notes,
        status: "New",
        tags: ["src_website", "lead_estimate"],
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        totalVolume: monthlyVolume, totalFees,
        notes: `Estimate request. Volume: ${monthlyVolume}, Fees: ${totalFees}`,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Estimate Request",
        message: `${firstName} ${lastName} - Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        type: "info",
      });

      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/support", async (req, res) => {
    try {
      const { name, businessName, email, mobile, issueType, priority, message: msg, consentSms } = req.body;
      const nameParts = (name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact = await storage.createContact({
        firstName, lastName, email, phone: mobile || "",
        companyName: businessName, consentSms: consentSms === true,
        status: "Active",
        tags: ["src_website", "support_request", `support_${(issueType || "other").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      const ticket = await storage.createTicket({
        contactId: contact.id,
        subject: `${issueType || "Support"} - ${businessName || firstName}`,
        description: msg || "",
        priority: priority || "Normal",
        category: issueType || "Other",
      });

      res.status(201).json({ success: true, ticketId: ticket.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/get-started", async (req, res) => {
    try {
      const { goal, vertical, monthlyVolume, needTerminal, interestedIn0Percent, firstName, lastName, email, phone, consentSms } = req.body;

      let offerPath = "Not Sure";
      if (goal === "0% interest" || interestedIn0Percent) offerPath = "0% Program";
      else if (goal === "lower fees") offerPath = "Wholesale";
      else if (goal === "need terminal") offerPath = "Terminal Needed";
      else if (goal === "compare vs flat-rate") offerPath = "Compare vs Square/Stripe";

      const contact = await storage.createContact({
        firstName, lastName, email, phone: phone || "",
        vertical, monthlyVolume, primaryOfferPath: offerPath,
        interestedIn0Percent: interestedIn0Percent === true,
        needTerminal: needTerminal === true,
        consentSms: consentSms === true,
        status: "New",
        tags: ["src_website", "lead_quiz", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        offerPath,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Quiz Lead",
        message: `${firstName} ${lastName} - ${vertical}, ${monthlyVolume}, Goal: ${goal}`,
        type: "info",
      });

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

      const run = await storage.createWorkflowRun({
        workflowId: wf.id,
        entityType: req.body.entityType || null,
        entityId: req.body.entityId || null,
        status: "running",
        currentStep: 0,
        log: [{ step: 0, action: "started", timestamp: new Date().toISOString() }],
      });

      const actions = (wf.actions as any[]) || [];
      const logEntries: any[] = [{ step: 0, action: "started", timestamp: new Date().toISOString() }];

      const entityType = req.body.entityType;
      const entityId = req.body.entityId;

      let contactId: number | undefined;
      let dealId: number | undefined;
      if (entityType === "deal" && entityId) {
        dealId = entityId;
        const deal = await storage.getDeal(dealId as number);
        contactId = deal?.contactId || undefined;
      } else if (entityType === "contact" && entityId) {
        contactId = entityId;
      }

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        try {
          if (action.type === "create_task") {
            await storage.createTask({
              title: action.title || `Auto-task from ${wf.name}`,
              assignedTo: action.assignedTo || "Unassigned",
              priority: action.priority || "medium",
              dueDate: action.dueHours ? new Date(Date.now() + action.dueHours * 60 * 60 * 1000) : undefined,
              dealId, contactId,
            });
            logEntries.push({ step: i + 1, action: "create_task", title: action.title, status: "completed", timestamp: new Date().toISOString() });

          } else if (action.type === "send_notification") {
            await storage.createNotification({
              channel: action.channel || "internal",
              title: action.title || `Workflow: ${wf.name}`,
              message: action.message || "Automated workflow notification",
              type: action.notificationType || "info",
              metadata: { workflowId: wf.id, dealId, contactId },
            });
            logEntries.push({ step: i + 1, action: "send_notification", title: action.title, status: "completed", timestamp: new Date().toISOString() });

          } else if (action.type === "create_audit_log") {
            await storage.createAuditLog({
              action: action.logAction || "workflow_action",
              entityType: entityType || "workflow",
              entityId: entityId || run.id,
              details: { workflow: wf.name, step: i + 1 },
            });
            logEntries.push({ step: i + 1, action: "create_audit_log", status: "completed", timestamp: new Date().toISOString() });

          } else if (action.type === "update_deal" && dealId) {
            const updates: any = {};
            if (action.stage) updates.stage = action.stage;
            if (action.notes) updates.notes = action.notes;
            if (action.offerPath) updates.offerPath = action.offerPath;
            if (action.owner) updates.owner = action.owner;
            if (action.nextFollowUp) updates.nextFollowUp = new Date(Date.now() + (action.nextFollowUpHours || 24) * 60 * 60 * 1000);
            await storage.updateDeal(dealId, updates);
            logEntries.push({ step: i + 1, action: "update_deal", updates, status: "completed", timestamp: new Date().toISOString() });

          } else if (action.type === "update_contact_tags" && contactId) {
            const contact = await storage.getContact(contactId);
            if (contact) {
              const currentTags = contact.tags || [];
              const addTags = action.addTags || [];
              const removeTags = action.removeTags || [];
              const newTags = Array.from(new Set([...currentTags, ...addTags])).filter(t => !removeTags.includes(t));
              await storage.updateContact(contactId, { tags: newTags });
            }
            logEntries.push({ step: i + 1, action: "update_contact_tags", status: "completed", timestamp: new Date().toISOString() });

          } else if (action.type === "send_ghl_email" && contactId) {
            if (action.templateId) {
              const result = await sendTemplatedMessage({ templateId: action.templateId, contactId, dealId });
              logEntries.push({ step: i + 1, action: "send_ghl_email", templateId: action.templateId, status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
            } else {
              const result = await sendGhlEmail({ contactId, dealId, subject: action.subject || "Liberty Bancard", body: action.body || "" });
              logEntries.push({ step: i + 1, action: "send_ghl_email", status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
            }

          } else if (action.type === "send_ghl_sms" && contactId) {
            if (action.templateId) {
              const result = await sendTemplatedMessage({ templateId: action.templateId, contactId, dealId });
              logEntries.push({ step: i + 1, action: "send_ghl_sms", templateId: action.templateId, status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
            } else {
              const result = await sendGhlSms({ contactId, dealId, body: action.body || "" });
              logEntries.push({ step: i + 1, action: "send_ghl_sms", status: result.success ? "completed" : "failed", error: result.error, timestamp: new Date().toISOString() });
            }

          } else if (action.type === "send_packet" && contactId) {
            const packets = await storage.getCollateralPackets();
            let matchedPacket = packets.find(p => p.id === action.packetId);
            if (!matchedPacket && dealId) {
              const deal = await storage.getDeal(dealId);
              matchedPacket = packets.find(p => p.offerPath === deal?.offerPath && p.isActive);
            }
            if (matchedPacket) {
              const packetUrl = (matchedPacket.pages || []).map(p => `${process.env.REPLIT_DEV_DOMAIN ? 'https://' + process.env.REPLIT_DEV_DOMAIN : ''}/assets/${p}`).join(", ");
              const result = await sendGhlEmail({
                contactId,
                dealId,
                subject: `Your Custom Pricing Breakdown - ${matchedPacket.name}`,
                body: `<p>Hi {{contact.firstName}},</p><p>Here is your personalized information packet: ${matchedPacket.name}</p><p>View your materials: ${packetUrl}</p><p>Questions? Reply to this email or call us directly.</p><p>Best,<br/>Liberty Bancard</p><p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`,
              });
              logEntries.push({ step: i + 1, action: "send_packet", packetName: matchedPacket.name, status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
            } else {
              logEntries.push({ step: i + 1, action: "send_packet", status: "skipped", reason: "No matching packet found", timestamp: new Date().toISOString() });
            }

          } else if (action.type === "generate_proposal" && contactId && dealId) {
            const deal = await storage.getDeal(dealId);
            const contact = await storage.getContact(contactId);
            if (deal && contact) {
              const proposalBody = `<h2>Statement Analysis & Proposal</h2>
<p>Dear ${contact.firstName},</p>
<p>After reviewing your processing statement, here is what we found:</p>
<ul>
  <li><strong>Current Effective Rate:</strong> ${deal.effectiveRate || "Pending Review"}</li>
  <li><strong>Monthly Volume:</strong> ${deal.totalVolume || "Pending Review"}</li>
  <li><strong>Current Total Fees:</strong> ${deal.totalFees || "Pending Review"}</li>
  <li><strong>Top Cost Drivers:</strong> ${(deal.topCostDrivers || []).join(", ") || "Pending Review"}</li>
  <li><strong>Recommended Path:</strong> ${deal.recommendedPath || deal.offerPath || "Custom Pricing"}</li>
  ${deal.terminalRecommendation ? `<li><strong>Terminal:</strong> ${deal.terminalRecommendation}</li>` : ""}
</ul>
<p><strong>Next Step:</strong> <a href="{{calendarLink}}">Book a 10-minute call</a> to walk through the numbers.</p>
<p>Best,<br/>Liberty Bancard Team</p>
<p style="font-size:11px;color:#999;">Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.</p>`;

              const result = await sendGhlEmail({
                contactId,
                dealId,
                subject: `Your Processing Analysis is Ready - ${contact.companyName || contact.firstName}`,
                body: proposalBody,
              });
              if (deal.stage === "Review In Progress") {
                await storage.updateDeal(dealId, { stage: "Proposal Sent" });
              }
              logEntries.push({ step: i + 1, action: "generate_proposal", status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
            }

          } else if (action.type === "request_review" && contactId) {
            const contact = await storage.getContact(contactId);
            if (contact) {
              const reviewBody = `<p>Hi ${contact.firstName},</p>
<p>We hope your payment processing has been running smoothly since switching to Liberty Bancard!</p>
<p>Would you mind leaving us a quick review? It only takes 30 seconds and helps other business owners find better processing.</p>
<p><a href="${action.reviewUrl || "[REVIEW_URL]"}">Leave a Review</a></p>
<p>Thank you for your business!</p>
<p>Best,<br/>Liberty Bancard Team</p>`;
              const result = await sendGhlEmail({
                contactId,
                dealId,
                subject: "How's your experience with Liberty Bancard?",
                body: reviewBody,
              });
              logEntries.push({ step: i + 1, action: "request_review", status: result.success ? "completed" : "failed", timestamp: new Date().toISOString() });
            }

          } else if (action.type === "wait") {
            const waitMinutes = action.minutes || action.hours * 60 || 60;
            logEntries.push({ step: i + 1, action: "wait", minutes: waitMinutes, status: "scheduled", timestamp: new Date().toISOString() });
            await storage.updateWorkflowRun(run.id, {
              status: "waiting",
              currentStep: i + 1,
              nextRunAt: new Date(Date.now() + waitMinutes * 60 * 1000),
              log: logEntries,
            });
            return res.json({ success: true, runId: run.id, status: "waiting", nextRunAt: new Date(Date.now() + waitMinutes * 60 * 1000), steps: logEntries });
          }
        } catch (stepErr: any) {
          logEntries.push({ step: i + 1, action: action.type, status: "failed", error: stepErr.message, timestamp: new Date().toISOString() });
        }
      }

      await storage.updateWorkflowRun(run.id, {
        status: "completed",
        completedAt: new Date(),
        currentStep: actions.length,
        log: logEntries,
      });

      res.json({ success: true, runId: run.id, steps: logEntries });
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
      const openai = new OpenAI();

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
      const openai = new OpenAI();

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
      const openai = new OpenAI();

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
      const openai = new OpenAI();

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
      const openai = new OpenAI();

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

      const matchingWorkflows = await storage.getWorkflowsByTrigger(event);
      const activeWorkflows = matchingWorkflows.filter(w => w.enabled);

      const runs = [];
      for (const workflow of activeWorkflows) {
        const run = await storage.createWorkflowRun({
          workflowId: workflow.id,
          status: "completed",
          log: { triggeredBy: `webhook:${event}`, event, entityType, entityId, data, actionsExecuted: Array.isArray(workflow.actions) ? workflow.actions.length : 0 },
        });
        runs.push(run);

        await storage.createAuditLog({
          action: "workflow_triggered",
          entityType: entityType || "system",
          entityId: entityId ? Number(entityId) : undefined,
          details: { workflowId: workflow.id, workflowName: workflow.name, event, triggerSource: "webhook" },
        });
      }

      const workflowNames = activeWorkflows.map(w => w.name);
      res.json({ triggered: runs.length, workflows: workflowNames });
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

  return httpServer;
}
