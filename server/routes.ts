import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { z } from "zod";
import { insertContactSchema, insertDealSchema, insertTicketSchema, insertTaskSchema, insertCompanySchema, insertDocumentSchema, insertNotificationSchema } from "@shared/schema";

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

  return httpServer;
}
