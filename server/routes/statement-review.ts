/**
 * Statement Review Routes — /api/statement-reviews/*
 *
 * Analyst workflow for processing statement reviews:
 * received → in_review → ai_analyzed → reviewed → complete (draft-only)
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
import { observeCommercialReportingPopulation } from "../services/commercial-resolution";
import { authorizeContactAccess, authorizeDealAccess } from "../services/crm-object-access";

const DRAFT_STATUSES = ["received", "in_review", "ai_analyzed", "reviewed", "complete"] as const;
const TRANSITIONS: Record<string, readonly string[]> = {
  received: ["in_review"],
  in_review: ["ai_analyzed"],
  ai_analyzed: ["reviewed"],
  reviewed: ["complete"],
  complete: [],
  // Retained only to read historic records; no new "sent" assertion is allowed.
  follow_up_sent: [],
};

async function authorizeReview(req: any, res: any, review: any, exact = false) {
  if (!review) {
    res.status(404).json({ message: "Statement review not found" });
    return false;
  }
  if (!review.contactId) {
    res.status(404).json({ message: "Statement review has no linked contact" });
    return false;
  }
  const contact = await authorizeContactAccess(req, res, review.contactId, { exactAssignment: exact });
  if (!contact) return false;
  if (review.dealId) {
    const deal = await authorizeDealAccess(req, res, review.dealId, { exactAssignment: exact });
    if (!deal || deal.contactId !== review.contactId) {
      if (deal) res.status(409).json({ message: "Review deal/contact relationship is inconsistent" });
      return false;
    }
  }
  if (review.documentId) {
    const doc = await storage.getDocumentById(review.documentId);
    if (!doc || (doc.contactId && doc.contactId !== review.contactId) || (review.dealId && doc.dealId && doc.dealId !== review.dealId)) {
      res.status(409).json({ message: "Review document relationship is inconsistent" });
      return false;
    }
  }
  return contact;
}

function buildFollowUpDraft(params: {
  contactName: string;
  companyName: string;
  processor?: string;
  savings?: { amount: string; currency: string; period: "annual" | "monthly" };
}): string {
  const { contactName, companyName, processor, savings } = params;
  const firstName = contactName.split(" ")[0] || "there";
  const processorInfo = processor ? ` (currently with ${processor})` : "";
  const savingsText = savings
    ? `Our documented estimate identifies potential savings of ${savings.currency} ${savings.amount} per ${savings.period}.`
    : "We have prepared a review draft for your discussion.";

  return `Hi ${firstName},

Thank you for submitting your processing statement${processorInfo}. Our team has completed a review draft for ${companyName || "your business"}.

${savingsText}

Next step: Let's connect for a 10-minute call to walk through the review and answer any questions.

Book a time that works for you: ${process.env.GHL_CALENDAR_BOOKING_URL || "https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr"}

There's no obligation — just a chance to discuss the review.

Best,
Liberty Bancard Team`;
}

export function registerStatementReviewRoutes(app: Express) {
  app.use("/api/statement-reviews", async (req, _res, next) => {
    if (req.user) await Promise.all([
      observeCommercialReportingPopulation({ subjectType: "contact", actor: req.user as any }),
      observeCommercialReportingPopulation({ subjectType: "deal", actor: req.user as any }),
    ]).catch((error) => console.error("[CRO02_STATEMENT_OBSERVATION_FAILED]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    next();
  });
  // GET /api/statement-reviews — list all reviews
  app.get("/api/statement-reviews", isDashboardUser, async (req, res) => {
    try {
      const allReviews = await getStatementReviews();
      const visible = await Promise.all(allReviews.map(async (review) =>
        (await authorizeReview(req, { status: () => ({ json: () => undefined }) } as any, review)) ? review : null,
      ));
      const reviews = visible.filter(Boolean) as typeof allReviews;

      // Enrich with contact and document info
      const enriched = await Promise.all(
        reviews.map(async (r) => {
          let contactName = "";
          let companyName = "";
          let documentName = "";
          const relatedData: Record<string, "ok" | "missing" | "unavailable"> = {};

          if (r.contactId) {
            try {
              const c = await storage.getContact(r.contactId);
              if (c) {
                contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "";
                companyName = c.companyName || "";
                relatedData.contact = "ok";
              } else {
                relatedData.contact = "missing";
              }
            } catch { relatedData.contact = "unavailable"; }
          }

          if (r.documentId) {
            try {
              const doc = await storage.getDocumentById(r.documentId);
              if (doc) {
                documentName = doc.fileName;
                relatedData.document = "ok";
              } else relatedData.document = "missing";
            } catch { relatedData.document = "unavailable"; }
          }

          return { ...r, contactName, companyName, documentName, relatedData };
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
      if (!review || !await authorizeReview(req, res, review)) return;

      let contactName = "";
      let companyName = "";
      let documentName = "";
      let deal: any = null;
      const relatedData: Record<string, "ok" | "missing" | "unavailable"> = {};

      if (review.contactId) {
        try {
          const c = await storage.getContact(review.contactId);
          if (c) {
            contactName = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "";
            companyName = c.companyName || "";
            relatedData.contact = "ok";
          } else {
            relatedData.contact = "missing";
          }
        } catch { relatedData.contact = "unavailable"; }
      }

      if (review.documentId) {
        try {
          const doc = await storage.getDocumentById(review.documentId);
          if (doc) {
            documentName = doc.fileName;
            relatedData.document = "ok";
          } else relatedData.document = "missing";
        } catch { relatedData.document = "unavailable"; }
      }

      if (review.dealId) {
        try {
          const rawDeal = await storage.getDeal(review.dealId);
          if (rawDeal) {
            // REV-05A: mask raw MID from deal before returning to the client.
            // Full MIDs are available only via dedicated receipted endpoints.
            const { serializeDeal } = await import("../utils/mask-mid");
            deal = serializeDeal(rawDeal as any);
            relatedData.deal = "ok";
          } else {
            relatedData.deal = "missing";
          }
        } catch { relatedData.deal = "unavailable"; }
      }

      res.json({ ...review, contactName, companyName, documentName, deal, relatedData });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH is an analyst-owned, optimistic-concurrency controlled draft workflow.
  app.patch("/api/statement-reviews/:id", requireRole("admin", "manager", "agent"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const user = req.user as any;

      const updateSchema = z.object({
        status: z.enum(DRAFT_STATUSES).optional(),
        analystNotes: z.string().max(10000).optional(),
        savingsEstimateOverride: z.string().regex(/^\d+(?:\.\d{1,2})?$/).optional(),
        followUpDraft: z.string().max(20000).optional(),
        version: z.number().int().nonnegative(),
      });

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const existing = await getStatementReview(id);
      if (!existing || !await authorizeReview(req, res, existing, true)) return;
      if (parsed.data.version !== existing.version) {
        return res.status(409).json({ code: "STATEMENT_REVIEW_VERSION_CONFLICT", currentVersion: existing.version });
      }
      const existingStatus = existing.status ?? "received";
      if (parsed.data.status && !TRANSITIONS[existingStatus]?.includes(parsed.data.status)) {
        return res.status(409).json({ message: "Invalid statement review status transition" });
      }

      const updates: Record<string, any> = { ...parsed.data };
      delete updates.version;

      // Auto-set analystName from user if assigning analyst without a name
      const actorId = String(user?.id || "");
      const actorName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : user?.email || "Unknown";
      if (existing.analystId && existing.analystId !== actorId && user?.role === "agent") {
        return res.status(403).json({ message: "Review is assigned to another analyst" });
      }
      updates.analystId = existing.analystId || actorId;
      updates.analystName = existing.analystName || actorName;

      // Auto-set reviewedAt when marking reviewed
      if (updates.status === "reviewed" && !existing.reviewedAt) {
        updates.reviewedAt = new Date();
      }

      if (updates.savingsEstimateOverride !== undefined) {
        if (!existing.documentId || !existing.aiSummary) {
          return res.status(409).json({ message: "Savings override requires an analyzed statement document as evidence" });
        }
        updates.savingsEvidence = {
          documentId: existing.documentId,
          aiSummaryRecordedAt: existing.updatedAt,
          overriddenBy: actorId,
          amount: updates.savingsEstimateOverride,
          currency: "USD",
          period: "annual",
        };
      }

      const updated = await updateStatementReview(id, updates, existing.version);
      if (!updated) return res.status(409).json({ code: "STATEMENT_REVIEW_VERSION_CONFLICT" });

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
      if (!review || !await authorizeReview(req, res, review, true)) return;

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

      // Unstructured AI values are not evidence for merchant-facing claims.
      const aiSummary = review.aiSummary as any;
      const processor = aiSummary?.processor || aiSummary?.current?.processor || "";
      const evidence = review.savingsEvidence as any;
      const savings = evidence?.documentId === review.documentId
        && typeof evidence.amount === "string"
        && /^\d+(?:\.\d{1,2})?$/.test(evidence.amount)
        && typeof evidence.currency === "string"
        && (evidence.period === "annual" || evidence.period === "monthly")
        ? { amount: evidence.amount, currency: evidence.currency, period: evidence.period }
        : undefined;

      const draft = buildFollowUpDraft({
        contactName,
        companyName,
        processor: processor ? String(processor) : undefined,
        savings,
      });

      // Persist draft on the review record
      const updated = await updateStatementReview(id, { followUpDraft: draft }, review.version);
      if (!updated) return res.status(409).json({ code: "STATEMENT_REVIEW_VERSION_CONFLICT" });

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

      res.json({ draft, review: updated });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/statement-reviews — create a review (normally auto-created on upload)
  app.post("/api/statement-reviews", requireRole("admin", "manager"), async (req, res) => {
    try {
      const schema = z.object({
        documentId: z.number().int().positive().optional(),
        contactId: z.number().int().positive().optional(),
        dealId: z.number().int().positive().optional(),
        createCommandKey: z.string().min(16).max(200),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });

      if (!parsed.data.documentId && !parsed.data.contactId) return res.status(400).json({ message: "documentId or contactId is required" });
      const doc = parsed.data.documentId ? await storage.getDocumentById(parsed.data.documentId) : undefined;
      if (parsed.data.documentId && !doc) return res.status(404).json({ message: "Statement document not found" });
      const contactId = doc?.contactId ?? parsed.data.contactId;
      if (!contactId || !await authorizeContactAccess(req, res, contactId, { exactAssignment: true })) return;
      const dealId = doc?.dealId ?? parsed.data.dealId;
      if (parsed.data.contactId && parsed.data.contactId !== contactId) return res.status(409).json({ message: "Document does not belong to contact" });
      if (dealId) {
        const deal = await authorizeDealAccess(req, res, dealId, { exactAssignment: true });
        if (!deal) return;
        if (deal.contactId !== contactId || (doc?.dealId && doc.dealId !== dealId)) return res.status(409).json({ message: "Deal does not belong to contact/document" });
      }
      const review = await createStatementReview({
        documentId: parsed.data.documentId,
        contactId,
        dealId: dealId ?? null,
        createCommandKey: parsed.data.createCommandKey,
        status: "received",
      });

      res.status(201).json(review);
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
