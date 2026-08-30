import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { upload } from "./helpers";
import { persistAndEnqueueStatementCommand } from "../services/statement-command-worker";
import { putProtectedObject } from "../services/protected-object";
import {
  claimCommand,
  computeRequestFingerprint,
  isValidUUIDv4,
  updateContext,
  updateCommandFKs,
  markRecoverableFailed,
} from "../services/statement-upload-idempotency";
import path from "path";
import fs from "fs";
import { serverError } from "../utils/server-error";
import { authorizeContactAccess, authorizeDealAccess } from "../services/crm-object-access";

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
        const review = await storage.getRateReviewRequestByStatementUploadCommandId(claim.command.id);
        const document = review?.documentId ? await storage.getDocumentById(review.documentId) : null;
        res.setHeader("Idempotency-Key", idempotencyKey);
        res.setHeader("X-Statement-Upload-Request-Id", claim.command.id);
        return res.status(200).json({
          success: true,
          replayed: true,
          statement_upload_request_id: claim.command.id,
          ...(document ? { document } : {}),
          ...(review ? { rate_review: review } : {}),
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
      const object = await putProtectedObject({
        bytes: req.file.buffer,
        mimeType: req.file.mimetype,
        fileName,
        tenantScope: `contact:${contact.id}`,
      });
      const storageKey = object.objectRef;

      const uploadedBy = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Merchant";

      const contactDeals = await storage.getDealsByContact(contact.id);
      const contactDeal = contactDeals.find(d => d.pipeline === "sales") ?? contactDeals[0];

      const doc = await storage.createDocument({
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        type: "rate_review_statement",
        category: "Rate Review Statement",
        fileName,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy,
        storageKey,
        accessScope: "merchant",
      });

      // This is an internal, request-owned CRM record, not a proposal or
      // delivery effect.  It must exist before the generic statement handoff
      // so portal/CRM status endpoints can immediately see and progress it.
      const review = await storage.createRateReviewRequest({
        statementUploadCommandId: commandId,
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        documentId: doc.id,
        status: "requested",
        requestNotes: req.body?.notes || null,
      });
      await updateCommandFKs(commandId, {
        contactId: contact.id,
        dealId: contactDeal?.id ?? undefined,
        documentId: doc.id,
      });

      // The leased statement command owns all generic downstream work. The
      // route does not send proposals or invoke external effects.
      const merchantName = contact.companyName || `${contact.firstName} ${contact.lastName}`;

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
          document: doc as unknown as Record<string, unknown>,
          rate_review: review as unknown as Record<string, unknown>,
          statement_upload_request_id: commandId,
        },
      });

      // Hand off to the durable generic statement command (non-blocking).
      // commandId ensures the worker marks the idempotency slot terminal on completion.
      // existingDocumentId makes chain Step 4 reuse the rate_review_statement document
      // created above instead of writing a duplicate file + document row.
      // Do NOT markSucceeded here — the chain owns its own terminal result.
      const statementQueued = await persistAndEnqueueStatementCommand({
        contactId: contact.id,
        dealId: contactDeal?.id ?? null,
        fileName: req.file.originalname,
        protectedObjectRef: object.objectRef,
        protectedObjectChecksum: object.checksumSha256,
        source: "portal-rate-review",
        businessName: merchantName,
        commandId,
        existingDocumentId: doc.id,
      });
      if (!statementQueued) {
        await markRecoverableFailed(commandId, {
          error: "STATEMENT_COMMAND_QUEUE_UNAVAILABLE",
          rate_review_request_id: review.id,
        });
        return res.status(503).json({ error: "STATEMENT_COMMAND_QUEUE_UNAVAILABLE", statement_upload_request_id: commandId });
      }

      res.setHeader("Idempotency-Key", idempotencyKey);
      res.setHeader("X-Statement-Upload-Request-Id", commandId);
      res.status(202).json({
        document: doc,
        rate_review: review,
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
      if (!await authorizeContactAccess(req, res, contactId)) return;
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
      if (!review.contactId || !await authorizeContactAccess(req, res, review.contactId)) return;

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
      if (!review.contactId || !await authorizeContactAccess(req, res, review.contactId)) return;

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
      if (!review.contactId || !await authorizeContactAccess(req, res, review.contactId)) return;

      if (!review.dealId) {
        return res.status(400).json({ message: "No deal associated with this rate review. Create or link a deal first." });
      }

      const deal = await authorizeDealAccess(req, res, review.dealId);
      if (!deal) return;

      // Direct proposal launches are retired. Proposal creation/sending requires
      // the reviewed proposal authority and a durable held effect intent.
      res.status(409).json({
        code: "PROPOSAL_REVIEW_REQUIRED",
        message: "Direct proposal generation is unavailable; submit through the reviewed proposal workflow.",
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
