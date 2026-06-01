import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertContactCompanySchema } from "@shared/schema";
import { and } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { isGhlConfigured, upsertGhlContact } from "../services/ghl";
import { syncContactToGhl, syncDealToGhl } from "../services/ghl-sync";
import { extractRelationshipsForContact } from "../services/relationship-extractor";

export function registerCrmOperationsRoutes(app: Express) {
  // === CONTACT DETAIL AGGREGATE ===
  app.get("/api/contacts/:id/detail", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await storage.getContact(contactId);
      if (!contact) return res.status(404).json({ message: "Not found" });

      if (!contact.ghlContactId && isGhlConfigured()) {
        syncContactToGhl(contactId).then(result => {
          if (result.success) {
            console.log(`[GHL Read-Touch] Auto-upserted contact ${contactId} to GHL: ${result.ghlContactId}`);
          }
        }).catch((err: Error) => {
          console.warn(`[GHL Read-Touch] Auto-upsert failed for contact ${contactId}:`, err.message);
        });
      }
      
      const [dealsResult, ticketsResult, allTasks, contactNotes] = await Promise.all([
        storage.getDeals({ limit: 500 }),
        storage.getTickets({ limit: 500 }),
        storage.getTasks(),
        storage.getNotes("contact", contactId),
      ]);
      
      const contactDeals = dealsResult.data.filter(d => d.contactId === contactId);
      const contactTickets = ticketsResult.data.filter(t => t.contactId === contactId);
      const contactTasks = allTasks.filter(t => t.contactId === contactId);
      
      res.json({ contact, deals: contactDeals, tickets: contactTickets, tasks: contactTasks, notes: contactNotes });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === EXPORT CSV ===
  app.get("/api/export/contacts", isAuthenticated, async (req, res) => {
    try {
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
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
      const { data: allDeals } = await storage.getDeals({ limit: 500 });
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
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
      const { data: allTickets } = await storage.getTickets({ limit: 500 });
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
    try {
      const result = await storage.getContactCompanies(Number(req.params.id));
      res.json(result);
    } catch (err: any) {
      console.error("Get contact companies error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/companies", isAuthenticated, async (req, res) => {
    try {
      const input = insertContactCompanySchema.parse({
        ...req.body,
        contactId: Number(req.params.id),
      });
      const link = await storage.addContactCompany(input);
      // Re-extract relationships now that company membership is established
      extractRelationshipsForContact(input.contactId!).catch((err) =>
        console.warn("[Relationships] Re-extraction after company link failed:", err),
      );
      res.status(201).json(link);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error("Add contact company error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/contact-companies/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.removeContactCompany(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Remove contact company error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });


  // === ARCHIVE / RESTORE ===
  app.post("/api/contacts/:id/archive", isAuthenticated, async (req, res) => {
    try {
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.archiveContact(Number(req.params.id), auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Archive contact error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/:id/restore", isAuthenticated, async (req, res) => {
    try {
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.restoreContact(Number(req.params.id), auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Restore contact error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/archive", isAuthenticated, async (req, res) => {
    try {
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.archiveDeal(Number(req.params.id), auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Archive deal error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/deals/:id/restore", isAuthenticated, async (req, res) => {
    try {
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.restoreDeal(Number(req.params.id), auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Restore deal error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });


  // === BULK OPERATIONS ===
  app.post("/api/deals/bulk-stage", isAuthenticated, async (req, res) => {
    try {
      const { dealIds, stage } = req.body;
      if (!Array.isArray(dealIds) || !stage) return res.status(400).json({ message: "dealIds array and stage required" });
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      await storage.bulkUpdateDealStage(dealIds, stage, auditCtx);
      if (isGhlConfigured()) {
        for (const dealId of dealIds) {
          syncDealToGhl(dealId).catch((err: Error) => {
            console.warn(`[GHL Bulk Stage] Failed to sync deal ${dealId} to GHL:`, err.message);
          });
        }
      }
      res.json({ success: true, count: dealIds.length });
    } catch (err: any) {
      console.error("Bulk stage update error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks/bulk-assign", isAuthenticated, async (req, res) => {
    try {
      const { taskIds, assignedTo } = req.body;
      if (!Array.isArray(taskIds) || !assignedTo) return res.status(400).json({ message: "taskIds array and assignedTo required" });
      await storage.bulkAssignTasks(taskIds, assignedTo);
      res.json({ success: true, count: taskIds.length });
    } catch (err: any) {
      console.error("Bulk assign tasks error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteTask(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete task error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });


  // === DUPLICATE DETECTION & MERGE ===
  app.get("/api/contacts/duplicates", isAuthenticated, async (req, res) => {
    try {
      const duplicates = await storage.findDuplicateContacts();
      res.json(duplicates);
    } catch (err: any) {
      console.error("Find duplicates error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/contacts/merge", isAuthenticated, async (req, res) => {
    try {
      const { primaryId, duplicateId } = req.body;
      if (!primaryId || !duplicateId) return res.status(400).json({ message: "primaryId and duplicateId required" });
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.mergeContacts(Number(primaryId), Number(duplicateId), auditCtx);
      if (!result) return res.status(404).json({ message: "Contact not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Merge contacts error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

}
