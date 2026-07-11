import { storage } from "../storage";
import type { Prospect, Campaign, Contact } from "@shared/schema";
import OpenAI from "openai";
import { sendGhlEmail, isGhlConfigured } from "./ghl";
import { getEmailSignatureHtml, getComplianceFooterHtml, type EmailSignature } from "./email-signatures";
import { sendSmtpEmail, isSmtpConfigured } from "./smtp-email";
import { logAiCall } from "./ai-audit-logger";
import { evaluateContactability } from "./contactability";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

const DEFAULT_QUEUE_LIMIT = 2000;
const SEND_INTERVAL_MS = 45000;

async function generatePersonalizedEmail(
  prospect: Prospect,
  campaign: Campaign,
  stepSubject: string,
  stepBody: string,
  stepNumber: number
): Promise<{ subject: string; body: string }> {
  const mergeFields: Record<string, string> = {
    "{{first_name}}": prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "there",
    "{{last_name}}": prospect.ownerLastName || "",
    "{{company_name}}": prospect.companyName || "your business",
    "{{vertical}}": prospect.vertical || "your industry",
    "{{city}}": prospect.city || "",
    "{{state}}": prospect.state || "",
  };

  let subject = stepSubject;
  let body = stepBody;

  for (const [key, value] of Object.entries(mergeFields)) {
    subject = subject.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
    body = body.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
  }

  if (campaign.aiPersonalization) {
    try {
      const prompt = `You are a B2B outreach email writer for Liberty Bancard, a merchant payment processing company. Personalize this email for maximum engagement.

Prospect Info:
- Company: ${prospect.companyName || "Unknown"}
- Industry: ${prospect.vertical || "Unknown"}
- Location: ${prospect.city || ""} ${prospect.state || ""}
- Estimated Revenue: ${prospect.estimatedRevenue || "Unknown"}
- Score: ${prospect.score || "Unknown"}

Email Template:
Subject: ${subject}
Body: ${body}

Step ${stepNumber} of ${campaign.totalSteps || 3} in sequence.
${stepNumber > 1 ? "This is a follow-up email. Keep it shorter and reference the previous outreach." : ""}

Rules:
- Keep it professional but conversational
- Do NOT promise savings or specific pricing
- Include compliance line: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Keep subject under 60 characters
- Keep body under 200 words
- Do not use emojis

Return JSON: { "subject": "...", "body": "..." }`;

      const campaignMessages = [{ role: "user" as const, content: prompt }];
      const { completion: response, flagged: campFlagged, reviewQueueId: campReviewId } = await logAiCall(
        { triggerType: "outbound-copy", actorType: "system", rawPrompt: JSON.stringify(campaignMessages) },
        () => getOpenAI().chat.completions.create({
          model: "gpt-4o-mini",
          messages: campaignMessages,
          response_format: { type: "json_object" },
        })
      );

      if (campFlagged) {
        console.warn(`[AI Governance] Campaign personalization flagged (reviewQueueId=${campReviewId}) — using unmodified template to prevent low-confidence outbound send`);
        return { subject, body };
      }

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return { subject: parsed.subject || subject, body: parsed.body || body };
      }
    } catch (err) {
      console.error("AI personalization failed, using template:", err);
    }
  }

  return { subject, body };
}

// Contact-native personalization for CRM-targeted campaigns.
// Separate from generatePersonalizedEmail (which takes a Prospect)
// so the contact path never silently falls through to prospect logic.
async function generateContactCampaignEmail(
  contact: Contact,
  campaign: Campaign,
  stepSubject: string,
  stepBody: string,
  stepNumber: number
): Promise<{ subject: string; body: string }> {
  const mergeFields: Record<string, string> = {
    "{{first_name}}": contact.firstName || contact.companyName?.split(" ")[0] || "there",
    "{{last_name}}": contact.lastName || "",
    "{{company_name}}": contact.companyName || "your business",
    "{{vertical}}": contact.vertical || "your industry",
    "{{city}}": contact.city || "",
    "{{state}}": contact.state || "",
  };

  let subject = stepSubject;
  let body = stepBody;

  for (const [key, value] of Object.entries(mergeFields)) {
    subject = subject.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
    body = body.replace(new RegExp(key.replace(/[{}]/g, "\\$&"), "g"), value);
  }

  if (campaign.aiPersonalization) {
    try {
      const prompt = `You are a B2B outreach email writer for Liberty Bancard, a merchant payment processing company. Personalize this email for maximum engagement.

Contact Info:
- First Name: ${contact.firstName || "Unknown"}
- Company: ${contact.companyName || "Unknown"}
- Industry: ${contact.vertical || contact.industry || "Unknown"}
- Location: ${contact.city || ""} ${contact.state || ""}

Email Template:
Subject: ${subject}
Body: ${body}

Step ${stepNumber} of ${campaign.totalSteps || 3} in sequence.
${stepNumber > 1 ? "This is a follow-up email. Keep it shorter and reference the previous outreach." : ""}

Rules:
- Keep it professional but conversational
- Do NOT promise savings or specific pricing
- Include compliance line: "Eligibility, underwriting, card brand rules, and applicable laws apply."
- Keep subject under 60 characters
- Keep body under 200 words
- Do not use emojis

Return JSON: { "subject": "...", "body": "..." }`;

      const msgs = [{ role: "user" as const, content: prompt }];
      const { completion: response, flagged, reviewQueueId } = await logAiCall(
        { triggerType: "outbound-copy", actorType: "system", rawPrompt: JSON.stringify(msgs) },
        () => getOpenAI().chat.completions.create({
          model: "gpt-4o-mini",
          messages: msgs,
          response_format: { type: "json_object" },
        })
      );

      if (flagged) {
        console.warn(`[AI Governance] Contact campaign personalization flagged (reviewQueueId=${reviewQueueId}) — using template`);
        return { subject, body };
      }

      const content = response.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        return { subject: parsed.subject || subject, body: parsed.body || body };
      }
    } catch (err) {
      console.error("AI personalization failed for contact, using template:", err);
    }
  }

  return { subject, body };
}

export async function queueCampaignMessages(campaignId: number, maxToQueue?: number): Promise<number> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign || campaign.status !== "active") return 0;

  const steps = await storage.getCampaignSteps(campaignId);
  if (steps.length === 0) return 0;

  const prospects = campaign.targetListId
    ? await storage.getProspects(campaign.targetListId)
    : [];

  const eligibleProspects = prospects.filter(p =>
    p.status !== "do_not_contact" &&
    !p.doNotContact &&
    p.email &&
    (campaign.targetScores?.length === 0 || !campaign.targetScores || campaign.targetScores.includes(p.score || ""))
  );

  let queued = 0;
  const now = new Date();
  const limit = maxToQueue ?? DEFAULT_QUEUE_LIMIT;
  const existingMessages = await storage.getOutboundMessages(campaignId);

  for (const prospect of eligibleProspects) {
    if (queued >= limit) break;

    const prospectMessages = existingMessages.filter(m => m.prospectId === prospect.id);
    const completedSteps = prospectMessages.filter(m => m.status === "sent" || m.status === "delivered");

    const nextStepIndex = completedSteps.length;
    if (nextStepIndex >= steps.length) continue;

    const hasReplied = prospectMessages.some(m => m.status === "replied");
    if (hasReplied) continue;

    const step = steps[nextStepIndex];
    const hasPending = prospectMessages.some(m =>
      m.stepId === step.id && (m.status === "queued" || m.status === "scheduled" || m.status === "sent" || m.status === "delivered")
    );
    if (hasPending) continue;

    const lastSent = prospectMessages
      .filter(m => m.sentAt)
      .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())[0];

    if (lastSent && step.delayDays) {
      const delayMs = step.delayDays * 24 * 60 * 60 * 1000;
      if (now.getTime() - new Date(lastSent.sentAt!).getTime() < delayMs) continue;
    }

    // ── Contactability gate for prospects with a linked CRM contact ───────────
    if (prospect.contactId) {
      const gate = await evaluateContactability({
        contactId: prospect.contactId,
        channel: "email",
        campaignType: "marketing_campaign",
        mode: "enforcement",
      });
      if (!gate.allowed) {
        await storage.createAuditLog({
          actorType: "system",
          action: "campaign_queue_blocked_contactability",
          entityType: "contact",
          entityId: prospect.contactId,
          details: { reason: gate.reason, campaignId, prospectId: prospect.id },
        });
        continue; // Do NOT create the outbound_messages row.
      }
    }

    const scheduledFor = new Date(now.getTime() + queued * SEND_INTERVAL_MS);

    await storage.createOutboundMessage({
      campaignId,
      prospectId: prospect.id,
      stepId: step.id,
      channel: step.channel || "email",
      subject: step.subject || "",
      body: step.bodyTemplate || "",
      status: "queued",
      scheduledFor,
    });

    queued++;
  }

  return queued;
}

// CRM contact-mode queuing: targets CRM contacts by vertical/completeness.
// evaluateContactability() is called BEFORE every outbound_messages row creation — kill line.
export async function queueContactCampaignMessages(campaignId: number, maxToQueue?: number): Promise<number> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign || campaign.status !== "active") return 0;

  const steps = await storage.getCampaignSteps(campaignId);
  if (steps.length === 0) return 0;

  // Hard caps: DEFAULT_QUEUE_LIMIT (2000) per call, dailySendLimit per day.
  const batchCap = Math.min(maxToQueue ?? DEFAULT_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT);
  const dailyLimit = campaign.dailySendLimit ?? 200;

  const existingMessages = await storage.getOutboundMessages(campaignId);

  // Count already-sent messages today for daily limit enforcement.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaySentCount = existingMessages.filter(m =>
    m.sentAt && new Date(m.sentAt).getTime() >= todayStart.getTime()
  ).length;

  const remainingDailyBudget = dailyLimit - todaySentCount;
  if (remainingDailyBudget <= 0) return 0;

  const effectiveLimit = Math.min(batchCap, remainingDailyBudget);

  // Fetch audience — over-fetch so JS vertical filter has room to match.
  const candidates = await storage.getContactsForCampaignAudience({
    verticals: campaign.targetVerticals ?? undefined,
    limit: Math.min(effectiveLimit * 5, 50000),
  });

  let queued = 0;
  const now = new Date();

  for (const contact of candidates) {
    if (queued >= effectiveLimit) break;

    const contactMessages = existingMessages.filter(m => m.contactId === contact.id);
    const completedSteps = contactMessages.filter(m => m.status === "sent" || m.status === "delivered");

    const nextStepIndex = completedSteps.length;
    if (nextStepIndex >= steps.length) continue;

    const hasReplied = contactMessages.some(m => m.status === "replied");
    if (hasReplied) continue;

    // Duplicate prevention: skip if already queued/scheduled for same step.
    const step = steps[nextStepIndex];
    const hasPending = contactMessages.some(m =>
      m.stepId === step.id && (m.status === "queued" || m.status === "scheduled" || m.status === "sent" || m.status === "delivered")
    );
    if (hasPending) continue;

    const lastSent = contactMessages
      .filter(m => m.sentAt)
      .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())[0];

    if (lastSent && step.delayDays) {
      const delayMs = step.delayDays * 24 * 60 * 60 * 1000;
      if (now.getTime() - new Date(lastSent.sentAt!).getTime() < delayMs) continue;
    }

    // ── KILL LINE: contactability gate BEFORE row creation ────────────────────
    const gate = await evaluateContactability({
      contactId: contact.id,
      channel: "email",
      campaignType: "marketing_campaign",
      mode: "enforcement",
    });
    if (!gate.allowed) {
      await storage.createAuditLog({
        actorType: "system",
        action: "campaign_queue_blocked_contactability",
        entityType: "contact",
        entityId: contact.id,
        details: { reason: gate.reason, campaignId },
      });
      continue; // Do NOT create the outbound_messages row.
    }

    const scheduledFor = new Date(now.getTime() + queued * SEND_INTERVAL_MS);

    await storage.createOutboundMessage({
      campaignId,
      contactId: contact.id,
      stepId: step.id,
      channel: step.channel || "email",
      subject: step.subject || "",
      body: step.bodyTemplate || "",
      status: "queued",
      scheduledFor,
    });

    queued++;
  }

  return queued;
}

// Preview the CRM contact audience without queuing.
// Returns required contract shape: { eligibleCount, sampleContacts, totalInVerticals, blockedCount, blockReasons }.
export async function previewContactCampaignAudience(campaignId: number): Promise<{
  eligibleCount: number;
  sampleContacts: Array<{ id: number; name: string; email: string; vertical: string | null }>;
  totalInVerticals: number;
  blockedCount: number;
  blockReasons: Record<string, number>;
}> {
  const campaign = await storage.getCampaign(campaignId);
  if (!campaign) {
    return { eligibleCount: 0, sampleContacts: [], totalInVerticals: 0, blockedCount: 0, blockReasons: {} };
  }

  // Fetch pre-filtered candidates (post-SQL + post-JS vertical filter, no contactability gate).
  const candidates = await storage.getContactsForCampaignAudience({
    verticals: campaign.targetVerticals ?? undefined,
    limit: 50000,
  });
  const totalInVerticals = candidates.length;

  // Run evaluateContactability on first 50 to derive blocked breakdown.
  const sampleForGate = candidates.slice(0, 50);
  let blockedCount = 0;
  const blockReasons: Record<string, number> = {};

  for (const contact of sampleForGate) {
    const gate = await evaluateContactability({
      contactId: contact.id,
      channel: "email",
      campaignType: "marketing_campaign",
      mode: "preview",
    });
    if (!gate.allowed) {
      blockedCount++;
      const reason = gate.reason || "unknown";
      blockReasons[reason] = (blockReasons[reason] || 0) + 1;
    }
  }

  // Extrapolate eligible count from sample block rate.
  const sampleSize = sampleForGate.length || 1;
  const blockRate = blockedCount / sampleSize;
  const eligibleCount = Math.max(0, Math.round(totalInVerticals * (1 - blockRate)));

  // Return up to 5 sample contacts (pre-gate — names/emails only).
  const sampleContacts = candidates.slice(0, 5).map(c => ({
    id: c.id,
    name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.companyName || "Unknown",
    email: c.email,
    vertical: c.vertical,
  }));

  return { eligibleCount, sampleContacts, totalInVerticals, blockedCount, blockReasons };
}

export async function processSendQueue(maxToSend?: number): Promise<{ sent: number; failed: number }> {
  if (!isGhlConfigured() && !isSmtpConfigured()) {
    return { sent: 0, failed: 0 };
  }

  const fetchLimit = maxToSend ? Math.min(maxToSend, 50) : 50;
  const messages = await storage.getQueuedMessages(fetchLimit);
  const now = new Date();
  const ready = messages.filter(m => !m.scheduledFor || new Date(m.scheduledFor).getTime() <= now.getTime());

  const { getStoredSignature } = await import("./email-signatures");
  const storedSig = await getStoredSignature("sales");

  let sent = 0;
  let failed = 0;

  // Cache campaign status to avoid N DB fetches per message.
  const campaignStatusCache = new Map<number, string>();

  for (const msg of ready) {
    if (maxToSend !== undefined && sent >= maxToSend) break;

    try {
      // ── Skip messages from paused/draft campaigns ──────────────────────────
      if (msg.campaignId) {
        let campaignStatus = campaignStatusCache.get(msg.campaignId);
        if (campaignStatus === undefined) {
          const c = await storage.getCampaign(msg.campaignId);
          campaignStatus = c?.status ?? "unknown";
          campaignStatusCache.set(msg.campaignId, campaignStatus);
        }
        if (campaignStatus === "paused" || campaignStatus === "draft") {
          continue; // Leave in queued state — do not send, do not fail.
        }
      }

      // ── Route to correct send path based on which FK is set ───────────────
      if (msg.contactId && !msg.prospectId) {
        const result = await sendContactCampaignMessage(msg, storedSig);
        if (result === "sent") sent++;
        else if (result === "failed") failed++;
        // "skipped" counts neither
        continue;
      }

      // ── Legacy prospect path ───────────────────────────────────────────────
      // Guard: prospectId may be null on malformed rows; don't crash with !
      if (!msg.prospectId) {
        await storage.updateOutboundMessage(msg.id, { status: "failed", error: "No prospectId or contactId set" });
        failed++;
        continue;
      }

      const prospect = await storage.getProspect(msg.prospectId);
      if (!prospect || !prospect.email) {
        await storage.updateOutboundMessage(msg.id, { status: "failed", error: "No email address" });
        failed++;
        continue;
      }

      if (prospect.doNotContact) {
        await storage.updateOutboundMessage(msg.id, { status: "skipped", error: "Do not contact" });
        continue;
      }

      if (prospect.contactId) {
        const contact = await storage.getContact(prospect.contactId);
        if (contact && (contact.emailStatus === "bounced" || contact.emailStatus === "invalid")) {
          await storage.updateOutboundMessage(msg.id, { status: "skipped", error: `Email status: ${contact.emailStatus}` });
          await storage.createAuditLog({
            actorType: "system",
            action: "campaign_send_skipped_bad_email",
            entityType: "contact",
            entityId: prospect.contactId,
            details: { emailStatus: contact.emailStatus, messageId: msg.id, reason: "contact email status blocks send" },
          });
          continue;
        }

        // Contactability gate for prospect-linked contacts
        if (contact) {
          const gate = await evaluateContactability({
            contactId: contact.id,
            channel: "email",
            campaignType: "marketing_campaign",
            mode: "enforcement",
          });
          if (!gate.allowed) {
            await storage.updateOutboundMessage(msg.id, { status: "skipped", error: `Contactability blocked: ${gate.reason}` });
            await storage.createAuditLog({
              actorType: "system",
              action: "campaign_send_blocked_contactability",
              entityType: "contact",
              entityId: contact.id,
              details: { reason: gate.reason, messageId: msg.id },
            });
            continue;
          }
        }
      }

      const campaign = msg.campaignId ? await storage.getCampaign(msg.campaignId) : null;
      let subject = msg.subject || "";
      let body = msg.body || "";

      if (campaign) {
        const step = msg.stepId ? (await storage.getCampaignSteps(campaign.id)).find(s => s.id === msg.stepId) : null;
        const stepNumber = step?.stepOrder || 1;
        const personalized = await generatePersonalizedEmail(prospect, campaign, subject, body, stepNumber);
        subject = personalized.subject;
        body = personalized.body;
      }

      // ── CAN-SPAM compliance footer + unsubscribe link ─────────────────────
      if (!prospect.contactId) {
        await storage.updateOutboundMessage(msg.id, { status: "skipped", error: "No linked contact (unsubscribe link unavailable)" });
        await storage.createAuditLog({
          actorType: "system",
          action: "campaign_send_blocked_no_contact_link",
          entityType: "prospect",
          entityId: prospect.id,
          details: { messageId: msg.id, reason: "prospect has no contactId; cannot generate unsubscribe link" },
        });
        continue;
      }

      const appUrl = process.env.APP_URL;
      const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
      const testMode = process.env.TEST_MODE === "true";
      let blockReason: string | null = null;
      if (!mailingAddress) {
        blockReason = "campaign_send_blocked_no_mailing_address";
      } else if (!appUrl) {
        blockReason = "campaign_send_blocked_no_unsubscribe_base_url";
      } else {
        try {
          const { getUnsubscribeTokenSecret } = await import("./unsubscribe-token");
          getUnsubscribeTokenSecret();
        } catch {
          if (!testMode) blockReason = "campaign_send_blocked_no_unsubscribe_secret";
        }
      }

      if (blockReason) {
        await storage.updateOutboundMessage(msg.id, { status: "failed", error: blockReason });
        await storage.createAuditLog({
          actorType: "system",
          action: blockReason,
          entityType: "prospect",
          entityId: prospect.id,
          details: { messageId: msg.id, reason: blockReason },
        });
        failed++;
        continue;
      }

      const complianceFooter = getComplianceFooterHtml(prospect.contactId, mailingAddress!, appUrl!);
      const signature = getEmailSignatureHtml("sales", storedSig);
      const bodyWithSig = body + signature + complianceFooter;

      if (isSmtpConfigured()) {
        const { generateUnsubscribeToken } = await import("./unsubscribe-token");
        const token = generateUnsubscribeToken(prospect.contactId);
        const unsubscribeUrl = `${appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;
        const result = await sendSmtpEmail({
          to: prospect.email!,
          subject,
          html: bodyWithSig,
          unsubscribeUrl,
          unsubscribeMailto: process.env.SMTP_FROM || process.env.SMTP_USER,
        });
        if (!result.success) {
          throw new Error(result.error || "SMTP send failed");
        }
      } else {
        await sendGhlEmail({ contactId: prospect.contactId, subject, body: bodyWithSig });
      }

      await storage.updateOutboundMessage(msg.id, {
        status: "sent",
        sentAt: new Date(),
        personalizedSubject: subject,
        personalizedBody: bodyWithSig,
      });

      await storage.updateProspect(prospect.id, {
        lastContactedAt: new Date(),
        status: "contacted",
      });

      sent++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`Failed to send message ${msg.id}:`, err);
      await storage.updateOutboundMessage(msg.id, {
        status: "failed",
        error: err.message || "Send failed",
      });
      failed++;
    }
  }

  return { sent, failed };
}

// Contact-mode send: called from processSendQueue when msg.contactId is set.
// Returns "sent" | "failed" | "skipped".
async function sendContactCampaignMessage(
  msg: Awaited<ReturnType<typeof storage.getQueuedMessages>>[number],
  storedSig: EmailSignature
): Promise<"sent" | "failed" | "skipped"> {
  if (!msg.contactId) return "failed";

  const contact = await storage.getContact(msg.contactId);
  if (!contact || !contact.email) {
    await storage.updateOutboundMessage(msg.id, { status: "failed", error: "Contact not found or no email" });
    return "failed";
  }

  // Contactability gate — enforcement mode writes audit log
  const gate = await evaluateContactability({
    contactId: contact.id,
    channel: "email",
    campaignType: "marketing_campaign",
    mode: "enforcement",
  });

  if (!gate.allowed) {
    await storage.updateOutboundMessage(msg.id, { status: "skipped", error: `Contactability blocked: ${gate.reason}` });
    await storage.createAuditLog({
      actorType: "system",
      action: "campaign_send_blocked_contactability",
      entityType: "contact",
      entityId: contact.id,
      details: { reason: gate.reason, messageId: msg.id },
    });
    return "skipped";
  }

  // Compliance prerequisites
  const appUrl = process.env.APP_URL;
  const mailingAddress = await storage.getSystemSetting("compliance_mailing_address") as string | null | undefined;
  const testMode = process.env.TEST_MODE === "true";
  let blockReason: string | null = null;

  if (!mailingAddress) {
    blockReason = "campaign_send_blocked_no_mailing_address";
  } else if (!appUrl) {
    blockReason = "campaign_send_blocked_no_unsubscribe_base_url";
  } else {
    try {
      const { getUnsubscribeTokenSecret } = await import("./unsubscribe-token");
      getUnsubscribeTokenSecret();
    } catch {
      if (!testMode) blockReason = "campaign_send_blocked_no_unsubscribe_secret";
    }
  }

  if (blockReason) {
    await storage.updateOutboundMessage(msg.id, { status: "failed", error: blockReason });
    await storage.createAuditLog({
      actorType: "system",
      action: blockReason,
      entityType: "contact",
      entityId: contact.id,
      details: { messageId: msg.id },
    });
    return "failed";
  }

  // Contact-mode campaigns MUST use SMTP for List-Unsubscribe header compliance.
  if (!isSmtpConfigured()) {
    await storage.updateOutboundMessage(msg.id, { status: "failed", error: "SMTP required for contact-mode campaigns" });
    await storage.createAuditLog({
      actorType: "system",
      action: "campaign_send_blocked_no_smtp",
      entityType: "contact",
      entityId: contact.id,
      details: { messageId: msg.id, reason: "contact-mode campaigns require SMTP for List-Unsubscribe headers" },
    });
    return "failed";
  }

  // Personalize
  const campaign = msg.campaignId ? await storage.getCampaign(msg.campaignId) : null;
  let subject = msg.subject || "";
  let body = msg.body || "";

  if (campaign) {
    const step = msg.stepId ? (await storage.getCampaignSteps(campaign.id)).find(s => s.id === msg.stepId) : null;
    const stepNumber = step?.stepOrder || 1;
    const personalized = await generateContactCampaignEmail(contact as Contact, campaign, subject, body, stepNumber);
    subject = personalized.subject;
    body = personalized.body;
  }

  const complianceFooter = getComplianceFooterHtml(contact.id, mailingAddress!, appUrl!);
  const signature = getEmailSignatureHtml("sales", storedSig);
  const bodyWithSig = body + signature + complianceFooter;

  const { generateUnsubscribeToken } = await import("./unsubscribe-token");
  const token = generateUnsubscribeToken(contact.id);
  const unsubscribeUrl = `${appUrl}/unsubscribe?t=${encodeURIComponent(token)}`;

  const result = await sendSmtpEmail({
    to: contact.email,
    subject,
    html: bodyWithSig,
    unsubscribeUrl,
    unsubscribeMailto: process.env.SMTP_FROM || process.env.SMTP_USER,
  });

  if (!result.success) {
    await storage.updateOutboundMessage(msg.id, {
      status: "failed",
      error: result.error || "SMTP send failed",
    });
    return "failed";
  }

  await storage.updateOutboundMessage(msg.id, {
    status: "sent",
    sentAt: new Date(),
    personalizedSubject: subject,
    personalizedBody: bodyWithSig,
  });

  await storage.updateContact(contact.id, { lastContactedAt: new Date() });

  return "sent";
}

export async function getDailySendCount(campaignId?: number): Promise<number> {
  const { db } = await import("../db");
  const { outboundMessages } = await import("@shared/schema");
  const { gte, eq, and: drizzleAnd, isNotNull } = await import("drizzle-orm");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const conditions = [
    isNotNull(outboundMessages.sentAt),
    gte(outboundMessages.sentAt, today),
  ];
  if (campaignId !== undefined) {
    conditions.push(eq(outboundMessages.campaignId, campaignId));
  }

  const rows = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(drizzleAnd(...conditions));

  return rows.length;
}

export async function getCampaignAnalytics(campaignId: number) {
  const stats = await storage.getOutboundStats(campaignId);
  const campaign = await storage.getCampaign(campaignId);
  const steps = await storage.getCampaignSteps(campaignId);

  return {
    campaign,
    steps,
    stats: {
      totalSent: stats.sent,
      totalOpened: stats.opened,
      totalReplied: stats.replied,
      totalBounced: stats.bounced,
      openRate: stats.sent > 0 ? ((stats.opened / stats.sent) * 100).toFixed(1) : "0",
      replyRate: stats.sent > 0 ? ((stats.replied / stats.sent) * 100).toFixed(1) : "0",
      bounceRate: stats.sent > 0 ? ((stats.bounced / stats.sent) * 100).toFixed(1) : "0",
    },
  };
}
