import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { and } from "drizzle-orm";
import { sendGhlEmail, sendGhlSms } from "../services/ghl";
import { autoEnrollFromTrigger } from "../services/sequence-worker";
import { triggerWorkflowsByEvent } from "../services/workflow-executor";
import { enrollInInboundConfirmation, isGhlInboundActive } from "../services/ghl-workflow-enrollment";
import { scoreContact } from "../services/lead-scoring";
import { generateDealBlueprint } from "../services/deal-blueprint";
import { autoGenerateProposal } from "../services/proposal-engine";
import { routeContact } from "../services/smart-router";
import { ingestBusinessFromContact } from "../services/sdr/dedupe";
import { syncFormSubmissionToGhl, syncStatementUploadToGhl, syncSupportTicketToGhl } from "../services/ghl-form-sync";
import { createContactGhlFirst } from "../services/contact-writer";
import { parse } from "csv-parse/sync";
import path from "path";
import fs from "fs";
import { upload, trackReferral, sendConfirmationSms } from "./helpers";

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

          const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: `You are Liberty Bancard's AI Pricing Strategist. Generate a brief, professional savings estimate email for a merchant who just uploaded their processing statement. Be concise and professional. Include a disclaimer that this is a preliminary estimate and actual savings depend on full statement review.

Return JSON with:
- subject: email subject line
- body: plain text email body (use \\n for line breaks)
- estimatedSavingsRange: string like "$200-$500/month"
- recommendedProgram: one of ["Cash Discount", "Interchange Plus", "Dual Pricing"]`
              },
              {
                role: "user",
                content: `Merchant: ${meta.businessName || contact.companyName || meta.contactName || "Unknown"}
Industry: ${meta.vertical || contact.vertical || "General"}
Estimated Monthly Volume: $${volume.toLocaleString()}
Estimated Effective Rate: ${effectiveRate}%
Current Monthly Fees: $${currentMonthlyFees.toFixed(2)}
Average Ticket: $${avgTicket.toFixed(2)}
Current Provider: ${contact.currentProvider || "Unknown"}`
              }
            ],
            max_tokens: 800,
          });

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
  app.post("/api/public/statement-upload", upload.single("statementFile"), async (req, res) => {
    try {
      const { businessName, contactName, email, mobile, vertical, currentProvider, interestedIn0Percent, needTerminal, notes, consentSms, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
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

      const contact = existingContactId
        ? await storage.getContact(existingContactId).then(c => c!)
        : await createContactGhlFirst({
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
            status: "New",
            tags,
          });

      if (!contact) throw new Error("Could not resolve contact record");

      let offerPath = "Not Sure";
      if (parseBool(interestedIn0Percent)) offerPath = "0% Program";
      else if (parseBool(needTerminal)) offerPath = "Terminal Needed";

      const deal = existingDealId
        ? await storage.getDeal(existingDealId).then(d => d!)
        : await storage.createDeal({
            contactId: contact.id, pipeline: "sales", stage: "Statement Received",
            offerPath, notes: `Statement uploaded. ${notes || ""}`.trim(),
            leadSource: utmSource ? `utm:${utmSource}` : "website",
            campaignName: utmCampaign || undefined,
          });

      if (!deal) throw new Error("Could not resolve deal record");

      await storage.createTask({
        dealId: deal.id, contactId: contact.id,
        title: "Review statement + send breakdown",
        assignedTo: "Scott Stevenson",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
        priority: "high",
      });

      await storage.createNotification({
        channel: "#sales", title: "New Statement Upload",
        message: `${firstName} ${lastName} from ${businessName || "Unknown"} (${vertical || "Unknown"}) uploaded a statement`,
        type: "alert",
      });

      if (parseBool(consentSms)) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "statement_upload" },
        });
      }

      const statementFileBuffer = req.file?.buffer;
      const rawStatementName = req.file?.originalname || businessName + "_statement";
      const statementFileName = path.basename(rawStatementName).replace(/[^a-zA-Z0-9._-]/g, "_");

      if (statementFileBuffer) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const diskFileName = `${Date.now()}_${statementFileName}`;
        fs.writeFileSync(path.join(uploadsDir, diskFileName), statementFileBuffer);
        const storageKey = `statements/${diskFileName}`;

        await storage.createDocument({
          type: "merchant_statement",
          fileName: statementFileName,
          storageKey,
          dealId: deal.id,
          contactId: contact.id,
          accessScope: "internal",
        });
      }

      await storage.createAuditLog({ action: "statement_uploaded", entityType: "contact", entityId: contact.id, details: { source: "website", hasFile: !!statementFileBuffer } });
      await storage.updateDeal(deal.id, { statementReceived: true, docReadinessScore: statementFileBuffer ? 2 : 1 });
      trackReferral(referralCode, contactName, email, mobile, businessName).catch(err => console.error("Referral tracking error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "website_statement").catch(err => console.warn("[Statement] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "statement_upload" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "statement_upload" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "statement_upload", dealId: deal.id }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (!isGhlInboundActive() && parseBool(consentSms)) sendConfirmationSms(contact.id, firstName, "statement_upload", deal.id).catch(err => console.error("Confirm SMS error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint generation error:", err));
      autoGenerateProposal(deal.id, statementFileBuffer).catch(err => console.error("Auto-proposal error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "statement_upload", sequenceName: "1. Switch & Save — Statement Audit", formData: { lb_sequence_name: "1. Switch & Save — Statement Audit" } }).catch(err => console.error("GHL form sync error:", err));
      syncStatementUploadToGhl(contact.id, statementFileName).catch(err => console.error("GHL statement sync error:", err));

      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/estimate", async (req, res) => {
    try {
      const { contactName, email, phone, monthlyVolume, totalFees, currentProvider, notes, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;
      const nameParts = (contactName || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const tags = ["src_website", "lead_estimate"];
      if (utmSource) tags.push(`utm_src_${utmSource}`);

      const contact = await createContactGhlFirst({
        firstName, lastName, email, phone: phone || "",
        monthlyVolume, currentProvider, notes,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/estimate",
        status: "New",
        tags,
      });

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        totalVolume: monthlyVolume, totalFees,
        notes: `Estimate request. Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Estimate Request",
        message: `${firstName} ${lastName} - Volume: ${monthlyVolume}, Fees: ${totalFees}`,
        type: "info",
      });

      trackReferral(referralCode, contactName, email, phone).catch(err => console.error("Referral tracking error:", err));
      ingestBusinessFromContact(contact.id, "manual_upload", "website_estimate").catch(err => console.warn("[Estimate] Business ingest failed:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "estimate" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "estimate" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "estimate", dealId: deal.id }).catch(err => console.error("GHL inbound confirmation error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "estimate" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/support", async (req, res) => {
    try {
      const { name, businessName, email, mobile, issueType, priority, message: msg, consentSms } = req.body;
      const nameParts = (name || "").trim().split(" ").filter(Boolean);
      const firstName = nameParts[0] || "there";
      const lastName = nameParts.slice(1).join(" ") || "";

      let contact = await createContactGhlFirst({
        firstName, lastName, email, phone: mobile || "",
        companyName: businessName, consentSms: consentSms === true,
        status: "Active",
        tags: ["src_website", "support_request", `support_${(issueType || "other").toLowerCase().replace(/[^a-z]/g, "_")}`],
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "support" },
        });
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
      if (consentSms && mobile) sendConfirmationSms(contact.id, firstName, "support").catch(err => console.error("Confirm SMS error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, leadSource: "support", skipWorkflowTrigger: true }).catch(err => console.error("GHL form sync error:", err));
      syncSupportTicketToGhl(contact.id, ticket.id, issueType || "General", msg || "").catch(err => console.error("GHL support sync error:", err));

      res.status(201).json({ success: true, ticketId: ticket.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/public/get-started", async (req, res) => {
    try {
      const { goal, vertical, monthlyVolume, needTerminal, interestedIn0Percent, firstName, lastName, email, phone, consentSms, referralCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, landingPage } = req.body;

      let offerPath = "Not Sure";
      if (goal === "0% interest" || interestedIn0Percent) offerPath = "0% Program";
      else if (goal === "lower fees") offerPath = "Wholesale";
      else if (goal === "need terminal") offerPath = "Terminal Needed";
      else if (goal === "compare vs flat-rate") offerPath = "Compare vs Square/Stripe";

      const tags = ["src_website", "lead_quiz", `vertical_${(vertical || "unknown").toLowerCase().replace(/[^a-z]/g, "_")}`];
      if (utmSource) tags.push(`utm_src_${utmSource}`);
      if (utmMedium) tags.push(`utm_med_${utmMedium}`);
      if (utmCampaign) tags.push(`utm_camp_${utmCampaign}`);

      const contact = await createContactGhlFirst({
        firstName, lastName, email, phone: phone || "",
        vertical, monthlyVolume, primaryOfferPath: offerPath,
        interestedIn0Percent: interestedIn0Percent === true,
        needTerminal: needTerminal === true,
        consentSms: consentSms === true,
        utmSource: utmSource || undefined,
        utmMedium: utmMedium || undefined,
        utmCampaign: utmCampaign || undefined,
        utmContent: utmContent || undefined,
        utmTerm: utmTerm || undefined,
        landingPage: landingPage || "/get-started",
        status: "New",
        tags,
      });

      if (consentSms) {
        await storage.createConsentAuditLog({
          contactId: contact.id,
          channel: "sms",
          action: "opt_in",
          consented: true,
          source: "website_form",
          ipAddress: req.ip || req.socket.remoteAddress || "unknown",
          userAgent: req.headers["user-agent"] || "unknown",
          details: { formType: "get_started" },
        });
      }

      const deal = await storage.createDeal({
        contactId: contact.id, pipeline: "sales", stage: "New Lead",
        offerPath,
        leadSource: utmSource ? `utm:${utmSource}` : "website",
        campaignName: utmCampaign || undefined,
      });

      await storage.createNotification({
        channel: "#sales", title: "New Quiz Lead",
        message: `${firstName} ${lastName} - ${vertical}, ${monthlyVolume}, Goal: ${goal}${utmSource ? ` (via ${utmSource})` : ""}`,
        type: "info",
      });

      trackReferral(referralCode, `${firstName} ${lastName}`, email, phone).catch(err => console.error("Referral tracking error:", err));
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      generateDealBlueprint(deal.id).catch(err => console.error("Blueprint gen error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "get_started" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "get_started" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "get_started", dealId: deal.id }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (!isGhlInboundActive() && consentSms && phone) sendConfirmationSms(contact.id, firstName, "get_started", deal.id).catch(err => console.error("Confirm SMS error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "get_started", formData: { lb_quiz_goal: goal || "", lb_monthly_volume: monthlyVolume || "", lb_interested_0_percent: interestedIn0Percent ? "yes" : "no", lb_terminal_need: needTerminal ? "yes" : "no" } }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id, offerPath });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });


  // === CALLBACK REQUEST ===
  app.post("/api/public/callback", async (req, res) => {
    try {
      const { name, phone, bestTime, notes } = req.body;
      const nameParts = (name || "").split(" ");
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      const contact = await createContactGhlFirst({
        firstName, lastName, email: "", phone: phone || "",
        status: "New",
        tags: ["src_website", "lead_callback", `callback_${(bestTime || "anytime").toLowerCase().replace(/[^a-z]/g, "_")}`],
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

      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "callback" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "callback" }).catch(err => console.error("Workflow trigger error:", err));
      enrollInInboundConfirmation({ contactId: contact.id, formType: "callback", dealId: deal.id }).catch(err => console.error("GHL inbound confirmation error:", err));
      if (!isGhlInboundActive() && phone) sendConfirmationSms(contact.id, firstName, "callback", deal.id).catch(err => console.error("Confirm SMS error:", err));
      syncFormSubmissionToGhl({ contactId: contact.id, dealId: deal.id, leadSource: "callback" }).catch(err => console.error("GHL form sync error:", err));
      res.status(201).json({ success: true, contactId: contact.id, dealId: deal.id });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid submission" });
    }
  });

  app.post("/api/equipment-order", async (req, res) => {
    try {
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

      const contact = await createContactGhlFirst({
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
      });

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
      scoreContact(contact.id).catch(err => console.error("Lead scoring error:", err));
      routeContact(contact.id).catch(err => console.error("Smart routing error:", err));
      autoEnrollFromTrigger("form_submitted", { contactId: contact.id, dealId: deal.id, formType: "equipment_order" }).catch(err => console.error("Auto-enroll error:", err));
      triggerWorkflowsByEvent("form_submitted", { entityType: "contact", entityId: contact.id, contactId: contact.id, dealId: deal.id }, { formType: "equipment_order" }).catch(err => console.error("Workflow trigger error:", err));
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/public/testimonial-submit", async (req, res) => {
    try {
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

      const contact = await createContactGhlFirst({
        firstName, lastName, email, phone: safePhone,
        status: "New",
        tags: ["src_testimonial_submit", "testimonial_prospect"],
      });

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

}
