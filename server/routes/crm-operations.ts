import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, insertContactCompanySchema } from "@shared/schema";
import { and } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { isGhlConfigured, upsertGhlContact } from "../services/ghl";
import { syncContactToGhl, syncDealToGhl } from "../services/ghl-sync";
import { extractRelationshipsForContact } from "../services/relationship-extractor";
import { propagateContactDeleteToGhl, propagateDealDeleteToGhl, propagateTaskDeleteToGhl } from "../services/ghl-delete-sync";
import { serverError } from "../utils/server-error";
import { advanceDealStage } from "../services/deal-stage-service";
import { GoLiveGateError } from "../services/go-live-gate";

export function registerCrmOperationsRoutes(app: Express) {
  // === CONTACT DETAIL AGGREGATE ===
  app.get("/api/contacts/:id/detail", isDashboardUser, async (req, res) => {
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
      const contactTasks = allTasks.filter((t: any) => t.contactId === contactId);
      
      res.json({ contact, deals: contactDeals, tickets: contactTickets, tasks: contactTasks, notes: contactNotes });
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === EXPORT CSV ===
  app.get("/api/export/contacts", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { data: allContacts } = await storage.getContacts({ limit: 500 });
      const headers = ["ID","First Name","Last Name","Email","Phone","Company","Status","Decision Maker","Email Status","Tags","Created"];
      const rows = allContacts.map(c => [
        c.id, c.firstName, c.lastName, c.email, c.phone, c.companyName || "", c.status || "",
        (c as any).isDecisionMaker === true ? "true" : "false",
        (c as any).emailStatus || "",
        (c.tags || []).join(";"), c.createdAt ? new Date(c.createdAt).toISOString() : ""
      ]);
      const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=contacts.csv");
      res.send(csv);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/export/deals", requireRole("admin", "manager"), async (req, res) => {
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
      serverError(res, err);
    }
  });

  app.get("/api/export/tickets", requireRole("admin", "manager"), async (req, res) => {
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
      serverError(res, err);
    }
  });


  // === CONTACT-COMPANY ASSOCIATIONS ===
  app.get("/api/contacts/:id/companies", isAuthenticated, async (req, res) => {
    try {
      const result = await storage.getContactCompanies(Number(req.params.id));
      res.json(result);
    } catch (err: any) {
      console.error("Get contact companies error:", err.message);
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.delete("/api/contact-companies/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.removeContactCompany(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Remove contact company error:", err.message);
      serverError(res, err);
    }
  });


  // === ARCHIVE / RESTORE ===
  app.post("/api/contacts/:id/archive", isAuthenticated, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.archiveContact(contactId, auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
      propagateContactDeleteToGhl(contactId).catch((err: Error) => {
        console.warn(`[GHL Delete] Failed to propagate contact #${contactId} archive to GHL:`, err.message);
      });
    } catch (err: any) {
      console.error("Archive contact error:", err.message);
      serverError(res, err);
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
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/archive", isAuthenticated, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.archiveDeal(dealId, auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
      propagateDealDeleteToGhl(dealId).catch((err: Error) => {
        console.warn(`[GHL Delete] Failed to propagate deal #${dealId} archive to GHL:`, err.message);
      });
    } catch (err: any) {
      console.error("Archive deal error:", err.message);
      serverError(res, err);
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
      serverError(res, err);
    }
  });


  // === BULK OPERATIONS ===
  app.post("/api/deals/bulk-stage", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { dealIds, stage, overrideReason } = req.body;
      if (!Array.isArray(dealIds) || !stage) return res.status(400).json({ message: "dealIds array and stage required" });

      const actor = req.user as any;
      const actorEmail: string = actor?.email ?? actor?.role ?? "unknown";

      // Build override context for go-live gate if a reason was supplied.
      // Admin/manager role is already enforced by requireRole above.
      const overrideCtx =
        typeof overrideReason === "string" && overrideReason.trim()
          ? { reason: overrideReason.trim(), actor: actorEmail }
          : undefined;

      let advanced = 0;
      let blocked = 0;
      const blockedDealIds: number[] = [];

      for (const rawId of dealIds) {
        const dealId = Number(rawId);
        try {
          const result = await advanceDealStage(dealId, stage, "bulk_stage", overrideCtx);
          if (result) advanced++;
        } catch (err) {
          if (err instanceof GoLiveGateError) {
            blocked++;
            blockedDealIds.push(dealId);
            // GoLiveGateError already wrote an audit log inside advanceDealStage
          } else {
            throw err; // unexpected errors bubble up
          }
        }
      }

      res.json({ success: true, advanced, blocked, blockedDealIds });
    } catch (err: any) {
      console.error("Bulk stage update error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/tasks/bulk-assign", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { taskIds, assignedTo } = req.body;
      if (!Array.isArray(taskIds) || !assignedTo) return res.status(400).json({ message: "taskIds array and assignedTo required" });
      await storage.bulkAssignTasks(taskIds, assignedTo);
      res.json({ success: true, count: taskIds.length });
    } catch (err: any) {
      console.error("Bulk assign tasks error:", err.message);
      serverError(res, err);
    }
  });

  app.delete("/api/tasks/:id", isAuthenticated, async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const allTasks = await storage.getTasks({ limit: 5000 });
      const task = allTasks.find((t: any) => t.id === taskId);
      const actor = req.user as any;
      const isAdminOrManager = actor?.role === "admin" || actor?.role === "manager";
      if (task && !isAdminOrManager && task.assignedTo !== actor?.id && task.assignedTo !== actor?.username) {
        return res.status(403).json({ message: "You can only delete tasks assigned to you." });
      }
      let ghlTaskId: string | null = null;
      let ghlContactId: string | null = null;
      if (task?.ghlTaskId && task.contactId) {
        const contact = await storage.getContact(task.contactId);
        ghlTaskId = task.ghlTaskId;
        ghlContactId = contact?.ghlContactId || null;
      }
      await storage.softDeleteTask(taskId);
      res.json({ success: true });
      propagateTaskDeleteToGhl(taskId, ghlTaskId, ghlContactId).catch((err: Error) => {
        console.warn(`[GHL Delete] Failed to propagate task #${taskId} delete to GHL:`, err.message);
      });
    } catch (err: any) {
      console.error("Delete task error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/tasks/bulk-delete", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { taskIds } = req.body;
      if (!Array.isArray(taskIds)) return res.status(400).json({ message: "taskIds must be an array" });
      if (taskIds.length === 0) {
        return res.json({ deleted: 0 });
      }
      if (taskIds.length > 2000) return res.status(400).json({ message: "Cannot delete more than 2,000 tasks at once" });
      const invalid = taskIds.filter(id => !Number.isInteger(id) || id <= 0);
      if (invalid.length > 0) return res.status(400).json({ message: "All taskIds must be positive integers" });

      const submittedCount = taskIds.length;
      const uniqueIds: number[] = [...new Set(taskIds as number[])];
      const uniqueCount = uniqueIds.length;
      const actualDeleted = await storage.bulkSoftDeleteTasks(uniqueIds);

      const actor = (req.user as any);
      await storage.createAuditLog({
        action: "bulk_soft_delete_tasks",
        entityType: "task",
        userId: actor?.id ?? null,
        details: {
          actor: actor?.email ?? actor?.username ?? "unknown",
          submitted: submittedCount,
          unique: uniqueCount,
          deleted: actualDeleted,
          alreadyDeletedOrMissing: uniqueCount - actualDeleted,
          timestamp: new Date().toISOString(),
        },
      });

      res.json({ deleted: actualDeleted });
    } catch (err: any) {
      console.error("Bulk delete tasks error:", err.message);
      serverError(res, err);
    }
  });


  // === DUPLICATE DETECTION & MERGE ===
  app.get("/api/contacts/duplicates", isAuthenticated, async (req, res) => {
    try {
      const duplicates = await storage.findDuplicateContacts();
      res.json(duplicates);
    } catch (err: any) {
      console.error("Find duplicates error:", err.message);
      serverError(res, err);
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
      serverError(res, err);
    }
  });

}
