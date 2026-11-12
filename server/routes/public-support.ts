/**
 * /api/public/support: validation, then a fixed per-effect sequence (see public-support-occurrence.ts).
 *
 * A request that fails AFTER something durable exists (the contact is bound, or the ticket is written) is answered with a
 * truthful recoverable 202 and held for a same-key re-entry, never a generic invalid-form 400. A request that fails before
 * anything exists is closed as failed. Support never creates a deal, sales assignment or promotional enrollment (its
 * source policy forbids them), and a text-message permission is optional and only honoured with a real phone number.
 */
import { z } from "zod";
import type { Contact } from "@shared/schema";
import { storage } from "../storage";
import { writeContact } from "../services/contact-writer";
import { processExistingPublicFormSubmission } from "../services/public-form-submission";
import { buildPublicContactPayload } from "../services/public-form-payload";
import { applyConsentCommand } from "../services/consent-authority";
import { inboundShortRef, setInboundRequestLifecycle } from "../services/inbound-request-authority";
import {
  INBOUND_HANDOFF_RECOVERABLE,
  bindOccurrenceProgress,
  contactHasOccurrenceEvidence,
  ensureOccurrenceNotification,
  resolveCommittedOccurrenceProgress,
} from "../services/public-sales-occurrence";
import { ensureSupportReceiptComment, findSupportTicket } from "../services/public-support-occurrence";
import { resolveDefaultOwnerEmail } from "../services/inbound-default-owner";
import { inboundReviewLink } from "../services/statement-review-notification";
import { isPlausibleInquiryPhone } from "@shared/public-inquiry";

export const SUPPORT_ISSUE_TYPES = ["Funding / Deposits", "Terminal", "Chargeback / Dispute", "PCI Compliance", "Other"] as const;

export const supportRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  businessName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(160),
  /** Optional: blank is "not provided". A non-blank value must be a real number; it never erases a stored one. */
  mobile: z.string().trim().max(40).optional().superRefine((value, ctx) => {
    if (value && !isPlausibleInquiryPhone(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid phone number." });
  }),
  issueType: z.enum(SUPPORT_ISSUE_TYPES),
  priority: z.enum(["Normal", "Urgent"]),
  message: z.string().trim().min(1).max(5000),
  /** Legacy optional SMS permission. Never required; true without a real number is rejected before any write. */
  consentSms: z.boolean().optional(),
}).strict();

export interface SupportDeps {
  acceptInbound: (req: any, refs: { contactId?: number | null; ticketId?: number | null }) => Promise<unknown>;
  recoveredContext: (req: any, sourceType: string) => Promise<{ contact: Contact; deal: unknown; hasEvidence: boolean } | null>;
  failInbound: (req: any, status: number) => Promise<void>;
}

async function respondSupportFailure(req: any, res: any, deps: SupportDeps, err: unknown) {
  const requestId = req.inboundRequestId as string | undefined;
  let committed = false;
  if (requestId) {
    try {
      const progress = await resolveCommittedOccurrenceProgress(requestId);
      const ticket = await findSupportTicket(requestId);
      committed = Boolean(ticket)
        || Boolean(progress?.contactId && await contactHasOccurrenceEvidence(requestId, "support_form", progress.contactId))
        || Boolean(progress?.contactId);
      if (committed) {
        if (progress?.contactId) await bindOccurrenceProgress(requestId, progress).catch(() => undefined);
        await setInboundRequestLifecycle(requestId, "review_required", INBOUND_HANDOFF_RECOVERABLE);
        console.error("[PublicSupport] retained recoverable request:", requestId, err instanceof Error ? err.message : err);
        return res.status(202).json({ success: false, recoverable: true, requestReceipt: requestId, status: "review_required", error: INBOUND_HANDOFF_RECOVERABLE });
      }
    } catch (recoveryError) {
      console.error("[PublicSupport] recovery classification failed:", requestId, recoveryError instanceof Error ? recoveryError.message : recoveryError);
      if (committed) return res.status(503).json({ error: "INBOUND_HANDOFF_UNCONFIRMED" });
    }
  }
  console.error("[PublicSupport] request failed before anything was saved:", err instanceof Error ? err.message : err);
  await deps.failInbound(req, 400);
  return res.status(400).json({ error: "SUPPORT_REQUEST_FAILED" });
}

export async function runSupportIntake(req: any, res: any, deps: SupportDeps) {
  try {
    const submissionId = req.inboundRequestId as string;
    const parsed = supportRequestSchema.safeParse(req.body);
    const issues: { path: string; message: string }[] = parsed.success ? [] : parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message }));
    if (parsed.success && parsed.data.consentSms === true && !(parsed.data.mobile && isPlausibleInquiryPhone(parsed.data.mobile))) {
      issues.push({ path: "consentSms", message: "Text-message permission needs a valid phone number." });
    }
    if (!parsed.success || issues.length) {
      await deps.failInbound(req, 400);
      return res.status(400).json({ error: "INVALID_SUBMISSION", details: issues });
    }
    const { name, businessName, email, mobile, issueType, priority, message: msg, consentSms } = parsed.data;
    const phone = mobile || "";
    const nameParts = name.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "there";
    const lastName = nameParts.slice(1).join(" ") || "";
    const evidence = { ipAddress: req.ip || req.socket.remoteAddress || "unknown", userAgent: req.headers["user-agent"] || "unknown" };

    // 1. contact (a re-entry reuses the contact this occurrence already wrote)
    const recovered = await deps.recoveredContext(req, "support_form");
    const existing = recovered?.contact ?? await storage.getContactByEmail(email.trim().toLowerCase());
    let contact: Contact;
    if (recovered?.hasEvidence) {
      contact = recovered.contact;
    } else if (existing) {
      await bindOccurrenceProgress(submissionId, { contactId: existing.id });
      contact = await processExistingPublicFormSubmission({
        existingContact: existing,
        // A blank phone is dropped by the allowlist builder, so an absent number never erases a stored one.
        permittedProfileUpdates: buildPublicContactPayload("support_form", { firstName, lastName, email, phone, companyName: businessName }),
        incomingConsent: { consentSms: consentSms === true ? true : undefined },
        submissionId,
        formType: "support_form",
        requestEvidence: evidence,
      });
    } else {
      contact = await writeContact({
        mode: "local_first",
        mutation: {
          firstName, lastName, email, phone,
          companyName: businessName,
          status: "Active",
          tags: ["src_website", "support_request", `support_${issueType.toLowerCase().replace(/[^a-z]/g, "_")}`],
        },
        provenance: { sourceCategory: "website_form", sourceType: "support_form", eventKey: `form:support_form:${submissionId}`, actorType: "public" },
        actor: { actorType: "public" },
      });
      await bindOccurrenceProgress(submissionId, { contactId: contact.id });
      // New contacts only: existing contacts get their consent rows inside processExistingPublicFormSubmission, never both.
      if (consentSms === true) {
        await applyConsentCommand({
          subject: { type: "contact", id: contact.id },
          kind: "opt_in", channel: "sms", purpose: "outreach", eventNamespace: "public_form",
          eventKey: `support_form:${submissionId}:sms`, source: "website_form",
          ipAddress: evidence.ipAddress, userAgent: evidence.userAgent,
          evidence: { formType: "support", submissionId }, details: { formType: "support", submissionId },
        });
      }
    }

    // 2. ticket (keyed: a re-entry returns the same ticket)
    // The administrator-recorded default owner (an active admin or manager) receives the ticket; with none recorded the
    // ticket is created unassigned exactly as before.
    const defaultOwnerEmail = await resolveDefaultOwnerEmail();
    const ticket = await storage.createAuthorityTicket({
      contactId: contact.id,
      subject: `${issueType} - ${businessName || firstName}`,
      description: msg,
      priority,
      category: issueType,
      ...(defaultOwnerEmail ? { assignedTo: defaultOwnerEmail } : {}),
    }, {
      producer: "inbound_request",
      commandKey: `inbound:${submissionId}:ticket`,
      issueKey: `inbound-support:${submissionId}`,
    });

    // 3. one factual receipt comment (no response-time, staffing or priority claim)
    await ensureSupportReceiptComment(submissionId, ticket.id);

    // 4. one internal notification, linked to the review page by short reference. No typed ticket/contact target: a
    // contact that is not yet production-classified would otherwise hide it from every reader.
    await ensureOccurrenceNotification(submissionId, {
      channel: "#support",
      title: `New ${priority} Support Request`,
      message: `${name} (${businessName}) — ${issueType}: ${msg.slice(0, 120)} (reference ${inboundShortRef(submissionId)})`,
      type: priority === "Urgent" ? "urgent" : "info",
      metadata: {
        eventType: "support_request_received",
        requestId: submissionId,
        shortRef: inboundShortRef(submissionId),
        link: inboundReviewLink(submissionId),
      },
    }, "support");

    // 5. canonical acceptance (links the ticket and records the internal SLA evidence)
    const accepted = await deps.acceptInbound(req, { contactId: contact.id, ticketId: ticket.id });
    res.status(201).json({ ...(accepted as object), reference: inboundShortRef(submissionId) });
  } catch (err) {
    await respondSupportFailure(req, res, deps, err);
  }
}
