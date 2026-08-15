import { triggerWorkflow, isSdrGhlConfigured } from "./sdr/ghl-client";
import { isGhlConfigured } from "./ghl";
import { storage } from "../storage";
import { auditChange } from "./audit-change";
import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface GhlWorkflowConfig {
  id: string;
  name: string;
  category: "sdr_outbound" | "inbound_lead" | "scheduling" | "support" | "onboarding" | "nurture" | "sales";
  triggerType: string;
  envKey: string;
  description: string;
}

export const GHL_WORKFLOW_REGISTRY: GhlWorkflowConfig[] = [
  { id: "inbound_confirmation", name: "Inbound Lead — Instant Confirmation", category: "inbound_lead", triggerType: "form_submitted", envKey: "GHL_WORKFLOW_INBOUND_CONFIRMATION", description: "CRITICAL: Triggers on every web form submission (estimate, statement upload, get started, callback). Sends an instant welcome/confirmation email with booking link. Without this, new leads get no immediate response." },
  { id: "inbound_lead", name: "Inbound Lead Confirmation (Legacy)", category: "inbound_lead", triggerType: "form_submitted", envKey: "GHL_WORKFLOW_INBOUND_LEAD", description: "Sends welcome email + SMS with booking link on new lead creation. 24h follow-up if no booking." },
  { id: "statement_review", name: "Statement Review Follow-Up", category: "inbound_lead", triggerType: "statement_uploaded", envKey: "GHL_WORKFLOW_STATEMENT_REVIEW", description: "Triggered when merchant uploads a processing statement. Sends confirmation and schedules AI review." },
  { id: "merchant_app", name: "Merchant Application Received", category: "onboarding", triggerType: "merchant_app_submitted", envKey: "GHL_WORKFLOW_MERCHANT_APP", description: "Triggered on merchant application submission. Sends confirmation, triggers e-sign, begins onboarding." },
  { id: "support_ticket", name: "Support Ticket Created", category: "support", triggerType: "ticket_created", envKey: "GHL_WORKFLOW_SUPPORT_TICKET", description: "Triggered on support form submission. Assigns to support team, sends acknowledgment." },
  { id: "affiliate_welcome", name: "Affiliate Welcome", category: "onboarding", triggerType: "affiliate_signup", envKey: "GHL_WORKFLOW_AFFILIATE_WELCOME", description: "Welcome sequence for new affiliate signups with portal access and referral instructions." },
  { id: "callback_request", name: "Callback Request", category: "inbound_lead", triggerType: "callback_requested", envKey: "GHL_WORKFLOW_CALLBACK", description: "Triggered on callback request. Creates task for sales team, sends confirmation SMS." },
  { id: "equipment_order", name: "Equipment Order Confirmation", category: "onboarding", triggerType: "equipment_ordered", envKey: "GHL_WORKFLOW_EQUIPMENT_ORDER", description: "Order confirmation with setup timeline. Triggers 24hr testing period tracking." },
  { id: "booking_confirmation", name: "Appointment Booking Confirmation", category: "scheduling", triggerType: "appointment_booked", envKey: "GHL_WORKFLOW_BOOKING_CONFIRM", description: "Sends booking confirmation email + SMS, 24h reminder, 1h reminder." },
  { id: "booking_reminder_24h", name: "24h Appointment Reminder", category: "scheduling", triggerType: "appointment_reminder", envKey: "GHL_WORKFLOW_REMINDER", description: "24-hour reminder before scheduled appointment." },
  { id: "no_show_reschedule", name: "No-Show Reschedule", category: "scheduling", triggerType: "appointment_no_show", envKey: "GHL_WORKFLOW_NO_SHOW", description: "Triggered when merchant misses appointment. Sends reschedule link." },
  { id: "post_call_review", name: "Post-Call Follow-Up", category: "nurture", triggerType: "call_completed", envKey: "GHL_WORKFLOW_POST_CALL", description: "Follow-up sequence after sales call. Sends recap, proposal, and next steps." },
  { id: "proposal_followup", name: "Proposal Follow-Up", category: "nurture", triggerType: "proposal_sent", envKey: "GHL_WORKFLOW_PROPOSAL_FOLLOWUP", description: "Follow-up sequence after proposal delivery. Day 1 check, Day 3 nudge, Day 7 urgency." },
  { id: "long_term_nurture", name: "Long-Term Nurture", category: "nurture", triggerType: "nurture_enrolled", envKey: "GHL_WORKFLOW_LONG_NURTURE", description: "Monthly touch sequence for leads not ready to buy. Education-focused content." },
  { id: "statement_analyzed", name: "Statement Analyzed - Sync to GHL", category: "inbound_lead", triggerType: "statement_analyzed", envKey: "GHL_WORKFLOW_STATEMENT_ANALYZED", description: "Triggered when a statement analysis is synced to GHL. Confirms custom field updates." },

  { id: "sdr_cold_auto", name: "SDR Cold Outbound - Auto", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_AUTO", description: "Cold outbound for automotive vertical." },
  { id: "sdr_cold_medspa", name: "SDR Cold Outbound - Med Spa", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_MEDSPA", description: "Cold outbound for med spa vertical." },
  { id: "sdr_cold_medical", name: "SDR Cold Outbound - Medical/Dental", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_MEDICAL", description: "Cold outbound for medical/dental vertical." },
  { id: "sdr_cold_restaurant", name: "SDR Cold Outbound - Restaurant", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_RESTAURANT", description: "Cold outbound for restaurant vertical." },
  { id: "sdr_cold_retail", name: "SDR Cold Outbound - Retail", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_RETAIL", description: "Cold outbound for retail vertical." },
  { id: "sdr_cold_construction", name: "SDR Cold Outbound - Construction", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_CONSTRUCTION", description: "Cold outbound for FL construction vertical (contractors, remodelers, roofing, specialty trades)." },
  { id: "sdr_cold_default", name: "SDR Cold Outbound - Default", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_DEFAULT", description: "Default cold outbound for uncategorized verticals." },
  { id: "sdr_statement_audit", name: "SDR Statement Audit Follow-Up", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_STATEMENT", description: "Statement audit focused outreach sequence." },

  { id: "merchant_approved", name: "Merchant Approved — Portal Welcome", category: "onboarding", triggerType: "merchant_approved", envKey: "GHL_WORKFLOW_MERCHANT_APPROVED", description: "Triggered when a merchant profile is approved. Sends portal access email with MID and next steps. Falls back to direct GHL email if workflow ID is not set." },
  { id: "proposal_viewed", name: "Proposal Viewed", category: "nurture", triggerType: "proposal_viewed", envKey: "GHL_WORKFLOW_PROPOSAL_VIEWED", description: "Triggered on first view of a co-branded proposal." },
  { id: "proposal_accepted", name: "Proposal Accepted", category: "nurture", triggerType: "proposal_accepted", envKey: "GHL_WORKFLOW_PROPOSAL_ACCEPTED", description: "Triggered when a merchant accepts a co-branded proposal." },

  { id: "rate_review_confirmation", name: "Rate Review Confirmation", category: "inbound_lead", triggerType: "rate_review_submitted", envKey: "GHL_WORKFLOW_RATE_REVIEW_CONFIRMATION", description: "Triggered when a merchant submits a rate review request via the merchant portal. Sends confirmation email with next steps and analysis timeline." },
  { id: "onboarding_reminder", name: "Onboarding Document Reminder", category: "onboarding", triggerType: "onboarding_reminder", envKey: "GHL_WORKFLOW_ONBOARDING_REMINDER", description: "Triggered when onboarding documents are overdue (>2 days pending). Sends reminder to merchant to complete outstanding checklist items." },
  { id: "voicemail_drop", name: "Voicemail Drop Trigger", category: "sales", triggerType: "voicemail_drop_requested", envKey: "GHL_WORKFLOW_VOICEMAIL_DROP", description: "Triggered when a sequence voicemail_drop step fires. If configured, GHL handles the actual audio delivery natively via a Voicemail Drop action node. Contact is tagged vm-drop-pending and a GHL note with the script preview is added before this workflow is enrolled." },
  { id: "unsubscribe", name: "Unsubscribe / Opt-Out", category: "inbound_lead", triggerType: "inbound_message", envKey: "GHL_WORKFLOW_UNSUBSCRIBE", description: "Triggered when a contact replies with an unsubscribe/opt-out intent. Removes them from all active GHL workflows and suppression lists." },
];

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
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isSdrGhlConfigured()) {
      return { success: false, error: "GHL not configured" };
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
      return { success: false, error: `Workflow ${params.workflowKey} not configured (set ${registryEntry?.envKey ?? params.workflowKey})` };
    }

    await triggerWorkflow({
      workflowId,
      contactId: params.ghlContactId,
      metadata: params.metadata,
    });

    console.log(`[GHL Workflows] Enrolled GHL contact ${params.ghlContactId} in workflow ${params.workflowKey}`);
    return { success: true };
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
    const isTransient = isTransientGhlError(err);
    if (!params._isRecoveryAttempt && isTransient) {
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
        deferred: !params._isRecoveryAttempt && isTransient,
        ...params.metadata,
      },
    }).catch(() => {});
    return { success: false, error: err.message };
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
 * Recovery paths (ghl-enrollment-recovery.ts), RVM transport, unsubscribe
 * handler, and workflow-executor intentionally call enrollInGhlWorkflow()
 * directly — do NOT change those call sites.
 */
export async function enrollInGhlWorkflowCompliant(params: {
  workflowKey: string;
  ghlContactId: string;
  metadata?: Record<string, any>;
  _isRecoveryAttempt?: boolean;
  /** DB contact id — enables DNC / doNotAutoContact checks */
  contactId?: number;
}): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  const registryEntry = GHL_WORKFLOW_REGISTRY.find(w => w.id === params.workflowKey);
  const category = registryEntry?.category ?? "inbound_lead";
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

  // ── Contact DNC / doNotAutoContact check ─────────────────────────────────
  if (params.contactId) {
    try {
      const [contact] = await db
        .select({
          id: contacts.id,
          doNotContact: contacts.doNotContact,
          doNotAutoContact: contacts.doNotAutoContact,
        })
        .from(contacts)
        .where(eq(contacts.id, params.contactId))
        .limit(1);

      if (contact?.doNotContact) {
        console.log(
          `[GHL Compliance] Workflow "${params.workflowKey}" blocked for contact ${params.contactId} — doNotContact=true`
        );
        return { success: false, error: "Contact is on Do Not Contact list", skipped: true };
      }
      if (isMarketingCategory && contact?.doNotAutoContact) {
        console.log(
          `[GHL Compliance] Workflow "${params.workflowKey}" blocked for contact ${params.contactId} — doNotAutoContact=true`
        );
        return {
          success: false,
          error: "Contact has opted out of automated outreach",
          skipped: true,
        };
      }
    } catch (err: any) {
      console.warn(
        `[GHL Compliance] Contact lookup failed for id=${params.contactId} — proceeding with enrollment: ${err.message}`
      );
    }
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

  const result = await enrollInGhlWorkflow({
    workflowKey,
    ghlContactId: params.ghlContactId,
    metadata: {
      vertical: params.vertical,
      merchantId: params.merchantId,
      contactId: params.contactId,
      enrolledAt: new Date().toISOString(),
    },
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
