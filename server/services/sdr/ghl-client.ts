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
}): Promise<WorkflowTriggerResult> {
  return sdrGhlFetch(`/contacts/${params.contactId}/workflow/${params.workflowId}`, {
    method: "POST",
    body: JSON.stringify({}),
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
] as const;

export const REQUIRED_TAGS = [
  "LB-AI-SDR", "LB-AUTO", "LB-MEDSPA", "LB-DENTAL", "LB-BOOKING-READY",
  "LB-STATEMENT-PENDING", "LB-PROPOSAL-SENT", "LB-HUMAN-HANDOFF", "LB-DO-NOT-AUTO",
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
