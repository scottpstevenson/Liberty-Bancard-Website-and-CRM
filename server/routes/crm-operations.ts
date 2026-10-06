import type { Express } from "express";
import { strictRecordId, workCommandEnvelope, workSelection } from "@shared/work-item-commands";
import { commandWorkItems, WorkCommandError, bindWorkActor } from "../services/work-item-command";
import {contactLifecycleFields,commandContactLifecycle} from "../services/contact-lifecycle-command";
import {readContactCompanies,linkCompany,unlinkCompany} from "../services/company-authority";
import { deleteTaskCommand, type NativeTaskDeleteTransport } from "../services/task-deletion-command";
import { registerWorkBulkRoutes } from "./work-bulk-commands";
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

export function registerCrmOperationsRoutes(app: Express, deps: { nativeTaskDeleteTransport?: NativeTaskDeleteTransport;
  relationshipExtractor?:(contactId:number)=>Promise<unknown> } = {}) {
  app.post("/api/contacts/bulk-archive",requireRole("admin","manager"),async(req,res)=>{
    try {
      const fields=contactLifecycleFields.parse(req.body);
      res.json(await commandContactLifecycle(bindWorkActor(req.user,fields.expectedActorId,fields.expectedAccountVersion),"archive",fields));
    } catch(error) {
      if(error instanceof z.ZodError) return res.status(400).json({message:error.errors[0].message});
      if(error instanceof WorkCommandError) return res.status(error.status).json({message:error.message});
      serverError(res,error);
    }
  });
  registerWorkBulkRoutes(app);
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
      const result = await readContactCompanies(bindWorkActor(req.user),strictRecordId.parse(req.params.id));
      res.json(result);
    } catch (err: any) {
      if(err instanceof z.ZodError) return res.status(400).json({message:"Invalid contact ID"});
      if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      console.error("Get contact companies error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/companies", isDashboardUser, async (req, res) => {
    try {
      const input=z.object({companyId:z.number().int().positive().max(2147483647),
        role:z.string().trim().min(1).max(100).default("Owner"),isPrimary:z.boolean().default(false)}).strict().parse(req.body);
      const contactId=strictRecordId.parse(req.params.id);
      const result=await linkCompany(bindWorkActor(req.user),{...input,contactId});
      // Human membership is accepted locally. Heuristic reconciliation is a
      // separate outcome and never grants an agent access to foreign members.
      let extractionState="management_review_required";
      if(["admin","manager"].includes((req.user as any).role)) {
        try {await (deps.relationshipExtractor ?? extractRelationshipsForContact)(contactId);extractionState="completed";}
        catch {extractionState="failed";}
      }
      res.status(result.changed?201:200).json({...result.link,changed:result.changed,replayed:result.replayed,extractionState});
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      console.error("Add contact company error:", err.message);
      serverError(res, err);
    }
  });

  app.delete("/api/contact-companies/:id", isDashboardUser, async (req, res) => {
    try {
      res.json({success:true,...await unlinkCompany(bindWorkActor(req.user),strictRecordId.parse(req.params.id))});
    } catch (err: any) {
      if(err instanceof z.ZodError) return res.status(400).json({message:"Invalid association ID"});
      if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      console.error("Remove contact company error:", err.message);
      serverError(res, err);
    }
  });


  // === ARCHIVE / RESTORE ===
  app.post("/api/contacts/:id/archive", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId=strictRecordId.parse(req.params.id),fields=contactLifecycleFields.parse(req.body);
      if(fields.items.length!==1 || fields.items[0].id!==contactId) return res.status(400).json({message:"Path and selected contact must match"});
      const result=await commandContactLifecycle(bindWorkActor(req.user,fields.expectedActorId,fields.expectedAccountVersion),"archive",fields);
      res.json({...result.contacts[0],lifecycleChanged:result.changed>0,replayed:result.replayed});
    } catch (err: any) {
      if(err instanceof z.ZodError) return res.status(400).json({message:err.errors[0].message});
      if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
      console.error("Archive contact error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/contacts/:id/restore", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId=strictRecordId.parse(req.params.id),fields=contactLifecycleFields.parse(req.body);
      if(fields.items.length!==1 || fields.items[0].id!==contactId) return res.status(400).json({message:"Path and selected contact must match"});
      const result=await commandContactLifecycle(bindWorkActor(req.user,fields.expectedActorId,fields.expectedAccountVersion),"restore",fields);
      res.json({...result.contacts[0],lifecycleChanged:result.changed>0,replayed:result.replayed});
    } catch (err: any) {
      if(err instanceof z.ZodError) return res.status(400).json({message:err.errors[0].message});
      if(err instanceof WorkCommandError) return res.status(err.status).json({message:err.message});
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
      const body = workCommandEnvelope.omit({ expectedFence: true }).extend({
        items: workSelection, assignedTo: z.string().min(1).max(190),
      }).strict().parse(req.body);
      const user = req.user as any;
      const command = await commandWorkItems({ kind: "task", items: body.items, commandId: body.commandId,
        recordClass: body.recordClass, actor: bindWorkActor(user, body.expectedActorId,body.expectedAccountVersion), updates: { assignedTo: body.assignedTo } });
      res.json({ success: true, count: command.changed, replayed: command.replayed });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({ message: err.message });
      console.error("Bulk assign tasks error:", err.message);
      serverError(res, err);
    }
  });

  app.delete("/api/tasks/:id", isDashboardUser, async (req, res) => {
    try {
      const id = strictRecordId.parse(req.params.id);
      const body = workCommandEnvelope.strict().parse(req.body);
      const user = req.user as any;
      res.json(await deleteTaskCommand({ id, ...body, actor: bindWorkActor(user, body.expectedActorId,body.expectedAccountVersion) }, deps.nativeTaskDeleteTransport));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({ message: err.message, localDeleted: false });
      console.error("Delete task error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/tasks/bulk-delete", requireRole("admin", "manager"), async (req, res) => {
    try {
      const body = workCommandEnvelope.omit({ expectedFence: true }).extend({ items: workSelection }).strict().parse(req.body);
      const user = req.user as any;
      const command = await commandWorkItems({ kind: "task", items: body.items, commandId: body.commandId,
        recordClass: body.recordClass, actor: bindWorkActor(user, body.expectedActorId,body.expectedAccountVersion), operation: "soft_delete", updates: {} });
      res.json({ deleted: command.changed, replayed: command.replayed });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      if (err instanceof WorkCommandError) return res.status(err.status).json({ message: err.message });
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
