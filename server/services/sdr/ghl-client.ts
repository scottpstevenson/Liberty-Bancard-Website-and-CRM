import crypto from "crypto";

const DEFAULT_GHL_BASE_URL = "https://services.leadconnectorhq.com";
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

let requestTimestamps: number[] = [];

function getBaseUrl(): string {
  return process.env.GHL_BASE_URL || DEFAULT_GHL_BASE_URL;
}

function getAuthToken(): string | null {
  return process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY || null;
}

function getLocationId(): string | null {
  return process.env.GHL_LOCATION_ID || null;
}

function getWebhookSecret(): string | null {
  return process.env.GHL_WEBHOOK_SECRET || null;
}

export function isSdrGhlConfigured(): boolean {
  return !!(getAuthToken() && getLocationId());
}

async function rateLimit(): Promise<void> {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (requestTimestamps.length >= RATE_LIMIT_MAX) {
    const oldestInWindow = requestTimestamps[0];
    const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow) + 100;
    console.log(`[SDR GHL] Rate limit reached, waiting ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  requestTimestamps.push(Date.now());
}

export interface GhlApiResponse {
  [key: string]: unknown;
}

async function sdrGhlFetch(path: string, options: RequestInit = {}, retries = 3): Promise<GhlApiResponse> {
  const token = getAuthToken();
  if (!token) throw new Error("GHL not configured. Set GHL_PRIVATE_INTEGRATION_TOKEN or GHL_API_KEY.");

  await rateLimit();

  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
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
        console.warn(`[SDR GHL] 429 rate limited, retrying after ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
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
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt === retries - 1) throw err;
      if (errMsg.includes("429")) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  return {};
}

export interface UpsertContactParams {
  locationId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  tags?: string[];
  customField?: Record<string, string>;
  existingGhlId?: string;
}

export async function upsertContact(params: UpsertContactParams): Promise<string> {
  const locationId = params.locationId || getLocationId();
  if (!locationId) throw new Error("GHL_LOCATION_ID not set");

  const payload = {
    locationId,
    firstName: params.firstName,
    lastName: params.lastName,
    email: params.email,
    phone: params.phone,
    companyName: params.companyName,
    tags: params.tags || [],
    customField: params.customField || {},
  };

  if (params.existingGhlId) {
    await sdrGhlFetch(`/contacts/${params.existingGhlId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return params.existingGhlId;
  }

  const result = await sdrGhlFetch("/contacts/", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const contactData = result.contact as Record<string, unknown> | undefined;
  return (contactData?.id as string) || (result.id as string) || "";
}

export async function updateCustomFields(ghlContactId: string, fields: Record<string, string>): Promise<void> {
  await sdrGhlFetch(`/contacts/${ghlContactId}`, {
    method: "PUT",
    body: JSON.stringify({ customField: fields }),
  });
}

export interface ConversationResult {
  id?: string;
  conversationId?: string;
}

export async function createConversation(params: {
  contactId: string;
  locationId?: string;
}): Promise<ConversationResult> {
  const locationId = params.locationId || getLocationId();
  const result = await sdrGhlFetch("/conversations/", {
    method: "POST",
    body: JSON.stringify({
      locationId,
      contactId: params.contactId,
    }),
  });
  return result as unknown as ConversationResult;
}

export interface OpportunityParams {
  pipelineId: string;
  stageId: string;
  contactId: string;
  name: string;
  status?: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
  existingOpportunityId?: string;
  locationId?: string;
}

export interface OpportunityResult {
  id?: string;
  [key: string]: unknown;
}

export async function manageOpportunity(params: OpportunityParams): Promise<OpportunityResult> {
  const locationId = params.locationId || getLocationId();

  const payload = {
    pipelineId: params.pipelineId,
    pipelineStageId: params.stageId,
    locationId,
    contactId: params.contactId,
    name: params.name,
    status: params.status || "open",
    monetaryValue: params.monetaryValue,
  };

  if (params.existingOpportunityId) {
    return sdrGhlFetch(`/opportunities/${params.existingOpportunityId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }) as unknown as OpportunityResult;
  }

  return sdrGhlFetch("/opportunities/", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as unknown as OpportunityResult;
}

export interface WorkflowTriggerResult {
  success?: boolean;
  [key: string]: unknown;
}

export async function triggerWorkflow(params: {
  workflowId: string;
  contactId: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkflowTriggerResult> {
  return sdrGhlFetch(`/contacts/${params.contactId}/workflow/${params.workflowId}`, {
    method: "POST",
    body: JSON.stringify(params.metadata || {}),
  }) as unknown as WorkflowTriggerResult;
}

export interface GhlCalendar {
  id: string;
  name: string;
  [key: string]: unknown;
}

export async function fetchCalendars(locationId?: string): Promise<GhlCalendar[]> {
  const locId = locationId || getLocationId();
  if (!locId) throw new Error("GHL_LOCATION_ID not set");
  const result = await sdrGhlFetch(`/calendars/?locationId=${locId}`);
  return (result.calendars as GhlCalendar[]) || [];
}

export interface NoteResult {
  id?: string;
  body?: string;
}

export async function addNote(params: {
  contactId: string;
  body: string;
}): Promise<NoteResult> {
  return sdrGhlFetch(`/contacts/${params.contactId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: params.body }),
  }) as unknown as NoteResult;
}

export async function addTag(params: {
  contactId: string;
  tags: string[];
}): Promise<void> {
  await sdrGhlFetch(`/contacts/${params.contactId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags: params.tags }),
  });
}

export async function removeTag(params: {
  contactId: string;
  tags: string[];
}): Promise<void> {
  await sdrGhlFetch(`/contacts/${params.contactId}/tags`, {
    method: "DELETE",
    body: JSON.stringify({ tags: params.tags }),
  });
}

export function validateWebhookSignature(payload: string, signature: string): boolean {
  const secret = getWebhookSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[SDR GHL] GHL_WEBHOOK_SECRET not set in production — rejecting webhook");
      return false;
    }
    return true;
  }

  try {
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    return signature === expectedSig || signature === `sha256=${expectedSig}`;
  } catch {
    return false;
  }
}

export interface SendMessageResult {
  messageId?: string;
  [key: string]: unknown;
}

export async function sendChatReply(params: {
  contactId: string;
  message: string;
  conversationId?: string;
}): Promise<SendMessageResult> {
  const payload: Record<string, unknown> = {
    type: "Custom",
    contactId: params.contactId,
    message: params.message,
  };
  if (params.conversationId) {
    payload.conversationId = params.conversationId;
  }

  return sdrGhlFetch("/conversations/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  }) as unknown as SendMessageResult;
}

export async function sendSmsReply(params: {
  contactId: string;
  message: string;
}): Promise<SendMessageResult> {
  return sdrGhlFetch("/conversations/messages", {
    method: "POST",
    body: JSON.stringify({
      type: "SMS",
      contactId: params.contactId,
      message: params.message,
    }),
  }) as unknown as SendMessageResult;
}

export async function sendEmailReply(params: {
  contactId: string;
  subject: string;
  htmlBody: string;
}): Promise<SendMessageResult> {
  return sdrGhlFetch("/conversations/messages", {
    method: "POST",
    body: JSON.stringify({
      type: "Email",
      contactId: params.contactId,
      subject: params.subject,
      html: params.htmlBody,
    }),
  }) as unknown as SendMessageResult;
}

export async function disableConversationAi(contactId: string): Promise<void> {
  try {
    await sdrGhlFetch(`/conversations/ai/toggle`, {
      method: "PUT",
      body: JSON.stringify({ contactId, enabled: false }),
    });
  } catch {
    await sdrGhlFetch(`/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        dnd: true,
        dndSettings: { all: { status: "active", message: "Handed off to human agent" } },
      }),
    });
  }
}

export async function enableConversationAi(contactId: string): Promise<void> {
  try {
    await sdrGhlFetch(`/conversations/ai/toggle`, {
      method: "PUT",
      body: JSON.stringify({ contactId, enabled: true }),
    });
  } catch {
    await sdrGhlFetch(`/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        dnd: false,
      }),
    });
  }
}

export interface SdrGhlConfigStatus {
  configured: boolean;
  hasToken: boolean;
  hasLocationId: boolean;
  hasWebhookSecret: boolean;
  baseUrl: string;
}

export function getSdrGhlConfig(): SdrGhlConfigStatus {
  return {
    configured: isSdrGhlConfigured(),
    hasToken: !!getAuthToken(),
    hasLocationId: !!getLocationId(),
    hasWebhookSecret: !!getWebhookSecret(),
    baseUrl: getBaseUrl(),
  };
}

export const REQUIRED_CUSTOM_FIELDS = [
  { key: "lb_merchant_id", name: "LB Merchant ID", dataType: "TEXT" },
  { key: "lb_current_stage", name: "LB Current Stage", dataType: "TEXT" },
  { key: "lb_fit_score", name: "LB Fit Score", dataType: "NUMERICAL" },
  { key: "lb_revenue_score", name: "LB Revenue Score", dataType: "NUMERICAL" },
  { key: "lb_reachability_score", name: "LB Reachability Score", dataType: "NUMERICAL" },
  { key: "lb_priority_score", name: "LB Priority Score", dataType: "NUMERICAL" },
  { key: "lb_vertical", name: "LB Vertical", dataType: "TEXT" },
  { key: "lb_best_channel", name: "LB Best Channel", dataType: "TEXT" },
  { key: "lb_statement_status", name: "LB Statement Status", dataType: "TEXT" },
  { key: "lb_proposal_status", name: "LB Proposal Status", dataType: "TEXT" },
  { key: "lb_last_ai_outcome", name: "LB Last AI Outcome", dataType: "TEXT" },
  { key: "lb_owner_type", name: "LB Owner Type", dataType: "TEXT" },
  { key: "lb_do_not_sdr", name: "LB Do Not SDR", dataType: "TEXT" },
  { key: "lb_monthly_volume", name: "LB Monthly Volume", dataType: "TEXT" },
  { key: "lb_current_processor", name: "LB Current Processor", dataType: "TEXT" },
  { key: "lb_pain_points", name: "LB Pain Points", dataType: "TEXT" },
  { key: "lb_terminal_need", name: "LB Terminal Need", dataType: "TEXT" },
  { key: "lb_preferred_program", name: "LB Preferred Program", dataType: "TEXT" },
  { key: "lb_interested_0_percent", name: "LB Interested 0%", dataType: "TEXT" },
  { key: "lb_avg_ticket", name: "LB Avg Ticket", dataType: "TEXT" },
  { key: "lb_utm_source", name: "LB UTM Source", dataType: "TEXT" },
  { key: "lb_utm_medium", name: "LB UTM Medium", dataType: "TEXT" },
  { key: "lb_utm_campaign", name: "LB UTM Campaign", dataType: "TEXT" },
  { key: "lb_promo_code", name: "LB Promo Code", dataType: "TEXT" },
  { key: "lb_lead_source", name: "LB Lead Source", dataType: "TEXT" },
  { key: "lb_consent_sms", name: "LB Consent SMS", dataType: "TEXT" },
  { key: "lb_consent_email", name: "LB Consent Email", dataType: "TEXT" },
  { key: "lb_business_type", name: "LB Business Type", dataType: "TEXT" },
  { key: "lb_estimated_savings", name: "LB Estimated Savings", dataType: "TEXT" },
  { key: "lb_recommended_program", name: "LB Recommended Program", dataType: "TEXT" },
  { key: "lb_referral_code", name: "LB Referral Code", dataType: "TEXT" },
  { key: "lb_landing_page", name: "LB Landing Page", dataType: "TEXT" },
  { key: "lb_deal_stage", name: "LB Deal Stage", dataType: "TEXT" },
  { key: "lb_deal_pipeline", name: "LB Deal Pipeline", dataType: "TEXT" },
  { key: "lb_ein_last4", name: "LB EIN Last 4", dataType: "TEXT" },
  { key: "lb_current_rate", name: "LB Current Rate", dataType: "TEXT" },
  { key: "lb_terminal_type", name: "LB Terminal Type", dataType: "TEXT" },
  { key: "lb_ecommerce_needed", name: "LB E-Commerce Needed", dataType: "TEXT" },
  { key: "lb_affiliate_code", name: "LB Affiliate Code", dataType: "TEXT" },
  { key: "lb_estimated_savings", name: "LB Estimated Savings", dataType: "TEXT" },
] as const;

export const REQUIRED_TAGS = [
  "LB-AI-SDR", "LB-AUTO", "LB-MEDSPA", "LB-DENTAL", "LB-BOOKING-READY",
  "LB-STATEMENT-PENDING", "LB-PROPOSAL-SENT", "LB-HUMAN-HANDOFF", "LB-DO-NOT-AUTO",
  "LB-CHAT-LEAD", "LB-CHAT-HANDOFF", "LB-ACTIVE-PIPELINE",
  "LB-AFFILIATE", "LB-SUPPORT", "LB-SUPPORT-REQUEST", "LB-STATEMENT-RECEIVED", "LB-EQUIPMENT-ORDER",
  "LB-QUIZ-LEAD", "LB-ESTIMATE", "LB-CALLBACK", "LB-MERCHANT-APP",
] as const;

let bootstrapCompleted = false;

export async function ensureGhlBootstrapped(): Promise<void> {
  if (bootstrapCompleted || !isSdrGhlConfigured()) return;
  try {
    console.log("[SDR GHL] First sync detected — bootstrapping custom fields and tags...");
    const result = await bootstrapGhlCustomFieldsAndTags();
    if (result.errors.length === 0) {
      bootstrapCompleted = true;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[SDR GHL] Bootstrap failed:", errMsg);
  }
}

export async function bootstrapGhlCustomFieldsAndTags(): Promise<{
  fieldsCreated: string[];
  fieldsExisting: string[];
  tagsCreated: string[];
  errors: string[];
}> {
  if (!isSdrGhlConfigured()) {
    return { fieldsCreated: [], fieldsExisting: [], tagsCreated: [], errors: ["GHL not configured"] };
  }

  const locationId = getLocationId()!;
  const fieldsCreated: string[] = [];
  const fieldsExisting: string[] = [];
  const tagsCreated: string[] = [];
  const errors: string[] = [];

  let existingFields: GhlApiResponse[] = [];
  try {
    const result = await sdrGhlFetch(`/locations/${locationId}/customFields`);
    existingFields = (result.customFields as GhlApiResponse[]) || [];
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to fetch existing custom fields: ${errMsg}`);
  }

  const existingFieldKeys = new Set(existingFields.map(f => f.fieldKey as string));

  for (const field of REQUIRED_CUSTOM_FIELDS) {
    if (existingFieldKeys.has(field.key)) {
      fieldsExisting.push(field.key);
      continue;
    }
    try {
      await sdrGhlFetch(`/locations/${locationId}/customFields`, {
        method: "POST",
        body: JSON.stringify({
          name: field.name,
          fieldKey: field.key,
          dataType: field.dataType,
          model: "contact",
        }),
      });
      fieldsCreated.push(field.key);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to create field ${field.key}: ${errMsg}`);
    }
  }

  for (const tag of REQUIRED_TAGS) {
    try {
      await sdrGhlFetch(`/locations/${locationId}/tags`, {
        method: "POST",
        body: JSON.stringify({ name: tag }),
      });
      tagsCreated.push(tag);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("already exists") || errMsg.includes("duplicate")) {
        continue;
      }
      errors.push(`Failed to create tag ${tag}: ${errMsg}`);
    }
  }

  console.log(`[SDR GHL Bootstrap] Fields created: ${fieldsCreated.length}, existing: ${fieldsExisting.length}, tags: ${tagsCreated.length}, errors: ${errors.length}`);
  return { fieldsCreated, fieldsExisting, tagsCreated, errors };
}

const RESPONSE_TEMPLATES: Record<string, string> = {
  booking_cta: "Great to hear you're interested! Here's a link to book a quick call with our team: {{booking_link}}",
  value_message_with_link: "Thanks for your interest! I'll send over some details about how we help businesses like yours save on processing. In the meantime, here's a link to chat: {{booking_link}}",
  pricing_review_explanation: "Great question! Our pricing is based on a free statement analysis — we compare your current rates and show you exactly where we can save you money. No obligation. Want me to set up a quick call? {{booking_link}}",
  booking_link_or_call: "I'd love to connect! Here's a link to pick a time that works: {{booking_link}} — or I can have one of our reps call you shortly.",
  snooze_acknowledgment: "No problem at all! I'll follow up in about a month. Feel free to reach out anytime if things change.",
  thank_you_suppress: "Understood — thanks for letting me know. We won't reach out again. If you ever need anything, don't hesitate to contact us.",
  wrong_person_apology: "Sorry about that! If you could point me to the right person, I'd appreciate it. Otherwise, we won't bother you again.",
  booking_confirmation: "Awesome — looking forward to our call! You'll get a reminder before the meeting. If anything changes, just let me know.",
  statement_received_acknowledgment: "Got it — thanks for sending that over! Our team will review it and get back to you with a savings analysis shortly.",
};

export async function sendTemplateResponse(
  merchantId: number,
  templateKey: string,
  channel: string
): Promise<void> {
  const { db } = await import("../../db");
  const { sdrMerchants, sdrLeadEvents } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const template = RESPONSE_TEMPLATES[templateKey];
  if (!template) {
    console.warn(`[GHL Client] Unknown response template: ${templateKey}`);
    return;
  }

  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant?.ghlContactId) {
    console.warn(`[GHL Client] Cannot send template — no GHL contact for merchant ${merchantId}`);
    return;
  }

  const complianceChannel = (channel === "email" ? "email" : "sms") as "sms" | "email";
  try {
    const { checkAndLogCompliance } = await import("./compliance-engine");
    const complianceResult = await checkAndLogCompliance(merchantId, complianceChannel);
    if (!complianceResult.allowed) {
      console.warn(`[GHL Client] Template "${templateKey}" blocked for merchant ${merchantId}: ${complianceResult.reason}`);
      await db.insert(sdrLeadEvents).values({
        merchantId,
        eventType: "template_response_blocked",
        channel,
        actorType: "system",
        payloadJson: { templateKey, reason: complianceResult.reason },
        decisionReason: `Template blocked: ${complianceResult.reason}`,
      });
      return;
    }
  } catch (compErr: unknown) {
    console.error(`[GHL Client] Compliance check failed for template send, failing closed:`, compErr);
    return;
  }

  if (!isSdrGhlConfigured()) {
    console.warn(`[GHL Client] GHL not configured — logging template send for merchant ${merchantId}`);
    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "template_response_queued",
      channel,
      actorType: "system",
      payloadJson: { templateKey, template, ghlNotConfigured: true },
      decisionReason: `Template "${templateKey}" queued (GHL not configured)`,
    });
    return;
  }

  try {
    const workflowId = process.env[`GHL_WORKFLOW_TEMPLATE_${templateKey.toUpperCase()}`] || process.env.GHL_WORKFLOW_TEMPLATE_RESPONSE;
    if (workflowId) {
      await triggerWorkflow({
        workflowId,
        contactId: merchant.ghlContactId,
        metadata: { templateKey, message: template, channel },
      });
    } else {
      await sdrGhlFetch(`/conversations/messages`, {
        method: "POST",
        body: JSON.stringify({
          type: channel === "email" ? "Email" : "SMS",
          contactId: merchant.ghlContactId,
          message: template.replace("{{booking_link}}", process.env.GHL_DEFAULT_BOOKING_LINK || "[booking link]"),
        }),
      });
    }

    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "template_response_sent",
      channel,
      actorType: "system",
      payloadJson: { templateKey, channel },
      decisionReason: `Template "${templateKey}" sent via ${channel}`,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[GHL Client] Failed to send template response: ${errMsg}`);
    await db.insert(sdrLeadEvents).values({
      merchantId,
      eventType: "template_response_failed",
      channel,
      actorType: "system",
      payloadJson: { templateKey, error: errMsg },
      decisionReason: `Template "${templateKey}" send failed: ${errMsg}`,
    });
  }
}
