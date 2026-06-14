import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { upload } from "./helpers";
import { autoGenerateProposal } from "../services/proposal-engine";
import { sendSmtpEmail, isSmtpConfigured } from "../services/smtp-email";
import { isGhlConfigured } from "../services/ghl";
import { enrollInGhlWorkflow } from "../services/ghl-workflows";
import path from "path";
import fs from "fs";

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
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

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

      const openReviews = await storage.getOpenRateReviewsByContact(contact.id);
      if (openReviews.length > 0) {
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
      const assignedTo = contact.assignedTo || null;

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

      if (contactDeal?.id) {
        autoGenerateProposal(contactDeal.id, req.file.buffer).then(async () => {
          await storage.updateRateReviewRequest(rateReview.id, { status: "analysis_complete" });
          await storage.createAuditLog({
            action: "rate_review_analysis_complete",
            entityType: "rate_review_request",
            entityId: rateReview.id,
            actorType: "system",
            details: { dealId: contactDeal.id },
          });
          await storage.createNotification({
            channel: "internal",
            title: "Rate Review Analysis Ready",
            message: `AI analysis complete for ${merchantName}'s rate review. Proposal is ready to review.`,
            type: "success",
            recipientId: assignedTo || undefined,
            metadata: { contactId: contact.id, rateReviewId: rateReview.id, dealId: contactDeal.id },
          });
        }).catch(err => {
          console.error("[RateReview] Auto-proposal error:", err);
        });
      }

      const confirmationHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#1a56db;">Rate Review Request Received</h2>
          <p>Hi ${contact.firstName},</p>
          <p>We've received your rate review request and your current processing statement has been uploaded to your account.</p>
          <p><strong>What happens next:</strong></p>
          <ul>
            <li>Our team will analyze your statement using our AI pricing engine</li>
            <li>Your account representative will contact you within <strong>1 business day</strong></li>
            <li>We'll present you with optimized pricing options tailored to your business</li>
          </ul>
          <p>If you have any questions, please contact us at <a href="mailto:support@libertybancard.com">support@libertybancard.com</a> or call 954-266-8214.</p>
          <p style="color:#6b7280;font-size:12px;">Eligibility, underwriting, card brand rules, and applicable laws apply. No savings are guaranteed without full statement review.</p>
        </div>
      `;

      const ghlWorkflowId = process.env.GHL_WORKFLOW_RATE_REVIEW_CONFIRMATION;
      if (ghlWorkflowId && isGhlConfigured() && contact.ghlContactId) {
        enrollInGhlWorkflow({ workflowKey: "GHL_WORKFLOW_RATE_REVIEW_CONFIRMATION", ghlContactId: contact.ghlContactId }).catch(err =>
          console.error("[RateReview] GHL workflow enrollment error:", err)
        );
      } else if (contact.email && isSmtpConfigured()) {
        sendSmtpEmail({
          to: contact.email,
          subject: "We received your rate review request",
          html: confirmationHtml,
        }).catch(err => console.error("[RateReview] Confirmation email error:", err));
      }

      res.status(201).json({ rateReview, document: doc });
    } catch (err: any) {
      console.error("[RateReview] Error:", err);
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });
}
