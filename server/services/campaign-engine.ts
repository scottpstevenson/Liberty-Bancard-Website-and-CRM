import { storage } from "../storage";
import type { Prospect, Campaign } from "@shared/schema";
import OpenAI from "openai";
import { sendGhlEmail, isGhlConfigured } from "./ghl";
import { getEmailSignatureHtml } from "./email-signatures";
import { logAiCall } from "./ai-audit-logger";

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
          model: "gpt-5-mini",
          messages: campaignMessages,
          response_format: { type: "json_object" },
          temperature: 0.7,
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

  for (const prospect of eligibleProspects) {
    const existingMessages = await storage.getOutboundMessages(campaignId);
    const prospectMessages = existingMessages.filter(m => m.prospectId === prospect.id);
    const completedSteps = prospectMessages.filter(m => m.status === "sent" || m.status === "delivered");

    const nextStepIndex = completedSteps.length;
    if (nextStepIndex >= steps.length) continue;

    const hasReplied = prospectMessages.some(m => m.status === "replied");
    if (hasReplied) continue;

    const hasPending = prospectMessages.some(m => m.status === "queued" || m.status === "scheduled");
    if (hasPending) continue;

    const step = steps[nextStepIndex];

    const lastSent = prospectMessages
      .filter(m => m.sentAt)
      .sort((a, b) => new Date(b.sentAt!).getTime() - new Date(a.sentAt!).getTime())[0];

    if (lastSent && step.delayDays) {
      const delayMs = step.delayDays * 24 * 60 * 60 * 1000;
      if (now.getTime() - new Date(lastSent.sentAt!).getTime() < delayMs) continue;
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
    const limit = maxToQueue ?? DEFAULT_QUEUE_LIMIT;
    if (queued >= limit) break;
  }

  return queued;
}

export async function processSendQueue(maxToSend?: number): Promise<{ sent: number; failed: number }> {
  if (!isGhlConfigured()) {
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

  for (const msg of ready) {
    if (maxToSend !== undefined && sent >= maxToSend) break;

    try {
      const prospect = await storage.getProspect(msg.prospectId!);
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

      const signature = getEmailSignatureHtml("sales", storedSig);
      const bodyWithSig = body + signature;

      await sendGhlEmail({ contactId: prospect.contactId || 0, subject, body: bodyWithSig });

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

export async function getDailySendCount(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return 0;
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
