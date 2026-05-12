import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { enrollInGhlWorkflow } from "../services/ghl-workflows";
import { REVIEW_CHECKLIST_ITEMS } from "@shared/schema";

export function registerReviewQueueRoutes(app: Express) {
  app.get("/api/review-queue/checklist-items", isDashboardUser, requireRole("admin", "manager"), (_req, res) => {
    res.json(REVIEW_CHECKLIST_ITEMS);
  });

  app.get("/api/review-queue/pending-count", isDashboardUser, requireRole("admin", "manager"), async (_req, res) => {
    try {
      const agg = await storage.getReviewQueueAggregates();
      res.json({ count: agg.pending, pending: agg.pending, approved: agg.approved, total: agg.total });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/review-queue", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const items = await storage.getReviewQueue(status);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/review-queue/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const item = await storage.getReviewQueueItem(Number(req.params.id));
      if (!item) return res.status(404).json({ message: "Not found" });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/review-queue/:id/checklist", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const existing = await storage.getReviewQueueItem(Number(req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (existing.status === "approved") {
        return res.status(400).json({ message: "Cannot modify checklist on an already-approved item" });
      }
      const schema = z.object({
        checklistState: z.record(z.boolean()),
      });
      const { checklistState } = schema.parse(req.body);
      const updated = await storage.updateReviewQueueItem(Number(req.params.id), { checklistState });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/review-queue/:id/approve", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const item = await storage.getReviewQueueItem(Number(req.params.id));
      if (!item) return res.status(404).json({ message: "Not found" });
      if (item.status === "approved") return res.status(400).json({ message: "Already approved" });

      const totalItems = REVIEW_CHECKLIST_ITEMS.length;
      const checkedItems = REVIEW_CHECKLIST_ITEMS.filter(
        (ci) => (item.checklistState as Record<string, boolean>)?.[ci.key] === true
      ).length;
      if (checkedItems < totalItems) {
        return res.status(400).json({
          message: `All checklist items must be completed before approving. (${checkedItems}/${totalItems} done)`,
        });
      }

      const user = req.user as any;
      const schema = z.object({ ghlWorkflowId: z.string().optional() });
      const { ghlWorkflowId } = schema.parse(req.body);

      const updated = await storage.updateReviewQueueItem(Number(req.params.id), {
        status: "approved",
        approvedBy: user?.id ? String(user.id) : "unknown",
        approvedAt: new Date(),
        ghlWorkflowId: ghlWorkflowId || undefined,
      });

      await storage.createAuditLog({
        userId: user?.id ? String(user.id) : undefined,
        action: "review_queue_approved",
        entityType: "review_queue",
        entityId: item.id,
        details: {
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          approvedBy: user?.email || user?.id,
          ghlWorkflowId: ghlWorkflowId || null,
        },
      });

      if (ghlWorkflowId) {
        const meta = item.metadata as Record<string, any> | null;
        let ghlContactId = meta?.ghlContactId;
        if (!ghlContactId && meta?.contactId) {
          const contact = await storage.getContact(Number(meta.contactId)).catch(() => undefined);
          ghlContactId = contact?.ghlContactId || undefined;
        }
        if (ghlContactId) {
          enrollInGhlWorkflow({
            workflowKey: ghlWorkflowId,
            ghlContactId,
            metadata: { reviewQueueId: item.id, sourceType: item.sourceType },
          }).catch((err) => console.error("[ReviewQueue] GHL enrollment failed:", err.message));
        } else {
          console.warn(`[ReviewQueue] GHL workflow ${ghlWorkflowId} requested on approval #${item.id} but no ghlContactId found — skipping enrollment`);
        }
      }

      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });
}
