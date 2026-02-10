import { storage } from "../storage";
import type { Contact, Deal } from "@shared/schema";

const GHL_API_BASE = "https://services.leadconnectorhq.com";

interface GhlConfig {
  apiKey: string;
  locationId: string;
  calendarId?: string;
}

function getConfig(): GhlConfig | null {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return {
    apiKey,
    locationId,
    calendarId: process.env.GHL_CALENDAR_ID || undefined,
  };
}

async function ghlFetch(path: string, options: RequestInit = {}) {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID.");

  const url = `${GHL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`GHL API error ${response.status}: ${errorBody}`);
  }
  return response.json();
}

export function isGhlConfigured(): boolean {
  return getConfig() !== null;
}

export function getGhlStatus() {
  const config = getConfig();
  return {
    configured: !!config,
    hasApiKey: !!process.env.GHL_API_KEY,
    hasLocationId: !!process.env.GHL_LOCATION_ID,
    hasCalendarId: !!process.env.GHL_CALENDAR_ID,
  };
}

export async function upsertGhlContact(contact: Contact): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured");

  const payload = {
    locationId: config.locationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    companyName: contact.companyName || undefined,
    tags: contact.tags || [],
    customField: {} as Record<string, string>,
  };

  if (contact.vertical) payload.customField["vertical"] = contact.vertical;
  if (contact.monthlyVolume) payload.customField["monthly_volume"] = contact.monthlyVolume;
  if (contact.primaryOfferPath) payload.customField["offer_path"] = contact.primaryOfferPath;
  if (contact.currentProvider) payload.customField["current_provider"] = contact.currentProvider;

  if (contact.ghlContactId) {
    const result = await ghlFetch(`/contacts/${contact.ghlContactId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return contact.ghlContactId;
  }

  const result = await ghlFetch("/contacts/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const ghlId = result.contact?.id;
  if (ghlId && contact.id) {
    await storage.updateContact(contact.id, { ghlContactId: ghlId });
  }
  return ghlId;
}

export async function sendGhlEmail(params: {
  contactId: number;
  dealId?: number;
  subject: string;
  body: string;
  templateId?: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const contact = await storage.getContact(params.contactId);
    if (!contact) throw new Error("Contact not found");
    if (!contact.email) throw new Error("Contact has no email");

    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      ghlContactId = await upsertGhlContact(contact);
    }

    const config = getConfig();
    if (!config) throw new Error("GHL not configured");

    const emailPayload = {
      type: "Email",
      contactId: ghlContactId,
      subject: params.subject,
      html: params.body,
    };

    const result = await ghlFetch("/conversations/messages", {
      method: "POST",
      body: JSON.stringify(emailPayload),
    });

    await storage.createGhlActivityLog({
      contactId: params.contactId,
      dealId: params.dealId || null,
      direction: "outbound",
      channel: "email",
      templateId: params.templateId || null,
      subject: params.subject,
      body: params.body,
      status: "sent",
      ghlMessageId: result?.messageId || null,
    });

    return { success: true, messageId: result?.messageId };
  } catch (err: any) {
    await storage.createGhlActivityLog({
      contactId: params.contactId,
      dealId: params.dealId || null,
      direction: "outbound",
      channel: "email",
      templateId: params.templateId || null,
      subject: params.subject,
      body: params.body,
      status: "failed",
      ghlMessageId: null,
      metadata: { error: err.message },
    });
    return { success: false, error: err.message };
  }
}

export async function sendGhlSms(params: {
  contactId: number;
  dealId?: number;
  body: string;
  templateId?: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const contact = await storage.getContact(params.contactId);
    if (!contact) throw new Error("Contact not found");
    if (!contact.phone) throw new Error("Contact has no phone");
    if (!contact.consentSms) throw new Error("Contact has not consented to SMS");

    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      ghlContactId = await upsertGhlContact(contact);
    }

    const smsPayload = {
      type: "SMS",
      contactId: ghlContactId,
      message: params.body,
    };

    const result = await ghlFetch("/conversations/messages", {
      method: "POST",
      body: JSON.stringify(smsPayload),
    });

    await storage.createGhlActivityLog({
      contactId: params.contactId,
      dealId: params.dealId || null,
      direction: "outbound",
      channel: "sms",
      templateId: params.templateId || null,
      subject: null,
      body: params.body,
      status: "sent",
      ghlMessageId: result?.messageId || null,
    });

    return { success: true, messageId: result?.messageId };
  } catch (err: any) {
    await storage.createGhlActivityLog({
      contactId: params.contactId,
      dealId: params.dealId || null,
      direction: "outbound",
      channel: "sms",
      templateId: params.templateId || null,
      subject: null,
      body: params.body,
      status: "failed",
      ghlMessageId: null,
      metadata: { error: err.message },
    });
    return { success: false, error: err.message };
  }
}

export function getCalendarBookingUrl(params?: {
  contactEmail?: string;
  contactName?: string;
  source?: string;
}): string | null {
  const config = getConfig();
  if (!config?.calendarId) return null;

  let url = `https://api.leadconnectorhq.com/widget/booking/${config.calendarId}`;
  const queryParams: string[] = [];
  if (params?.contactEmail) queryParams.push(`email=${encodeURIComponent(params.contactEmail)}`);
  if (params?.contactName) queryParams.push(`name=${encodeURIComponent(params.contactName)}`);
  if (params?.source) queryParams.push(`source=${encodeURIComponent(params.source)}`);
  if (queryParams.length > 0) url += `?${queryParams.join("&")}`;

  return url;
}

export function resolveMergeFields(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
    const keys = path.split(".");
    let value: any = data;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined || value === null) return match;
    }
    return String(value);
  });
}

export async function sendTemplatedMessage(params: {
  templateId: number;
  contactId: number;
  dealId?: number;
  extraData?: Record<string, any>;
}): Promise<{ success: boolean; error?: string }> {
  const template = await storage.getMessageTemplate(params.templateId);
  if (!template) return { success: false, error: "Template not found" };
  if (!template.isActive) return { success: false, error: "Template is inactive" };

  const contact = await storage.getContact(params.contactId);
  if (!contact) return { success: false, error: "Contact not found" };

  let deal: Deal | undefined;
  if (params.dealId) {
    deal = await storage.getDeal(params.dealId);
  }

  const mergeData: Record<string, any> = {
    contact: {
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`,
      email: contact.email,
      phone: contact.phone,
      companyName: contact.companyName || "",
      vertical: contact.vertical || "",
    },
    deal: deal ? {
      effectiveRate: deal.effectiveRate || "",
      totalVolume: deal.totalVolume || "",
      totalFees: deal.totalFees || "",
      avgTicket: deal.avgTicket || "",
      recommendedPath: deal.recommendedPath || "",
      terminalRecommendation: deal.terminalRecommendation || "",
      offerPath: deal.offerPath || "",
      stage: deal.stage,
      estimatedGrossProfitMonthly: deal.estimatedGrossProfitMonthly || "",
      merchantTier: deal.merchantTier || "",
    } : {},
    calendarLink: getCalendarBookingUrl({
      contactEmail: contact.email,
      contactName: `${contact.firstName} ${contact.lastName}`,
    }) || "[CALENDAR_LINK]",
    ...params.extraData,
  };

  const resolvedBody = resolveMergeFields(template.body, mergeData);
  const resolvedSubject = template.subject ? resolveMergeFields(template.subject, mergeData) : undefined;

  if (template.channel === "email") {
    return sendGhlEmail({
      contactId: params.contactId,
      dealId: params.dealId,
      subject: resolvedSubject || "Liberty Bancard",
      body: resolvedBody,
      templateId: template.id,
    });
  } else if (template.channel === "sms") {
    return sendGhlSms({
      contactId: params.contactId,
      dealId: params.dealId,
      body: resolvedBody,
      templateId: template.id,
    });
  }

  return { success: false, error: `Unknown channel: ${template.channel}` };
}

export async function handleGhlWebhook(payload: any): Promise<void> {
  const { type, contactId, messageId, direction, body, subject, status: deliveryStatus } = payload;

  if (deliveryStatus && contactId) {
    const contacts = await storage.getContacts();
    const contact = contacts.find(c => c.ghlContactId === contactId);
    if (contact) {
      const recentLogs = await storage.getGhlActivityLogs(contact.id);
      const matchingLog = recentLogs.find(l => l.ghlMessageId === messageId);
      if (matchingLog) {
        console.log(`[GHL Webhook] Delivery status update: ${deliveryStatus} for message ${messageId}`);
      }
    }
  }

  if (direction === "inbound") {
    const contacts = await storage.getContacts();
    const contact = contacts.find(c => c.ghlContactId === contactId);
    if (contact) {
      const channel = type === "SMS" ? "sms" : "email";

      const deals = await storage.getDeals();
      const contactDeal = deals.find(d => d.contactId === contact.id);

      await storage.createGhlActivityLog({
        contactId: contact.id,
        dealId: contactDeal?.id || null,
        direction: "inbound",
        channel,
        templateId: null,
        subject: subject || null,
        body: body || null,
        status: "received",
        ghlMessageId: messageId || null,
      });

      await storage.updateContact(contact.id, {
        lastContactedAt: new Date(),
        tags: Array.from(new Set([...(contact.tags || []), "replied", `replied_${channel}`])),
      });

      const messageClassification = classifyInboundMessage(body || "");

      await storage.createNotification({
        channel: "internal",
        title: `Inbound ${channel.toUpperCase()} from ${contact.firstName} ${contact.lastName}`,
        message: body?.substring(0, 200) || "New message received",
        type: messageClassification.priority === "high" ? "warning" : "info",
        metadata: {
          contactId: contact.id,
          dealId: contactDeal?.id,
          channel,
          classification: messageClassification,
        },
      });

      if (messageClassification.intent === "unsubscribe") {
        await storage.updateContact(contact.id, { doNotContact: true });
        await storage.createAuditLog({
          action: "contact_unsubscribed",
          entityType: "contact",
          entityId: contact.id,
          details: { source: "ghl_inbound_message", channel },
        });
      }

      if (messageClassification.intent === "interested" && contactDeal) {
        if (["New Lead", "Contacted"].includes(contactDeal.stage)) {
          await storage.updateDeal(contactDeal.id, { stage: "Engaged" });
          await storage.createAuditLog({
            action: "deal_auto_progressed",
            entityType: "deal",
            entityId: contactDeal.id,
            details: { from: contactDeal.stage, to: "Engaged", reason: "inbound_reply" },
          });
        }
      }

      if (messageClassification.intent === "support" || messageClassification.intent === "question") {
        await storage.createTask({
          title: `Follow up: ${contact.firstName} ${contact.lastName} - ${messageClassification.intent}`,
          assignedTo: contactDeal?.owner || "Unassigned",
          priority: messageClassification.priority === "high" ? "high" : "medium",
          dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000),
          dealId: contactDeal?.id,
          contactId: contact.id,
        });
      }

      if (messageClassification.intent === "callback") {
        await storage.createTask({
          title: `CALLBACK REQUEST: ${contact.firstName} ${contact.lastName}`,
          assignedTo: contactDeal?.owner || "Unassigned",
          priority: "high",
          dueDate: new Date(Date.now() + 1 * 60 * 60 * 1000),
          dealId: contactDeal?.id,
          contactId: contact.id,
        });
      }

      try {
        const { triggerWorkflowsByEvent } = await import("./workflow-executor");
        await triggerWorkflowsByEvent("inbound_message", {
          entityType: "contact",
          entityId: contact.id,
          data: { channel, body, subject, classification: messageClassification },
        });
      } catch (e) {
        console.error("[GHL Webhook] Workflow trigger error:", e);
      }

      await storage.createAuditLog({
        action: "inbound_message_processed",
        entityType: "contact",
        entityId: contact.id,
        details: {
          channel,
          classification: messageClassification,
          dealId: contactDeal?.id,
          messagePreview: (body || "").substring(0, 100),
        },
      });
    }
  }

  if (type === "unsubscribe" && contactId) {
    const contacts = await storage.getContacts();
    const contact = contacts.find(c => c.ghlContactId === contactId);
    if (contact) {
      await storage.updateContact(contact.id, { doNotContact: true });
      await storage.createAuditLog({
        action: "contact_unsubscribed",
        entityType: "contact",
        entityId: contact.id,
        details: { source: "ghl_webhook" },
      });
    }
  }
}

function classifyInboundMessage(message: string): {
  intent: "interested" | "unsubscribe" | "question" | "support" | "callback" | "neutral";
  priority: "high" | "medium" | "low";
  keywords: string[];
} {
  const lower = message.toLowerCase();
  const keywords: string[] = [];

  const unsubWords = ["unsubscribe", "stop", "opt out", "remove me", "do not contact", "take me off"];
  const interestWords = ["interested", "tell me more", "sounds good", "let's talk", "sign me up", "ready", "i want", "let's do it", "i'm in"];
  const callbackWords = ["call me", "give me a call", "phone me", "call back", "callback", "ring me"];
  const supportWords = ["problem", "issue", "not working", "broken", "help", "complaint", "frustrated", "error", "charge", "refund"];
  const questionWords = ["how much", "what is", "how does", "when can", "pricing", "rates", "cost", "?"];

  for (const w of unsubWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "unsubscribe", priority: "high", keywords };

  for (const w of callbackWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "callback", priority: "high", keywords };

  for (const w of supportWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "support", priority: "high", keywords };

  for (const w of interestWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "interested", priority: "medium", keywords };

  for (const w of questionWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "question", priority: "medium", keywords };

  return { intent: "neutral", priority: "low", keywords: [] };
}
