import crypto from "crypto";
import { storage } from "../storage";
import type { Contact, Deal } from "@shared/schema";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
}

const GHL_API_BASE = "https://services.leadconnectorhq.com";

interface GhlConfig {
  apiKey: string;
  locationId: string;
  calendarId?: string;
}

function getConfig(): GhlConfig | null {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return {
    apiKey,
    locationId,
    calendarId: process.env.GHL_CALENDAR_ID || undefined,
  };
}

async function ghlFetch(path: string, options: RequestInit = {}, retries = 3): Promise<any> {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID.");

  const url = `${GHL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
    ...(options.headers as Record<string, string> || {}),
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers });

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("retry-after") || "5", 10);
        const waitMs = retryAfter * 1000;
        console.warn(`[GHL] 429 rate limited, retrying after ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      if (response.status >= 500 && attempt < retries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
        console.warn(`[GHL] Server error ${response.status}, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`GHL API error ${response.status}: ${errorBody}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (response.status === 204 || !contentType.includes("application/json")) {
        return {};
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (err: unknown) {
      if (attempt === retries - 1) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isRetryable = errMsg.includes("429") || errMsg.includes("ECONNRESET") || errMsg.includes("ETIMEDOUT") || errMsg.includes("fetch failed");
      if (isRetryable) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 15000);
        console.warn(`[GHL] Transient error, retrying in ${Math.round(backoffMs)}ms (attempt ${attempt + 1}/${retries}): ${errMsg.substring(0, 100)}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`GHL API request to ${path} failed after ${retries} retries`);
}

export function isGhlConfigured(): boolean {
  return getConfig() !== null;
}

export function getGhlStatus() {
  const config = getConfig();
  const hasToken = !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY);
  return {
    configured: !!config,
    hasToken,
    hasApiKey: !!process.env.GHL_API_KEY,
    hasPrivateToken: !!process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
    hasLocationId: !!process.env.GHL_LOCATION_ID,
    hasCalendarId: !!process.env.GHL_CALENDAR_ID,
    hasWebhookSecret: !!process.env.GHL_WEBHOOK_SECRET,
    missingConfig: [
      ...(!hasToken ? ["GHL_PRIVATE_INTEGRATION_TOKEN or GHL_API_KEY"] : []),
      ...(!process.env.GHL_LOCATION_ID ? ["GHL_LOCATION_ID"] : []),
      ...(!process.env.GHL_CALENDAR_ID ? ["GHL_CALENDAR_ID"] : []),
      ...(!process.env.GHL_WEBHOOK_SECRET ? ["GHL_WEBHOOK_SECRET"] : []),
    ],
  };
}

export function validateGhlWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[GHL] GHL_WEBHOOK_SECRET not set in production — rejecting webhook");
      return false;
    }
    console.warn("[GHL] GHL_WEBHOOK_SECRET not set — skipping signature verification (dev mode)");
    return true;
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    const sigToCompare = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    if (sigToCompare.length !== expectedSig.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sigToCompare, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

export async function checkGhlHealth(): Promise<{
  connected: boolean;
  latencyMs: number;
  locationName?: string;
  error?: string;
  configStatus?: ReturnType<typeof getGhlStatus>;
}> {
  const status = getGhlStatus();
  const config = getConfig();
  if (!config) {
    return {
      connected: false,
      latencyMs: 0,
      error: `GHL not configured. Missing: ${status.missingConfig.filter(k => ["GHL_API_KEY", "GHL_LOCATION_ID"].includes(k)).join(", ")}`,
      configStatus: status,
    };
  }

  const start = Date.now();
  try {
    const data = await ghlFetch(`/locations/${config.locationId}`);
    const latencyMs = Date.now() - start;
    return {
      connected: true,
      latencyMs,
      locationName: data?.location?.name || data?.name || "Unknown",
      configStatus: status,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      connected: false,
      latencyMs,
      error: err.message,
      configStatus: status,
    };
  }
}

type GhlContactInput = Pick<Contact,
  "id" | "firstName" | "lastName" | "email" | "phone" | "ghlContactId"
> & Partial<Pick<Contact,
  "companyName" | "tags" | "vertical" | "monthlyVolume" | "primaryOfferPath" |
  "currentProvider" | "painPoints" | "interestedIn0Percent" | "needTerminal" |
  "utmSource" | "utmMedium" | "utmCampaign" | "promoCode" | "consentSms" |
  "consentEmail" | "landingPage"
>>;

/**
 * Look up an existing GHL contact by email. Returns the GHL contact ID if found,
 * or null if no match exists. Never creates a contact.
 */
export async function lookupGhlContactByEmail(email: string): Promise<string | null> {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured");
  try {
    const result = await ghlFetch(
      `/contacts/search/duplicate?locationId=${encodeURIComponent(config.locationId)}&email=${encodeURIComponent(email)}`,
      { method: "GET" }
    );
    const id = result?.contact?.id ?? result?.contacts?.[0]?.id ?? null;
    return id ?? null;
  } catch {
    return null;
  }
}

export async function upsertGhlContact(contact: GhlContactInput): Promise<string> {
  const config = getConfig();
  if (!config) throw new Error("GHL not configured");

  const customFields: Array<{ key: string; field_value: string }> = [];
  const addCF = (key: string, value: string) => customFields.push({ key, field_value: value });

  if (contact.vertical) {
    addCF("vertical", contact.vertical);
    addCF("lb_vertical", contact.vertical);
  }
  if (contact.monthlyVolume) {
    addCF("monthly_volume", contact.monthlyVolume);
    addCF("lb_monthly_volume", contact.monthlyVolume);
  }
  if (contact.primaryOfferPath) {
    addCF("offer_path", contact.primaryOfferPath);
    addCF("lb_preferred_program", contact.primaryOfferPath);
  }
  if (contact.currentProvider) {
    addCF("current_provider", contact.currentProvider);
    addCF("lb_current_processor", contact.currentProvider);
  }
  if (contact.painPoints && Array.isArray(contact.painPoints) && contact.painPoints.length > 0) {
    addCF("lb_pain_points", contact.painPoints.join(", "));
  }
  if (contact.interestedIn0Percent !== undefined && contact.interestedIn0Percent !== null) {
    addCF("lb_interested_0_percent", contact.interestedIn0Percent ? "Yes" : "No");
  }
  if (contact.needTerminal !== undefined && contact.needTerminal !== null) {
    addCF("lb_terminal_need", contact.needTerminal ? "Yes" : "No");
  }
  if (contact.utmSource) addCF("lb_utm_source", contact.utmSource);
  if (contact.utmMedium) addCF("lb_utm_medium", contact.utmMedium);
  if (contact.utmCampaign) addCF("lb_utm_campaign", contact.utmCampaign);
  if (contact.promoCode) addCF("lb_promo_code", contact.promoCode);
  if (contact.consentSms !== undefined && contact.consentSms !== null) {
    addCF("lb_consent_sms", contact.consentSms ? "Yes" : "No");
  }
  if (contact.consentEmail !== undefined && contact.consentEmail !== null) {
    addCF("lb_consent_email", contact.consentEmail ? "Yes" : "No");
  }
  if (contact.landingPage) {
    const sourceMap: Record<string, string> = {
      "/free-analysis": "free-analysis",
      "/get-started": "get-started",
      "/upload-statement": "statement-upload",
      "/support": "support",
      "/merchant-application": "merchant-app",
      "/affiliate": "affiliate",
      "/estimate": "estimate",
    };
    addCF("lb_lead_source", sourceMap[contact.landingPage] || contact.landingPage);
  }

  const payload: Record<string, unknown> = {
    locationId: config.locationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    companyName: contact.companyName || undefined,
    tags: contact.tags || [],
  };
  if (customFields.length > 0) {
    payload.customFields = customFields;
  }

  // GHL only accepts locationId on contact CREATE (POST), not UPDATE (PUT).
  // Build a separate update payload without locationId to avoid 422 errors.
  const { locationId: _loc, ...updatePayload } = payload;

  if (contact.ghlContactId) {
    await ghlFetch(`/contacts/${contact.ghlContactId}`, {
      method: "PUT",
      body: JSON.stringify(updatePayload),
    });
    return contact.ghlContactId;
  }

  try {
    const result = await ghlFetch("/contacts/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const ghlId = result.contact?.id;
    if (ghlId && contact.id) {
      await storage.updateContact(contact.id, { ghlContactId: ghlId });
    }
    return ghlId;
  } catch (err: any) {
    // GHL returns 400 with the existing contact ID when a duplicate is detected.
    // Parse it out, link, and update — this turns a hard error into a successful upsert.
    const msg = String(err?.message || "");
    if (msg.includes("400") && /duplicat|already exist/i.test(msg)) {
      const idMatch = msg.match(/"(?:id|contactId)"\s*:\s*"([a-zA-Z0-9]+)"/);
      const existingId = idMatch?.[1];
      if (existingId) {
        try {
          await ghlFetch(`/contacts/${existingId}`, {
            method: "PUT",
            body: JSON.stringify(updatePayload),
          });
          if (contact.id) {
            await storage.updateContact(contact.id, { ghlContactId: existingId });
          }
          return existingId;
        } catch (putErr: any) {
          console.warn(`[GHL] Linked existing contact ${existingId} but PUT update failed:`, putErr?.message);
          if (contact.id) {
            await storage.updateContact(contact.id, { ghlContactId: existingId });
          }
          return existingId;
        }
      }
    }
    throw err;
  }
}

export async function sendGhlEmail(params: {
  contactId: number;
  dealId?: number;
  subject: string;
  body: string;
  templateId?: number;
  fromEmail?: string;
  fromName?: string;
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

    const emailPayload: Record<string, unknown> = {
      type: "Email",
      contactId: ghlContactId,
      subject: params.subject,
      html: params.body,
    };

    if (params.fromEmail) {
      emailPayload.emailFrom = params.fromEmail;
    }
    if (params.fromName) {
      emailPayload.emailReplyMode = "custom";
      if (params.fromEmail) {
        emailPayload.emailFrom = params.fromEmail;
      }
    }

    const result = await ghlFetch("/conversations/messages", {
      method: "POST",
      body: JSON.stringify(emailPayload),
    });

    if (result?.messageId) trackOutboundMessageId(result.messageId);

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

export async function sendGhlEmailForMerchant(params: {
  email: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const config = getConfig();
    if (!config) throw new Error("GHL not configured");

    const emailPayload = {
      type: "Email",
      email: params.email,
      subject: params.subject,
      html: params.body,
    };

    const result = await ghlFetch("/conversations/messages", {
      method: "POST",
      body: JSON.stringify(emailPayload),
    });

    if (result?.messageId) trackOutboundMessageId(result.messageId);

    console.log(`[GHL] Welcome email sent to ${params.email} - Subject: ${params.subject}`);

    return { success: true };
  } catch (err: any) {
    console.error(`[GHL] Welcome email failed for ${params.email}:`, err.message);
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

    if (result?.messageId) trackOutboundMessageId(result.messageId);

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

  if (type === "ContactUpdate" || type === "contact-updated" || type === "ContactCreate" || type === "contact-created") {
    await handleContactUpdated(payload);
    return;
  }

  if (type === "OpportunityUpdated" || type === "opportunity-updated" || type === "OpportunityStageUpdate") {
    await handleOpportunityUpdated(payload);
    return;
  }

  if (type === "TaskCompleted" || type === "task-completed") {
    await handleTaskCompleted(payload);
    return;
  }

  if (type === "TaskUpdated" || type === "task-updated" || type === "TaskCreate" || type === "task-created") {
    await handleTaskUpdated(payload);
    return;
  }

  if (type === "NoteAdded" || type === "note-added" || type === "NoteCreate") {
    await handleNoteAdded(payload);
    return;
  }

  if (type === "TagAdded" || type === "tag-added" || type === "ContactTagUpdate") {
    await handleTagAdded(payload);
    return;
  }

  if (type === "TagRemoved" || type === "tag-removed") {
    await handleTagRemoved(payload);
    return;
  }

  if (deliveryStatus && contactId) {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
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
    if (messageId && isOurOutboundMessage(messageId)) {
      console.log(`[GHL Webhook] Ignoring echo of our own outbound message: ${messageId}`);
      return;
    }

    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === contactId);
    if (contact) {
      const channel = type === "SMS" ? "sms" : "email";

      const { data: deals } = await storage.getDeals({ limit: 500 });
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
        await storage.updateContact(contact.id, {
          doNotContact: true,
          consentEmail: false,
          consentSms: false,
        });
        await storage.pauseAllActiveEnrollments(contact.id);
        await storage.createAuditLog({
          action: "contact_unsubscribed",
          entityType: "contact",
          entityId: contact.id,
          details: { source: "ghl_inbound_message", channel },
        });

        if (contact.ghlContactId) {
          const { enrollInGhlWorkflow } = await import("./ghl-workflows");
          enrollInGhlWorkflow({ workflowKey: "unsubscribe", ghlContactId: contact.ghlContactId }).catch(
            (err: any) => console.warn("[GHL Webhook] GHL unsubscribe enrollment failed (non-blocking):", err?.message)
          );
        }
      }

      if (messageClassification.intent === "positive_reply" && contactDeal) {
        if (["New Lead", "Contacted"].includes(contactDeal.stage)) {
          const { advanceDealStage } = await import("./deal-stage-service");
          await advanceDealStage(contactDeal.id, "Engaged", "ghl_inbound_interested");
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

      if (messageClassification.intent === "booking_intent") {
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

      try {
        const autoReplyResult = await sendAiAutoReply({
          contact,
          deal: contactDeal,
          channel,
          inboundMessage: body || "",
          classification: messageClassification,
        });
        if (autoReplyResult.sent) {
          console.log(`[GHL Webhook] AI auto-reply sent to ${contact.firstName} ${contact.lastName} via ${channel}`);
        } else {
          console.log(`[GHL Webhook] AI auto-reply skipped: ${autoReplyResult.error}`);
        }
      } catch (autoReplyErr: any) {
        console.error("[GHL Webhook] AI auto-reply error:", autoReplyErr.message);
      }
    }
  }

  if (type === "unsubscribe" && contactId) {
    const { data: contacts } = await storage.getContacts({ limit: 500 });
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

const recentAutoReplies = new Map<string, number>();
const outboundMessageIds = new Set<string>();

function trackOutboundMessageId(messageId: string) {
  if (!messageId) return;
  outboundMessageIds.add(messageId);
  setTimeout(() => outboundMessageIds.delete(messageId), 30 * 60 * 1000);
}

function isOurOutboundMessage(messageId: string): boolean {
  return messageId ? outboundMessageIds.has(messageId) : false;
}

async function hasRecentAutoReply(contactId: number, channel: string): Promise<boolean> {
  const key = `${contactId}_${channel}`;
  const lastReply = recentAutoReplies.get(key);
  if (lastReply && Date.now() - lastReply < 5 * 60 * 1000) {
    return true;
  }
  const logs = await storage.getGhlActivityLogs(contactId);
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  return logs.some(l =>
    l.direction === "outbound" &&
    l.channel === channel &&
    l.status === "sent" &&
    l.createdAt && new Date(l.createdAt) > fiveMinAgo &&
    l.metadata && (l.metadata as any).autoReply === true
  );
}

function markAutoReplySent(contactId: number, channel: string) {
  recentAutoReplies.set(`${contactId}_${channel}`, Date.now());
  setTimeout(() => recentAutoReplies.delete(`${contactId}_${channel}`), 5 * 60 * 1000);
}

async function generateAiAutoReply(params: {
  contact: Contact;
  deal: Deal | undefined;
  channel: "email" | "sms";
  inboundMessage: string;
  classification: { intent: string; priority: string; keywords: string[] };
}): Promise<{ subject?: string; body: string } | null> {
  const { contact, deal, channel, inboundMessage, classification } = params;

  const noReplyIntents = ["unsubscribe", "booking_intent", "neutral"];
  if (noReplyIntents.includes(classification.intent)) return null;

  if (contact.doNotContact) return null;

  if (channel === "sms" && !contact.consentSms) return null;

  if (await hasRecentAutoReply(contact.id, channel)) {
    console.log(`[AI Auto-Reply] Skipped: recent auto-reply already sent to contact ${contact.id} via ${channel}`);
    return null;
  }

  const isSms = channel === "sms";

  const systemPrompt = `You are a professional sales advisor for Liberty Bancard, a merchant payment processing company. Generate a helpful, compliant reply to an inbound ${channel} message from a business prospect.

RULES:
- Be warm, professional, and helpful
- NEVER make specific savings promises (like "save 30%") — use phrases like "many merchants find significant savings" or "we typically help businesses reduce processing costs"
- NEVER provide legal, tax, or PCI compliance advice
- NEVER ask for sensitive card data or bank account numbers
- Always include a clear next step (schedule a call, send a statement for review, etc.)
- If they asked a pricing question, explain that pricing depends on their specific processing profile and offer a free statement analysis
- Keep the tone conversational but professional
${isSms ? "- Keep response under 300 characters for SMS" : "- Keep response concise but thorough for email"}
- Sign off as "Liberty Bancard Team"

COMPLIANCE DISCLAIMER (must be included in every reply):
${isSms ? "Msg&data rates may apply. Reply STOP to opt out." : "This message is from Liberty Bancard. If you no longer wish to receive communications, please reply STOP or contact us to be removed from our list."}`;

  const contactContext = `Contact: ${contact.firstName} ${contact.lastName}
Company: ${contact.companyName || "Not specified"}
Industry: ${contact.vertical || "Not specified"}
Current Provider: ${contact.currentProvider || "Not specified"}
Monthly Volume: ${contact.monthlyVolume || "Not specified"}
Deal Stage: ${deal?.stage || "No active deal"}
Message Intent: ${classification.intent}
Message Keywords: ${classification.keywords.join(", ")}`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${contactContext}\n\nInbound message:\n"${inboundMessage}"\n\nGenerate a ${channel} reply. ${isSms ? "Keep it under 300 characters." : "Include a subject line on the first line prefixed with 'Subject: ' followed by the body."}` }
      ],
      max_tokens: isSms ? 150 : 500,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    if (!raw) return null;

    if (isSms) {
      const smsDisclaimer = "\nMsg&data rates may apply. Reply STOP to opt out.";
      const hasDisclaimer = raw.toLowerCase().includes("reply stop");
      if (hasDisclaimer) {
        const smsBody = raw.length > 300 ? raw.substring(0, 297) + "..." : raw;
        return { body: smsBody };
      }
      const maxContent = 300 - smsDisclaimer.length;
      const content = raw.length > maxContent ? raw.substring(0, maxContent - 3) + "..." : raw;
      return { body: content + smsDisclaimer };
    }

    const emailDisclaimer = "\n\nThis message is from Liberty Bancard. If you no longer wish to receive communications, please reply STOP or contact us to be removed from our list.";
    const subjectMatch = raw.match(/^Subject:\s*(.+?)[\n\r]/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : `Re: Your inquiry — Liberty Bancard`;
    let emailBody = subjectMatch ? raw.replace(/^Subject:\s*.+?[\n\r]+/i, "").trim() : raw;
    if (!emailBody.toLowerCase().includes("no longer wish to receive") && !emailBody.toLowerCase().includes("reply stop")) {
      emailBody += emailDisclaimer;
    }

    return { subject, body: emailBody };
  } catch (err: any) {
    console.error("[AI Auto-Reply] Generation failed:", err.message);
    return null;
  }
}

export async function sendAiAutoReply(params: {
  contact: Contact;
  deal: Deal | undefined;
  channel: "email" | "sms";
  inboundMessage: string;
  classification: { intent: string; priority: string; keywords: string[] };
}): Promise<{ sent: boolean; error?: string }> {
  try {
    if (!isGhlConfigured()) {
      return { sent: false, error: "GHL not configured" };
    }

    const reply = await generateAiAutoReply(params);
    if (!reply) {
      return { sent: false, error: "No reply generated (intent filtered or generation failed)" };
    }

    let result: { success: boolean; messageId?: string; error?: string };

    if (params.channel === "email") {
      result = await sendGhlEmail({
        contactId: params.contact.id,
        dealId: params.deal?.id,
        subject: reply.subject || "Re: Your inquiry — Liberty Bancard",
        body: reply.body,
      });
    } else {
      result = await sendGhlSms({
        contactId: params.contact.id,
        dealId: params.deal?.id,
        body: reply.body,
      });
    }

    if (result.success) {
      markAutoReplySent(params.contact.id, params.channel);

      await storage.createGhlActivityLog({
        contactId: params.contact.id,
        dealId: params.deal?.id || null,
        direction: "outbound",
        channel: params.channel,
        templateId: null,
        subject: params.channel === "email" ? (reply.subject || "Re: Your inquiry") : null,
        body: reply.body,
        status: "sent",
        ghlMessageId: result.messageId || null,
        metadata: { autoReply: true, intent: params.classification.intent },
      });

      await storage.createAuditLog({
        action: "ai_auto_reply_sent",
        entityType: "contact",
        entityId: params.contact.id,
        details: {
          channel: params.channel,
          intent: params.classification.intent,
          dealId: params.deal?.id,
          replyPreview: reply.body.substring(0, 150),
          messageId: result.messageId,
        },
      });

      await storage.createNotification({
        channel: "internal",
        title: `AI Auto-Reply Sent to ${params.contact.firstName} ${params.contact.lastName}`,
        message: `${params.channel.toUpperCase()} reply sent for "${params.classification.intent}" message. Preview: ${reply.body.substring(0, 100)}...`,
        type: "info",
        metadata: {
          contactId: params.contact.id,
          dealId: params.deal?.id,
          autoReply: true,
        },
      });
    } else {
      await storage.createAuditLog({
        action: "ai_auto_reply_failed",
        entityType: "contact",
        entityId: params.contact.id,
        details: {
          channel: params.channel,
          intent: params.classification.intent,
          error: result.error,
        },
      });
    }

    return { sent: result.success, error: result.error };
  } catch (err: any) {
    console.error("[AI Auto-Reply] Error:", err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendDocumentForEsign(opts: {
  documentTemplateId: string;
  contactId?: string;
  recipientName: string;
  recipientEmail: string;
  applicationId: number;
}): Promise<{ success: boolean; documentId?: string; signingUrl?: string; error?: string }> {
  try {
    const config = getConfig();
    if (!config) {
      return { success: false, error: "GHL not configured. Set GHL_API_KEY and GHL_LOCATION_ID." };
    }

    const payload: Record<string, any> = {
      locationId: config.locationId,
      templateId: opts.documentTemplateId,
      name: `Merchant Processing Agreement - ${opts.recipientName}`,
      recipients: [
        {
          name: opts.recipientName,
          email: opts.recipientEmail,
          role: "signer",
        },
      ],
      emailSettings: {
        subject: "Liberty Bancard - Merchant Processing Agreement for E-Signature",
        fromName: "Liberty Bancard",
      },
    };

    if (opts.contactId) {
      payload.contactId = opts.contactId;
    }

    const result = await ghlFetch("/documents/", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return {
      success: true,
      documentId: result?.id || result?.documentId,
      signingUrl: result?.signingUrl || result?.publicUrl || null,
    };
  } catch (err: any) {
    console.error("[GHL E-Sign] Error sending document:", err.message);
    return { success: false, error: err.message };
  }
}

export async function getDocumentStatus(documentId: string): Promise<{
  status: string;
  signedAt?: string;
  error?: string;
}> {
  try {
    const result = await ghlFetch(`/documents/${documentId}`, { method: "GET" });
    return {
      status: result?.status || "unknown",
      signedAt: result?.completedAt || result?.signedAt,
    };
  } catch (err: any) {
    console.error("[GHL E-Sign] Error checking document status:", err.message);
    return { status: "error", error: err.message };
  }
}

async function handleContactUpdated(payload: any): Promise<void> {
  try {
    const contactData = payload.contact || payload;
    const ghlContactId = contactData.id || payload.contactId;

    if (!ghlContactId) return;

    const { syncContactFromGhl } = await import("./ghl-sync");
    // Use ?? not || so that explicit empty string from GHL is preserved.
    // For camelCase vs snake_case field names, prefer camelCase if present, fall back to
    // snake_case only when camelCase is undefined (not just falsy).
    const syncPayload: {
      id: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      companyName?: string;
      tags?: string[];
    } = { id: ghlContactId };
    const firstName = contactData.firstName !== undefined ? contactData.firstName : contactData.first_name;
    const lastName = contactData.lastName !== undefined ? contactData.lastName : contactData.last_name;
    const companyName = contactData.companyName !== undefined ? contactData.companyName : contactData.company_name;
    if (firstName !== undefined) syncPayload.firstName = firstName ?? "";
    if (lastName !== undefined) syncPayload.lastName = lastName ?? "";
    if (contactData.email !== undefined) syncPayload.email = contactData.email ?? "";
    if (contactData.phone !== undefined) syncPayload.phone = contactData.phone ?? "";
    if (companyName !== undefined) syncPayload.companyName = companyName ?? "";
    // Only pass tags when explicitly present in payload; omitting prevents accidental empty-array replace
    if (Array.isArray(contactData.tags)) syncPayload.tags = contactData.tags;
    const result = await syncContactFromGhl(syncPayload);

    if (result) {
      console.log(`[GHL Webhook] Contact ${result.created ? "created" : "updated"} from GHL: ${result.contactId}`);
    }
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling contact update:", err.message);
  }
}

async function handleOpportunityUpdated(payload: any): Promise<void> {
  try {
    const { syncDealFromGhl, syncActivityFromGhl } = await import("./ghl-sync");
    const opportunityData = payload.opportunity || payload;
    const ghlContactId = opportunityData.contactId || opportunityData.contact?.id;

    if (opportunityData.id) {
      const result = await syncDealFromGhl(opportunityData);
      if (result) {
        console.log(`[GHL Webhook] Opportunity updated: deal ${result.dealId} (${result.created ? "created" : "updated"})`);
      }
    }

    if (ghlContactId) {
      await syncActivityFromGhl({
        contactId: ghlContactId,
        type: "opportunity_updated",
        channel: "sync",
        body: `Opportunity "${opportunityData.name || ""}" updated. Status: ${opportunityData.status || "unknown"}`,
        subject: "Opportunity Updated",
      });
    }
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling opportunity update:", err.message);
  }
}

async function handleTaskUpdated(payload: any): Promise<void> {
  try {
    const taskData = payload.task || payload;
    const ghlContactId = taskData.contactId || payload.contactId;

    if (!ghlContactId) return;

    const { syncTaskFromGhl } = await import("./ghl-sync");
    await syncTaskFromGhl(taskData, ghlContactId);
    console.log(`[GHL Webhook] Task synced/updated from GHL for contact ${ghlContactId}`);
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling task update:", err.message);
  }
}

async function handleTaskCompleted(payload: any): Promise<void> {
  try {
    const taskData = payload.task || payload;
    const ghlContactId = taskData.contactId || payload.contactId;

    if (!ghlContactId) return;

    const { syncTaskFromGhl, syncActivityFromGhl } = await import("./ghl-sync");
    await syncTaskFromGhl(
      { ...taskData, completed: true },
      ghlContactId
    );

    await syncActivityFromGhl({
      contactId: ghlContactId,
      type: "task_completed",
      channel: "sync",
      body: `Task "${taskData.title || ""}" completed`,
      subject: "Task Completed",
    });
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling task completed:", err.message);
  }
}

async function handleNoteAdded(payload: any): Promise<void> {
  try {
    const noteData = payload.note || payload;
    const ghlContactId = noteData.contactId || payload.contactId;
    const ghlNoteId = noteData.id || payload.noteId;

    if (!ghlContactId) return;

    const { data: contacts } = await storage.getContacts({ limit: 500 });
    const contact = contacts.find(c => c.ghlContactId === ghlContactId);
    if (!contact) return;

    const noteContent = noteData.body || noteData.content || "Note from GHL";

    if (ghlNoteId) {
      const existingNotes = await storage.getNotes("contact", contact.id);
      const alreadySynced = existingNotes.some(n =>
        n.authorName === "GHL Sync" &&
        n.content === noteContent
      );
      if (alreadySynced) {
        console.log(`[GHL Webhook] Note already exists for contact ${contact.id}, skipping duplicate`);
        return;
      }
    }

    await storage.createNote({
      entityType: "contact",
      entityId: contact.id,
      content: noteContent,
      authorName: "GHL Sync",
    });

    const { syncActivityFromGhl } = await import("./ghl-sync");
    await syncActivityFromGhl({
      contactId: ghlContactId,
      type: "note_added",
      channel: "sync",
      body: noteContent,
      subject: "Note Added",
    });

    console.log(`[GHL Webhook] Note synced from GHL for contact ${contact.id}`);
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling note added:", err.message);
  }
}

async function handleTagAdded(payload: any): Promise<void> {
  try {
    const ghlContactId = payload.contactId || payload.contact?.id;
    const tags = payload.tags || (payload.tag ? [payload.tag] : []);

    if (!ghlContactId || tags.length === 0) return;

    const { syncTagsFromGhl } = await import("./ghl-sync");
    await syncTagsFromGhl(ghlContactId, tags);
    console.log(`[GHL Webhook] Tags added from GHL: ${tags.join(", ")}`);

    // ── Auto-enrollment triggers based on GHL tag events ───────────────────
    // No-Show Recovery: when GHL calendar fires LB-NO-SHOW, auto-enroll
    if (tags.some((t: string) => t === "LB-NO-SHOW")) {
      autoEnrollNoShowRecovery(ghlContactId).catch(err =>
        console.error("[GHL Webhook] No-show auto-enroll error:", err.message)
      );
    }

    // DNC: when LB-DNC is added from GHL side, mark contact do-not-contact
    if (tags.some((t: string) => t === "LB-DNC")) {
      autoDncContact(ghlContactId).catch(err =>
        console.error("[GHL Webhook] DNC auto-flag error:", err.message)
      );
    }
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling tag added:", err.message);
  }
}

async function autoEnrollNoShowRecovery(ghlContactId: string): Promise<void> {
  const { storage } = await import("../storage");
  const { data: contacts } = await storage.getContacts({ limit: 1000 });
  const contact = contacts.find((c: { ghlContactId?: string | null }) => c.ghlContactId === ghlContactId);
  if (!contact) {
    console.warn(`[GHL Webhook] No-show tag received for unknown GHL contact: ${ghlContactId}`);
    return;
  }
  if (contact.doNotContact) {
    console.log(`[GHL Webhook] No-show: contact ${contact.id} is DNC — skipping enrollment`);
    return;
  }
  const sequences = await storage.getSequences();
  const seq = sequences.find((s: { name: string }) =>
    s.name === "SDR: No-Show Recovery" || s.name === "No-Show Reschedule"
  );
  if (!seq) {
    console.warn("[GHL Webhook] No-show: could not find 'SDR: No-Show Recovery' sequence in DB — skipping enrollment");
    return;
  }
  const { enrollContactInGhlWorkflow } = await import("./ghl-workflow-enrollment");
  const result = await enrollContactInGhlWorkflow({
    contactId: contact.id,
    sequenceName: seq.name,
    sequenceId: seq.id,
  });
  console.log(`[GHL Webhook] No-show auto-enrolled contact ${contact.id} — method: ${result.method}, enrolled: ${result.enrolled}`);
}

async function autoDncContact(ghlContactId: string): Promise<void> {
  const { storage } = await import("../storage");
  const { data: contacts } = await storage.getContacts({ limit: 1000 });
  const contact = contacts.find((c: { ghlContactId?: string | null }) => c.ghlContactId === ghlContactId);
  if (!contact) return;
  await storage.updateContact(contact.id, { doNotContact: true });
  console.log(`[GHL Webhook] DNC auto-flagged contact ${contact.id} (${contact.email}) from GHL tag`);
}

async function handleTagRemoved(payload: any): Promise<void> {
  try {
    const ghlContactId = payload.contactId || payload.contact?.id;
    const tags = payload.tags || (payload.tag ? [payload.tag] : []);

    if (!ghlContactId || tags.length === 0) return;

    const { removeTagsFromLocal } = await import("./ghl-sync");
    await removeTagsFromLocal(ghlContactId, tags);
    console.log(`[GHL Webhook] Tags removed from GHL: ${tags.join(", ")}`);
  } catch (err: any) {
    console.error("[GHL Webhook] Error handling tag removed:", err.message);
  }
}

function classifyInboundMessage(message: string): {
  intent: "positive_reply" | "unsubscribe" | "question" | "support" | "booking_intent" | "objection" | "neutral";
  priority: "high" | "medium" | "low";
  keywords: string[];
} {
  const lower = message.toLowerCase();
  const keywords: string[] = [];

  const unsubWords = ["unsubscribe", "stop", "opt out", "remove me", "do not contact", "take me off", "don't contact", "stop contacting", "stop emailing", "stop texting"];
  const interestWords = ["interested", "tell me more", "sounds good", "let's talk", "sign me up", "ready", "i want", "let's do it", "i'm in", "yes please", "send it over", "want to switch", "looking to switch", "want to learn more", "open to it", "open to switching", "absolutely", "definitely interested", "yes i'm", "yes i am", "count me in", "move forward"];
  const bookingWords = ["call me", "give me a call", "phone me", "call back", "callback", "ring me", "book a call", "book a meeting", "schedule a call", "set up a call", "let's meet", "book a time", "calendar", "when can we talk", "let's schedule", "want to schedule", "set up a meeting", "schedule a meeting", "schedule time", "grab a time", "pick a time", "find a time", "set up a demo", "book a demo", "let's connect", "can we chat", "hop on a call"];
  const objectionWords = ["not interested", "too expensive", "too pricey", "too costly", "way too much", "happy with", "not looking", "already have", "no thanks", "no thank you", "pass", "not now", "maybe later", "do not have time", "don't have time", "not the right time", "can't afford", "not in the budget", "out of budget", "stick with", "staying with", "going to stay", "not ready", "not a good time", "wrong time"];
  const supportWords = ["problem", "issue", "not working", "broken", "help", "complaint", "frustrated", "error", "charge", "refund"];
  const questionWords = ["how much", "what is", "how does", "when can", "pricing", "rates", "cost", "?"];

  for (const w of unsubWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "unsubscribe", priority: "high", keywords };

  for (const w of bookingWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "booking_intent", priority: "high", keywords };

  for (const w of objectionWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "objection", priority: "medium", keywords };

  for (const w of supportWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "support", priority: "high", keywords };

  for (const w of interestWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "positive_reply", priority: "medium", keywords };

  for (const w of questionWords) { if (lower.includes(w)) keywords.push(w); }
  if (keywords.length > 0) return { intent: "question", priority: "medium", keywords };

  return { intent: "neutral", priority: "low", keywords: [] };
}
