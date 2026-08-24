import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertChargebackSchema, CHARGEBACK_DEADLINE_DAYS } from "@shared/schema";
import { createPreferenceAwareNotification } from "../services/digest-service";
import { generateChargebackEvidencePdf } from "../services/chargeback-pdf";
import { serverError } from "../utils/server-error";
import { getDefaultProcessor } from "../services/processors/registry";
import { upload } from "./helpers";
import path from "path";
import fs from "fs";
import { authorizeContactAccess, authorizeDealAccess } from "../services/crm-object-access";

const ALLOWED_EVIDENCE_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "text/csv",
  "application/vnd.ms-excel",
]);
const MAX_EVIDENCE_FILES = 5;

async function authorizeChargebackTarget(req: any, res: any, chargeback: any) {
  if (!chargeback) return false;
  if (chargeback.contactId && !await authorizeContactAccess(req, res, chargeback.contactId)) return false;
  if (chargeback.dealId && !await authorizeDealAccess(req, res, chargeback.dealId)) return false;
  return true;
}

export function registerChargebacksRoutes(app: Express) {
  app.get("/api/chargebacks", isDashboardUser, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const contactId = req.query.contactId ? Number(req.query.contactId) : undefined;
      if (contactId && !await authorizeContactAccess(req, res, contactId)) return;
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
      const contactId = Number(req.params.contactId);
      if (!await authorizeContactAccess(req, res, contactId)) return;
      const list = await storage.getChargebacksByContact(contactId);
      res.json(list);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/deal/:dealId", isDashboardUser, async (req, res) => {
    try {
      const dealId = Number(req.params.dealId);
      if (!await authorizeDealAccess(req, res, dealId)) return;
      const list = await storage.getChargebacksByDeal(dealId);
      res.json(list);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/chargebacks/:id", isDashboardUser, async (req, res) => {
    try {
      const cb = await storage.getChargeback(Number(req.params.id));
      if (!cb) return res.status(404).json({ message: "Not found" });
      if (!await authorizeChargebackTarget(req, res, cb)) return;
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
      if (input.contactId && !await authorizeContactAccess(req, res, input.contactId)) return;
      if (input.dealId && !await authorizeDealAccess(req, res, input.dealId)) return;
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

  // Strict schema prevents evidenceFiles/aiEvidencePacket injection via generic update
  const patchChargebackSchema = z.object({
    status: z.enum(["New", "Under Review", "Responded", "Won", "Lost"]).optional(),
    outcome: z.string().max(200).optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    reasonCode: z.string().max(50).optional(),
    reasonDescription: z.string().max(500).optional().nullable(),
    amount: z.number().positive("Amount must be positive").optional(),
    cardBrand: z.string().max(50).optional(),
    responseDeadline: z.string().optional().nullable(),
    respondedAt: z.string().optional().nullable(),
    transactionDate: z.string().optional(),
  }).strict();

  app.patch("/api/chargebacks/:id", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getChargeback(id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (!await authorizeChargebackTarget(req, res, existing)) return;
      const parsed = patchChargebackSchema.parse(req.body);
      const body: Record<string, unknown> = { ...parsed };

      if (typeof body.transactionDate === "string") {
        body.transactionDate = new Date(body.transactionDate as string);
      }
      if (typeof body.responseDeadline === "string") {
        body.responseDeadline = new Date(body.responseDeadline as string);
      } else if (body.responseDeadline === null) {
        body.responseDeadline = null;
      }
      if (typeof body.respondedAt === "string") {
        body.respondedAt = new Date(body.respondedAt as string);
      } else if (body.respondedAt === null) {
        body.respondedAt = null;
      }

      if (body.status === "Responded" && !body.respondedAt) {
        body.respondedAt = new Date();
      }

      const updated = await storage.updateChargeback(id, body as any);
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
      if (!await authorizeChargebackTarget(req, res, cb)) return;
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
      if (!await authorizeChargebackTarget(req, res, cb)) return;

      const schema = z.object({
        name: z.string().min(1),
        url: z.string().min(1),
      });
      const { name, url } = schema.parse(req.body);
      const existing = (cb.evidenceFiles as any[]) || [];
      if (existing.length >= MAX_EVIDENCE_FILES) {
        return res.status(400).json({ message: `Maximum ${MAX_EVIDENCE_FILES} evidence files allowed per chargeback.` });
      }
      const updated = await storage.updateChargeback(id, {
        evidenceFiles: [...existing, { name, url, uploadedAt: new Date().toISOString() }],
      });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(400).json({ message: err.message });
    }
  });

  // Magic-byte signatures for server-side content validation
  function detectMimeFromBuffer(buf: Buffer): string | null {
    if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "application/pdf";
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
    // CSV: no universal magic bytes — verify it contains no null bytes (binary data rejection)
    if (!buf.includes(0x00)) return "text/csv";
    return null;
  }

  /**
   * POST /api/chargebacks/:id/evidence/upload
   * Upload an actual evidence file (PDF, JPG, PNG, CSV) for a chargeback.
   * Stores the file in uploads/chargeback_evidence/ and records the storageKey
   * in the chargeback's evidence_files JSONB column.
   */
  app.post("/api/chargebacks/:id/evidence/upload", isDashboardUser, (req, res, next) => {
    // Wrap multer so we can return JSON errors for size/type violations instead of
    // falling through to the global Express error handler.
    upload.single("file")(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File too large — maximum 10 MB per file." });
      }
      if (err) return next(err);
      next();
    });
  }, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cb = await storage.getChargeback(id);
      if (!cb) return res.status(404).json({ message: "Not found" });
      if (!await authorizeChargebackTarget(req, res, cb)) return;

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { originalname, size, buffer } = req.file;

      // Server-side content validation via magic bytes (do not trust client-supplied MIME)
      const detectedMime = detectMimeFromBuffer(buffer);
      if (!detectedMime || !ALLOWED_EVIDENCE_MIME_TYPES.has(detectedMime)) {
        return res.status(400).json({ message: "Unsupported file content. Allowed formats: PDF, JPG, PNG, CSV." });
      }

      const existing = (cb.evidenceFiles as any[]) || [];
      if (existing.length >= MAX_EVIDENCE_FILES) {
        return res.status(400).json({ message: `Maximum ${MAX_EVIDENCE_FILES} evidence files allowed per chargeback.` });
      }

      const timestamp = Date.now();
      const safeBaseName = `${timestamp}_${originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageKey = `chargeback_evidence/${safeBaseName}`;
      const evidenceDir = path.join(process.cwd(), "uploads", "chargeback_evidence");
      if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, safeBaseName), buffer);

      const updated = await storage.updateChargeback(id, {
        evidenceFiles: [
          ...existing,
          {
            name: originalname,
            storageKey,
            mimeType: detectedMime,
            fileSize: size,
            uploadedAt: new Date().toISOString(),
          },
        ],
      });

      await storage.createAuditLog({
        action: "chargeback_evidence_uploaded",
        entityType: "chargeback",
        entityId: id,
        details: { fileName: originalname, mimeType: detectedMime, fileSize: size, storageKey },
      });

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  /**
   * GET /api/chargebacks/:id/evidence/download
   * Download an evidence file by storageKey (query param ?key=...).
   * Verifies the key belongs to this chargeback before serving.
   * Path-traversal safe: resolves the canonical path and confirms it stays
   * within the chargeback_evidence directory before opening the file.
   */
  app.get("/api/chargebacks/:id/evidence/download", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const key = req.query.key as string | undefined;
      if (!key) return res.status(400).json({ message: "Missing key query parameter" });

      const cb = await storage.getChargeback(id);
      if (!cb) return res.status(404).json({ message: "Not found" });
      if (!await authorizeChargebackTarget(req, res, cb)) return;

      // Confirm the requested key is stored on THIS chargeback (prevents cross-chargeback access)
      const evidenceFiles = (cb.evidenceFiles as any[]) || [];
      const entry = evidenceFiles.find((f: any) => f.storageKey === key);
      if (!entry) return res.status(404).json({ message: "Evidence file not found on this chargeback" });

      // Build and confine the path using basename only — reject any directory components
      const evidenceDir = path.resolve(process.cwd(), "uploads", "chargeback_evidence");
      const safeFileName = path.basename(key); // strips all directory segments
      const filePath = path.resolve(evidenceDir, safeFileName);

      // Final confinement check: resolved path must be a direct child of evidenceDir
      if (!filePath.startsWith(evidenceDir + path.sep)) {
        return res.status(403).json({ message: "Invalid storage key" });
      }

      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found on disk" });

      res.download(filePath, entry.name);
    } catch (err: any) {
      serverError(res, err);
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
      if (!await authorizeChargebackTarget(req, res, cb)) return;

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
