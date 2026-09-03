import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { contacts, contactCompanies, insertContactCompanySchema } from "@shared/schema";
import { and } from "drizzle-orm";
import { parse } from "csv-parse/sync";
import { isGhlConfigured, upsertGhlContact } from "../services/ghl";
import { syncContactToGhl, syncDealToGhl } from "../services/ghl-sync";
import { extractRelationshipsForContact } from "../services/relationship-extractor";
import { propagateDealDeleteToGhl, propagateTaskDeleteToGhl } from "../services/ghl-delete-sync";
import { serverError } from "../utils/server-error";
import { advanceDealStage } from "../services/deal-stage-service";
import { GoLiveGateError } from "../services/go-live-gate";
import { authorizeContactAccess } from "../services/crm-object-access";
import { db } from "../db";
import { tickets, tasks } from "@shared/schema";
import { eq } from "drizzle-orm";

export function registerCrmOperationsRoutes(app: Express) {
  // === CONTACT DETAIL AGGREGATE ===
  app.get("/api/contacts/:id/detail", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const contact = await authorizeContactAccess(req, res, contactId);
      if (!contact) return;

      const [rawDeals, contactTickets, contactTasks, contactNotes] = await Promise.all([
        storage.getDealsByContact(contactId),
        db.select().from(tickets).where(eq(tickets.contactId, contactId)),
        db.select().from(tasks).where(eq(tasks.contactId, contactId)),
        storage.getNotes("contact", contactId),
      ]);

      // REV-05A: mask raw MID from deal objects before returning to the client.
      // Full MIDs are available only via dedicated receipted endpoints.
      const { serializeDeal } = await import("../utils/mask-mid");
      const contactDeals = rawDeals.map((d: any) => serializeDeal(d));

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
  app.get("/api/contacts/:id/companies", isDashboardUser, async (req, res) => {
    try {
      const result = await storage.getContactCompanies(Number(req.params.id));
      res.json(result);
    } catch (err: any) {
      console.error("Get contact companies error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/companies", isDashboardUser, async (req, res) => {
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

  app.delete("/api/contact-companies/:id", isDashboardUser, async (req, res) => {
    try {
      const associationId = Number(req.params.id);
      const [association] = await db.select().from(contactCompanies).where(eq(contactCompanies.id, associationId));
      if (!association?.contactId || !await authorizeContactAccess(req, res, association.contactId)) return;
      await storage.removeContactCompany(associationId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Remove contact company error:", err.message);
      serverError(res, err);
    }
  });


  // === ARCHIVE / RESTORE ===
  app.post("/api/contacts/:id/archive", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const result = await storage.archiveContact(contactId, auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Archive contact error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/restore", requireRole("admin", "manager"), async (req, res) => {
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

  app.post("/api/deals/:id/archive", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.id);
      const auditCtx = { actorType: "user" as const, userId: (req.user as any)?.id ?? null };
      const existingDeal = await storage.getDeal(dealId);
      if (!existingDeal) return res.status(404).json({ message: "Not found" });
      // C-02 (#1626): propagate the GHL delete BEFORE archiving locally, and
      // leave local state unchanged when propagation is pause-blocked or fails.
      const ghlResult = await propagateDealDeleteToGhl(dealId);
      if (!ghlResult.ok) {
        const status = ghlResult.reason === "paused" ? 503 : 409;
        return res.status(status).json({
          message: `GHL delete did not complete (${ghlResult.reason}). Deal was NOT archived locally — retry archive to re-attempt.`,
          localArchived: false,
          ghlPropagated: false,
          reason: ghlResult.reason,
        });
      }
      const result = await storage.archiveDeal(dealId, auditCtx);
      if (!result) return res.status(404).json({ message: "Not found" });
      res.json(result);
    } catch (err: any) {
      console.error("Archive deal error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/deals/:id/restore", isDashboardUser, async (req, res) => {
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

  app.delete("/api/tasks/:id", isDashboardUser, async (req, res) => {
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
      // C-02 (#1626): propagate to GHL BEFORE the local soft-delete, and only
      // soft-delete locally once propagation succeeds (or is not needed).
      // Rationale: soft-deleted tasks are excluded from getTasks(), so a
      // retry after a local-first delete would lose the GHL task/contact IDs
      // and silently skip propagation, leaving the external task undeleted.
      const ghlResult = await propagateTaskDeleteToGhl(taskId, ghlTaskId, ghlContactId);
      if (!ghlResult.ok) {
        const status = ghlResult.reason === "paused" ? 503 : 409;
        return res.status(status).json({
          message: `GHL delete did not complete (${ghlResult.reason}). Task was NOT deleted locally — retry delete to re-attempt.`,
          localDeleted: false,
          ghlPropagated: false,
          reason: ghlResult.reason,
        });
      }
      await storage.softDeleteTask(taskId);
      res.json({ success: true });
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


  // === LEGACY DUPLICATE DETECTION & MERGE (BT-07 containment) ==============
  // The unsafe storage.mergeContacts helper is deliberately unavailable to
  // every role. Reviewed candidates and execution are registered in
  // routes/contacts.ts under their own authorization boundary.
  app.get("/api/contacts/duplicates", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    return res.status(410).json({
      code: "LEGACY_CONTACT_MERGE_DISABLED",
      message: "Legacy duplicate discovery is disabled. Use reviewed identity candidates.",
    });
  });

  app.post("/api/contacts/merge", isDashboardUser, requireRole("admin"), async (req, res) => {
    await storage.createAuditLog({
      action: "legacy_contact_merge_blocked",
      entityType: "contact_merge",
      actorType: "user",
      actorId: (req.user as any)?.id ?? null,
      details: { reason: "LEGACY_CONTACT_MERGE_DISABLED" },
    }).catch(() => {});
    return res.status(410).json({
      code: "LEGACY_CONTACT_MERGE_DISABLED",
      message: "Legacy merge execution is permanently disabled. Use the reviewed merge operation API.",
    });
  });

}
