import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertRfiSchema, insertWorkflowSchema } from "@shared/schema";
import { executeWorkflowActions, triggerWorkflowsByEvent } from "../services/workflow-executor";
import { parse } from "csv-parse/sync";
import { requireInternalWebhookSecret } from "../middleware/internal-webhook-auth";
import { serverError } from "../utils/server-error";

export function registerWorkflowsRoutes(app: Express) {
  // === RFIs ===
  app.get("/api/rfis", isAuthenticated, async (req, res) => {
    try {
      const allRfis = await storage.getRfis();
      res.json(allRfis);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/rfis/:id", isAuthenticated, async (req, res) => {
    try {
      const rfi = await storage.getRfi(Number(req.params.id));
      if (!rfi) return res.status(404).json({ message: "Not found" });
      res.json(rfi);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/rfis", isAuthenticated, async (req, res) => {
    try {
      const input = insertRfiSchema.parse(req.body);
      const rfi = await storage.createRfi(input);
      await storage.createAuditLog({ action: "rfi_created", entityType: "rfi", entityId: rfi.id, details: { subject: rfi.subject, category: rfi.category } });
      await storage.createNotification({
        channel: "internal",
        title: `New RFI: ${rfi.subject}`,
        message: `Priority: ${rfi.priority} | Category: ${rfi.category} | Assigned to: ${rfi.assignedTo || "Unassigned"}`,
        type: rfi.priority === "Urgent" ? "urgent" : "info",
        metadata: { rfiId: rfi.id, contactId: rfi.contactId || undefined, dealId: rfi.dealId || undefined, entityType: "rfi", entityId: rfi.id },
      });
      (async () => {
        let contactName: string | undefined;
        let email: string | undefined;
        let phone: string | undefined;
        let ghlContactId: string | undefined;
        if (rfi.contactId) {
          const contact = await storage.getContact(rfi.contactId).catch(() => undefined);
          if (contact) {
            contactName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || contact.email || undefined;
            email = contact.email || undefined;
            phone = contact.phone || undefined;
            ghlContactId = contact.ghlContactId || undefined;
          }
        }
        await storage.createReviewQueueItem({
          sourceType: "rfi",
          sourceId: rfi.id,
          status: "pending",
          checklistState: {},
          metadata: {
            subject: rfi.subject,
            category: rfi.category,
            priority: rfi.priority,
            description: rfi.description,
            requestedBy: rfi.requestedBy,
            assignedTo: rfi.assignedTo,
            source: "rfi",
            contactId: rfi.contactId || undefined,
            dealId: rfi.dealId || undefined,
            contactName,
            email,
            phone,
            ghlContactId,
          },
        });
      })().catch((err: any) => console.error("[ReviewQueue] RFI enqueue failed:", err.message));
      res.status(201).json(rfi);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/rfis/:id", isAuthenticated, async (req, res) => {
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
          metadata: { rfiId: updated.id, contactId: updated.contactId || undefined, dealId: updated.dealId || undefined, entityType: "rfi", entityId: updated.id },
        });
      }
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });


  // === WORKFLOWS ===
  app.get("/api/workflows", isAuthenticated, async (req, res) => {
    try {
      const wfs = await storage.getWorkflows();
      res.json(wfs);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/workflows/:id", isAuthenticated, async (req, res) => {
    try {
      const wf = await storage.getWorkflow(Number(req.params.id));
      if (!wf) return res.status(404).json({ message: "Not found" });
      res.json(wf);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/workflows", isAuthenticated, async (req, res) => {
    try {
      const input = insertWorkflowSchema.parse(req.body);
      const wf = await storage.createWorkflow(input);
      await storage.createAuditLog({ action: "workflow_created", entityType: "workflow", entityId: wf.id, details: { name: wf.name, trigger: wf.triggerType } });
      res.status(201).json(wf);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/workflows/:id", isAuthenticated, async (req, res) => {
    try {
      const allowed = insertWorkflowSchema.partial().parse(req.body);
      const updated = await storage.updateWorkflow(Number(req.params.id), allowed);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.delete("/api/workflows/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteWorkflow(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/workflow-runs", isAuthenticated, async (req, res) => {
    try {
      const workflowId = req.query.workflowId ? Number(req.query.workflowId) : undefined;
      const runs = workflowId
        ? await storage.getWorkflowRunsByWorkflow(workflowId)
        : await storage.getWorkflowRuns();
      res.json(runs);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/workflows/:id/run", isAuthenticated, async (req, res) => {
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
      serverError(res, err);
    }
  });


  // === WORKFLOW TRIGGER EXECUTION ===
  // #225 — Rate-limit: max 60 trigger calls per minute per secret (shared bucket)
  const _webhookTriggerWindow: { count: number; resetAt: number } = { count: 0, resetAt: Date.now() + 60_000 };
  function checkWebhookTriggerRateLimit(): boolean {
    const now = Date.now();
    if (now > _webhookTriggerWindow.resetAt) { _webhookTriggerWindow.count = 0; _webhookTriggerWindow.resetAt = now + 60_000; }
    _webhookTriggerWindow.count++;
    return _webhookTriggerWindow.count <= 60;
  }

  app.post("/api/webhooks/trigger", requireInternalWebhookSecret, async (req, res) => {
    if (!checkWebhookTriggerRateLimit()) {
      return res.status(429).json({ message: "Rate limit exceeded: max 60 webhook triggers per minute" });
    }
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
      serverError(res, err);
    }
  });

}
