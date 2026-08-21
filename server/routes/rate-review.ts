import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { upload } from "./helpers";
import { autoGenerateProposal } from "../services/proposal-engine";
import { runStatementUploadChain } from "../services/statement-upload-chain";
import {
  claimCommand,
  computeRequestFingerprint,
  isValidUUIDv4,
  updateContext,
  markRecoverableFailed,
} from "../services/statement-upload-idempotency";
import path from "path";
import fs from "fs";
import { serverError } from "../utils/server-error";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isEligibleForRateReview(profile: { accountStatus: string | null; goLiveDate: Date | null | string }): boolean {
  if (profile.accountStatus !== "active") return false;
  if (!profile.goLiveDate) return false;
  const goLive = new Date(profile.goLiveDate);
  return Date.now() - goLive.getTime() > THIRTY_DAYS_MS;
}

export function registerRateReviewRoutes(app: Express) {
  // === MERCHANT PORTAL: submit a rate review request ===
  app.post("/api/merchant-portal/rate-review", isAuthenticated, upload.single("file"), async (req, res) => {
    // Tracks the idempotency slot we own so post-claim errors/early returns can
    // honestly mark the command recoverable-failed instead of leaving it in_progress.
    let ownedCommandId: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

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
      const userId = user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });

      const profile = await storage.getMerchantProfileByUser(userId);
      if (!profile) return res.status(404).json({ message: "Merchant profile not found" });

      if (!isEligibleForRateReview(profile)) {
        return res.status(403).json({
          message: "Rate review is available to active merchants after 30 days of processing.",
        });
      }

      const contact = profile.contactId ? await storage.getContact(profile.contactId) : null;
      if (!contact) return res.status(404).json({ message: "Associated contact not found" });

      // ── Compute fingerprint and claim idempotency slot ────────────────────
      const fingerprint = computeRequestFingerprint({
        fields: {
          contactId: contact.id,
          source: "portal-rate-review",
          workflow: "rate-review-upload",
          userId,
          fileName: req.file.originalname,
          notes: req.body?.notes || null,
        },
        fileBuffer: req.file.buffer,
      });
      const ownerScope = `user:${userId}`;

      const claim = await claimCommand({
        requestId: idempotencyKey,
        fingerprint,
        ownerScope,
        source: "portal-rate-review",
        contactId: contact.id,
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
          message: "This rate review upload is already being processed.",
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
          ...(stored ?? {}),
        });
      }
      if (claim.outcome === "recoverable_failed_replay") {
        // Prior attempt for this key failed recoverably — surface the stored
        // failure honestly; never fall through to a fresh mutation.
        const stored = claim.command.result as Record<string, unknown> | null;
        res.setHeader("Idempotency-Key", idempotencyKey);
        res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
        return res.status(422).json({
          error: "IDEMPOTENCY_KEY_RECOVERABLE_FAILED",
          message: "A prior attempt with this Idempotency-Key failed. Retry with a new Idempotency-Key.",
          replayed: true,
          statement_upload_request_id: claim.command.id,
          ...(stored ?? {}),
        });
      }

      const commandId = claim.command.id;
      ownedCommandId = commandId;

      // Persist context before any business mutations so the slot is recoverable.
      await updateContext(commandId, {
        contactId: contact.id,
        source: "portal-rate-review",
        workflow: "rate-review-upload",
        userId,
        fileName: req.file.originalname,
        notes: req.body?.notes || null,
      });

      const openReviews = await storage.getOpenRateReviewsByContact(contact.id);
      if (openReviews.length > 0) {
        // Business early return after claim — mark the slot recoverable-failed so
        // it never replays as a success and can be retried with a new key.
        await markRecoverableFailed(commandId, {
          error: "OPEN_RATE_REVIEW_EXISTS",
          message: "An open rate review already exists for this contact.",
        }).catch(() => { /* best-effort */ });
        return res.status(409).json({
          message: "You already have an open rate review request. Please wait for it to be resolved before submitting another.",
          existing: openReviews[0],
        });
      }

      const fileName = req.file.originalname;
      const timestamp = Date.now();
      const safeFileName = `${timestamp}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const storageKey = `merchant_docs/${safeFileName}`;

      const uploadsDir = path.join(process.cwd(), "uploads", "merchant_docs");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, safeFileName), req.file.buffer);

      const uploadedBy = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Merchant";

      const doc = await storage.createDocument({
        contactId: contact.id,
        dealId: null,
        type: "rate_review_statement",
        category: "Rate Review Statement",
        fileName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy,
        storageKey,
        accessScope: "merchant",
      });

      const contactDeals = await storage.getDealsByContact(contact.id);
      const contactDeal = contactDeals.find(d => d.pipeline === "sales") ?? contactDeals[0];

      const rateReview = await storage.createRateReviewRequest({
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        documentId: doc.id,
        status: "requested",
        requestNotes: req.body?.notes || null,
      });

      const merchantName = contact.companyName || `${contact.firstName} ${contact.lastName}`;
      const taskTitle = `Rate Review Requested — ${merchantName}`;
      const assignedTo = (contact as any).assignedTo || null;

      await storage.createTask({
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        title: taskTitle,
        description: `${merchantName} has requested a rate review via the merchant portal. A current processing statement has been uploaded for your analysis. Review the statement and generate a retention proposal within 1 business day.`,
        assignedTo: assignedTo || undefined,
        priority: "high",
        status: "pending",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await storage.createNotification({
        channel: "internal",
        title: "Rate Review Requested",
        message: `${merchantName} has requested a rate review. Statement uploaded — please review within 1 business day.`,
        type: "info",
        recipientId: assignedTo || undefined,
        metadata: {
          contactId: contact.id,
          dealId: contactDeal?.id,
          rateReviewId: rateReview.id,
          documentId: doc.id,
        },
      });

      await storage.createAuditLog({
        action: "rate_review_requested",
        entityType: "rate_review_request",
        entityId: rateReview.id,
        actorType: "merchant",
        actorId: userId,
        details: {
          contactId: contact.id,
          documentId: doc.id,
          merchantName,
          dealId: contactDeal?.id ?? null,
        },
      });

      // Persist the accepted initial response into context so the slot is
      // recoverable. The chain is authoritative for the TERMINAL command result
      // (it calls markSucceeded / markRecoverableFailed internally via commandId);
      // the route must NOT overwrite that terminal status.
      await updateContext(commandId, {
        contactId: contact.id,
        source: "portal-rate-review",
        workflow: "rate-review-upload",
        userId,
        fileName: req.file.originalname,
        notes: req.body?.notes || null,
        acceptedResponse: {
          rateReview: rateReview as unknown as Record<string, unknown>,
          document: doc as unknown as Record<string, unknown>,
          statement_upload_request_id: commandId,
        },
      });

      // Fire the full 11-step statement upload chain (non-blocking).
      // This handles GHL sync, pipeline advance, rep notification with correct userId,
      // proposal draft entity creation, and sequence enrollment — same as all other upload paths.
      // commandId ensures the chain marks the idempotency slot terminal on completion.
      // existingDocumentId makes chain Step 4 reuse the rate_review_statement document
      // created above instead of writing a duplicate file + document row.
      // Do NOT markSucceeded here — the chain owns its own terminal result.
      runStatementUploadChain({
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
        source: "portal-rate-review",
        businessName: merchantName,
        commandId,
        existingDocumentId: doc.id,
      }).catch(err => console.error("[RateReview] 11-step chain error:", err.message));

      res.setHeader("Idempotency-Key", idempotencyKey);
      res.setHeader("X-Statement-Upload-Request-Id", commandId);
      res.status(201).json({
        rateReview,
        document: doc,
        statement_upload_request_id: commandId,
      });
    } catch (err: any) {
      // Route-level error after claim — honestly mark the owned slot
      // recoverable-failed so the key never replays as a success.
      if (ownedCommandId) {
        await markRecoverableFailed(ownedCommandId, {
          error: err?.message ?? "unknown error",
          code: err?.code ?? null,
        }).catch(() => { /* best-effort */ });
      }
      console.error("[RateReview] Error:", err);
      serverError(res, err);
    }
  });

  // === MERCHANT PORTAL: get own rate review status ===
  app.get("/api/merchant-portal/rate-review", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const profile = await storage.getMerchantProfileByUser(user?.id);
      if (!profile?.contactId) return res.json({ reviews: [], eligible: false });

      const isEligible = isEligibleForRateReview(profile);
      const reviews = await storage.getRateReviewRequestsByContact(profile.contactId);

      const reviewsWithDocs = await Promise.all(
        reviews.map(async (r) => {
          const doc = r.documentId ? await storage.getDocumentById(r.documentId) : null;
          return { ...r, document: doc };
        })
      );

      res.json({ reviews: reviewsWithDocs, eligible: isEligible });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CRM: get all rate reviews for a contact ===
  app.get("/api/rate-reviews/contact/:contactId", isDashboardUser, async (req, res) => {
    try {
      const contactId = Number(req.params.contactId);
      const reviews = await storage.getRateReviewRequestsByContact(contactId);

      const enriched = await Promise.all(
        reviews.map(async (r) => {
          const doc = r.documentId ? await storage.getDocumentById(r.documentId) : null;
          return { ...r, document: doc };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CRM: mark rate review as viewed by rep ===
  app.post("/api/rate-reviews/:id/mark-viewed", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await storage.getRateReviewRequest(id);
      if (!review) return res.status(404).json({ message: "Rate review not found" });

      if (!review.repViewedAt) {
        const updated = await storage.updateRateReviewRequest(id, {
          repViewedAt: new Date(),
          status: review.status === "requested" ? "rep_viewed" : review.status,
        });
        await storage.createAuditLog({
          action: "rate_review_rep_viewed",
          entityType: "rate_review_request",
          entityId: id,
          actorType: "user",
          actorId: (req.user as any)?.id,
          details: {},
        });
        return res.json(updated);
      }

      res.json(review);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CRM: update rate review status / resolution ===
  app.patch("/api/rate-reviews/:id", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await storage.getRateReviewRequest(id);
      if (!review) return res.status(404).json({ message: "Rate review not found" });

      const user = req.user as any;
      const updates: Record<string, any> = {};
      const allowed = ["status", "resolution", "requestNotes", "isOptimalPricing"];
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }

      if (req.body.status === "resolved" && !review.resolvedAt) {
        updates.resolvedAt = new Date();
        updates.resolvedBy = `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || user?.email || "Unknown";
      }

      const updated = await storage.updateRateReviewRequest(id, updates);

      await storage.createAuditLog({
        action: "rate_review_updated",
        entityType: "rate_review_request",
        entityId: id,
        actorType: "user",
        actorId: user?.id,
        details: updates,
      });

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === CRM: generate retention proposal from a rate review ===
  app.post("/api/rate-reviews/:id/generate-proposal", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await storage.getRateReviewRequest(id);
      if (!review) return res.status(404).json({ message: "Rate review not found" });

      if (!review.dealId) {
        return res.status(400).json({ message: "No deal associated with this rate review. Create or link a deal first." });
      }

      const deal = await storage.getDeal(review.dealId);
      if (!deal) return res.status(404).json({ message: "Associated deal not found" });

      const contact = review.contactId ? await storage.getContact(review.contactId) : null;

      await storage.updateDeal(review.dealId, {
        notes: `${deal.notes || ""}\n[RETENTION] Rate review requested by merchant on ${new Date().toLocaleDateString()}. Proposal type: retention.`.trim(),
        statementReceived: true,
      });

      autoGenerateProposal(review.dealId).catch(err =>
        console.error("[RateReview] Retention proposal generation error:", err)
      );

      await storage.updateRateReviewRequest(id, { status: "proposal_sent" });

      await storage.createAuditLog({
        action: "rate_review_proposal_generated",
        entityType: "rate_review_request",
        entityId: id,
        actorType: "user",
        actorId: (req.user as any)?.id,
        details: {
          dealId: review.dealId,
          contactId: review.contactId,
          proposalType: "retention",
          isOptimalPricing: review.isOptimalPricing,
        },
      });

      if (contact) {
        await storage.createNotification({
          channel: "internal",
          title: "Retention Proposal Queued",
          message: `Retention proposal generation started for ${contact.companyName || contact.firstName} — rate review #${id}`,
          type: "info",
          metadata: { contactId: contact.id, dealId: review.dealId, rateReviewId: id },
        });
      }

      res.json({ message: "Retention proposal generation started", dealId: review.dealId });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
