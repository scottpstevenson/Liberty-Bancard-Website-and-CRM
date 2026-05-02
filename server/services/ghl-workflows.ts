import { triggerWorkflow, isSdrGhlConfigured } from "./sdr/ghl-client";
import { isGhlConfigured } from "./ghl";
import { storage } from "../storage";

export interface GhlWorkflowConfig {
  id: string;
  name: string;
  category: "sdr_outbound" | "inbound_lead" | "scheduling" | "support" | "onboarding" | "nurture";
  triggerType: string;
  envKey: string;
  description: string;
}

export const GHL_WORKFLOW_REGISTRY: GhlWorkflowConfig[] = [
  { id: "inbound_lead", name: "Inbound Lead Confirmation", category: "inbound_lead", triggerType: "form_submitted", envKey: "GHL_WORKFLOW_INBOUND_LEAD", description: "Sends welcome email + SMS with booking link on new lead creation. 24h follow-up if no booking." },
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

  { id: "sdr_cold_auto", name: "SDR Cold Outbound - Auto", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_AUTO", description: "Cold outbound for automotive vertical." },
  { id: "sdr_cold_medspa", name: "SDR Cold Outbound - Med Spa", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_MEDSPA", description: "Cold outbound for med spa vertical." },
  { id: "sdr_cold_medical", name: "SDR Cold Outbound - Medical/Dental", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_MEDICAL", description: "Cold outbound for medical/dental vertical." },
  { id: "sdr_cold_restaurant", name: "SDR Cold Outbound - Restaurant", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_RESTAURANT", description: "Cold outbound for restaurant vertical." },
  { id: "sdr_cold_retail", name: "SDR Cold Outbound - Retail", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_RETAIL", description: "Cold outbound for retail vertical." },
  { id: "sdr_cold_default", name: "SDR Cold Outbound - Default", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_DEFAULT", description: "Default cold outbound for uncategorized verticals." },
  { id: "sdr_statement_audit", name: "SDR Statement Audit Follow-Up", category: "sdr_outbound", triggerType: "sdr_outreach", envKey: "GHL_WORKFLOW_SDR_STATEMENT", description: "Statement audit focused outreach sequence." },
];

export async function getWorkflowId(workflowKey: string): Promise<string | null> {
  const workflow = GHL_WORKFLOW_REGISTRY.find(w => w.id === workflowKey);
  if (!workflow) return null;
  if (process.env[workflow.envKey]) return process.env[workflow.envKey]!;
  try {
    const { storage } = await import("../storage");
    const saved = await storage.getSystemSetting(`ghl_workflow_env_${workflow.envKey}`);
    if (saved) return saved as string;
  } catch {}
  return null;
}

export async function getWorkflowEnvValue(envKey: string): Promise<string | null> {
  if (process.env[envKey]) return process.env[envKey]!;
  try {
    const { storage } = await import("../storage");
    const saved = await storage.getSystemSetting(`ghl_workflow_env_${envKey}`);
    if (saved) return saved as string;
  } catch {}
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isSdrGhlConfigured()) {
      return { success: false, error: "GHL not configured" };
    }

    const workflowId = await getWorkflowId(params.workflowKey);
    if (!workflowId) {
      console.log(`[GHL Workflows] No workflow ID configured for ${params.workflowKey} — skipping enrollment`);
      return { success: false, error: `Workflow ${params.workflowKey} not configured (set ${GHL_WORKFLOW_REGISTRY.find(w => w.id === params.workflowKey)?.envKey})` };
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
    return { success: false, error: err.message };
  }
}

export function getSdrWorkflowForVertical(vertical: string): string {
  const normalizedVertical = (vertical || "").toLowerCase();

  if (normalizedVertical.includes("auto")) return "sdr_cold_auto";
  if (normalizedVertical.includes("med spa") || normalizedVertical.includes("medspa") || normalizedVertical.includes("salon") || normalizedVertical.includes("spa")) return "sdr_cold_medspa";
  if (normalizedVertical.includes("medical") || normalizedVertical.includes("dental") || normalizedVertical.includes("healthcare")) return "sdr_cold_medical";
  if (normalizedVertical.includes("restaurant") || normalizedVertical.includes("food")) return "sdr_cold_restaurant";
  if (normalizedVertical.includes("retail")) return "sdr_cold_retail";

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
