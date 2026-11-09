/**
 * W-C public inquiry modes on /api/public/get-started.
 *
 * `equipment_inquiry` and `general_inquiry` are server-owned modes selected by an allowlisted request value. Each has its
 * own strict DTO, its own source policy (additive v3 only, no warm/nurture lane), and a frozen context kept on the
 * canonical occurrence. Absent mode never reaches this file: the generic get-started contract is untouched.
 *
 * Order of operations (nothing before validation touches a business table):
 *   claim (middleware, ledger row only) → strict validation (400 + failed ledger row, no contact/deal/task)
 *   → freeze context → contact → bind → optional SMS permission (only with a real number) → deal → bind → notification
 *   → authority accept → analytics (after durable acceptance only).
 * A re-entry of the same key resumes from the occurrence's committed rows, so a retry never duplicates anything.
 */
import type { Contact } from "@shared/schema";
import { inboundRequests } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { writeContact } from "../services/contact-writer";
import { processExistingPublicFormSubmission } from "../services/public-form-submission";
import { buildPublicContactPayload } from "../services/public-form-payload";
import { recordPewcDecision } from "../services/consent-evidence";
import { resolveReferralAttribution } from "../services/attribution";
import { recordAnalyticsEvent } from "../services/analytics-events";
import { FORM_SUBMITTED, DEAL_CREATED } from "@shared/analytics-events";
import { inboundShortRef } from "../services/inbound-request-authority";
import { bindOccurrenceProgress, ensureOccurrenceNotification, pewcDecisionRecorded } from "../services/public-sales-occurrence";
import {
  INQUIRY_CONTEXT_SCHEMA,
  equipmentInquirySchema,
  generalInquirySchema,
  generalIntentLabel,
  inquiryConsentIssues,
  leaseAnswerLabel,
  resolveInquiryOffer,
  volumeBandLabel,
  type InquiryContext,
  type InquiryMode,
} from "@shared/public-inquiry";
import { inboundReviewLink } from "../services/statement-review-notification";
import { trackReferral } from "./helpers";

/** Allowlisted mode → canonical source type. Anything else keeps the generic get-started contract (and its strict schema). */
export const INQUIRY_SOURCE_BY_MODE: Record<InquiryMode, readonly [string, string]> = {
  equipment_inquiry: ["website_form", "equipment_inquiry"],
  general_inquiry: ["website_form", "general_inquiry"],
};

/**
 * The source a public JSON request is claimed under. Path decides; for get-started an exactly allowlisted `mode` string
 * additionally selects a W-C inquiry source. An unrecognised mode is NOT mapped: it stays generic and the generic strict
 * schema rejects the unknown key, so a forged value can never reach an inquiry policy or the warm lane.
 */
export function resolvePublicInboundSource(
  path: string,
  body: unknown,
  table: Record<string, [string, string]>,
): readonly [string, string] | null {
  const base = table[path];
  if (!base) return null;
  if (path === "/api/public/get-started") {
    const mode = body && typeof body === "object" ? (body as Record<string, unknown>).mode : undefined;
    if (typeof mode === "string" && Object.prototype.hasOwnProperty.call(INQUIRY_SOURCE_BY_MODE, mode)) {
      return INQUIRY_SOURCE_BY_MODE[mode as InquiryMode];
    }
  }
  return base;
}

/** First-write-wins: the context frozen at first acceptance is never replaced by a later (replayed or hand-edited) call. */
export async function freezeInquiryContext(requestId: string, context: InquiryContext): Promise<InquiryContext> {
  await db.update(inboundRequests).set({ attributionRefs: context as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(eq(inboundRequests.id, requestId), isNull(inboundRequests.attributionRefs)));
  const [row] = await db.select({ refs: inboundRequests.attributionRefs }).from(inboundRequests).where(eq(inboundRequests.id, requestId)).limit(1);
  return (row?.refs as InquiryContext | null) ?? context;
}

/** Read the frozen inquiry context of a stored occurrence (null for every other source or an unrecognised shape). */
export function readInquiryContext(refs: unknown): InquiryContext | null {
  if (!refs || typeof refs !== "object") return null;
  const value = refs as Partial<InquiryContext>;
  return value.schema === INQUIRY_CONTEXT_SCHEMA && (value.mode === "equipment_inquiry" || value.mode === "general_inquiry")
    ? (value as InquiryContext)
    : null;
}

export interface InquiryDeps {
  acceptInbound: (req: any, refs: { contactId?: number | null; dealId?: number | null }) => Promise<unknown>;
  recoveredContext: (req: any, sourceType: string) => Promise<{ contact: Contact; deal: any; hasEvidence: boolean } | null>;
  respondInboundFailure: (req: any, res: any, err: unknown) => Promise<unknown>;
  failInbound: (req: any, status: number) => Promise<void>;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "_");

export async function runInquiryIntake(req: any, res: any, mode: InquiryMode, deps: InquiryDeps) {
  try {
    const submissionId = req.inboundRequestId as string;
    const schema = mode === "equipment_inquiry" ? equipmentInquirySchema : generalInquirySchema;
    const parsed = schema.safeParse(req.body);
    const issues: { path: string; message: string }[] = [];
    if (!parsed.success) {
      issues.push(...parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })));
    } else {
      issues.push(...inquiryConsentIssues(parsed.data));
      if (mode === "equipment_inquiry" && "offer" in parsed.data && parsed.data.offer !== undefined && !resolveInquiryOffer(parsed.data.offer)) {
        issues.push({ path: "offer", message: "Unsupported offer." });
      }
    }
    if (!parsed.success || issues.length) {
      // The claim ledger row already exists (the claim middleware runs first); it is closed as failed, and nothing else was written.
      await deps.failInbound(req, 400);
      return res.status(400).json({ error: "INVALID_SUBMISSION", details: issues });
    }
    const data = parsed.data;
    const offer = mode === "equipment_inquiry" ? resolveInquiryOffer((data as { offer?: string }).offer) : null;
    const nameParts = data.name.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || data.name;
    const lastName = nameParts.slice(1).join(" ");
    const phone = data.phone || "";
    const evidence = {
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"] || "unknown",
    };

    const context: InquiryContext = {
      schema: INQUIRY_CONTEXT_SCHEMA,
      mode,
      offer: offer ? { id: offer.id, version: offer.version, intent: offer.intent } : null,
      businessName: data.businessName,
      ...(mode === "equipment_inquiry"
        ? {
          businessType: (data as { businessType: string }).businessType,
          volumeBand: (data as { volumeBand: InquiryContext["volumeBand"] }).volumeBand,
          currentlyLeasing: (data as { currentlyLeasing: InquiryContext["currentlyLeasing"] }).currentlyLeasing,
        }
        : {
          intent: (data as { intent: InquiryContext["intent"] }).intent,
          ...((data as { note?: string }).note ? { note: (data as { note?: string }).note } : {}),
        }),
      phoneProvided: Boolean(phone),
      smsPermissionRequested: data.pewcConsent === true,
      attribution: {
        utmSource: data.utmSource, utmMedium: data.utmMedium, utmCampaign: data.utmCampaign, utmContent: data.utmContent,
        utmTerm: data.utmTerm, landingPage: data.landingPage, referralCode: data.referralCode,
        gclidPresent: data.gclidPresent === true || Boolean(data.gclid) || undefined,
        fbclidPresent: data.fbclidPresent === true || undefined,
        msclkidPresent: data.msclkidPresent === true || undefined,
      },
    };
    const frozen = await freezeInquiryContext(submissionId, context);

    const normalizedEmail = data.email.trim().toLowerCase();
    const sourceType = mode;
    const recovered = await deps.recoveredContext(req, sourceType);
    const existing = recovered?.contact ?? await storage.getContactByEmail(normalizedEmail);
    const landingPage = data.landingPage || (mode === "equipment_inquiry" ? "/get-started" : "/about-contact");
    let contact: Contact;
    if (recovered?.hasEvidence) {
      contact = recovered.contact;
    } else if (existing) {
      await bindOccurrenceProgress(submissionId, { contactId: existing.id });
      contact = await processExistingPublicFormSubmission({
        existingContact: existing,
        // A blank phone is dropped by the allowlist builder, so an absent number never erases a stored one.
        permittedProfileUpdates: buildPublicContactPayload(sourceType, {
          firstName, lastName, email: data.email, phone, companyName: data.businessName,
          utmSource: data.utmSource, utmMedium: data.utmMedium, utmCampaign: data.utmCampaign,
          utmContent: data.utmContent, utmTerm: data.utmTerm, landingPage,
        }),
        incomingConsent: {},
        submissionId,
        formType: sourceType,
        requestEvidence: evidence,
      });
    } else {
      contact = await writeContact({
        mode: "local_first",
        mutation: {
          firstName, lastName, email: data.email, phone,
          companyName: data.businessName,
          ...(mode === "equipment_inquiry" ? { vertical: (data as { businessType: string }).businessType } : {}),
          utmSource: data.utmSource || undefined, utmMedium: data.utmMedium || undefined, utmCampaign: data.utmCampaign || undefined,
          utmContent: data.utmContent || undefined, utmTerm: data.utmTerm || undefined,
          landingPage,
          gclid: data.gclid || undefined,
          status: "New",
          tags: ["src_website", mode === "equipment_inquiry" ? "inquiry_equipment" : "inquiry_general",
            ...(mode === "equipment_inquiry" ? [`vertical_${slug((data as { businessType: string }).businessType)}`] : [])],
        },
        provenance: { sourceCategory: "website_form", sourceType, eventKey: `form:${sourceType}:${submissionId}`, actorType: "public" },
        actor: { actorType: "public" },
      });
      await bindOccurrenceProgress(submissionId, { contactId: contact.id });
    }

    // SMS permission needs a real number (validated above) and is recorded once per occurrence, bound to the number typed.
    if (data.pewcConsent === true && phone && !(recovered && await pewcDecisionRecorded(`${sourceType}:${submissionId}`))) {
      await recordPewcDecision({
        contactId: contact.id,
        checked: true,
        source: sourceType,
        ipAddress: evidence.ipAddress,
        userAgent: evidence.userAgent,
        eventKey: `${sourceType}:${submissionId}`,
        details: { formType: sourceType, submissionId, consentedPhone: phone },
      });
    }

    const offerPath = mode === "equipment_inquiry" ? "Terminal Needed" : "Not Sure";
    const deal = recovered?.deal ?? await storage.createDeal({
      contactId: contact.id, pipeline: "sales", stage: "New Lead", inboundRequestId: submissionId,
      offerPath,
      leadSource: data.utmSource ? `utm:${data.utmSource}` : "website",
      campaignName: data.utmCampaign || undefined,
      ...(contact.partnerOrgId ? { partnerOrgId: contact.partnerOrgId } : {}),
    });
    await bindOccurrenceProgress(submissionId, { contactId: contact.id, dealId: deal.id });

    const summary = mode === "equipment_inquiry"
      ? `${data.businessName} — ${(data as { businessType: string }).businessType}; volume: ${volumeBandLabel(frozen.volumeBand) ?? "n/a"}; current lease: ${leaseAnswerLabel(frozen.currentlyLeasing) ?? "n/a"}`
      : `${data.businessName} — interested in: ${generalIntentLabel(frozen.intent) ?? "n/a"}`;
    await ensureOccurrenceNotification(submissionId, {
      channel: "#sales",
      title: mode === "equipment_inquiry" ? "New Equipment Inquiry" : "New Business Inquiry",
      message: `${data.name} — ${summary}${data.utmSource ? ` (via ${data.utmSource})` : ""}`,
      type: "info",
      // No typed contact/deal target on purpose: a fresh public contact is not yet production-classified, and a typed target
      // would hide this notification from every reader. It links to the request's review page by short reference instead.
      metadata: {
        eventType: "public_inquiry_received",
        requestId: submissionId,
        shortRef: inboundShortRef(submissionId),
        inquiryMode: mode,
        link: inboundReviewLink(submissionId),
      },
    });

    const accepted = await deps.acceptInbound(req, { contactId: contact.id, dealId: deal.id });
    // Analytics only after durable acceptance, once per logical occurrence (a recovery re-entry resumes before this point).
    recordAnalyticsEvent({
      eventName: FORM_SUBMITTED, contactId: contact.id, dealId: deal.id, sourceCategory: "website_form", formId: mode,
      utmSource: data.utmSource || undefined, utmMedium: data.utmMedium || undefined, utmCampaign: data.utmCampaign || undefined,
      utmContent: data.utmContent || undefined, utmTerm: data.utmTerm || undefined, gclidPresent: !!data.gclid,
      landingPage, offerRoute: offerPath, metadata: { formType: mode, ...(offer ? { offer: offer.id } : {}) },
    }).catch(() => {});
    recordAnalyticsEvent({
      eventName: DEAL_CREATED, contactId: contact.id, dealId: deal.id, sourceCategory: "website_form", formId: mode,
      utmSource: data.utmSource || undefined, utmMedium: data.utmMedium || undefined, utmCampaign: data.utmCampaign || undefined,
      offerRoute: offerPath, metadata: { formType: mode, stage: "New Lead" },
    }).catch(() => {});
    if (data.referralCode) {
      trackReferral(data.referralCode, data.name, data.email, phone).catch((err: unknown) => console.error("Referral tracking error:", err));
      resolveReferralAttribution(data.referralCode, contact.partnerOrgId).then(async (attr) => {
        // Existing authoritative attribution is preserved: a replay or a later form never overwrites it.
        if (attr.partnerType === "partner_org" && attr.partnerOrgId && !contact.partnerOrgId) {
          const updates: Record<string, unknown> = { partnerOrgId: attr.partnerOrgId, referralSource: attr.referralSource };
          if (attr.promoCode && !contact.promoCode) updates.promoCode = attr.promoCode;
          await storage.updateContact(contact.id, updates as Parameters<typeof storage.updateContact>[1]);
          await storage.updateDeal(deal.id, { partnerOrgId: attr.partnerOrgId });
        } else if (attr.partnerType === "affiliate_partner" && attr.promoCode && !contact.promoCode) {
          await storage.updateContact(contact.id, { promoCode: attr.promoCode, referralSource: attr.referralSource });
        } else if (attr.partnerType !== "none" && attr.referralSource && !contact.referralSource) {
          await storage.updateContact(contact.id, { referralSource: attr.referralSource });
        }
      }).catch((err: unknown) => console.error("[Attribution] inquiry error:", err));
    }

    res.status(201).json({
      ...(accepted as object),
      reference: inboundShortRef(submissionId),
      inquiry: { mode, offerId: frozen.offer?.id ?? null, offerVersion: frozen.offer?.version ?? null },
    });
  } catch (err) {
    await deps.respondInboundFailure(req, res, err);
  }
}
