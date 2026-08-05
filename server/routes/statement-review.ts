/**
 * Statement Review Routes — /api/statement-reviews/*
 *
 * Analyst workflow for processing statement reviews:
 * received → in_review → ai_analyzed → reviewed → follow_up_sent → complete
 */
import type { Express } from "express";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import {
  createStatementReview,
  getStatementReviews,
  getStatementReview,
  updateStatementReview,
} from "../storage/inbox";
import { z } from "zod";
import { serverError } from "../utils/server-error";

const VALID_STATUSES = [
  "received",
  "in_review",
  "ai_analyzed",
  "reviewed",
  "follow_up_sent",
  "complete",
] as const;

function buildFollowUpDraft(params: {
  contactName: string;
  companyName: string;
  effectiveRate?: string;
  monthlyVolume?: string;
  savingsEstimate?: string;
  processor?: string;
}): string {
  const { contactName, companyName, effectiveRate, monthlyVolume, savingsEstimate, processor } = params;
  const firstName = contactName.split(" ")[0] || "there";
  const savings = savingsEstimate || "significant savings";
  const rateInfo = effectiveRate ? `Your current effective rate is approximately ${effectiveRate}` : "Based on your processing statement";
  const volumeInfo = monthlyVolume ? ` on ~$${monthlyVolume}/month in volume` : "";
  const processorInfo = processor ? ` (currently with ${processor})` : "";

  return `Hi ${firstName},

Thank you for submitting your processing statement${processorInfo}. Our team has completed a full review for ${companyName || "your business"}.

Here's what we found:

${rateInfo}${volumeInfo}, we've identified potential savings of ${savings} per year by switching to our program.

Key findings from your statement:
• Effective rate is above the industry benchmark for your vertical
• Several fee categories show room for immediate reduction
• Our Cash Discount or Interchange+ program would be a strong fit

Next step: Let's connect for a 10-minute call to walk through the numbers and answer any questions.

Book a time that works for you: ${process.env.GHL_CALENDAR_BOOKING_URL || "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr"}

There's no obligation — just a clear picture of what you could save.

Best,
Liberty Bancard Team`;
}

export function registerStatementReviewRoutes(app: Express) {
  // GET /api/statement-reviews — list all reviews
  app.get("/api/statement-reviews", isDashboardUser, async (req, res) => {
    try {
      const reviews = await getStatementReviews();

      // Enrich with contact and document info
      const enriched = await Promise.all(
        reviews.map(async (r) => {
          let contactName = "";
          let companyName = "";
          let documentName = "";

          if (r.contactId) {
            try {
              const c = await storage.getContact(r.contactId);
              if (c) {
                contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "";
                companyName = c.companyName || "";
              }
            } catch { /* ignore */ }
          }

          if (r.documentId) {
            try {
              const doc = await storage.getDocumentById(r.documentId);
              if (doc) documentName = doc.fileName;
            } catch { /* ignore */ }
          }

          return { ...r, contactName, companyName, documentName };
        })
      );

      res.json(enriched);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/statement-reviews/:id — single review
  app.get("/api/statement-reviews/:id", isDashboardUser, async (req, res) => {
    try {
      const review = await getStatementReview(Number(req.params.id));
      if (!review) return res.status(404).json({ message: "Statement review not found" });

      let contactName = "";
      let companyName = "";
      let documentName = "";
      let deal: any = null;

      if (review.contactId) {
        try {
          const c = await storage.getContact(review.contactId);
          if (c) {
            contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "";
            companyName = c.companyName || "";
          }
        } catch { /* ignore */ }
      }

      if (review.documentId) {
        try {
          const doc = await storage.getDocumentById(review.documentId);
          if (doc) documentName = doc.fileName;
        } catch { /* ignore */ }
      }

      if (review.dealId) {
        try {
          deal = await storage.getDeal(review.dealId);
        } catch { /* ignore */ }
      }

      res.json({ ...review, contactName, companyName, documentName, deal });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH /api/statement-reviews/:id — update review (status, analyst, notes, savings override)
  app.patch("/api/statement-reviews/:id", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const user = req.user as any;

      const updateSchema = z.object({
        status: z.enum(VALID_STATUSES).optional(),
        analystId: z.string().optional(),
        analystName: z.string().optional(),
        analystNotes: z.string().optional(),
        savingsEstimateOverride: z.string().optional(),
        followUpDraft: z.string().optional(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const existing = await getStatementReview(id);
      if (!existing) return res.status(404).json({ message: "Statement review not found" });

      const updates: Record<string, any> = { ...parsed.data };

      // Auto-set analystName from user if assigning analyst without a name
      if (updates.analystId && !updates.analystName) {
        updates.analystName = user?.firstName
          ? `${user.firstName} ${user.lastName || ""}`.trim()
          : user?.email || "Unknown";
      }

      // Auto-set reviewedAt when marking reviewed
      if (updates.status === "reviewed" && !existing.reviewedAt) {
        updates.reviewedAt = new Date();
      }

      // Auto-set followUpSentAt when marking follow_up_sent
      if (updates.status === "follow_up_sent" && !existing.followUpSentAt) {
        updates.followUpSentAt = new Date();
      }

      // Auto-assign analyst if unset and user is logged in
      if (updates.status && updates.status !== "received" && !existing.analystId && !updates.analystId) {
        updates.analystId = String(user?.id || "");
        updates.analystName = user?.firstName
          ? `${user.firstName} ${user.lastName || ""}`.trim()
          : user?.email || "Unknown";
      }

      const updated = await updateStatementReview(id, updates);

      // Audit log every status change
      await storage.createAuditLog({
        userId: String(user?.id || ""),
        action: "statement_review_updated",
        entityType: "statement_review",
        entityId: id,
        actorType: "user",
        actorId: String(user?.id || ""),
        details: {
          from: existing.status,
          to: updates.status || existing.status,
          changes: Object.keys(parsed.data),
        },
      });

      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/statement-reviews/:id/follow-up-draft — generate merchant-facing summary draft
  app.post("/api/statement-reviews/:id/follow-up-draft", isDashboardUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const review = await getStatementReview(id);
      if (!review) return res.status(404).json({ message: "Statement review not found" });

      let contactName = "";
      let companyName = "";

      if (review.contactId) {
        try {
          const c = await storage.getContact(review.contactId);
          if (c) {
            contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "";
            companyName = c.companyName || "";
          }
        } catch { /* ignore */ }
      }

      // Pull AI summary metrics if available
      const aiSummary = review.aiSummary as any;
      const effectiveRate = aiSummary?.effectiveRate || aiSummary?.current?.effectiveRate || "";
      const monthlyVolume = aiSummary?.monthlyVolume || aiSummary?.current?.monthlyVolume || "";
      const processor = aiSummary?.processor || aiSummary?.current?.processor || "";
      const savingsEstimate =
        review.savingsEstimateOverride ||
        aiSummary?.potentialSavings ||
        aiSummary?.annualSavings ||
        aiSummary?.monthlySavings ||
        "";

      const draft = buildFollowUpDraft({
        contactName,
        companyName,
        effectiveRate: effectiveRate ? String(effectiveRate) : undefined,
        monthlyVolume: monthlyVolume ? String(monthlyVolume) : undefined,
        savingsEstimate: savingsEstimate ? String(savingsEstimate) : undefined,
        processor: processor ? String(processor) : undefined,
      });

      // Persist draft on the review record
      await updateStatementReview(id, { followUpDraft: draft });

      const user = req.user as any;
      await storage.createAuditLog({
        userId: String(user?.id || ""),
        action: "statement_review_follow_up_draft_generated",
        entityType: "statement_review",
        entityId: id,
        actorType: "user",
        actorId: String(user?.id || ""),
        details: { contactId: review.contactId, dealId: review.dealId },
      });

      res.json({ draft });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/statement-reviews — create a review (normally auto-created on upload)
  app.post("/api/statement-reviews", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        documentId: z.number().optional(),
        contactId: z.number().optional(),
        dealId: z.number().optional(),
        status: z.enum(VALID_STATUSES).optional(),
        analystName: z.string().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      const review = await createStatementReview({
        ...parsed.data,
        status: parsed.data.status || "received",
      });

      res.status(201).json(review);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
