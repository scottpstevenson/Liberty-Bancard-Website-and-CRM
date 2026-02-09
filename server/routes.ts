import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { z } from "zod";
import { insertContactSchema, insertDealSchema, insertTicketSchema, insertTaskSchema, insertCompanySchema, insertDocumentSchema, insertNotificationSchema, insertWorkflowSchema, insertRfiSchema, insertMessageTemplateSchema, insertCollateralPacketSchema, insertSlaConfigSchema } from "@shared/schema";
import { isGhlConfigured, getGhlStatus, sendGhlEmail, sendGhlSms, sendTemplatedMessage, upsertGhlContact, handleGhlWebhook, getCalendarBookingUrl } from "./services/ghl";

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
  app.post("/api/ai/chat", async (req, res) => {
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

  return httpServer;
}
