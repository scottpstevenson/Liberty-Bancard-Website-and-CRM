import { triggerWorkflow, isSdrGhlConfigured } from "./sdr/ghl-client";
import { isGhlConfigured } from "./ghl";
import { storage } from "../storage";
import { auditChange } from "./audit-change";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ContactabilityChannel } from "./contactability";
import { GhlAmbiguousDispatchError, isAmbiguousDispatchMessage } from "./ghl-dispatch-recorder";

/** confirmed: accepted; unsent: pre-I/O or definite refusal; unknown: the trigger may have been accepted. */
export type GhlEnrollmentOutcome = "confirmed" | "unsent" | "unknown";

import { GHL_WORKFLOW_REGISTRY, type GhlWorkflowConfig } from "./ghl-workflow-registry-data";
export { GHL_WORKFLOW_REGISTRY };
export type { GhlWorkflowConfig };

/**
 * Recipient-channel declarations are intentionally co-located with the native
 * workflow registry. Source code cannot prove what a GHL workflow delivers, so
 * enrollment additionally requires the live-review attestation named by
 * verificationEnvKey. Unknown or unverified workflows are blocked, not guessed.
 */
const WORKFLOW_DELIVERY_DECLARATIONS: Record<string, {
  purpose: string;
  outboundChannels: ContactabilityChannel[];
  commercialPurpose?: "marketing_outreach" | "transactional_response";
}> = {
  inbound_confirmation: { purpose: "confirm a merchant's inbound form submission", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  inbound_lead: { purpose: "confirm a merchant's inbound lead submission", outboundChannels: ["email", "sms"], commercialPurpose: "transactional_response" },
  statement_review: { purpose: "confirm a merchant's statement upload", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  merchant_app: { purpose: "confirm a merchant application submission", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  support_ticket: { purpose: "acknowledge a merchant support request", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  affiliate_welcome: { purpose: "welcome an approved affiliate", outboundChannels: ["email"] },
  callback_request: { purpose: "confirm a requested callback", outboundChannels: ["sms"], commercialPurpose: "transactional_response" },
  equipment_order: { purpose: "confirm an equipment order", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  booking_confirmation: { purpose: "confirm a merchant appointment", outboundChannels: ["email", "sms"], commercialPurpose: "transactional_response" },
  booking_reminder_24h: { purpose: "remind a merchant about a booked appointment", outboundChannels: ["email", "sms"], commercialPurpose: "transactional_response" },
  booking_link: { purpose: "deliver a booking link requested for a merchant", outboundChannels: ["email", "sms"], commercialPurpose: "transactional_response" },
  statement_request_after_meeting: { purpose: "request a statement after a merchant meeting", outboundChannels: ["email"] },
  no_show_reschedule: { purpose: "offer rescheduling after a missed appointment", outboundChannels: ["email"] },
  post_call_review: { purpose: "follow up after a sales call", outboundChannels: ["email"] },
  proposal_followup: { purpose: "follow up on a merchant proposal", outboundChannels: ["email"] },
  long_term_nurture: { purpose: "continue discretionary lead nurture", outboundChannels: ["email"] },
  statement_analyzed: { purpose: "confirm a completed statement analysis", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  sdr_cold_auto: { purpose: "automated automotive SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_medspa: { purpose: "automated med-spa SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_medical: { purpose: "automated medical SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_restaurant: { purpose: "automated restaurant SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_retail: { purpose: "automated retail SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_construction: { purpose: "automated construction SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_cold_default: { purpose: "automated SDR outreach", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
  sdr_statement_audit: { purpose: "automated statement-audit outreach", outboundChannels: ["email", "sms"] },
  merchant_approved: { purpose: "deliver merchant portal access after approval", outboundChannels: ["email"], commercialPurpose: "transactional_response" },
  proposal_viewed: { purpose: "follow up on a viewed proposal", outboundChannels: ["email"] },
  proposal_accepted: { purpose: "confirm a proposal acceptance", outboundChannels: ["email"] },
  rate_review_confirmation: { purpose: "confirm a merchant rate-review request", outboundChannels: ["email"] },
  onboarding_reminder: { purpose: "remind an onboarded merchant about required documents", outboundChannels: ["email"] },
  voicemail_drop: { purpose: "deliver a requested ringless voicemail", outboundChannels: ["ringless_vm"] },
  voice_intro_qualification: { purpose: "run an automated qualification call", outboundChannels: ["voice_ai"] },
  voice_follow_up_callback: { purpose: "run an automated callback", outboundChannels: ["voice_ai"] },
  voice_statement_chase: { purpose: "run an automated statement-chase call", outboundChannels: ["voice_ai"] },
  voice_proposal_reminder: { purpose: "run an automated proposal reminder call", outboundChannels: ["voice_ai"] },
  voice_appointment_reminder: { purpose: "run an automated appointment reminder call", outboundChannels: ["voice_ai"] },
  voice_callback_request: { purpose: "run an automated callback-request call", outboundChannels: ["voice_ai"] },
  voice_cold_outbound: { purpose: "run an automated cold-outreach call", outboundChannels: ["voice_ai"] },
  unsubscribe: { purpose: "process an inbound opt-out request", outboundChannels: ["email", "sms", "voice_ai", "ringless_vm"] },
};

for (const workflow of GHL_WORKFLOW_REGISTRY) {
  const declaration = WORKFLOW_DELIVERY_DECLARATIONS[workflow.id];
  if (!declaration) {
    throw new Error(`GHL workflow registry entry "${workflow.id}" has no recipient-channel declaration`);
  }
  workflow.purpose = declaration.purpose;
  workflow.outboundChannels = declaration.outboundChannels;
  workflow.commercialPurpose = declaration.commercialPurpose ?? "marketing_outreach";
  workflow.verificationEnvKey = `GHL_WORKFLOW_VERIFIED_CHANNELS_${workflow.id.toUpperCase()}`;
}

function normalizedChannels(channels: readonly string[]): string {
  return [...new Set(channels.map(channel => channel.trim()).filter(Boolean))].sort().join(",");
}

function getWorkflowVerificationFailure(workflow: GhlWorkflowConfig): string | null {
  if (!workflow.purpose || !workflow.outboundChannels?.length || !workflow.verificationEnvKey) {
    return "Workflow declaration is incomplete";
  }
  const declared = normalizedChannels(workflow.outboundChannels);
  const verified = normalizedChannels((process.env[workflow.verificationEnvKey] ?? "").split(","));
  if (!verified || verified !== declared) {
    return `Workflow channels are not live-verified (set ${workflow.verificationEnvKey}=${declared} after reviewing the GHL workflow)`;
  }
  return null;
}

/** Resolve only an unambiguous CRM contact for a GHL contact ID. */
export async function resolveLocalContactIdForGhlContactId(ghlContactId: string): Promise<number | null> {
  try {
    const matches = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.ghlContactId, ghlContactId))
      .limit(2);
    return matches.length === 1 ? matches[0].id : null;
  } catch (err: any) {
    console.warn(`[GHL Compliance] Local contact resolution failed for GHL contact ${ghlContactId}: ${err.message}`);
    return null;
  }
}

/**
 * Typed reading of the provider's trigger response. Returns null ONLY for an explicit documented true result
 * (`succeded` [sic], `succeeded` or `success`). An explicit false is a definite refusal (`key=false`). Anything else
 * (null, `{}`, a non-boolean value) is an unconfirmed outcome after dispatch: `unconfirmed_response`, which the caller
 * treats as unknown (never success, never an authorization to fall back or re-send).
 */
export const WORKFLOW_TRIGGER_UNCONFIRMED = "unconfirmed_response";
export function workflowTriggerRefusal(body: unknown): string | null {
  if (!body || typeof body !== "object") return WORKFLOW_TRIGGER_UNCONFIRMED;
  const record = body as Record<string, unknown>;
  let sawTrue = false;
  for (const key of ["succeeded", "succeded", "success"]) {
    if (record[key] === false) return `${key}=false`;
    if (record[key] === true) sawTrue = true;
  }
  return sawTrue ? null : WORKFLOW_TRIGGER_UNCONFIRMED;
}

export async function getWorkflowId(workflowKey: string): Promise<string | null> {
  const workflow = GHL_WORKFLOW_REGISTRY.find(w => w.id === workflowKey);
  if (!workflow) return null;
  if (process.env[workflow.envKey]) return process.env[workflow.envKey]!;
  try {
    const { storage } = await import("../storage");
    const saved = await storage.getSystemSetting(`ghl_workflow_env_${workflow.envKey}`);
    if (saved) return saved as string;
  } catch (err: any) {
    console.warn(`[GHL Workflows] DB lookup failed for ${workflowKey} — returning null:`, err.message);
  }
  return null;
}

export async function getWorkflowEnvValue(envKey: string): Promise<string | null> {
  if (process.env[envKey]) return process.env[envKey]!;
  try {
    const { storage } = await import("../storage");
    const saved = await storage.getSystemSetting(`ghl_workflow_env_${envKey}`);
    if (saved) return saved as string;
  } catch (err: any) {
    console.warn(`[GHL Workflows] DB lookup failed for env key ${envKey} — returning null:`, err.message);
  }
  return null;
}

export async function setWorkflowEnvValue(envKey: string, value: string | null): Promise<void> {
  const { storage } = await import("../storage");
  if (value) {
    process.env[envKey] = value;
    await storage.setSystemSetting(`ghl_workflow_env_${envKey}`, value);
  } else {
    delete process.env[envKey];
    await storage.setSystemSetting(`ghl_workflow_env_${envKey}`, null);
  }
}

export async function hydrateWorkflowEnvFromDb(): Promise<number> {
  let hydrated = 0;
  try {
    const { storage } = await import("../storage");
    for (const w of GHL_WORKFLOW_REGISTRY) {
      if (!process.env[w.envKey]) {
        const saved = await storage.getSystemSetting(`ghl_workflow_env_${w.envKey}`);
        if (saved && typeof saved === "string") {
          process.env[w.envKey] = saved;
          hydrated++;
        }
      }
    }
  } catch (err) {
    console.warn("[GHL Workflows] Failed to hydrate workflow env IDs from DB:", err);
  }
  return hydrated;
}

export async function getWorkflowRegistryWithStatus(): Promise<Array<GhlWorkflowConfig & { value: string | null; isSet: boolean }>> {
  return Promise.all(
    GHL_WORKFLOW_REGISTRY.map(async (w) => {
      const value = await getWorkflowEnvValue(w.envKey);
      return { ...w, value, isSet: !!value };
    })
  );
}

export async function enrollInGhlWorkflow(params: {
  workflowKey: string;
  ghlContactId: string;
  metadata?: Record<string, any>;
  /** Internal flag: set by ghl-enrollment-recovery to prevent recursive deferral */
  _isRecoveryAttempt?: boolean;
  /**
   * Internal flag: the caller persists its own deferred obligation (with its occurrence identity) for a transient
   * failure, so this function must not also write an unscoped one for the same requested enrollment.
   */
  _callerOwnsDeferral?: boolean;
}): Promise<{ success: boolean; error?: string; outcome?: GhlEnrollmentOutcome }> {
  try {
    if (!isSdrGhlConfigured()) {
      return { success: false, error: "GHL not configured", outcome: "unsent" };
    }

    const workflowId = await getWorkflowId(params.workflowKey);
    if (!workflowId) {
      const registryEntry = GHL_WORKFLOW_REGISTRY.find(w => w.id === params.workflowKey);
      console.warn(
        `[GHL Workflows] WORKFLOW_KEY_UNRESOLVED: No workflow ID configured for key "${params.workflowKey}"` +
        (registryEntry
          ? ` (set env var ${registryEntry.envKey} to activate this automation)`
          : " (key not in registry — check GHL_WORKFLOW_REGISTRY)") +
        ` — enrollment skipped. This automation will never fire until the ID is configured.`
      );
      return { success: false, error: `Workflow ${params.workflowKey} not configured (set ${registryEntry?.envKey ?? params.workflowKey})`, outcome: "unsent" };
    }

    const trigger = await triggerWorkflow({
      workflowId,
      contactId: params.ghlContactId,
      metadata: params.metadata,
    });
    // The provider's response body is the acceptance fact. HighLevel documents `succeded` (sic) and some tenants return
    // `succeeded` or `success`; an explicit false is a definite refusal, never an enrollment.
    const refusal = workflowTriggerRefusal(trigger);
    if (refusal === WORKFLOW_TRIGGER_UNCONFIRMED) {
      throw new Error("GHL_AMBIGUOUS_DISPATCH: workflow trigger response did not confirm acceptance; outcome unknown");
    }
    if (refusal) throw new Error(`GHL workflow enrollment refused by provider: ${refusal}`);

    console.log(`[GHL Workflows] Enrolled GHL contact ${params.ghlContactId} in workflow ${params.workflowKey}`);
    return { success: true, outcome: "confirmed" };
  } catch (err: any) {
    console.error(`[GHL Workflows] Enrollment failed for ${params.workflowKey}:`, err.message);

    // Resolve the DB contact for better audit trail display
    let dbContactId: number | undefined;
    let displayName: string = params.ghlContactId;
    try {
      const [match] = await db
        .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
        .from(contacts)
        .where(eq(contacts.ghlContactId, params.ghlContactId))
        .limit(1);
      if (match) {
        dbContactId = match.id;
        displayName = [match.firstName, match.lastName].filter(Boolean).join(" ") || match.email || params.ghlContactId;
      }
    } catch (_) {}

    // For transient errors, defer instead of permanently dropping the enrollment.
    // Recovery calls (_isRecoveryAttempt) update the retry count via the recovery
    // module itself, so we skip re-deferring to avoid double-counting.
    const { isTransientGhlError, deferGhlEnrollment } = await import("./ghl-enrollment-recovery");
    // A lost response (the request may have been accepted) is an unknown outcome: it is never deferred for re-sending.
    const { isAmbiguousDispatchMessage } = await import("./ghl-dispatch-recorder");
    const possiblyAccepted = err instanceof GhlAmbiguousDispatchError
      || isAmbiguousDispatchMessage(err?.message)
      || /^GHL API error (?:5\d\d|408)\b/.test(String(err?.message ?? ""))
      || err instanceof SyntaxError;
    const isTransient = isTransientGhlError(err) && !possiblyAccepted;
    const defersHere = !params._isRecoveryAttempt && !params._callerOwnsDeferral && isTransient;
    if (defersHere) {
      await deferGhlEnrollment({
        ghlContactId: params.ghlContactId,
        workflowKey: params.workflowKey,
        metadata: params.metadata,
        error: err,
      }).catch(deferErr =>
        console.error("[GHL Workflows] Failed to defer enrollment:", deferErr)
      );
    }

    await auditChange({
      entityType: "ghl_sync",
      entityId: dbContactId,
      entityKey: displayName,
      action: "ghl_enrollment_failed",
      actorType: "system",
      details: {
        workflowKey: params.workflowKey,
        error: err.message,
        deferred: defersHere,
        ...params.metadata,
      },
    }).catch(() => {});
    // Typed outcome for callers that own their own retry ledger: a possibly-accepted request is `unknown`
    // and must not be retried by an outer queue; a pre-I/O or definite refusal is `unsent`.
    // A provider 5xx/408 or an unreadable success body on the trigger POST may follow processing: also unknown.
    const outcome: GhlEnrollmentOutcome = possiblyAccepted ? "unknown" : "unsent";
    return { success: false, error: err.message, outcome };
  }
}

/**
 * Compliance-gated GHL workflow enrollment (#1380 — Kill Line #3 fix).
 *
 * Replaces direct enrollInGhlWorkflow() call sites in routes/services so that
 * every GHL automation respects the Replit compliance fence:
 *   • Marketing/nurture/SDR workflows → global pause + DNC + doNotAutoContact
 *   • Transactional workflows (confirmations, support, onboarding) → DNC only
 *
 * The deferred-enrollment recovery job also dispatches through this gate (final
 * dispatch re-runs workflow verification, pause, identity, suppression and quiet
 * hours). RVM transport, unsubscribe handler, and workflow-executor intentionally
 * call enrollInGhlWorkflow() directly — do NOT change those call sites.
 */
export async function enrollInGhlWorkflowCompliant(params: {
  workflowKey: string;
  ghlContactId: string;
  metadata?: Record<string, any>;
  _isRecoveryAttempt?: boolean;
  /** See enrollInGhlWorkflow: the caller owns the deferred obligation. */
  _callerOwnsDeferral?: boolean;
  /** DB contact id — enables DNC / doNotAutoContact checks */
  contactId?: number;
  /** Server-owned current inbound event binding; absent means account transactional. */
  inboundRequestId?: string;
}): Promise<{ success: boolean; error?: string; skipped?: boolean; outcome?: GhlEnrollmentOutcome }> {
  const registryEntry = GHL_WORKFLOW_REGISTRY.find(w => w.id === params.workflowKey);
  if (!registryEntry) {
    return { success: false, error: `Unknown GHL workflow "${params.workflowKey}"`, skipped: true };
  }
  const declarationFailure = getWorkflowVerificationFailure(registryEntry);
  if (declarationFailure) {
    return { success: false, error: declarationFailure, skipped: true };
  }
  if (!params.contactId) {
    return { success: false, error: "A local contact is required for merchant-directed workflow enrollment", skipped: true };
  }
  const category = registryEntry.category;
  const isMarketingCategory =
    category === "sdr_outbound" || category === "nurture" || category === "sales";

  // ── Global pause — marketing/nurture/SDR only (upgraded to OutboundPauseAuthority) ──
  if (isMarketingCategory) {
    try {
      const { authorize } = await import("./outbound-pause-authority");
      const { canExecute } = await import("./outbound-queue-coordinator");
      const decision = await authorize({});
      if (!decision.allowed) {
        console.log(
          `[GHL Compliance] Workflow "${params.workflowKey}" blocked by OutboundPauseAuthority (reason=${decision.reasonCode})`
        );
        return { success: false, error: "Global outbound pause is active", skipped: true };
      }
      const coordOk = await canExecute("ghl-workflows-marketing");
      if (!coordOk) {
        console.log(
          `[GHL Compliance] Workflow "${params.workflowKey}" blocked by coordinator hold on 'ghl-workflows-marketing'`
        );
        return { success: false, error: "Coordinator hold active for outbound marketing", skipped: true };
      }
    } catch (_) {
      // If authority check fails, fail-closed for marketing sends
      return { success: false, error: "Could not verify global pause state", skipped: true };
    }
  }

  // The local contact must exist and correspond to the provider contact. A
  // missing/ambiguous lookup is a denial, never a reason to trust legacy fields.
  try {
    const [contact] = await db
      .select({ id: contacts.id, ghlContactId: contacts.ghlContactId })
      .from(contacts)
      .where(eq(contacts.id, params.contactId))
      .limit(1);
    if (!contact || !contact.ghlContactId || contact.ghlContactId !== params.ghlContactId) {
      return { success: false, error: "Local contact does not match the GHL workflow recipient", skipped: true };
    }
  } catch (err: any) {
    console.warn(`[GHL Compliance] Contact lookup failed for id=${params.contactId}: ${err.message}`);
    return { success: false, error: "Could not verify workflow recipient", skipped: true };
  }

  try {
    const { evaluateContactability } = await import("./contactability");
    for (const channel of registryEntry.outboundChannels!) {
      const decision = await evaluateContactability({
        contactId: params.contactId,
        channel,
        campaignType: `ghl_workflow:${params.workflowKey}`,
        commercialPurpose: registryEntry.commercialPurpose ?? "marketing_outreach",
        inboundRequestId: params.inboundRequestId,
        intendedRecipientContactId: params.inboundRequestId ? params.contactId : undefined,
        mode: "enforcement",
      });
      if (!decision.allowed) {
        return { success: false, error: decision.reason, skipped: true };
      }
    }
  } catch (err: any) {
    console.warn(`[GHL Compliance] Contactability check failed for ${params.workflowKey}: ${err.message}`);
    return { success: false, error: "Could not verify contactability", skipped: true };
  }

  return enrollInGhlWorkflow(params);
}

export function getSdrWorkflowForVertical(vertical: string): string {
  const normalizedVertical = (vertical || "").toLowerCase();

  if (normalizedVertical.includes("auto")) return "sdr_cold_auto";
  if (normalizedVertical.includes("med spa") || normalizedVertical.includes("medspa") || normalizedVertical.includes("salon") || normalizedVertical.includes("spa")) return "sdr_cold_medspa";
  if (normalizedVertical.includes("medical") || normalizedVertical.includes("dental") || normalizedVertical.includes("healthcare")) return "sdr_cold_medical";
  if (normalizedVertical.includes("restaurant") || normalizedVertical.includes("food")) return "sdr_cold_restaurant";
  if (normalizedVertical.includes("retail")) return "sdr_cold_retail";
  if (normalizedVertical.includes("construction") || normalizedVertical.includes("contractor") || normalizedVertical.includes("remodel") || normalizedVertical.includes("roofing") || normalizedVertical.includes("trades")) return "sdr_cold_construction";

  return "sdr_cold_default";
}

export async function enrollSdrOutreach(params: {
  ghlContactId: string;
  vertical: string;
  merchantId?: number;
  contactId?: number;
}): Promise<{ success: boolean; workflowKey: string; error?: string }> {
  const workflowKey = getSdrWorkflowForVertical(params.vertical);
  if (!params.contactId) {
    return { success: false, workflowKey, error: "A local contact is required for SDR workflow enrollment" };
  }

  const result = await enrollInGhlWorkflowCompliant({
    workflowKey,
    ghlContactId: params.ghlContactId,
    metadata: {
      vertical: params.vertical,
      merchantId: params.merchantId,
      contactId: params.contactId,
      enrolledAt: new Date().toISOString(),
    },
    contactId: params.contactId,
  });

  return { ...result, workflowKey };
}

export function getWorkflowStatus(): {
  configured: Record<string, boolean>;
  total: number;
  configuredCount: number;
  missingWorkflows: string[];
} {
  const configured: Record<string, boolean> = {};
  const missingWorkflows: string[] = [];

  for (const workflow of GHL_WORKFLOW_REGISTRY) {
    const hasId = !!process.env[workflow.envKey];
    configured[workflow.id] = hasId;
    if (!hasId) missingWorkflows.push(`${workflow.name} (${workflow.envKey})`);
  }

  const configuredCount = Object.values(configured).filter(Boolean).length;

  return {
    configured,
    total: GHL_WORKFLOW_REGISTRY.length,
    configuredCount,
    missingWorkflows,
  };
}

/**
 * Fetch a single GHL workflow by ID directly from the GHL API.
 * Returns a typed result — never throws.
 */
export async function fetchGhlWorkflowById(workflowId: string): Promise<
  | { found: true; name: string; status: string; active: boolean }
  | { found: false }
  | { found: null; error: string }
> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return { found: null, error: "GHL not configured" };

  const base = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const resp = await fetch(`${base}/workflows/${workflowId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        "location-id": locationId,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.status === 404) return { found: false };
    if (resp.status === 401 || resp.status === 403) {
      return { found: null, error: `GHL auth failed (HTTP ${resp.status}) — regenerate token in GHL Settings → Private Integrations` };
    }
    if (!resp.ok) return { found: null, error: `GHL API error HTTP ${resp.status}` };

    const data = await resp.json().catch(() => ({})) as Record<string, any>;
    const wf = data?.workflow ?? data;
    const status: string = wf?.status ?? "unknown";
    const active = status === "published" || status === "active" || wf?.isActive === true;
    return { found: true, name: wf?.name ?? workflowId, status, active };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") return { found: null, error: "GHL request timed out after 15s" };
    return { found: null, error: err.message ?? "Unknown fetch error" };
  }
}

export interface WorkflowValidationResult {
  envKey: string;
  workflowId: string;
  registryName: string;
  category: string;
  status: "ok" | "not_found" | "inactive" | "api_error" | "not_configured";
  ghlName?: string;
  ghlStatus?: string;
  error?: string;
}

/**
 * Validates every configured workflow ID in GHL_WORKFLOW_REGISTRY against the live GHL API.
 * Keys without a configured ID are returned as "not_configured" (not an error — just not set).
 * Processes in small batches to stay well within GHL's rate limits.
 */
export async function validateGhlWorkflowRegistry(): Promise<{
  results: WorkflowValidationResult[];
  checkedCount: number;
  okCount: number;
  unresolvedKeys: string[];
  inactiveKeys: string[];
  apiErrorKeys: string[];
}> {
  const results: WorkflowValidationResult[] = [];
  const BATCH = 3;

  for (let i = 0; i < GHL_WORKFLOW_REGISTRY.length; i += BATCH) {
    const batch = GHL_WORKFLOW_REGISTRY.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (w): Promise<WorkflowValidationResult> => {
        const workflowId = await getWorkflowEnvValue(w.envKey);
        if (!workflowId) {
          return { envKey: w.envKey, workflowId: "", registryName: w.name, category: w.category, status: "not_configured" };
        }
        const check = await fetchGhlWorkflowById(workflowId);
        if (check.found === null) {
          return { envKey: w.envKey, workflowId, registryName: w.name, category: w.category, status: "api_error", error: check.error };
        }
        if (!check.found) {
          return { envKey: w.envKey, workflowId, registryName: w.name, category: w.category, status: "not_found" };
        }
        if (!check.active) {
          return { envKey: w.envKey, workflowId, registryName: w.name, category: w.category, status: "inactive", ghlName: check.name, ghlStatus: check.status };
        }
        return { envKey: w.envKey, workflowId, registryName: w.name, category: w.category, status: "ok", ghlName: check.name, ghlStatus: check.status };
      })
    );
    results.push(...batchResults);
    if (i + BATCH < GHL_WORKFLOW_REGISTRY.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const configured = results.filter(r => r.status !== "not_configured");
  const okCount = results.filter(r => r.status === "ok").length;
  const unresolvedKeys = results.filter(r => r.status === "not_found").map(r => r.envKey);
  const inactiveKeys = results.filter(r => r.status === "inactive").map(r => r.envKey);
  const apiErrorKeys = results.filter(r => r.status === "api_error").map(r => r.envKey);

  // Emit structured warnings for any key that resolves to nothing or is inactive
  for (const r of configured) {
    if (r.status === "not_found") {
      console.warn(
        `[GHL Workflow Validation] WORKFLOW_NOT_FOUND: ${r.envKey}=${r.workflowId} ` +
        `("${r.registryName}") does not exist in GHL. Update the ID or enrollments will silently skip.`
      );
    } else if (r.status === "inactive") {
      console.warn(
        `[GHL Workflow Validation] WORKFLOW_INACTIVE: ${r.envKey}=${r.workflowId} ` +
        `("${r.registryName}" / GHL name: "${r.ghlName}", status: ${r.ghlStatus}) ` +
        `exists but is not active — contacts will not be enrolled.`
      );
    } else if (r.status === "api_error") {
      console.warn(
        `[GHL Workflow Validation] API_ERROR: Could not verify ${r.envKey}=${r.workflowId} — ${r.error}`
      );
    }
  }

  return { results, checkedCount: configured.length, okCount, unresolvedKeys, inactiveKeys, apiErrorKeys };
}

export function getPlatformEmailConfig(): {
  passwordReset: "replit_app";
  emailVerification: "replit_app";
  accountNotifications: "replit_app";
  salesOutreach: "ghl";
  supportAck: "ghl";
  appointmentReminders: "ghl";
  documentSigning: "ghl";
} {
  return {
    passwordReset: "replit_app",
    emailVerification: "replit_app",
    accountNotifications: "replit_app",
    salesOutreach: "ghl",
    supportAck: "ghl",
    appointmentReminders: "ghl",
    documentSigning: "ghl",
  };
}
