import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { and, sql as sqlTag } from "drizzle-orm";
import { db as publicDb } from "../db";
import { verifyUnsubscribeToken } from "../services/unsubscribe-token";
import { sendGhlEmail, sendGhlSms } from "../services/ghl";
import { enqueuePromotionalEnrollment } from "../services/promotional-enrollment-eligibility";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { enrollInInboundConfirmation, isGhlInboundActive } from "../services/ghl-workflow-enrollment";
import { enrollInGhlWorkflow } from "../services/ghl-workflows";
import { scoreContact } from "../services/lead-scoring";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { autoGenerateProposal } from "../services/proposal-engine";
import { routeContact } from "../services/smart-router";
import { ingestBusinessFromContact } from "../services/sdr/dedupe";
import { syncFormSubmissionToGhl, syncStatementUploadToGhl, syncSupportTicketToGhl } from "../services/ghl-form-sync";
import { writeContact } from "../services/contact-writer";
import { processExistingPublicFormSubmission } from "../services/public-form-submission";
import { buildPublicContactPayload } from "../services/public-form-payload";
import type { Contact } from "@shared/schema";
import { runStatementUploadChain } from "../services/statement-upload-chain";
import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { upload, trackReferral, sendConfirmationSms } from "./helpers";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { recordPewcDecision } from "../services/consent-evidence";
import { evaluateContactability } from "../services/contactability";
import { StatementChainTracker } from "../services/statement-upload-chain";
import { resolveReferralAttribution } from "../services/attribution";
import { serverError } from "../utils/server-error";
import { recordAnalyticsEvent } from "../services/analytics-events";
import { FORM_SUBMITTED, DEAL_CREATED } from "@shared/analytics-events";

export function registerPublicRoutes(app: Express) {
  const autoProposalRateLimit = new Map<string, number>();
  const AUTO_PROPOSAL_COOLDOWN_MS = 60 * 1000;

  async function legacyAutoProposalEmail(dealId: number, contactId: number, meta: { vertical?: string; businessName?: string; contactName?: string; email?: string; consentEmail?: boolean }) {
    try {
      if (meta.email) {
        const lastCall = autoProposalRateLimit.get(meta.email);
        if (lastCall && Date.now() - lastCall < AUTO_PROPOSAL_COOLDOWN_MS) {
          console.log("[AutoProposal] Rate limited for", meta.email);
          return;
        }
        autoProposalRateLimit.set(meta.email, Date.now());
        if (autoProposalRateLimit.size > 1000) {
          const oldest = [...autoProposalRateLimit.entries()].sort((a, b) => a[1] - b[1]).slice(0, 500);
          oldest.forEach(([key]) => autoProposalRateLimit.delete(key));
        }
      }

      const deal = await storage.getDeal(dealId);
      if (!deal) return;
      const contact = await storage.getContact(contactId);
      if (!contact) return;

      const volume = parseFloat((deal.totalVolume || "15000").toString().replace(/[^0-9.]/g, "")) || 15000;
      const effectiveRate = parseFloat((deal.effectiveRate || "2.8").toString().replace(/[^0-9.]/g, "")) || 2.8;
      const avgTicket = parseFloat((deal.avgTicket || "50").toString().replace(/[^0-9.]/g, "")) || 50;
      const currentMonthlyFees = volume * (effectiveRate / 100);

      let proposalData: any;

      const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      if (apiKey) {
        try {
          const { OpenAI } = await import("openai");
          const openai = new OpenAI({ apiKey, baseURL });

          const { logAiCall: logAi } = await import("../services/ai-audit-logger");
          const pubStmtMessages = [
            {
              role: "system" as const,
              content: `You are Liberty Bancard's AI Pricing Strategist. Generate a brief, professional savings estimate email for a merchant who just uploaded their processing statement. Be concise and professional. Include a disclaimer that this is a preliminary estimate and actual savings depend on full statement review.

Return JSON with:
- subject: email subject line
- body: plain text email body (use \\n for line breaks)
- estimatedSavingsRange: string like "$200-$500/month"
- recommendedProgram: one of ["Cash Discount", "Interchange Plus", "Dual Pricing"]`
            },
            {
              role: "user" as const,
              content: `Merchant: ${meta.businessName || contact.companyName || meta.contactName || "Unknown"}
Industry: ${meta.vertical || contact.vertical || "General"}
Estimated Monthly Volume: $${volume.toLocaleString()}
Estimated Effective Rate: ${effectiveRate}%
Current Monthly Fees: $${currentMonthlyFees.toFixed(2)}
Average Ticket: $${avgTicket.toFixed(2)}
Current Provider: ${contact.currentProvider || "Unknown"}`
            },
          ];
          const { completion } = await logAi(
            { triggerType: "statement-analysis", actorType: "system", rawPrompt: JSON.stringify(pubStmtMessages) },
            () => openai.chat.completions.create({
              model: "gpt-5",
              messages: pubStmtMessages,
              max_completion_tokens: 8000,
            })
          );

          const raw = completion.choices[0]?.message?.content || "";
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            proposalData = JSON.parse(jsonMatch[0]);
          }
        } catch (aiErr: any) {
          console.error("[AutoProposal] AI call failed:", aiErr.message?.slice(0, 100));
        }
      } else {
        console.log("[AutoProposal] No OpenAI API key configured, using fallback proposal");
      }

      if (!proposalData || !proposalData.subject || !proposalData.body) {
        const merchantName = meta.contactName || contact.firstName || "there";
        const savingsEst = Math.round(currentMonthlyFees * 0.25);
        proposalData = {
          subject: `Your Statement Review Is Underway — ${meta.businessName || "Your Business"}`,
          body: `Hi ${merchantName},\n\nThank you for uploading your processing statement. Our team is reviewing it now.\n\nBased on your industry and estimated volume ($${volume.toLocaleString()}/month), merchants like you typically save $${savingsEst}-$${savingsEst * 2}/month by switching to transparent interchange-plus pricing.\n\nWe'll have your full line-by-line breakdown ready within one business day. In the meantime, feel free to call or text us at 954-266-8214 with any questions.\n\nBest,\nLiberty Bancard Team\n\nDisclaimer: This is a preliminary estimate. Actual savings depend on full statement review. Eligibility, underwriting, card brand rules, and applicable laws apply.`,
          estimatedSavingsRange: `$${savingsEst}-$${savingsEst * 2}/month`,
          recommendedProgram: "Interchange Plus",
        };
      }

      await storage.updateDeal(dealId, {
        savingsProposal: proposalData,
        proposalGeneratedAt: new Date(),
        recommendedPath: proposalData.recommendedProgram || deal.recommendedPath,
      });

      await storage.createAuditLog({
        action: "auto_proposal_generated",
        entityType: "deal",
        entityId: dealId,
        details: {
          source: "statement_upload_auto",
          recommendedProgram: proposalData.recommendedProgram,
          estimatedSavings: proposalData.estimatedSavingsRange,
        },
      });

      const hasEmailConsent = meta.consentEmail === true;
      if (meta.email && hasEmailConsent && proposalData.subject && proposalData.body) {
        try {
          await sendGhlEmail({
            contactId,
            dealId,
            subject: proposalData.subject,
            body: proposalData.body,
          });
          await storage.createAuditLog({
            action: "auto_proposal_emailed",
            entityType: "deal",
            entityId: dealId,
            details: { email: meta.email, subject: proposalData.subject },
          });
        } catch (emailErr: any) {
          console.error("[AutoProposal] Email send failed:", emailErr.message?.slice(0, 100));
        }
      }

      await storage.createNotification({
        channel: "internal",
        title: "Auto-Proposal Generated",
        message: `Auto-proposal for ${meta.contactName || meta.email || "Unknown"} - ${proposalData.estimatedSavingsRange || "N/A"} estimated savings${hasEmailConsent ? " (emailed)" : " (stored, not emailed - no consent)"}`,
        type: "info",
        metadata: { dealId, contactId },
      });
    } catch (err: any) {
      console.error("[AutoProposal] Error:", err.message?.slice(0, 200));
    }
  }


  // === PUBLIC FORM SUBMISSIONS ===
  app.post("/api/public/statement-upload", publicLeadRateLimit, upload.single("statementFile"), async (req, res) => {
    try {
      // Per-request UUID: each HTTP submission is a distinct event. BullMQ job retries
      // use this same UUID (stored in job data), ensuring intra-retry dedup stability.
      const submissionId = crypto.randomUUID();
      const { businessName, contactName, email, mobile, vertical, currentProvider, interestedIn0Percent, needTerminal, notes, consentSms, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage, gclid, referrerUrl: bodyReferrerUrl } = req.body;
      const referrerUrl = bodyReferrerUrl || req.headers["referer"] || req.headers["referrer"] || undefined;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const parseBool = (v: unknown) => v === true || v === "true";

      // Check if the user is already authenticated — bind upload to their existing merchant record
      const authUserId = (req.user as any)?.id;
      let existingContactId: number | null = null;
      let existingDealId: number | null = null;

      if (authUserId) {
        try {
          const merchantProfile = await storage.getMerchantProfileByUser(authUserId);
          if (merchantProfile?.contactId) {
            existingContactId = merchantProfile.contactId;
          }
          if (merchantProfile?.dealId) {
            existingDealId = merchantProfile.dealId;
          }
        } catch (profileErr) {
          console.warn("[StatementUpload] Could not fetch merchant profile for user", authUserId, profileErr);
        }
      }

      const tags = ["src_website", "lead_statement_upload", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`];
      if (utmSource) tags.push(`utm_src_${utmSource}`);

      let contact: Contact;
      if (existingContactId) {
        contact = (await storage.getContact(existingContactId))!;
      } else {
        const normalizedEmail = email?.trim().toLowerCase() || null;
        const existingByEmail = normalizedEmail ? await storage.getContactByEmail(normalizedEmail) : null;
        if (existingByEmail) {
          contact = await processExistingPublicFormSubmission({
            existingContact: existingByEmail,
            permittedProfileUpdates: buildPublicContactPayload("statement_upload", {
              firstName, lastName, email, phone: mobile,
              companyName: businessName, vertical, currentProvider,
              interestedIn0Percent: parseBool(interestedIn0Percent),
              needTerminal: parseBool(needTerminal),
              notes, utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
              landingPage: landingPage || "/upload-statement",
              gclid: gclid || undefined,
            }),
            incomingConsent: { consentSms: parseBool(consentSms) },
            submissionId,
            formType: "statement_upload",
            requestEvidence: {
              ipAddress: req.ip || req.socket.remoteAddress || "unknown",
              userAgent: req.headers["user-agent"] || "unknown",
            },
          });
        } else {
          contact = await writeContact({
            mode: "ghl_upsert_first",
            mutation: {
              firstName, lastName, email, phone: mobile,
              companyName: businessName, vertical, currentProvider,
              interestedIn0Percent: parseBool(interestedIn0Percent),
              needTerminal: parseBool(needTerminal),
              notes, consentSms: parseBool(consentSms),
              utmSource: utmSource || undefined,
              utmMedium: utmMedium || undefined,
              utmCampaign: utmCampaign || undefined,
              utmContent: utmContent || undefined,
              utmTerm: utmTerm || undefined,
              landingPage: landingPage || "/upload-statement",
              gclid: gclid || undefined,
              referrerUrl: referrerUrl || undefined,
              status: "New",
              tags,
            },
            provenance: {
              sourceCategory: "website_form",
              sourceType: "statement_upload",
              eventKey: `form:statement_upload:${submissionId}`,
              actorType: "public",
            },
            actor: { actorType: "public" },
          });
        }
      }

      if (!contact) throw new Error("Could not resolve contact record");

      const pewcConsent = parseBool(req.body.pewcConsent);
      if (pewcConsent) {
        recordPewcDecision({
          contactId: contact.id,
          checked: true,
          source: "statement_upload",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "statement_upload" },
        }).catch(err => console.error("[StatementUpload] PEWC record error:", err));
      }

      const statementFileBuffer = req.file?.buffer;
      const rawStatementName = req.file?.originalname || (businessName ? businessName + "_statement" : "statement");
      const statementFileName = path.basename(rawStatementName).replace(/[^a-zA-Z0-9._-]/g, "_");

      // Resolve attribution BEFORE the chain so partnerOrgId flows into deal creation
      let resolvedPartnerOrgId: number | null = null;
      try {
        const attr = await resolveReferralAttribution(referralCode, contact.partnerOrgId);
        if (attr.partnerType === "partner_org" && attr.partnerOrgId) {
          if (!contact.partnerOrgId) {
            const orgUpdates: Record<string, unknown> = { partnerOrgId: attr.partnerOrgId, referralSource: attr.referralSource };
            if (attr.promoCode && !contact.promoCode) orgUpdates.promoCode = attr.promoCode;
            await storage.updateContact(contact.id, orgUpdates as Parameters<typeof storage.updateContact>[1]);
            resolvedPartnerOrgId = attr.partnerOrgId;
          } else {
            resolvedPartnerOrgId = contact.partnerOrgId;
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has partnerOrgId", existing: contact.partnerOrgId, inbound: attr.partnerOrgId } });
          }
        } else if (attr.partnerType === "affiliate_partner" && attr.promoCode) {
          if (!contact.promoCode) {
            await storage.updateContact(contact.id, { promoCode: attr.promoCode, referralSource: attr.referralSource });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has promoCode", existing: contact.promoCode, inbound: attr.promoCode } });
          }
        } else if (attr.partnerType !== "none" && attr.referralSource && !contact.referralSource) {
          await storage.updateContact(contact.id, { referralSource: attr.referralSource });
        }
      } catch (err) {
        console.error("[Attribution] statement-upload error:", err);
      }

      // Run the full 11-step conversion chain (fire-and-forget — merchant always gets 201)
      runStatementUploadChain({
        contactId: contact.id,
        dealId: existingDealId || null,
        fileBuffer: statementFileBuffer,
        fileName: statementFileName,
        source: "website",
        businessName: businessName || undefined,
        consentEmail: parseBool(consentSms),
        partnerOrgId: resolvedPartnerOrgId,
      }).catch(err => console.error("[StatementChain] Unhandled chain error:", err.message));

      if (contact.ghlContactId) {
        enrollInGhlWorkflow({ workflowKey: "statement_review", ghlContactId: contact.ghlContactId, metadata: { source: "website", contactId: contact.id } }).catch(err =>
          console.error("[StatementUpload] GHL statement_review enrollment error:", err)
        );
      }

      // Non-chain fire-and-forget actions
      recordAnalyticsEvent({
        eventName: FORM_SUBMITTED,
        contactId: contact.id,
        sourceCategory: "website_form",
        formId: "statement_upload",
        vertical: vertical || undefined,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        gclidPresent: !!gclid,
        landingPage: landingPage || "/upload-statement",
        metadata: { formType: "statement_upload" },
      }).catch(() => {});
      trackReferral(referralCode, contactName, email, mobile, businessName).catch(err => console.error("Referral tracking error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "website_statement").catch(err => console.warn("[Statement] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: existingDealId || undefined }, { formType: "statement_upload" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "statement_upload", dealId: existingDealId || undefined, submissionId }).catch(err => console.error("GHL inbound confirmation error:", err));

      await storage.createAuditLog({
        action: "statement_uploaded",
        entityType: "contact",
        entityId: contact.id,
        details: { source: "website", hasFile: !!statementFileBuffer },
      });

      res.status(201).json({ success: true, contactId: contact.id, dealId: existingDealId || null });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/estimate", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { contactName, email, phone, monthlyVolume, totalFees, currentProvider, notes, pewcConsent: estimatePewcRaw, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage, gclid, referrerUrl: estimateReferrerUrlBody } = req.body;
      const estimateReferrerUrl = estimateReferrerUrlBody || req.headers["referer"] || req.headers["referrer"] || undefined;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const tags = ["src_website", "lead_estimate"];
      if (utmSource) tags.push(`utm_src_${utmSource}`);

      const normalizedEstimateEmail = email?.trim().toLowerCase() || null;
      const existingEstimateContact = normalizedEstimateEmail ? await storage.getContactByEmail(normalizedEstimateEmail) : null;
      let contact: Contact;
      if (existingEstimateContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingEstimateContact,
          permittedProfileUpdates: buildPublicContactPayload("estimate_form", {
            firstName, lastName, email, phone: phone || "",
            monthlyVolume, currentProvider, notes,
            utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
            landingPage: landingPage || "/estimate",
            gclid: gclid || undefined,
            referrerUrl: estimateReferrerUrl || undefined,
          }),
          incomingConsent: {},
          submissionId,
          formType: "estimate_form",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName, lastName, email, phone: phone || "",
            monthlyVolume, currentProvider, notes,
            utmSource: utmSource || undefined,
            utmMedium: utmMedium || undefined,
            utmCampaign: utmCampaign || undefined,
            utmContent: utmContent || undefined,
            utmTerm: utmTerm || undefined,
            landingPage: landingPage || "/estimate",
            gclid: gclid || undefined,
            referrerUrl: estimateReferrerUrl || undefined,
            status: "New",
            tags,
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "estimate_form",
            eventKey: `form:estimate_form:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      if (estimatePewcRaw === true) {
        recordPewcDecision({
          contactId: contact.id,
          checked: true,
          source: "estimate",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "estimate" },
        }).catch(err => console.error("[Estimate] PEWC record error:", err));
      }

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        totalVolume: monthlyVolume, totalFees,
        notes: `Estimate request. Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
        ...(contact.partnerOrgId ? { partnerOrgId: contact.partnerOrgId } : {}),
      });

      await storage.createNotification({
        channel: "#sales", title: "New Estimate Request",
        message: `${firstName} ${lastName} - Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        type: "info",
      });

      recordAnalyticsEvent({
        eventName: FORM_SUBMITTED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "estimate_form",
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        gclidPresent: !!gclid,
        landingPage: landingPage || "/estimate",
        metadata: { formType: "estimate" },
      }).catch(() => {});
      recordAnalyticsEvent({
        eventName: DEAL_CREATED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "estimate_form",
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        metadata: { formType: "estimate", stage: "New Lead" },
      }).catch(() => {});
      trackReferral(referralCode, contactName, email, phone).catch(err => console.error("Referral tracking error:", err));
      resolveReferralAttribution(referralCode, contact.partnerOrgId).then(async attr => {
        if (attr.partnerType === "partner_org" && attr.partnerOrgId) {
          if (!contact.partnerOrgId) {
            const orgUpdates: Record<string, unknown> = { partnerOrgId: attr.partnerOrgId, referralSource: attr.referralSource };
            if (attr.promoCode && !contact.promoCode) orgUpdates.promoCode = attr.promoCode;
            await storage.updateContact(contact.id, orgUpdates as Parameters<typeof storage.updateContact>[1]);
            await storage.updateDeal(deal.id, { partnerOrgId: attr.partnerOrgId });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has partnerOrgId", existing: contact.partnerOrgId, inbound: attr.partnerOrgId } });
          }
        } else if (attr.partnerType === "affiliate_partner" && attr.promoCode) {
          if (!contact.promoCode) {
            await storage.updateContact(contact.id, { promoCode: attr.promoCode, referralSource: attr.referralSource });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has promoCode", existing: contact.promoCode, inbound: attr.promoCode } });
          }
        } else if (attr.partnerType !== "none" && attr.referralSource && !contact.referralSource) {
          await storage.updateContact(contact.id, { referralSource: attr.referralSource });
        }
      }).catch(err => console.error("[Attribution] estimate error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "website_estimate").catch(err => console.warn("[Estimate] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "form_submitted", formType: "estimate", sourceEventId: submissionId }).catch(err => console.error("Enqueue error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "estimate" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "estimate", dealId: deal.id, submissionId }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (contact.ghlContactId) enrollInGhlWorkflow({ workflowKey: "inbound_lead", ghlContactId: contact.ghlContactId, metadata: { formType: "estimate", dealId: deal.id } }).catch(err => console.error("[Estimate] GHL inbound_lead enrollment error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "estimate" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/support", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { name, businessName, email, mobile, issueType, priority, message: msg, consentSms } = req.body;
      const nameParts = (name || "").trim().split(" ").filter(Boolean);
      const firstName = nameParts[0] || "there";
      const lastName = nameParts.slice(1).join(" ") || "";

      const normalizedSupportEmail = email?.trim().toLowerCase() || null;
      const existingSupportContact = normalizedSupportEmail ? await storage.getContactByEmail(normalizedSupportEmail) : null;
      let contact: Contact;
      if (existingSupportContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingSupportContact,
          permittedProfileUpdates: buildPublicContactPayload("support_form", {
            firstName, lastName, email, phone: mobile || "",
            companyName: businessName,
          }),
          incomingConsent: { consentSms: consentSms === true },
          submissionId,
          formType: "support_form",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName, lastName, email, phone: mobile || "",
            companyName: businessName, consentSms: consentSms === true,
            status: "Active",
            tags: ["src_website", "support_request", `support_${(issueType || "other").toLowerCase().replace(/[^a-z]/g, "_")}`],
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "support_form",
            eventKey: `form:support_form:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
        // New contacts only: write the opt_in audit row here.
        // Existing contacts: processExistingPublicFormSubmission() writes opt_in (or
        // consent_reenable_blocked) audit rows inside its transaction — never both.
        if (consentSms) {
          await storage.createConsentAuditLog({
            contactId: contact.id,
            channel: "sms",
            action: "opt_in",
            consented: true,
            consentType: "general_optin",
            source: "website_form",
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
            details: { formType: "support" },
          });
        }
      }

      const ticket = await storage.createTicket({
        contactId: contact.id,
        subject: `${issueType || "Support"} - ${businessName || firstName}`,
        description: msg || "",
        priority: priority || "Normal",
        category: issueType || "Other",
      });

      const ackMessages: Record<string, string> = {
        "Funding / Deposits": `Hi ${firstName} — thanks for reaching out about a funding question. We know how important it is to have your deposits landing on time, so we're pulling up your account now.\n\nIf this is a same-day issue, feel free to call us directly at 954-266-8214 and we'll get right on it. Otherwise, someone from our team will follow up within a few hours with an update.\n\nHang tight — we're on it.`,
        "Terminal": `Hey ${firstName} — we got your message about your terminal. Whether it's acting up, needs a reset, or you're looking at a replacement, we deal with this stuff daily so we'll get you sorted out.\n\nIf your terminal is completely down and you can't take payments, call us at 954-266-8214 so we can walk you through a fix right away. Otherwise, expect a reply from our tech team shortly.\n\nAppreciate your patience.`,
        "Chargeback / Dispute": `Hi ${firstName} — thanks for letting us know about this. Chargebacks can be stressful, but the good news is we handle these all the time and we're going to walk you through exactly what to do.\n\nTime matters with disputes, so we've flagged this for priority review. A team member will reach out shortly with the specific documents you'll need and the steps to respond. In the meantime, don't worry — we've got your back on this.\n\nIf you have the transaction date and amount handy, that'll help us move faster.`,
        "PCI Compliance": `Hey ${firstName} — good on you for staying on top of PCI compliance. A lot of merchants overlook this until there's a problem, so we're glad you reached out.\n\nOur compliance team will take a look at your account status and let you know exactly where things stand — whether you need to complete your annual questionnaire, update anything, or if you're already good to go.\n\nYou'll hear from us soon. If you have any compliance notices or letters you've received, feel free to forward them to support@libertybancard.com so we can reference them.`,
      };
      const ackText = ackMessages[issueType] || `Hi ${firstName} — thanks for reaching out. We received your request and a team member is reviewing it now.\n\nYou can expect a personal follow-up within a few hours during business hours. If you need something handled immediately, you're always welcome to call us at 954-266-8214.\n\nWe appreciate your patience — we'll be in touch soon.`;

      await storage.createTicketComment({
        ticketId: ticket.id,
        content: ackText,
        authorName: "Liberty Bancard Support",
        isInternal: false,
      });

      await storage.createNotification({
        channel: "#support",
        title: `New ${priority || "Normal"} Support Ticket`,
        message: `${firstName} ${lastName} (${businessName || "N/A"}) — ${issueType || "General"}: ${(msg || "").slice(0, 120)}`,
        type: priority === "Urgent" ? "urgent" : "info",
        metadata: { ticketId: ticket.id, contactId: contact.id },
      });

      triggerWorkflowsByEvent("ticket_created", { entityType: "ticket", entityId: ticket.id }).catch(err => console.error("Workflow trigger error:", err));
      if (contact.ghlContactId) enrollInGhlWorkflow({ workflowKey: "support_ticket", ghlContactId: contact.ghlContactId, metadata: { ticketId: ticket.id, issueType: issueType || "Other" } }).catch(err => console.error("[Support] GHL support_ticket enrollment error:", err));
      if (consentSms && mobile) sendConfirmationSms(contact.id, firstName, "support").catch(err => console.error("Confirm SMS error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, leadSource: "support", skipWorkflowTrigger: true }).catch(err => console.error("GHL form sync error:", err));
      syncSupportTicketToGhl(contact.id, ticket.id, issueType || "General", msg || "").catch(err => console.error("GHL support sync error:", err));

      res.status(201).json({ success: true, ticketId: ticket.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/get-started", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { goal, vertical, monthlyVolume, needTerminal, interestedIn0Percent, firstName, lastName, email, phone, pewcConsent, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage, gclid } = req.body;

      let offerPath = "Not Sure";
      if (goal === "0% interest" || interestedIn0Percent) offerPath = "0% Program";
      else if (goal === "lower fees") offerPath = "Wholesale";
      else if (goal === "need terminal") offerPath = "Terminal Needed";
      else if (goal === "compare vs flat-rate") offerPath = "Compare vs Square/Stripe";

      const tags = ["src_website", "lead_quiz", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`];
      if (utmSource) tags.push(`utm_src_${utmSource}`);
      if (utmMedium) tags.push(`utm_med_${utmMedium}`);
      if (utmCampaign) tags.push(`utm_camp_${utmCampaign}`);

      const normalizedGsEmail = email?.trim().toLowerCase() || null;
      const existingGsContact = normalizedGsEmail ? await storage.getContactByEmail(normalizedGsEmail) : null;
      let contact: Contact;
      if (existingGsContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingGsContact,
          permittedProfileUpdates: buildPublicContactPayload("get_started_form", {
            firstName, lastName, email, phone: phone || "",
            vertical, monthlyVolume, primaryOfferPath: offerPath,
            interestedIn0Percent: interestedIn0Percent === true,
            needTerminal: needTerminal === true,
            utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
            landingPage: landingPage || "/get-started",
            gclid: gclid || undefined,
          }),
          incomingConsent: { consentSms: pewcConsent === true },
          submissionId,
          formType: "get_started_form",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName, lastName, email, phone: phone || "",
            vertical, monthlyVolume, primaryOfferPath: offerPath,
            interestedIn0Percent: interestedIn0Percent === true,
            needTerminal: needTerminal === true,
            consentSms: pewcConsent === true,
            utmSource: utmSource || undefined,
            utmMedium: utmMedium || undefined,
            utmCampaign: utmCampaign || undefined,
            utmContent: utmContent || undefined,
            utmTerm: utmTerm || undefined,
            landingPage: landingPage || "/get-started",
            gclid: gclid || undefined,
            status: "New",
            tags,
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "get_started_form",
            eventKey: `form:get_started_form:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      if (pewcConsent === true) {
        recordPewcDecision({
          contactId: contact.id,
          checked: true,
          source: "get_started",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "get_started" },
        }).catch(err => console.error("[GetStarted] PEWC record error:", err));
      }

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        offerPath,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
        ...(contact.partnerOrgId ? { partnerOrgId: contact.partnerOrgId } : {}),
      });

      await storage.createNotification({
        channel: "#sales", title: "New Quiz Lead",
        message: `${firstName} ${lastName} - ${vertical}, ${monthlyVolume}, Goal: ${goal}${utmSource ? ` (via ${utmSource})` : ""}`,
        type: "info",
      });

      recordAnalyticsEvent({
        eventName: FORM_SUBMITTED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "get_started_form",
        vertical: vertical || undefined,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        gclidPresent: !!gclid,
        landingPage: landingPage || "/get-started",
        offerRoute: offerPath,
        metadata: { formType: "get_started", goal: goal || undefined },
      }).catch(() => {});
      recordAnalyticsEvent({
        eventName: DEAL_CREATED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "get_started_form",
        vertical: vertical || undefined,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        offerRoute: offerPath,
        metadata: { formType: "get_started", stage: "New Lead" },
      }).catch(() => {});
      trackReferral(referralCode, `${firstName} ${lastName}`, email, phone).catch(err => console.error("Referral tracking error:", err));
      resolveReferralAttribution(referralCode, contact.partnerOrgId).then(async attr => {
        if (attr.partnerType === "partner_org" && attr.partnerOrgId) {
          if (!contact.partnerOrgId) {
            const orgUpdates: Record<string, unknown> = { partnerOrgId: attr.partnerOrgId, referralSource: attr.referralSource };
            if (attr.promoCode && !contact.promoCode) orgUpdates.promoCode = attr.promoCode;
            await storage.updateContact(contact.id, orgUpdates as Parameters<typeof storage.updateContact>[1]);
            await storage.updateDeal(deal.id, { partnerOrgId: attr.partnerOrgId });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has partnerOrgId", existing: contact.partnerOrgId, inbound: attr.partnerOrgId } });
          }
        } else if (attr.partnerType === "affiliate_partner" && attr.promoCode) {
          if (!contact.promoCode) {
            await storage.updateContact(contact.id, { promoCode: attr.promoCode, referralSource: attr.referralSource });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has promoCode", existing: contact.promoCode, inbound: attr.promoCode } });
          }
        } else if (attr.partnerType !== "none" && attr.referralSource && !contact.referralSource) {
          await storage.updateContact(contact.id, { referralSource: attr.referralSource });
        }
      }).catch(err => console.error("[Attribution] get-started error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      if (!contact.primaryOfferPath) {
        import("../services/offer-router").then(({ routeOfferDeterministic }) => {
          const deterministicResult = routeOfferDeterministic(contact);
          if (deterministicResult) {
            storage.updateContact(contact.id, {
              primaryOfferPath: deterministicResult.offerRoute,
              offerRoutingSource: deterministicResult.routingSource,
              offerConfidence: deterministicResult.offerConfidence,
              offerRoutedAt: new Date(),
              processorDetected: deterministicResult.processorDetected ?? null,
              offerMatchedSignals: deterministicResult.matchedSignals,
            }).catch(err => console.error("[OfferRouter] At-creation routing error:", err));
          }
        }).catch(err => console.error("[OfferRouter] Import error:", err));
      }
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint gen error:", err));
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "form_submitted", formType: "get_started", sourceEventId: submissionId }).catch(err => console.error("Enqueue error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "get_started" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "get_started", dealId: deal.id, submissionId }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (contact.ghlContactId) enrollInGhlWorkflow({ workflowKey: "inbound_lead", ghlContactId: contact.ghlContactId, metadata: { formType: "get_started", dealId: deal.id } }).catch(err => console.error("[GetStarted] GHL inbound_lead enrollment error:", err));
      if (!isGhlInboundActive() && pewcConsent === true && phone) {
        evaluateContactability({ contactId: contact.id, channel: "sms", campaignType: "confirmation", mode: "enforcement" })
          .then(r => { if (r.allowed) sendConfirmationSms(contact.id, firstName, "get_started", deal.id).catch(err => console.error("Confirm SMS error:", err)); })
          .catch(err => console.error("[GetStarted] Contactability check error:", err));
      }
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "get_started", formData: { lb_quiz_goal: goal || "", lb_monthly_volume: monthlyVolume || "", lb_interested_0_percent: interestedIn0Percent ? "yes" : "no", lb_terminal_need: needTerminal ? "yes" : "no" } }).catch(err => console.error("GHL form sync error:", err));
      storage.createReviewQueueItem({
        sourceType: "quiz",
        sourceId: contact.id,
        status: "pending",
        checklistState: {},
        metadata: {
          contactName: `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          email,
          phone,
          vertical,
          monthlyVolume,
          goal,
          offerPath,
          source: "get_started",
          utmSource: utmSource || undefined,
          utmCampaign: utmCampaign || undefined,
          contactId: contact.id,
          dealId: deal.id,
        },
      }).catch((err: any) => console.error("[ReviewQueue] Get-started enqueue failed:", err.message));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id, offerPath });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });


  // === INTEGRATION REQUEST ===
  app.post("/api/public/integration-request", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const schema = z.object({
        softwareName: z.string().min(1, "Software name is required").max(120),
        softwareCategory: z.string().max(80).optional().default(""),
        contactName: z.string().min(1, "Name is required").max(120),
        email: z.string().email("Valid email required").max(160),
        businessName: z.string().max(160).optional().default(""),
        phone: z.string().max(40).optional().default(""),
        notes: z.string().max(2000).optional().default(""),
      });
      const data = schema.parse(req.body);

      const nameParts = data.contactName.trim().split(" ").filter(Boolean);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const softwareSlug = data.softwareName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "unknown";
      const tags = ["src_website", "lead_integration_request", `integration_${softwareSlug}`];

      const requestNote = `Integration request: ${data.softwareName}${data.softwareCategory ? ` (${data.softwareCategory})` : ""}.${data.notes ? ` Notes: ${data.notes}` : ""}`;

      const normalizedIrEmail = data.email?.trim().toLowerCase() || null;
      const existingIrContact = normalizedIrEmail ? await storage.getContactByEmail(normalizedIrEmail) : null;
      let contact: Contact;
      if (existingIrContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingIrContact,
          permittedProfileUpdates: buildPublicContactPayload("integration_request", {
            firstName, lastName, email: data.email,
            phone: data.phone || "",
            companyName: data.businessName || undefined,
            notes: requestNote,
          }),
          incomingConsent: {},
          submissionId,
          formType: "integration_request",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName,
            lastName,
            email: data.email,
            phone: data.phone || "",
            companyName: data.businessName || undefined,
            notes: requestNote,
            landingPage: "/integrations",
            status: "New",
            tags,
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "integration_request",
            eventKey: `form:integration_request:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      await storage.createNotification({
        channel: "#sales",
        title: "Integration Request",
        message: `${firstName} ${lastName}${data.businessName ? ` (${data.businessName})` : ""} asked about ${data.softwareName}${data.softwareCategory ? ` — ${data.softwareCategory}` : ""}`,
        type: "info",
        metadata: { contactId: contact.id, software: data.softwareName, category: data.softwareCategory },
      });

      await storage.createAuditLog({
        action: "integration_requested",
        entityType: "contact",
        entityId: contact.id,
        details: {
          software: data.softwareName,
          category: data.softwareCategory,
          notes: data.notes,
          source: "website_integrations_page",
        },
      });

      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "form_submitted", formType: "integration_request", sourceEventId: submissionId }).catch(err => console.error("Enqueue error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id }, { formType: "integration_request", software: data.softwareName }).catch(err => console.error("Workflow trigger error:", err));

      res.status(201).json({ success: true, contactId: contact.id });
    } catch (err: any) {
      if (err?.issues) {
        return res.status(400).json({ message: err.issues[0]?.message || "Invalid submission" });
      }
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  // === CALLBACK REQUEST ===
  // EXEMPTION from canonical existing-contact path: this form captures no email address
  // (email: "" is hardcoded), so email-based lookup always returns null and the canonical
  // processExistingPublicFormSubmission() flow cannot be applied. Additionally, this form
  // does not write consentSms or consentEmail fields — only PEWC consent, which is handled
  // via the separate recordPewcDecision() path. No consent field protection or opt_in audit
  // is needed here; this handler is safe to remain as a direct writeContact() call.
  app.post("/api/public/callback", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { name, phone, bestTime, notes, pewcConsent: pewcConsentRaw } = req.body;
      const pewcConsent = pewcConsentRaw === true;
      const nameParts = (name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact: Contact = await writeContact({
        mode: "ghl_upsert_first",
        mutation: {
          firstName, lastName, email: "", phone: phone || "",
          status: "New",
          tags: ["src_website", "lead_callback", `callback_${(bestTime || "anytime").toLowerCase().replace(/[^a-z]/g, "_")}`],
        },
        provenance: {
          sourceCategory: "website_form",
          sourceType: "callback_form",
          eventKey: `form:callback_form:${submissionId}`,
          actorType: "public",
        },
        actor: { actorType: "public" },
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        notes: `Callback request. Best time: ${bestTime || "Anytime"}. Notes: ${notes || "None"}`,
      });

      await storage.createNotification({
        channel: "#sales", title: "Callback Requested",
        message: `${firstName} ${lastName} - ${phone} - Best time: ${bestTime || "Anytime"}`,
        type: "alert",
      });

      if (pewcConsent) {
        recordPewcDecision({
          contactId: contact.id,
          checked: true,
          source: "callback",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "callback" },
        }).catch(err => console.error("[Callback] PEWC record error:", err));
      }
      recordAnalyticsEvent({
        eventName: FORM_SUBMITTED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "callback_form",
        metadata: { formType: "callback", bestTime: bestTime || "anytime" },
      }).catch(() => {});
      recordAnalyticsEvent({
        eventName: DEAL_CREATED,
        contactId: contact.id,
        dealId: deal.id,
        sourceCategory: "website_form",
        formId: "callback_form",
        metadata: { formType: "callback", stage: "New Lead" },
      }).catch(() => {});
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "form_submitted", formType: "callback", sourceEventId: submissionId }).catch(err => console.error("Enqueue error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "callback" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "callback", dealId: deal.id, submissionId }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (contact.ghlContactId) enrollInGhlWorkflow({ workflowKey: "callback_request", ghlContactId: contact.ghlContactId, metadata: { dealId: deal.id, bestTime: bestTime || "anytime" } }).catch(err => console.error("[Callback] GHL callback_request enrollment error:", err));
      if (!isGhlInboundActive() && pewcConsent && phone) {
        evaluateContactability({ contactId: contact.id, channel: "sms", campaignType: "confirmation", mode: "enforcement" })
          .then(r => { if (r.allowed) sendConfirmationSms(contact.id, firstName, "callback", deal.id).catch(err => console.error("Confirm SMS error:", err)); })
          .catch(err => console.error("[Callback] Contactability check error:", err));
      }
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "callback" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/equipment-order", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { firstName, lastName, email, phone, businessName, message, items, referralCode, promoCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
      if (!firstName || typeof firstName !== "string" || firstName.length > 100) {
        return res.status(400).json({ message: "Valid first name is required" });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required" });
      }
      if (!phone || typeof phone !== "string" || phone.length > 30) {
        return res.status(400).json({ message: "Valid phone number is required" });
      }
      if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
        return res.status(400).json({ message: "At least one item is required" });
      }
      const validatedItems = items.map((i: any) => ({
        name: String(i.name || "").slice(0, 100),
        quantity: Math.min(Math.max(1, Number(i.quantity) || 1), 50),
        price: String(i.price || "").slice(0, 50),
      }));

      const safeLastName = String(lastName || "").slice(0, 100);
      const safeBusiness = String(businessName || "").slice(0, 200);
      const safeMessage = String(message || "").slice(0, 1000);
      const sanitizedPromo = promoCode
        ? String(promoCode).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20)
        : undefined;

      const orderTags = ["src_website", "lead_equipment_order", ...validatedItems.slice(0, 5).map((i: any) => `equip_${i.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`)];
      if (sanitizedPromo) orderTags.push(`promo_${sanitizedPromo.toLowerCase()}`);

      if (utmSource) orderTags.push(`utm_src_${utmSource}`);

      const normalizedEoEmail = email?.trim().toLowerCase() || null;
      const existingEoContact = normalizedEoEmail ? await storage.getContactByEmail(normalizedEoEmail) : null;
      let contact: Contact;
      if (existingEoContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingEoContact,
          permittedProfileUpdates: buildPublicContactPayload("equipment_order", {
            firstName: firstName.slice(0, 100), lastName: safeLastName,
            email: email.slice(0, 200), phone: phone.slice(0, 30),
            companyName: safeBusiness,
            utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
            landingPage: landingPage || "/shop",
          }),
          incomingConsent: {},
          submissionId,
          formType: "equipment_order",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName: firstName.slice(0, 100), lastName: safeLastName, email: email.slice(0, 200), phone: phone.slice(0, 30),
            companyName: safeBusiness,
            promoCode: sanitizedPromo,
            utmSource: utmSource || undefined,
            utmMedium: utmMedium || undefined,
            utmCampaign: utmCampaign || undefined,
            utmContent: utmContent || undefined,
            utmTerm: utmTerm || undefined,
            landingPage: landingPage || "/shop",
            status: "New",
            tags: orderTags,
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "equipment_order",
            eventKey: `form:equipment_order:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      const itemSummary = validatedItems.map((i: any) => `${i.name} x${i.quantity} (${i.price})`).join(", ");
      const primaryTerminal = validatedItems[0]?.name || "Unknown";
      const allTerminals = validatedItems.map((i: any) => i.name).join(", ");
      const orderedAt = new Date();

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        notes: `Equipment order: ${itemSummary}. ${safeMessage}${sanitizedPromo ? `\nPromo Code: ${sanitizedPromo}` : ""}`.trim(),
        promoCode: sanitizedPromo,
        terminalRecommendation: allTerminals,
        terminalStatus: "Ordered — 24hr setup & testing before ship",
        hardwarePackage: allTerminals,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
        ...(contact.partnerOrgId ? { partnerOrgId: contact.partnerOrgId } : {}),
      });

      for (const item of validatedItems) {
        await storage.createEquipmentOrder({
          dealId: deal.id,
          contactId: contact.id,
          equipmentType: item.name,
          quantity: item.quantity,
          status: "pending",
          orderedAt,
          notes: `Price: ${item.price}. 24-hour setup & testing period before shipment.`,
        });
      }

      await storage.createTask({
        dealId: deal.id, contactId: contact.id,
        title: `Setup & test terminal: ${primaryTerminal} (24hr processing)`.slice(0, 255),
        assignedTo: "Scott Stevenson",
        priority: "high", status: "open",
      });

      await storage.createNotification({
        channel: "#sales", title: "Equipment Order Received",
        message: `${firstName} ${safeLastName} ordered: ${itemSummary}${sanitizedPromo ? ` (promo: ${sanitizedPromo})` : ""}`.slice(0, 500),
        type: "alert",
      });

      trackReferral(referralCode, `${firstName} ${safeLastName}`, email, phone, safeBusiness).catch(err => console.error("Referral tracking error:", err));
      resolveReferralAttribution(referralCode, contact.partnerOrgId).then(async attr => {
        if (attr.partnerType === "partner_org" && attr.partnerOrgId) {
          if (!contact.partnerOrgId) {
            const orgUpdates: Record<string, unknown> = { partnerOrgId: attr.partnerOrgId, referralSource: attr.referralSource };
            if (attr.promoCode && !contact.promoCode) orgUpdates.promoCode = attr.promoCode;
            await storage.updateContact(contact.id, orgUpdates as Parameters<typeof storage.updateContact>[1]);
            await storage.updateDeal(deal.id, { partnerOrgId: attr.partnerOrgId });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has partnerOrgId", existing: contact.partnerOrgId, inbound: attr.partnerOrgId } });
          }
        } else if (attr.partnerType === "affiliate_partner" && attr.promoCode) {
          if (!contact.promoCode) {
            await storage.updateContact(contact.id, { promoCode: attr.promoCode, referralSource: attr.referralSource });
          } else {
            await storage.createAuditLog({ action: "attribution_preserved", entityType: "contact", entityId: contact.id, actorType: "system", details: { reason: "contact already has promoCode", existing: contact.promoCode, inbound: attr.promoCode } });
          }
        } else if (attr.partnerType !== "none" && attr.referralSource && !contact.referralSource) {
          await storage.updateContact(contact.id, { referralSource: attr.referralSource });
        }
      }).catch(err => console.error("[Attribution] equipment-order error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "form_submitted", formType: "equipment_order", sourceEventId: submissionId }).catch(err => console.error("Enqueue error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "equipment_order" }).catch(err => console.error("Workflow trigger error:", err));
      if (contact.ghlContactId) enrollInGhlWorkflow({ workflowKey: "equipment_order", ghlContactId: contact.ghlContactId, metadata: { dealId: deal.id, items: validatedItems.map((i: any) => i.name) } }).catch(err => console.error("[EquipmentOrder] GHL equipment_order enrollment error:", err));
      if (phone) sendConfirmationSms(contact.id, firstName, "equipment_order", deal.id).catch(err => console.error("Confirm SMS error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "equipment_order" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.get("/api/public/testimonials/approved", async (_req, res) => {
    try {
      const submissions = await storage.getPublishedTestimonialSubmissions();
      const sanitized = submissions.map((s) => {
        const firstName = (s.name || "").split(" ")[0] || "Anonymous";
        const lastInitial = ((s.name || "").split(" ")[1] || "").charAt(0);
        return {
          id: s.id,
          displayName: lastInitial ? `${firstName} ${lastInitial}.` : firstName,
          businessName: s.businessName,
          industry: s.industry,
          videoLink: s.videoLink,
          savingsAmount: s.savingsAmount,
          story: s.story,
          createdAt: s.createdAt,
        };
      });
      res.json(sanitized);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/public/testimonial-submit", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const { name, businessName, email, phone, industry, videoLink, savingsAmount, story } = req.body;
      if (!name || typeof name !== "string" || name.length > 200) {
        return res.status(400).json({ message: "Valid name is required" });
      }
      if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
        return res.status(400).json({ message: "Valid email is required" });
      }
      if (!story || typeof story !== "string" || story.length < 10) {
        return res.status(400).json({ message: "Please share your story" });
      }
      const nameParts = (name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";
      const safePhone = String(phone || "").slice(0, 30);
      const safeBusiness = String(businessName || "").slice(0, 200);
      const safeIndustry = String(industry || "").slice(0, 100);
      const safeVideoLink = String(videoLink || "").slice(0, 500);
      const safeSavings = String(savingsAmount || "").slice(0, 100);
      const safeStory = String(story || "").slice(0, 5000);

      const normalizedTsEmail = email?.trim().toLowerCase() || null;
      const existingTsContact = normalizedTsEmail ? await storage.getContactByEmail(normalizedTsEmail) : null;
      let contact: Contact;
      if (existingTsContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingTsContact,
          permittedProfileUpdates: buildPublicContactPayload("testimonial_submit", {
            firstName, lastName, email, phone: safePhone,
          }),
          incomingConsent: {},
          submissionId,
          formType: "testimonial_submit",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName, lastName, email, phone: safePhone,
            status: "New",
            tags: ["src_testimonial_submit", "testimonial_prospect"],
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "testimonial_submit",
            eventKey: `form:testimonial_submit:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      const noteContent = [
        `TESTIMONIAL SUBMISSION`,
        `Business: ${safeBusiness}`,
        `Industry: ${safeIndustry}`,
        `Savings: ${safeSavings}`,
        `Video Link: ${safeVideoLink || "None"}`,
        `Story: ${safeStory}`,
      ].join("\n");

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        notes: noteContent,
      });

      const submission = await storage.createTestimonialSubmission({
        name: `${firstName} ${lastName}`.trim().slice(0, 200),
        businessName: safeBusiness || null,
        email,
        phone: safePhone || null,
        industry: safeIndustry || null,
        videoLink: safeVideoLink || null,
        savingsAmount: safeSavings || null,
        story: safeStory,
        status: "pending",
        publish: false,
        contactId: contact.id,
        dealId: deal.id,
      });

      await storage.createNotification({
        channel: "#marketing", title: "New Testimonial Submission",
        message: `${firstName} ${lastName} (${safeBusiness}) submitted their story. Savings: ${safeSavings || "Not specified"}. Review at /dashboard/testimonial-submissions`.slice(0, 500),
        type: "info",
      });

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "testimonial_submit" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, submissionId: submission.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  // === NEWSLETTER SIGNUP ===
  app.post("/api/newsletter/subscribe", publicLeadRateLimit, async (req, res) => {
    try {
      const submissionId = crypto.randomUUID();
      const schema = z.object({
        firstName: z.string().min(1).max(100),
        email: z.string().email(),
      });
      const { firstName, email } = schema.parse(req.body);

      const normalizedNlEmail = email?.trim().toLowerCase() || null;
      const existingNlContact = normalizedNlEmail ? await storage.getContactByEmail(normalizedNlEmail) : null;
      let contact: Contact;
      if (existingNlContact) {
        contact = await processExistingPublicFormSubmission({
          existingContact: existingNlContact,
          permittedProfileUpdates: buildPublicContactPayload("newsletter_signup", {
            firstName, email,
          }),
          incomingConsent: {},
          submissionId,
          formType: "newsletter_signup",
          requestEvidence: {
            ipAddress: req.ip || req.socket.remoteAddress || "unknown",
            userAgent: req.headers["user-agent"] || "unknown",
          },
        });
      } else {
        contact = await writeContact({
          mode: "ghl_upsert_first",
          mutation: {
            firstName,
            lastName: "",
            email,
            phone: "",
            status: "New",
            tags: ["NEWSLETTER-SIGNUP", "src_blog"],
            referralSource: "newsletter",
            landingPage: "/blog",
          },
          provenance: {
            sourceCategory: "website_form",
            sourceType: "newsletter_signup",
            eventKey: `form:newsletter_signup:${submissionId}`,
            actorType: "public",
          },
          actor: { actorType: "public" },
        });
      }

      syncFormSubmissionToGhl({
        contactId: contact.id,
        leadSource: "newsletter_signup",
        formData: { lb_newsletter_source: "blog_inline" },
      }).catch(err => console.error("[Newsletter] GHL sync error:", err));

      enqueuePromotionalEnrollment({ contactId: contact.id, triggerType: "newsletter_signup", formType: "newsletter", sourceEventId: submissionId }).catch(err =>
        console.error("[Newsletter] Enqueue error:", err),
      );

      res.status(201).json({ success: true, contactId: contact.id });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(400).json({ message: err.message || "Subscription failed" });
    }
  });

  // ── CAN-SPAM unsubscribe endpoint ─────────────────────────────────────────
  app.get("/unsubscribe", async (req, res) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    const result = verifyUnsubscribeToken(token);

    if (!result.valid) {
      return res.status(400).send(
        "<!DOCTYPE html><html><head><title>Invalid Link</title></head><body>" +
        "<h2>This unsubscribe link is invalid or has expired.</h2>" +
        "<p>If you wish to unsubscribe, please reply directly to any email you received and ask to be removed.</p>" +
        "</body></html>"
      );
    }

    const { contactId } = result;

    try {
      const UNSUB_PAGE =
        "<!DOCTYPE html><html><head><title>Unsubscribed</title></head><body style='font-family:Arial,sans-serif;max-width:600px;margin:60px auto;text-align:center;'>" +
        "<h2 style='color:#333;'>You have been unsubscribed.</h2>" +
        "<p style='color:#666;'>You will no longer receive marketing emails from Liberty Bancard.</p>" +
        "<p style='color:#999;font-size:12px;'>If you unsubscribed by mistake or have questions, reply to any email we sent you.</p>" +
        "</body></html>";

      const contact = await storage.getContact(contactId);
      if (!contact) {
        return res.send(UNSUB_PAGE);
      }

      const alreadyOptedOut = contact.optedOutEmail === true ||
        contact.emailStatus === "opted_out" || contact.consentTier === "opted_out";

      if (!alreadyOptedOut) {
        // Raw SQL: bypass Drizzle set() cast which can silently drop boolean/enum cols
        await publicDb.execute(sqlTag`
          UPDATE contacts
          SET opted_out_email      = true,
              email_status         = 'opted_out',
              consent_tier         = 'opted_out',
              consent_email        = false,
              do_not_auto_contact  = true,
              updated_at           = now()
          WHERE id = ${contactId}
        `);

        await storage.createAuditLog({
          action: "contact_email_unsubscribed_via_link",
          entityType: "contact",
          entityId: contactId,
          actorType: "system",
          details: {
            source: "email_footer",
            contactId,
            email: contact.email,
          },
        });

        // CAN-SPAM compliance: write consent audit log so the contactability
        // gate has a durable record of this opt-out.
        storage.createConsentAuditLog({
          contactId,
          channel: "email",
          action: "campaign_unsubscribe",
          consented: false,
          consentType: "general_optin",
          source: "campaign_unsubscribe",
          details: { source: "email_footer", email: contact.email },
        }).catch(() => {});

        // Suppress New Lead auto-enrollment so the next hourly sweep won't re-enroll
        const { suppressNewLeadAutoEnrollmentForContact } = await import("../services/new-lead-enrollment-job");
        suppressNewLeadAutoEnrollmentForContact(contactId, "email_unsubscribe_link").catch((err: any) =>
          console.error("[unsubscribe] suppression error:", err?.message)
        );
      }

      return res.send(UNSUB_PAGE);
    } catch (err: any) {
      console.error("[unsubscribe] error processing opt-out:", err?.message);
      return res.status(500).send(
        "<!DOCTYPE html><html><head><title>Error</title></head><body>" +
        "<h2>An error occurred.</h2>" +
        "<p>Please try again or reply directly to any email and ask to be removed.</p>" +
        "</body></html>"
      );
    }
  });

}
