import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertChargebackSchema, CHARGEBACK_DEADLINE_DAYS } from "@shared/schema";
import { createPreferenceAwareNotification } from "../services/digest-service";
import { generateChargebackEvidencePdf } from "../services/chargeback-pdf";
import { serverError } from "../utils/server-error";
import { getDefaultProcessor } from "../services/processors/registry";

export function registerChargebacksRoutes(app: Express) {
  app.get("/api/chargebacks", isDashboardUser, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
      const cardBrand = req.query.cardBrand as string | undefined;
      const overdueOnly = req.query.overdueOnly === "true";
      const chargebackList = await storage.getChargebacks({ status, contactId, cardBrand, overdueOnly: overdueOnly || undefined });
      res.json(chargebackList);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/stats", isDashboardUser, async (req, res) => {
    try {
      const stats = await storage.getChargebackStats();
      res.json(stats);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/overdue", isDashboardUser, async (req, res) => {
    try {
      const overdue = await storage.getOverdueChargebacks();
      res.json(overdue);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/contact/:contactId", isDashboardUser, async (req, res) => {
    try {
      const list = await storage.getChargebacksByContact(Number(req.params.contactId));
      res.json(list);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/deal/:dealId", isDashboardUser, async (req, res) => {
    try {
      const list = await storage.getChargebacksByDeal(Number(req.params.dealId));
      res.json(list);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/:id", isDashboardUser, async (req, res) => {
    try {
      const cb = await storage.getChargeback(Number(req.params.id));
      if (!cb) return res.status(404).json({ message: "Not found" });
      res.json(cb);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/chargebacks", isDashboardUser, async (req, res) => {
    try {
      const body = { ...req.body };

      if (body.transactionDate && typeof body.transactionDate === "string") {
        body.transactionDate = new Date(body.transactionDate);
      }

      if (!body.responseDeadline && body.cardBrand && body.transactionDate) {
        const deadlineDays = CHARGEBACK_DEADLINE_DAYS[body.cardBrand] ?? 30;
        const txDate = new Date(body.transactionDate);
        const deadline = new Date(txDate);
        deadline.setDate(deadline.getDate() + deadlineDays);
        body.responseDeadline = deadline;
      } else if (body.responseDeadline && typeof body.responseDeadline === "string") {
        body.responseDeadline = new Date(body.responseDeadline);
      }

      const input = insertChargebackSchema.parse(body);
      const cb = await storage.createChargeback(input);

      await storage.createAuditLog({
        action: "chargeback_created",
        entityType: "chargeback",
        entityId: cb.id,
        details: { amount: cb.amount, cardBrand: cb.cardBrand, reasonCode: cb.reasonCode, contactId: cb.contactId },
      });

      await createPreferenceAwareNotification({
        channel: "internal",
        title: "New Chargeback Logged",
        message: `Chargeback #${cb.id} — $${cb.amount.toFixed(2)} (${cb.cardBrand}) logged. Deadline: ${cb.responseDeadline ? new Date(cb.responseDeadline).toLocaleDateString() : "N/A"}.`,
        type: "info",
        metadata: { chargebackId: cb.id, eventType: "chargeback_created" },
      }, "chargeback_created").catch(() => {});

      res.status(201).json(cb);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/chargebacks/:id", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const body = { ...req.body };

      if (body.transactionDate && typeof body.transactionDate === "string") {
        body.transactionDate = new Date(body.transactionDate);
      }
      if (body.responseDeadline && typeof body.responseDeadline === "string") {
        body.responseDeadline = new Date(body.responseDeadline);
      }
      if (body.respondedAt && typeof body.respondedAt === "string") {
        body.respondedAt = new Date(body.respondedAt);
      }

      if (body.status === "Responded" && !body.respondedAt) {
        body.respondedAt = new Date();
      }

      const updated = await storage.updateChargeback(id, body);
      if (!updated) return res.status(404).json({ message: "Not found" });

      await storage.createAuditLog({
        action: "chargeback_updated",
        entityType: "chargeback",
        entityId: updated.id,
        details: { status: updated.status, outcome: updated.outcome },
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/chargebacks/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getChargeback(id);
      if (!existing) return res.status(404).json({ message: "Chargeback not found" });
      await storage.deleteChargeback(id);
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/:id/pdf", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cb = await storage.getChargeback(id);
      if (!cb) return res.status(404).json({ message: "Not found" });
      if (!cb.aiEvidencePacket) {
        return res.status(400).json({ message: "No evidence packet has been generated for this chargeback yet. Build the evidence packet first." });
      }

      const [contact, deal] = await Promise.all([
        cb.contactId ? storage.getContact(cb.contactId) : null,
        cb.dealId ? storage.getDeal(cb.dealId) : null,
      ]);

      const pdfBuffer = await generateChargebackEvidencePdf({
        chargeback: cb,
        contact: contact
          ? { companyName: contact.companyName, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone }
          : null,
        deal: deal ? { id: deal.id, stage: deal.stage, pipeline: deal.pipeline, owner: deal.owner } : null,
      });

      await storage.createAuditLog({
        action: "chargeback_pdf_downloaded",
        entityType: "chargeback",
        entityId: cb.id,
        details: { chargebackId: cb.id },
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="chargeback-evidence-${cb.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("[Chargebacks] PDF generation error:", err.message);
      res.status(500).json({ message: "Failed to generate PDF" });
    }
  });

  app.post("/api/chargebacks/:id/evidence", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cb = await storage.getChargeback(id);
      if (!cb) return res.status(404).json({ message: "Not found" });

      const schema = z.object({
        name: z.string().min(1),
        url: z.string().min(1),
      });
      const { name, url } = schema.parse(req.body);
      const existing = (cb.evidenceFiles as any[]) || [];
      const updated = await storage.updateChargeback(id, {
        evidenceFiles: [...existing, { name, url, uploadedAt: new Date().toISOString() }],
      });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(400).json({ message: err.message });
    }
  });

  /**
   * POST /api/chargebacks/:id/submit-to-card-brand
   * Submit a chargeback evidence packet to the card brand via the processor adapter.
   * Marks the chargeback as "Responded" on success and writes an audit log entry.
   */
  app.post("/api/chargebacks/:id/submit-to-card-brand", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cb = await storage.getChargeback(id);
      if (!cb) return res.status(404).json({ message: "Chargeback not found" });

      const schema = z.object({
        mid:          z.string().min(1, "MID is required"),
        caseNumber:   z.string().optional(),
        transactionId: z.string().optional(),
        evidenceNotes: z.string().optional(),
      });
      const { mid, caseNumber, transactionId, evidenceNotes } = schema.parse(req.body);

      const processor = getDefaultProcessor();
      const result = await processor.submitChargeback({
        mid,
        transactionId: transactionId || String(cb.id),
        amount: cb.amount,
        reason: cb.reasonDescription || cb.reasonCode,
        cardBrand: cb.cardBrand,
        caseNumber,
        responseDeadline: cb.responseDeadline?.toISOString(),
        evidenceNotes,
      });

      if (result.success) {
        const caseNote = result.caseId ? ` · Case ID: ${result.caseId}` : "";
        const updated = await storage.updateChargeback(id, {
          status: "Responded",
          respondedAt: new Date(),
          notes: [cb.notes, `Evidence submitted to card brand${caseNote}.`]
            .filter(Boolean)
            .join("\n\n"),
        });

        await storage.createAuditLog({
          action: "chargeback_submitted_to_card_brand",
          entityType: "chargeback",
          entityId: id,
          details: {
            caseId: result.caseId,
            status: result.status,
            message: result.message,
            mid,
            cardBrand: cb.cardBrand,
            amount: cb.amount,
          },
        });

        res.json({
          success: true,
          caseId: result.caseId,
          status: result.status,
          message: result.message || "Evidence packet submitted successfully.",
          chargeback: updated,
        });
      } else {
        res.status(502).json({
          message: result.error || "Submission failed — check processor connection and MID.",
        });
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  /**
   * GET /api/admin/ghl-deferred-queue
   * Admin visibility into pending and recently-failed deferred GHL workflow enrollments.
   * Supports #1010 — catch deferred enrollments before they're permanently lost.
   */
  app.get("/api/admin/ghl-deferred-queue", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { getDeferredEnrollmentQueue } = await import("../services/ghl-enrollment-recovery");
      const queue = await getDeferredEnrollmentQueue();
      res.json(queue);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
