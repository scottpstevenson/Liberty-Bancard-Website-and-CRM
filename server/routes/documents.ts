import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { insertCollateralPacketSchema, insertDocumentSchema, insertKnowledgeBaseSchema } from "@shared/schema";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { advanceDealStage } from "../services/deal-stage-service";
import { autoGenerateProposal } from "../services/proposal-engine";
import { persistAndEnqueueStatementCommand } from "../services/statement-command-worker";
import {
  claimCommand,
  computeRequestFingerprint,
  isValidUUIDv4,
  updateContext,
  markSucceeded,
  markRecoverableFailed,
} from "../services/statement-upload-idempotency";
import { generateDocumentToken, verifyDocumentToken } from "../services/document-tokens";
import { generateCoBrandedProposalPdf } from "../services/co-branded-proposal";
import path from "path";
import fs from "fs";
import { upload, parseId } from "./helpers";
import { ZipArchive } from "archiver";
import { serverError } from "../utils/server-error";
import { authorizeGhlRouteMutation, requireGhlRouteMutationAllowed } from "./ghl-mutation-pause";

export function registerDocumentsRoutes(app: Express) {
  // === MERCHANT DOCUMENT VAULT ===

  // Permission helper: controls who can view/download documents for a contact.
  // admin/manager: all. agent: only their assigned contacts. merchant: own contact by email.
  // partner: only docs explicitly shared (accessScope = 'partner') on their org's contacts.
  async function canAccessContactDocs(user: any, contactId: number | null): Promise<boolean> {
    const role = user?.role;
    if (!role) return false;
    if (['admin', 'manager'].includes(role)) return true;
    if (!contactId) return false;
    const contact = await storage.getContact(contactId);
    if (!contact) return false;
    if (user.email && contact.email && user.email === contact.email) return true;
    if (role === 'partner') {
      return !!(user.partnerOrgId && contact.partnerOrgId && user.partnerOrgId === contact.partnerOrgId);
    }
    const userDisplay = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    return (
      (contact as any).assignedTo === user.email ||
      (!!userDisplay && (contact as any).assignedTo === userDisplay)
    );
  }

  // Document-level permission check — called AFTER canAccessContactDocs passes.
  // Enforces scope, category, and status restrictions per role.
  // admin/manager: all. agent: all docs on their contacts. partner: scope='partner' only.
  // merchant: scope='merchant', allowed categories only, no archived docs.
  const MERCHANT_ALLOWED_CATEGORIES = ['Application', 'Voided Check', 'Photo ID', 'Bank Statement', 'Signed Proposal', 'Processing Statement'];

  function canAccessDocument(user: any, doc: any): boolean {
    const role = user?.role;
    if (!role) return false;
    if (['admin', 'manager'].includes(role)) return true;
    if (role === 'agent') return true; // contact ownership already verified upstream
    if (role === 'partner') return doc.accessScope === 'partner';
    if (role === 'merchant') {
      // Merchants may only view documents that have been explicitly approved
      return (
        doc.accessScope === 'merchant' &&
        MERCHANT_ALLOWED_CATEGORIES.includes(doc.category || '') &&
        doc.status === 'approved'
      );
    }
    return false;
  }

  // Filter documents based on role after access check passes.
  // Partners see only scope='partner'. Merchants see only scope='merchant', approved docs only.
  function filterDocsByRole(docs: any[], role: string): any[] {
    if (['admin', 'manager', 'agent'].includes(role)) return docs;
    if (role === 'partner') return docs.filter(d => d.accessScope === 'partner');
    if (role === 'merchant') {
      return docs.filter(d =>
        d.accessScope === 'merchant' &&
        MERCHANT_ALLOWED_CATEGORIES.includes(d.category || '') &&
        d.status === 'approved'
      );
    }
    return docs;
  }

  // Log a document access event to the audit log.
  function logDocumentAccess(userId: string | undefined, docId: number, action: 'view' | 'download' | 'bulk_download' | 'bulk_delete', role?: string) {
    storage.createAuditLog({
      userId: userId || null,
      action: `document_${action}`,
      entityType: 'document',
      entityId: docId,
      actorType: 'user',
      actorId: userId || null,
      details: { role: role || null },
    }).catch(err => console.error('[doc-audit] failed:', err));
  }

  // GET /api/merchant-documents - admin/manager index of all documents
  app.get("/api/merchant-documents", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      if (!['admin', 'manager'].includes(user?.role)) {
        return res.status(403).json({ message: "Admin/Manager only" });
      }
      const allDocs = await storage.getDocuments();
      const category = req.query.category as string | undefined;
      const contactId = req.query.contactId ? parseId(req.query.contactId as string) : undefined;
      const status = req.query.status as string | undefined;

      let docs = allDocs;
      if (category && category !== "all") {
        docs = docs.filter(d => d.category === category);
      }
      if (contactId) {
        docs = docs.filter(d => d.contactId === contactId);
      }
      if (status && status !== "all") {
        docs = docs.filter(d => (d.status || 'pending') === status);
      }
      res.json(docs);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-documents/contact/:contactId - get docs for a specific merchant
  app.get("/api/merchant-documents/contact/:contactId", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const cid = parseId(req.params.contactId);
      if (cid === null) return res.status(404).json({ message: "Contact not found" });
      if (!await canAccessContactDocs(user, cid)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const docs = await storage.getDocumentsByContact(cid);
      const filtered = filterDocsByRole(docs, user?.role || '');
      res.json(filtered);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/merchant-documents/upload - upload a document to a merchant record
  app.post("/api/merchant-documents/upload", isAuthenticated, upload.single("file"), async (req, res) => {
    // Tracks the idempotency slot we own so a post-claim error can honestly mark
    // the command recoverable-failed instead of leaving it stuck in_progress.
    let ownedCommandId: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user as any;
      let { category, contactId, dealId } = req.body;

      // Merchant users: derive contactId server-side from their profile — reject client-supplied ownership
      if (user?.role === "merchant") {
        const profile = await storage.getMerchantProfileByUser(user.id).catch(() => null);
        if (!profile) return res.status(403).json({ message: "No merchant profile found" });
        contactId = String(profile.contactId);
        dealId = undefined; // merchants cannot scope uploads to a specific deal
        // Validate category against merchant-allowed list
        const MERCHANT_ALLOWED_CATEGORIES = new Set(["KYC", "Bank Statement", "Processing Statement", "ID Verification", "Other"]);
        if (category && !MERCHANT_ALLOWED_CATEGORIES.has(category)) {
          return res.status(400).json({ message: "Invalid document category" });
        }
      } else if (contactId && !await canAccessContactDocs(user, parseId(contactId))) {
        return res.status(403).json({ message: "Access denied" });
      }

      // ── Idempotency for statement document types ─────────────────────────
      const isStatementType = category === "Processing Statement" || category === "Rate Review Statement";
      let commandId: string | null = null;

      if (isStatementType) {
        const idempotencyKey = req.headers["idempotency-key"] as string | undefined;

        if (!idempotencyKey) {
          return res.status(400).json({
            message: "Idempotency-Key header is required for statement uploads",
            code: "IDEMPOTENCY_KEY_REQUIRED",
          });
        }

        if (!isValidUUIDv4(idempotencyKey)) {
          return res.status(400).json({
            message: "Idempotency-Key must be a valid UUID v4",
            code: "IDEMPOTENCY_KEY_INVALID",
          });
        }

        const ownerScope = `user:${user.id}`;

        const fingerprint = computeRequestFingerprint({
          fields: {
            category: category ?? "",
            contactId: contactId ?? "",
            dealId: dealId ?? "",
            fileName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
          },
          fileBuffer: req.file.buffer,
        });

        const claimResult = await claimCommand({
          requestId: idempotencyKey,
          fingerprint,
          ownerScope,
          source: "document_upload_route",
          contactId: contactId ? Number(contactId) : undefined,
          dealId: dealId ? Number(dealId) : undefined,
          context: {
            category,
            fileName: req.file.originalname,
            uploadedBy: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown" : "Unknown",
          },
        });

        if (claimResult.outcome === "replay") {
          // Return the previously stored result
          const storedResult = claimResult.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Idempotency-Replayed", "true");
          return res.status(200).json(storedResult ?? { message: "Upload already processed" });
        }

        if (claimResult.outcome === "recoverable_failed_replay") {
          // Prior attempt for this key failed recoverably — return the honest
          // stored failure; never fall through to a fresh mutation.
          const storedResult = claimResult.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Idempotency-Replayed", "true");
          return res.status(422).json({
            message: "A prior upload with this Idempotency-Key failed. Use a new Idempotency-Key to retry.",
            code: "IDEMPOTENCY_RECOVERABLE_FAILED",
            ...(storedResult ?? {}),
          });
        }

        if (claimResult.outcome === "claimed_by_other") {
          res.setHeader("Idempotency-Key", idempotencyKey);
          return res.status(202).json({
            message: "This upload is currently being processed. Please retry after a moment.",
            code: "UPLOAD_IN_PROGRESS",
            commandId: claimResult.commandId,
          });
        }

        if (claimResult.outcome === "conflict") {
          res.setHeader("Idempotency-Key", idempotencyKey);
          return res.status(409).json({
            message: "Idempotency-Key already used with a different request payload. Use a new Idempotency-Key.",
            code: "IDEMPOTENCY_CONFLICT",
          });
        }

        if (claimResult.outcome === "scope_mismatch") {
          // Do not reveal details about the existing command to the different caller
          return res.status(403).json({
            message: "Idempotency-Key is not valid for this caller.",
            code: "IDEMPOTENCY_SCOPE_MISMATCH",
          });
        }

        // outcome === "claimed" — we hold the slot, proceed with the upload
        commandId = claimResult.command.id;
        ownedCommandId = commandId;

        // Update context with resolved details
        await updateContext(commandId, {
          category,
          fileName: req.file.originalname,
          contactId: contactId ?? null,
          dealId: dealId ?? null,
          uploadedBy: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown" : "Unknown",
          claimedAt: new Date().toISOString(),
        });
      }
      // ── End idempotency claim ─────────────────────────────────────────────

      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype;
      const timestamp = Date.now();
      const safeFileName = `${timestamp}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageKey = `merchant_docs/${safeFileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads", "merchant_docs");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, safeFileName), req.file.buffer);

      const uploadedBy = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown" : "Unknown";

      const doc = await storage.createDocument({
        contactId: contactId ? Number(contactId) : null,
        dealId: dealId ? Number(dealId) : null,
        type: category || "Other",
        category: category || "Other",
        fileName,
        fileSize,
        mimeType,
        uploadedBy,
        storageKey,
        accessScope: "internal",
        status: "pending",
      });

      storage.createAuditLog({
        userId: String(user?.id || ''),
        action: 'document_upload',
        entityType: 'document',
        entityId: doc.id,
        actorType: 'user',
        actorId: String(user?.id || ''),
        details: { fileName, category: category || 'Other', contactId: contactId || null },
      }).catch(err => console.error('[doc-audit] upload log failed:', err));

      // Auto-update onboarding checklist item when document category maps to a known step.
      // Resolves the active deal for the contact (if any) and marks the matching checklist
      // item as "received" so staff don't have to update it manually.
      const CATEGORY_TO_CHECKLIST_KEY: Record<string, string> = {
        "Bank Statement":        "bank_statement",
        "Processing Statement":  "processing_statement",
        "ID Verification":       "government_id",
        "KYC":                   "kyc_documents",
        "Voided Check":          "voided_check",
      };
      const checklistKey = CATEGORY_TO_CHECKLIST_KEY[category as string];
      if (checklistKey && contactId) {
        (async () => {
          try {
            const cid = Number(contactId);
            const dealList = await (storage.getDeals as any)({ contactId: cid, limit: 1 });
            const activeDeal = dealList.data?.[0] ?? (dealList as any)[0];
            const did = (activeDeal as any)?.id;
            if (did) {
              await storage.updateOnboardingChecklistItemStatus(did, checklistKey, "received", doc.id, null).catch(async () => {
                await storage.upsertOnboardingChecklistItem({ dealId: did, itemKey: checklistKey, status: "received", documentId: doc.id });
              });
              await storage.createAuditLog({
                action: "checklist_auto_updated",
                entityType: "document",
                entityId: doc.id,
                actorType: "system",
                details: { dealId: did, itemKey: checklistKey, documentId: doc.id, fileName },
              });
            }
          } catch (e: any) {
            console.warn("[doc-upload] checklist auto-update failed (non-critical):", e.message);
          }
        })().catch(() => {});
      }

      // ── Statement upload → create inbox item + statement review ──────────
      if (isStatementType && contactId) {
        (async () => {
          try {
            const cid = Number(contactId);
            const { upsertInboxItem, createStatementReview, getStatementReviewByDocument } = await import("../storage/inbox");

            // Create/update inbox item assigned to analyst queue
            const inboxSourceId = `statement-doc-${doc.id}`;
            await upsertInboxItem({
              sourceItemId: inboxSourceId,
              sourceItemType: "statement",
              contactId: cid,
              dealId: dealId ? Number(dealId) : null,
              department: "accounts",
              status: "new",
              priority: "high",
              slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h SLA
              nextAction: "review_statement",
            });

            // Create statement review record (if not already exists)
            const existing = await getStatementReviewByDocument(doc.id).catch(() => null);
            if (!existing) {
              await createStatementReview({
                documentId: doc.id,
                contactId: cid,
                dealId: dealId ? Number(dealId) : null,
                status: "received",
              });
            }

            // Create analyst review task
            await storage.createAuthorityTask({
              title: `Review statement — ${fileName}`,
              description: `Processing statement uploaded by ${uploadedBy}. Document ID: ${doc.id}. Review and prepare savings proposal.`,
              contactId: cid,
              dealId: dealId ? Number(dealId) : null,
              status: "pending",
              priority: "high",
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              assignedTo: "Scott Stevenson",
              source: "statement_upload",
              automationKey: `statement_review_doc_${doc.id}`,
            });

            await storage.createAuditLog({
              action: "statement_review_created_on_upload",
              entityType: "document",
              entityId: doc.id,
              actorType: "system",
              details: { contactId: cid, documentId: doc.id, fileName, category },
            });
          } catch (e: any) {
            console.warn("[doc-upload] statement review creation failed (non-critical):", e.message);
          }
        })().catch(() => {});
      }

      // Statement commands are terminalized only by the queue-owned worker.
      // This generic document endpoint may persist the document, but it must not
      // claim workflow completion or race a leased command executor.
      if (isStatementType && commandId) {
        const statementQueued = await persistAndEnqueueStatementCommand({
          contactId: Number(contactId),
          dealId: dealId ? Number(dealId) : null,
          fileBuffer: req.file.buffer,
          fileName,
          source: "dashboard",
          commandId,
          existingDocumentId: doc.id,
        });
        if (!statementQueued) {
          return res.status(503).json({ error: "STATEMENT_COMMAND_QUEUE_UNAVAILABLE", statement_upload_request_id: commandId });
        }
        const idempotencyKey = req.headers["idempotency-key"] as string;
        res.setHeader("Idempotency-Key", idempotencyKey);
        res.setHeader("X-Idempotency-Replayed", "false");
        return res.status(202).json({ ...doc, statement_upload_request_id: commandId });
      }

      res.status(201).json(doc);
    } catch (err: any) {
      // Route-level error after claim — honestly mark the owned slot
      // recoverable-failed so the key never replays as a success.
      if (ownedCommandId) {
        await markRecoverableFailed(ownedCommandId, {
          error: err?.message ?? "unknown error",
          code: err?.code ?? null,
        }).catch(() => { /* best-effort */ });
      }
      serverError(res, err);
    }
  });

  // PATCH /api/merchant-documents/:id/status - approve/reject/archive a document
  app.patch("/api/merchant-documents/:id/status", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { status } = req.body;
      const validStatuses = ['pending', 'approved', 'rejected', 'archived'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be: pending, approved, rejected, or archived" });
      }

      const docStatusId = parseId(req.params.id);
      if (docStatusId === null) return res.status(404).json({ message: "Document not found" });
      const doc = await storage.getDocumentById(docStatusId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      // A rejection may add a GHL note. Resolve an already-active pause before
      // changing local status so the operator receives an actionable response.
      if (status === "rejected" && doc.contactId) {
        const contact = await storage.getContact(doc.contactId);
        const { isSdrGhlConfigured } = await import("../services/sdr/ghl-client");
        if (contact?.ghlContactId && isSdrGhlConfigured() && !(await requireGhlRouteMutationAllowed(res))) return;
      }

      const user = req.user as any;
      const updated = await storage.updateDocument(doc.id, { status });

      storage.createAuditLog({
        userId: String(user?.id || ''),
        action: `document_status_changed`,
        entityType: 'document',
        entityId: doc.id,
        actorType: 'user',
        actorId: String(user?.id || ''),
        details: { from: doc.status || 'pending', to: status, fileName: doc.fileName },
      }).catch(err => console.error('[doc-audit] status change log failed:', err));

      // When a document is rejected, notify the merchant via internal notification + GHL note.
      if (status === "rejected" && doc.contactId) {
        (async () => {
          try {
            const { createPreferenceAwareNotification } = await import("../services/digest-service");
            await createPreferenceAwareNotification({
              channel: "internal",
              title: "Document Rejected",
              message: `Document "${doc.fileName}" was rejected and requires resubmission. Please upload a corrected version.`,
              type: "warning",
              metadata: { documentId: doc.id, contactId: doc.contactId, eventType: "document_rejected" },
            }).catch(() => {});

            const contact = await storage.getContact(doc.contactId as number);
            if (contact?.ghlContactId) {
              // Re-authorize in the deferred task to close its scheduling gap.
              const pauseDecision = await authorizeGhlRouteMutation();
              if (pauseDecision.allowed) {
                const { addNote } = await import("../services/sdr/ghl-client");
                await addNote({ contactId: contact.ghlContactId, body: `Document rejected: "${doc.fileName}". Merchant has been notified to resubmit.` }).catch(() => {});
              } else {
                console.warn(`[doc-status] GHL note skipped: ${pauseDecision.reasonCode}`);
              }
            }

            // Audit the rejection event for reporting
            await storage.createAuditLog({ action: "document_rejected_notification_sent", entityType: "document", entityId: doc.id, actorType: "system", details: { contactId: doc.contactId, fileName: doc.fileName } }).catch(() => {});
          } catch (e: any) {
            console.warn("[doc-status] rejection notification failed (non-critical):", e.message);
          }
        })().catch(() => {});
      }

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-documents/serve/:token - serve a file via signed token
  app.get("/api/merchant-documents/serve/:token", async (req, res) => {
    try {
      let payload;
      try {
        payload = verifyDocumentToken(req.params.token);
      } catch (err: any) {
        return res.status(401).json({ message: err.message || "Invalid or expired token" });
      }

      const doc = await storage.getDocumentById(payload.documentId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      storage.createDocumentAccessLog({
        documentId: doc.id,
        userId: payload.userId,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
      }).catch(err => console.error("[doc-access-log] failed to write:", err));

      logDocumentAccess(payload.userId, doc.id, 'download');

      if (doc.storageKey) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        const relativePath = doc.storageKey.replace(/^uploads\//, "");
        const filePath = path.join(uploadsDir, relativePath);

        if (fs.existsSync(filePath)) {
          return res.download(filePath, doc.fileName);
        }

        const merchantDocPath = path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey));
        if (fs.existsSync(merchantDocPath)) {
          return res.download(merchantDocPath, doc.fileName);
        }

        const allFiles = fs.readdirSync(uploadsDir);
        const match = allFiles.find(f => doc.storageKey?.includes(f) || f.includes(path.basename(doc.storageKey || "")));
        if (match) {
          return res.download(path.join(uploadsDir, match), doc.fileName);
        }
      }

      return res.status(404).json({ message: "File not found on disk" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-documents/:id/access-token - issue a short-lived signed download URL
  app.get("/api/merchant-documents/:id/access-token", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const accessTokenDocId = parseId(req.params.id);
      if (accessTokenDocId === null) return res.status(404).json({ message: "Document not found" });
      const doc = await storage.getDocumentById(accessTokenDocId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      // Contact-level check: user must be able to access this contact's documents
      if (!await canAccessContactDocs(user, doc.contactId)) {
        return res.status(403).json({ message: "Access denied" });
      }
      // Document-level check: verify scope/category/status for restricted roles
      if (!canAccessDocument(user, doc)) {
        return res.status(403).json({ message: "Access denied to this document" });
      }

      logDocumentAccess(String(user?.id || ''), doc.id, 'view', user?.role);

      const token = generateDocumentToken(doc.id, user.id);
      const serveUrl = `/api/merchant-documents/serve/${token}`;
      res.json({ url: serveUrl, expiresInSeconds: 900 });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-documents/:id/download - blocked; use /access-token + /serve instead
  app.get("/api/merchant-documents/:id/download", isAuthenticated, (_req, res) => {
    res.status(401).json({ message: "Direct document downloads are not permitted. Use /api/merchant-documents/:id/access-token to obtain a short-lived signed URL." });
  });

  // POST /api/documents/bulk-download - ZIP download of selected documents
  app.post("/api/documents/bulk-download", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      const numIds = ids.map(Number).filter(n => !isNaN(n));
      if (numIds.length === 0) return res.status(400).json({ message: "No valid document IDs" });

      const docs = await storage.getDocumentsByIds(numIds);
      const user = req.user as any;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="documents_${Date.now()}.zip"`);

      const archive = new ZipArchive({ zlib: { level: 6 } });
      archive.on("error", (err) => {
        console.error("[bulk-download] archiver error:", err);
        if (!res.headersSent) serverError(res, err);
      });
      archive.pipe(res);

      const uploadsDir = path.join(process.cwd(), "uploads");
      const usedNames = new Map<string, number>();

      for (const doc of docs) {
        if (!doc.storageKey) continue;

        const tryPaths = [
          path.join(uploadsDir, doc.storageKey.replace(/^uploads\//, "")),
          path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey)),
          path.join(uploadsDir, path.basename(doc.storageKey)),
        ];

        let filePath: string | null = null;
        for (const p of tryPaths) {
          if (fs.existsSync(p)) { filePath = p; break; }
        }
        if (!filePath) continue;

        const baseName = doc.fileName;
        const count = usedNames.get(baseName) || 0;
        usedNames.set(baseName, count + 1);
        const entryName = count > 0 ? `${path.parse(baseName).name}_${count}${path.extname(baseName)}` : baseName;

        archive.file(filePath, { name: entryName });

        logDocumentAccess(String(user?.id || ''), doc.id, 'bulk_download', user?.role);
      }

      storage.createAuditLog({
        userId: String(user?.id || ''),
        action: 'document_bulk_download',
        entityType: 'document',
        entityId: null as any,
        actorType: 'user',
        actorId: String(user?.id || ''),
        details: { documentIds: numIds, count: docs.length },
      }).catch(err => console.error('[doc-audit] bulk download log failed:', err));

      await archive.finalize();
    } catch (err: any) {
      if (!res.headersSent) serverError(res, err);
    }
  });

  // POST /api/documents/bulk-delete - delete multiple documents independently
  app.post("/api/documents/bulk-delete", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      const numIds = ids.map(Number).filter(n => !isNaN(n));
      if (numIds.length === 0) {
        return res.status(400).json({ message: "No valid document IDs" });
      }

      const user = req.user as any;
      const uploadsDir = path.join(process.cwd(), "uploads");

      const succeeded: { id: number; filename?: string }[] = [];
      const failed: { id: number; filename?: string; reason: string }[] = [];

      for (const id of numIds) {
        let filename: string | undefined;
        try {
          const doc = await storage.getDocumentById(id);
          if (!doc) {
            failed.push({ id, reason: "Document not found" });
            continue;
          }
          filename = doc.fileName;

          if (doc.storageKey) {
            const tryPaths = [
              path.join(uploadsDir, doc.storageKey.replace(/^uploads\//, "")),
              path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey)),
              path.join(uploadsDir, path.basename(doc.storageKey)),
            ];
            for (const p of tryPaths) {
              if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                break;
              }
            }
          }

          await storage.deleteDocument(id);
          logDocumentAccess(String(user?.id || ''), id, 'bulk_delete', user?.role);
          succeeded.push({ id, filename });
        } catch (err: any) {
          console.error(`[bulk-delete] failed to delete document ${id}:`, err);
          failed.push({ id, filename, reason: err?.message || "Unknown error" });
        }
      }

      storage.createAuditLog({
        userId: String(user?.id || ''),
        action: 'document_bulk_delete',
        entityType: 'document',
        entityId: null as any,
        actorType: 'user',
        actorId: String(user?.id || ''),
        details: { documentIds: numIds, succeededCount: succeeded.length, failedCount: failed.length },
      }).catch(err => console.error('[doc-audit] bulk delete log failed:', err));

      const attempted = numIds.length;
      const result = { attempted, succeeded, failed };

      if (failed.length === 0) {
        return res.status(200).json(result);
      }
      if (succeeded.length === 0) {
        return res.status(500).json(result);
      }
      return res.status(207).json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // DELETE /api/merchant-documents/:id - delete a document
  app.delete("/api/merchant-documents/:id", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const deleteDocId = parseId(req.params.id);
      if (deleteDocId === null) return res.status(404).json({ message: "Document not found" });
      const doc = await storage.getDocumentById(deleteDocId);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (!await canAccessContactDocs(user, doc.contactId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (doc.storageKey) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        const tryPaths = [
          path.join(uploadsDir, doc.storageKey.replace(/^uploads\//, "")),
          path.join(uploadsDir, "merchant_docs", path.basename(doc.storageKey)),
          path.join(uploadsDir, path.basename(doc.storageKey)),
        ];
        for (const p of tryPaths) {
          if (fs.existsSync(p)) { fs.unlinkSync(p); break; }
        }
      }

      await storage.deleteDocument(doc.id);
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === LEGACY DOCUMENTS (restricted to admin/manager — no per-role filtering applied) ===
  app.get("/api/documents", requireRole("admin", "manager"), async (req, res) => {
    const documents = await storage.getDocuments();
    res.json(documents);
  });

  app.post("/api/documents", requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertDocumentSchema.parse(req.body);
      const doc = await storage.createDocument(input);
      res.status(201).json(doc);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });

  app.post("/api/documents/upload", requireRole("admin", "manager"), upload.single("file"), async (req, res) => {
    // Tracks the idempotency slot we own so a synchronous post-claim error (before
    // handing off to the authoritative chain) can honestly mark it recoverable-failed.
    let ownedCommandId: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { type, contactId, dealId, accessScope } = req.body;
      const fileName = req.file.originalname;

      // For merchant_statement uploads via dashboard, run the full 11-step chain
      if ((type === "merchant_statement" || !type) && contactId) {
        // ── Idempotency-Key guard (required before any business mutation) ────
        const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
        if (!idempotencyKey) {
          return res.status(400).json({
            error: "MISSING_IDEMPOTENCY_KEY",
            message: "Idempotency-Key header is required. Supply a UUID v4.",
          });
        }
        if (!isValidUUIDv4(idempotencyKey)) {
          return res.status(400).json({
            error: "INVALID_IDEMPOTENCY_KEY",
            message: "Idempotency-Key must be a valid UUID v4.",
          });
        }

        const user = req.user as any;
        const resolvedContactId = Number(contactId);
        const resolvedDealId = dealId ? Number(dealId) : null;

        const fingerprint = computeRequestFingerprint({
          fields: {
            contactId: resolvedContactId,
            dealId: resolvedDealId ?? null,
            source: "dashboard",
            workflow: "statement-upload",
            userId: user?.id ?? null,
            fileName: req.file.originalname,
          },
          fileBuffer: req.file.buffer,
        });
        const ownerScope = `user:${user?.id ?? "unknown"}`;

        const claim = await claimCommand({
          requestId: idempotencyKey,
          fingerprint,
          ownerScope,
          source: "dashboard",
          contactId: resolvedContactId,
          dealId: resolvedDealId ?? undefined,
        });

        if (claim.outcome === "conflict") {
          return res.status(409).json({
            error: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This Idempotency-Key was already used with a different request payload.",
          });
        }
        if (claim.outcome === "scope_mismatch") {
          return res.status(403).json({
            error: "IDEMPOTENCY_KEY_SCOPE_MISMATCH",
            message: "This Idempotency-Key belongs to a different caller.",
          });
        }
        if (claim.outcome === "claimed_by_other") {
          return res.status(202).json({
            error: "IDEMPOTENCY_IN_PROGRESS",
            message: "This upload is already being processed.",
            commandId: claim.commandId,
          });
        }
        if (claim.outcome === "replay") {
          const stored = claim.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
          return res.status(200).json({
            success: true,
            replayed: true,
            statement_upload_request_id: claim.command.id,
            contactId: resolvedContactId,
            ...(stored ?? {}),
          });
        }
        if (claim.outcome === "recoverable_failed_replay") {
          // Prior attempt for this key failed recoverably — return the honest
          // stored failure; never fall through to a fresh mutation.
          const stored = claim.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
          return res.status(422).json({
            error: "IDEMPOTENCY_KEY_RECOVERABLE_FAILED",
            message: "A prior attempt with this Idempotency-Key failed. Retry with a new Idempotency-Key.",
            replayed: true,
            statement_upload_request_id: claim.command.id,
            contactId: resolvedContactId,
            ...(stored ?? {}),
          });
        }

        const commandId = claim.command.id;
        ownedCommandId = commandId;

        // Accepted initial response. The chain is authoritative for the TERMINAL
        // command result (it calls markSucceeded / markRecoverableFailed internally
        // via commandId); the route must NOT overwrite that terminal status.
        const acceptedResponse = {
          success: true,
          contactId: resolvedContactId,
          statement_upload_request_id: commandId,
        };

        // Persist context (including the accepted response) before handing off to
        // the async chain so the slot is recoverable.
        await updateContext(commandId, {
          contactId: resolvedContactId,
          dealId: resolvedDealId ?? null,
          source: "dashboard",
          workflow: "statement-upload",
          userId: user?.id ?? null,
          fileName,
          acceptedResponse,
        });

        // Fire-and-forget — do NOT markSucceeded here; the chain owns its result.
        const statementQueued = await persistAndEnqueueStatementCommand({
          contactId: resolvedContactId,
          dealId: resolvedDealId,
          fileBuffer: req.file.buffer,
          fileName,
          source: "dashboard",
          commandId,
        });
        if (!statementQueued) {
          return res.status(503).json({ error: "STATEMENT_COMMAND_QUEUE_UNAVAILABLE", statement_upload_request_id: commandId });
        }

        res.setHeader("Idempotency-Key", idempotencyKey);
        res.setHeader("X-Statement-Upload-Request-Id", commandId);
        return res.status(202).json(acceptedResponse);
      }

      // Non-statement document — legacy path
      const storageKey = `uploads/${Date.now()}_${fileName}`;
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const doc = await storage.createDocument({
        contactId: contactId ? Number(contactId) : null,
        dealId: dealId ? Number(dealId) : null,
        type: type || "general",
        fileName,
        storageKey,
        accessScope: accessScope || "internal",
        status: "pending",
      });

      res.status(201).json(doc);
    } catch (err: any) {
      // Route-level error after claim (before chain hand-off) — honestly mark the
      // owned slot recoverable-failed so the key never replays as a success.
      if (ownedCommandId) {
        await markRecoverableFailed(ownedCommandId, {
          error: err?.message ?? "unknown error",
          code: err?.code ?? null,
        }).catch(() => { /* best-effort */ });
      }
      serverError(res, err);
    }
  });

  app.get("/api/documents/download/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const docs = await storage.getDocuments();
      const dlDocId = parseId(req.params.id);
      if (dlDocId === null) return res.status(404).json({ message: "Document not found" });
      const doc = docs.find(d => d.id === dlDocId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      // ── Co-branded proposal: generate PDF on the fly from the token ──────────
      if (doc.storageKey?.startsWith("co-branded-proposal:")) {
        const token = doc.storageKey.replace("co-branded-proposal:", "");
        const proposal = await storage.getCoBrandedProposalByToken(token);
        if (!proposal) return res.status(404).json({ message: "Proposal not found." });
        const org = await storage.getPartnerOrg(proposal.partnerOrgId!);
        if (!org) return res.status(404).json({ message: "Partner org not found." });
        const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
        const baseUrl = process.env.APP_URL || (replitDomain ? `https://${replitDomain}` : `${req.protocol}://${req.get("host")}`);
        const pdfBuffer = await generateCoBrandedProposalPdf({
          org,
          merchantName: proposal.merchantName || "Merchant",
          merchantMonthlyVolume: proposal.merchantMonthlyVolume,
          merchantEffectiveRate: proposal.merchantEffectiveRate,
          pricingPlan: proposal.pricingPlan,
          customMessage: proposal.customMessage,
          proposalData: proposal.proposalData,
          token: proposal.token,
          baseUrl,
        });
        const slug = (proposal.merchantName || "merchant").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="savings-proposal-${slug}.pdf"`,
          "Content-Length": String(pdfBuffer.length),
          "Cache-Control": "no-store",
        });
        return res.send(pdfBuffer);
      }

      const uploadsDir = path.join(process.cwd(), "uploads");
      const files = fs.readdirSync(uploadsDir);
      const matchingFile = files.find(f => doc.storageKey?.includes(f) || f.includes(doc.fileName));

      if (matchingFile) {
        res.download(path.join(uploadsDir, matchingFile), doc.fileName);
      } else {
        res.status(404).json({ message: "File not found on disk" });
      }
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/documents/contact/:contactId", requireRole("admin", "manager"), async (req, res) => {
    const docs = await storage.getDocuments();
    const legacyCid = parseId(req.params.contactId);
    if (legacyCid === null) return res.status(404).json({ message: "Contact not found" });
    const contactDocs = docs.filter(d => d.contactId === legacyCid);
    res.json(contactDocs);
  });

  app.get("/api/merchant-portal/onboarding-tasks", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const requestedDealId = req.query.dealId ? parseId(req.query.dealId as string) : null;
      if (!requestedDealId) return res.json([]);

      const role = user?.role;
      const isDashboard = role === "admin" || role === "manager" || role === "agent";

      if (!isDashboard) {
        // Merchant: validate ownership — only allow access to their own deal
        const profile = await storage.getMerchantProfileByUser(user.id).catch(() => null);
        if (!profile || profile.dealId !== requestedDealId) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const KYC_UPLOAD_SUBSTRINGS = [
        "KYC",
        "Photo ID",
        "Driver License",
        "Passport",
        "EIN Letter",
        "Voided Check",
        "Bank Statement",
        "Identity Verification",
        "KYC Documents",
      ];

      const dealTasks = await storage.getTasksByDeal(requestedDealId);
      const safeTasks = dealTasks.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        completedAt: (t as any).completedAt ?? null,
        isKycUploadTask: KYC_UPLOAD_SUBSTRINGS.some(sub =>
          t.title?.toLowerCase().includes(sub.toLowerCase()),
        ),
      }));
      res.json(safeTasks);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-portal/boarding-status
  // Returns the merchant's deal boarding status, processor application ID, log, and MID.
  app.get("/api/merchant-portal/boarding-status", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const role = user?.role;
      const isDashboard = role === "admin" || role === "manager" || role === "agent";

      let contactId: number | null = null;
      let dealId: number | null = null;

      if (isDashboard) {
        // Dashboard users may supply ?dealId= for debugging
        const qDealId = req.query.dealId ? Number(req.query.dealId) : null;
        if (qDealId) dealId = qDealId;
      } else {
        // Merchant: resolve contact from their profile (strict ownership)
        const profile = await storage.getMerchantProfileByUser(user.id).catch(() => null);
        if (!profile) return res.status(404).json({ message: "Merchant profile not found" });
        contactId = profile.contactId ?? null;
        dealId = profile.dealId ?? null;
      }

      // Resolve deal
      let deal: any = null;
      if (dealId) {
        deal = await storage.getDeal(dealId).catch(() => null);
      } else if (contactId) {
        const dealList = await storage.getDealsByContact(contactId).catch(() => []);
        // Prefer onboarding pipeline deal; fall back to most recent
        deal = dealList.find((d: any) => d.pipeline === "onboarding") ?? dealList[0] ?? null;
      }

      if (!deal) {
        return res.json({
          boardingStatus: "not_submitted",
          processorApplicationId: null,
          boardingLog: [],
          mid: null,
          boardingSubmittedAt: null,
          boardingApprovedAt: null,
        });
      }

      return res.json({
        boardingStatus: deal.boardingStatus ?? "not_submitted",
        processorApplicationId: deal.processorApplicationId ?? null,
        boardingLog: deal.boardingLog ?? [],
        mid: deal.mid ?? null,
        boardingSubmittedAt: deal.boardingSubmittedAt ?? null,
        boardingApprovedAt: deal.boardingApprovedAt ?? null,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/merchant-portal/chargebacks
  // Returns chargebacks scoped to the authenticated merchant's contact.
  app.get("/api/merchant-portal/chargebacks", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const role = user?.role;
      const isDashboard = role === "admin" || role === "manager" || role === "agent";

      let contactId: number | null = null;

      if (isDashboard) {
        // Dashboard users must supply ?contactId= for scoped view
        const qContactId = req.query.contactId ? Number(req.query.contactId) : null;
        if (!qContactId) return res.json([]);
        contactId = qContactId;
      } else {
        const profile = await storage.getMerchantProfileByUser(user.id).catch(() => null);
        if (!profile) return res.status(404).json({ message: "Merchant profile not found" });
        contactId = profile.contactId ?? null;
      }

      if (!contactId) return res.json([]);

      const rows = await storage.getChargebacksByContact(contactId).catch(() => []);
      // Sort descending by transaction date
      rows.sort((a: any, b: any) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

      // Return only the fields the merchant portal needs (no internal AI evidence packets)
      const safe = rows.map((cb: any) => ({
        id: cb.id,
        transactionDate: cb.transactionDate,
        amount: cb.amount,
        cardBrand: cb.cardBrand,
        reasonCode: cb.reasonCode,
        reasonDescription: cb.reasonDescription,
        status: cb.status,
        responseDeadline: cb.responseDeadline,
        respondedAt: cb.respondedAt,
        outcome: cb.outcome,
        createdAt: cb.createdAt,
      }));

      return res.json(safe);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/merchant-portal/upload-statement", isAuthenticated, upload.single("file"), async (req, res) => {
    // Tracks the idempotency slot we own so a synchronous post-claim error (before
    // handing off to the authoritative chain) can honestly mark it recoverable-failed.
    let ownedCommandId: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const user = req.user as any;
      const fileName = req.file.originalname;
      const fileNameLower = fileName.toLowerCase();

      // Determine document type from filename for non-statement files
      const explicitDocType = req.body?.docType;
      const validDocTypes = ["merchant_statement", "voided_check", "government_id", "application"];
      let docType: string;

      if (explicitDocType && validDocTypes.includes(explicitDocType)) {
        docType = explicitDocType;
      } else {
        docType = "merchant_statement";
        if (/\bvoid(ed)?\b/.test(fileNameLower) || /\bcheck\b/.test(fileNameLower) || /\bbank\b/.test(fileNameLower)) {
          docType = "voided_check";
        } else if (/\blicense\b/.test(fileNameLower) || /\bpassport\b/.test(fileNameLower) || /\bgov(ernment)?[_-]?id\b/.test(fileNameLower) || /\bphoto[_-]?id\b/.test(fileNameLower) || /\bdriver/i.test(fileNameLower)) {
          docType = "government_id";
        } else if (/\bapplication\b/.test(fileNameLower)) {
          docType = "application";
        }
      }

      // Resolve the uploader's contact via merchant profile (strict ownership — no heuristic)
      const merchantProfile = await storage.getMerchantProfileByUser(user.id).catch(() => null);
      let uploaderContactId: number | null = null;
      let uploaderContact: any = null;
      if (merchantProfile?.contactId) {
        uploaderContactId = merchantProfile.contactId;
        uploaderContact = await storage.getContact(merchantProfile.contactId).catch(() => null);
      }
      if (!uploaderContactId) {
        // Fallback for non-merchant portal users (internal staff forwarding merchant uploads)
        const { data: allContacts } = await storage.getContacts({ limit: 500 });
        uploaderContact = allContacts.find((c: any) => c.userId === user.id || c.email === user.email);
        uploaderContactId = uploaderContact?.id || null;
      }

      // For processing statements run the full 11-step chain; for other doc types use legacy path
      if (docType === "merchant_statement" && uploaderContactId) {
        const targetDealId = req.body?.dealId ? parseId(req.body.dealId) : null;

        // ── Idempotency-Key guard (required before any business mutation) ────
        const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
        if (!idempotencyKey) {
          return res.status(400).json({
            error: "MISSING_IDEMPOTENCY_KEY",
            message: "Idempotency-Key header is required. Supply a UUID v4.",
          });
        }
        if (!isValidUUIDv4(idempotencyKey)) {
          return res.status(400).json({
            error: "INVALID_IDEMPOTENCY_KEY",
            message: "Idempotency-Key must be a valid UUID v4.",
          });
        }

        const fingerprint = computeRequestFingerprint({
          fields: {
            contactId: uploaderContactId,
            dealId: targetDealId ?? null,
            source: "merchant_portal",
            workflow: "statement-upload",
            userId: user.id,
            fileName: req.file.originalname,
          },
          fileBuffer: req.file.buffer,
        });
        const ownerScope = `user:${user.id}`;

        const claim = await claimCommand({
          requestId: idempotencyKey,
          fingerprint,
          ownerScope,
          source: "merchant_portal",
          contactId: uploaderContactId,
          dealId: targetDealId ?? undefined,
        });

        if (claim.outcome === "conflict") {
          return res.status(409).json({
            error: "IDEMPOTENCY_KEY_CONFLICT",
            message: "This Idempotency-Key was already used with a different request payload.",
          });
        }
        if (claim.outcome === "scope_mismatch") {
          return res.status(403).json({
            error: "IDEMPOTENCY_KEY_SCOPE_MISMATCH",
            message: "This Idempotency-Key belongs to a different caller.",
          });
        }
        if (claim.outcome === "claimed_by_other") {
          return res.status(202).json({
            error: "IDEMPOTENCY_IN_PROGRESS",
            message: "This upload is already being processed.",
            commandId: claim.commandId,
          });
        }
        if (claim.outcome === "replay") {
          const stored = claim.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
          return res.status(200).json({
            success: true,
            replayed: true,
            statement_upload_request_id: claim.command.id,
            contactId: uploaderContactId,
            ...(stored ?? {}),
          });
        }
        if (claim.outcome === "recoverable_failed_replay") {
          // Prior attempt for this key failed recoverably — return the honest
          // stored failure; never fall through to a fresh mutation.
          const stored = claim.command.result as Record<string, unknown> | null;
          res.setHeader("Idempotency-Key", idempotencyKey);
          res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
          return res.status(422).json({
            error: "IDEMPOTENCY_KEY_RECOVERABLE_FAILED",
            message: "A prior attempt with this Idempotency-Key failed. Retry with a new Idempotency-Key.",
            replayed: true,
            statement_upload_request_id: claim.command.id,
            contactId: uploaderContactId,
            ...(stored ?? {}),
          });
        }

        const commandId = claim.command.id;
        ownedCommandId = commandId;

        // Accepted initial response. The chain is authoritative for the TERMINAL
        // command result (it calls markSucceeded / markRecoverableFailed internally
        // via commandId); the route must NOT overwrite that terminal status.
        const acceptedResponsePortal = {
          success: true,
          contactId: uploaderContactId,
          statement_upload_request_id: commandId,
        };

        // Persist context (including the accepted response) before handing off to
        // the async chain so the slot is recoverable.
        await updateContext(commandId, {
          contactId: uploaderContactId,
          dealId: targetDealId ?? null,
          source: "merchant_portal",
          workflow: "statement-upload",
          userId: user.id,
          fileName,
          acceptedResponse: acceptedResponsePortal,
        });

        // Run the full conversion chain (non-blocking — always respond 201).
        // Do NOT markSucceeded here — the chain owns its own terminal result.
        // Post-chain onboarding update runs inside owner execution only (no replay duplicates).
        const statementQueued = await persistAndEnqueueStatementCommand({
          contactId: uploaderContactId,
          dealId: targetDealId,
          fileBuffer: req.file.buffer,
          fileName,
          source: "merchant_portal",
          businessName: uploaderContact?.companyName || undefined,
          commandId,
        });
        if (!statementQueued) {
          return res.status(503).json({ error: "STATEMENT_COMMAND_QUEUE_UNAVAILABLE", statement_upload_request_id: commandId });
        }
        Promise.resolve().then(async () => {
          // Update onboarding deal doc readiness (separate from the sales chain)
          try {
            const { data: allDeals } = await storage.getDeals({ limit: 500 });
            const merchantDeals = allDeals.filter(
              d => d.pipeline === "onboarding" &&
                d.contactId === uploaderContactId &&
                !["Active (30 Days)", "Active (7 Days)"].includes(d.stage),
            );
            const dealsToUpdate = targetDealId
              ? merchantDeals.filter(d => d.id === targetDealId)
              : merchantDeals.length === 1 ? merchantDeals : [];

            const allDocs = await storage.getDocuments();

            for (const deal of dealsToUpdate) {
              const dealDocs = allDocs.filter(
                (d: any) => (d.dealId === deal.id) || (d.contactId === uploaderContactId && !d.dealId),
              );
              const hasStatement = deal.statementReceived || dealDocs.some(d => d.type === "merchant_statement");
              const hasVoidedCheck = deal.voidedCheckReceived || dealDocs.some(d => d.type === "voided_check");
              const hasId = deal.idReceived || dealDocs.some(d => d.type === "government_id");

              const docUpdates: Record<string, any> = {};
              if (hasStatement && !deal.statementReceived) docUpdates.statementReceived = true;
              if (hasVoidedCheck && !deal.voidedCheckReceived) docUpdates.voidedCheckReceived = true;
              if (hasId && !deal.idReceived) docUpdates.idReceived = true;
              const totalDocs = [hasStatement, hasVoidedCheck, hasId].filter(Boolean).length;
              docUpdates.docReadinessScore = Math.round((totalDocs / 3) * 100);
              if (Object.keys(docUpdates).length > 0) await storage.updateDeal(deal.id, docUpdates);

              if (hasStatement && hasVoidedCheck && hasId && deal.appCompleted) {
                if (deal.stage === "Contract Sent" || deal.stage === "Application Started") {
                  await advanceDealStage(deal.id, "Underwriting Submitted", "document_auto_advance");
                  await storage.createNotification({
                    channel: "internal",
                    title: "Auto-Advanced to Underwriting",
                    message: `Deal #${deal.id} auto-advanced — all documents collected.`,
                    type: "success",
                  });
                  await storage.createAuditLog({
                    action: "auto_advance_underwriting",
                    entityType: "deal",
                    entityId: deal.id,
                    details: { reason: "All documents collected and application complete", docReadinessScore: 100 },
                  });
                  const onboardingSteps = await storage.getOnboardingStepsByDeal(deal.id);
                  const docsStep = onboardingSteps.find(s => s.stepName === "Documents Collected");
                  if (docsStep && docsStep.status !== "completed") {
                    await storage.updateOnboardingStep(docsStep.id, { status: "completed", completedAt: new Date() });
                  }
                  const uwStep = onboardingSteps.find(s => s.stepName === "Underwriting Review");
                  if (uwStep && uwStep.status === "pending") {
                    await storage.updateOnboardingStep(uwStep.id, { status: "in_progress" });
                  }
                }
              }
            }
          } catch (onboardingErr: any) {
            console.error("[Portal Upload] Onboarding deal update failed (non-fatal):", onboardingErr.message);
          }
        }).catch(err => console.error("[StatementChain] Portal upload chain error:", err.message));

        res.setHeader("Idempotency-Key", idempotencyKey);
        res.setHeader("X-Statement-Upload-Request-Id", commandId);
        return res.status(202).json(acceptedResponsePortal);
      }

      // === Legacy path for non-statement document types ===
      const categoryMap: Record<string, string> = {
        merchant_statement: "Processing Statement",
        voided_check: "Voided Check",
        government_id: "Photo ID",
        application: "Application",
      };

      const storageKey = `statements/${Date.now()}_${fileName}`;
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, `${Date.now()}_${fileName}`), req.file.buffer);

      const targetDealId = req.body?.dealId ? parseId(req.body.dealId) : null;
      let associatedDealId: number | null = null;
      let dealId: number | undefined;

      if (uploaderContact) {
        const { data: allDeals } = await storage.getDeals({ limit: 500 });
        if (targetDealId) {
          const matchingDeal = allDeals.find(d => d.id === targetDealId && d.contactId === uploaderContact.id);
          if (matchingDeal) associatedDealId = matchingDeal.id;
        }
        const existingDeal = allDeals.find(d => d.contactId === uploaderContact.id);
        if (existingDeal) {
          dealId = existingDeal.id;
        } else {
          const newDeal = await storage.createDeal({
            contactId: uploaderContact.id,
            pipeline: "sales",
            stage: "Statement Received",
            notes: `Document uploaded via merchant portal: ${fileName}`,
            leadSource: "merchant_portal",
          });
          dealId = newDeal.id;
        }
      }

      // Honour explicit category from client (e.g. "KYC") — overrides filename-derived mapping
      const explicitCategory = req.body?.category;
      const resolvedCategory = explicitCategory || categoryMap[docType] || "Other";

      const doc = await storage.createDocument({
        type: docType,
        category: resolvedCategory,
        fileName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email : undefined,
        storageKey,
        accessScope: "merchant",
        contactId: uploaderContactId,
        dealId: associatedDealId || dealId,
        status: "pending",
      });

      await storage.createNotification({
        channel: "internal",
        title: "New Document Uploaded",
        message: `${user.firstName} ${user.lastName} uploaded: ${fileName} (${docType})`,
        type: "info",
        metadata: { contactId: uploaderContactId || undefined, dealId: associatedDealId || dealId || undefined },
      });

      if (dealId) {
        await storage.updateDeal(dealId, { statementReceived: true });
      }

      res.status(201).json(doc);
    } catch (err: any) {
      // Route-level error after claim (before chain hand-off) — honestly mark the
      // owned slot recoverable-failed so the key never replays as a success.
      if (ownedCommandId) {
        await markRecoverableFailed(ownedCommandId, {
          error: err?.message ?? "unknown error",
          code: err?.code ?? null,
        }).catch(() => { /* best-effort */ });
      }
      serverError(res, err);
    }
  });


  // === COLLATERAL PACKETS ===
  app.get("/api/collateral-packets", isDashboardUser, async (req, res) => {
    const packets = await storage.getCollateralPackets();
    res.json(packets);
  });

  app.post("/api/collateral-packets", isDashboardUser, async (req, res) => {
    try {
      const input = insertCollateralPacketSchema.parse(req.body);
      const packet = await storage.createCollateralPacket(input);
      res.status(201).json(packet);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      throw err;
    }
  });


  // === KNOWLEDGE BASE ===
  app.get("/api/knowledge-base", isDashboardUser, async (req, res) => {
    try {
      const articles = await storage.getPublishedArticles();
      res.json(articles);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/knowledge-base/category/:category", isDashboardUser, async (req, res) => {
    try {
      const articles = await storage.getKnowledgeBaseByCategory(req.params.category as string);
      res.json(articles);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/knowledge-base/:id", isDashboardUser, async (req, res) => {
    try {
      const kbId = parseId(req.params.id);
      if (kbId === null) return res.status(404).json({ message: "Not found" });
      const article = await storage.getKnowledgeBaseArticle(kbId);
      if (!article) return res.status(404).json({ message: "Not found" });
      res.json(article);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/knowledge-base", requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertKnowledgeBaseSchema.parse(req.body);
      const article = await storage.createKnowledgeBaseArticle(input);
      res.status(201).json(article);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/knowledge-base/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const kbUpdateId = parseId(req.params.id);
      if (kbUpdateId === null) return res.status(404).json({ message: "Not found" });
      const updated = await storage.updateKnowledgeBaseArticle(kbUpdateId, req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

}
