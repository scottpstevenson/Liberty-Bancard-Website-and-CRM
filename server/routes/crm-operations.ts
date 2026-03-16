import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertContactCompanySchema } from "@shared/schema";
import { and } from "drizzle-orm";
import { parse } from "csv-parse/sync";

export function registerCrmOperationsRoutes(app: Express) {
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

}
