import { storage } from "../storage";
import { isGhlConfigured, upsertGhlContact, sendGhlEmail, sendGhlSms, getCalendarBookingUrl } from "./ghl";
import {
  triggerWorkflow, addTag, addNote, isSdrGhlConfigured,
  upsertContact as sdrUpsertContact,
  sendEmailReply as sdrSendEmail,
  sendSmsReply as sdrSendSms,
} from "./sdr/ghl-client";
import { createPreferenceAwareNotification } from "./digest-service";

const SALES_CALENDAR = "https://api.leadconnectorhq.com/widget/bookings/libertybancard";
const AM_CALENDAR = "https://api.leadconnectorhq.com/widget/booking/kBRoNz5XoTpddupMQg0c";

export function isGhlInboundActive(): boolean {
  return isGhlConfigured() || isSdrGhlConfigured();
}

async function unifiedUpsertContact(contact: { id: number; ghlContactId?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; companyName?: string | null; vertical?: string | null }): Promise<string | null> {
  if (isGhlConfigured()) {
    return upsertGhlContact({
      id: contact.id,
      firstName: contact.firstName ?? "",
      lastName: contact.lastName ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      ghlContactId: contact.ghlContactId ?? null,
      companyName: contact.companyName ?? undefined,
      vertical: contact.vertical ?? undefined,
    });
  }
  if (isSdrGhlConfigured()) {
    return sdrUpsertContact({
      firstName: contact.firstName || undefined,
      lastName: contact.lastName || undefined,
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      companyName: contact.companyName || undefined,
      existingGhlId: contact.ghlContactId || undefined,
    });
  }
  return null;
}

async function unifiedSendEmail(params: { contactId: number; ghlContactId: string; subject: string; body: string }): Promise<void> {
  if (isGhlConfigured()) {
    await sendGhlEmail({ contactId: params.contactId, subject: params.subject, body: params.body });
    return;
  }
  if (isSdrGhlConfigured()) {
    await sdrSendEmail({ contactId: params.ghlContactId, subject: params.subject, htmlBody: params.body });
    return;
  }
  throw new Error("No GHL client configured for sending email");
}

async function unifiedSendSms(params: { contactId: number; ghlContactId: string; body: string }): Promise<void> {
  if (isGhlConfigured()) {
    await sendGhlSms({ contactId: params.contactId, body: params.body });
    return;
  }
  if (isSdrGhlConfigured()) {
    await sdrSendSms({ contactId: params.ghlContactId, message: params.body });
    return;
  }
  throw new Error("No GHL client configured for sending SMS");
}

export interface GhlWorkflowMapping {
  sequenceName: string;
  ghlWorkflowId: string | null;
  category: string;
  vertical: string;
  inboxLabel: string;
  inboxTags: string[];
}

const SEQUENCE_WORKFLOW_MAP: Record<string, GhlWorkflowMapping> = {
  "1. Switch & Save — Statement Audit": { sequenceName: "1. Switch & Save — Statement Audit", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Statement Audit", inboxTags: ["LB-SDR", "LB-SEQ-STATEMENT-AUDIT"] },
  "2. Payment Stack 101 — Education": { sequenceName: "2. Payment Stack 101 — Education", ghlWorkflowId: null, category: "education", vertical: "all", inboxLabel: "SDR: Education", inboxTags: ["LB-SDR", "LB-SEQ-EDUCATION"] },
  "3. Fast Approval — Application Completion": { sequenceName: "3. Fast Approval — Application Completion", ghlWorkflowId: null, category: "onboarding", vertical: "all", inboxLabel: "SDR: Application", inboxTags: ["LB-SDR", "LB-SEQ-APPLICATION"] },
  "4. Trust Builder — Authority Sequence": { sequenceName: "4. Trust Builder — Authority Sequence", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Trust Builder", inboxTags: ["LB-SDR", "LB-SEQ-TRUST-BUILDER"] },
  "5. Chargeback Defense": { sequenceName: "5. Chargeback Defense", ghlWorkflowId: null, category: "risk", vertical: "all", inboxLabel: "SDR: Chargeback", inboxTags: ["LB-SDR", "LB-SEQ-CHARGEBACK"] },
  "6. Funding Speed & Reliability": { sequenceName: "6. Funding Speed & Reliability", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Funding", inboxTags: ["LB-SDR", "LB-SEQ-FUNDING"] },
  "8. Liberty Smart Terminal — Product Showcase": { sequenceName: "8. Liberty Smart Terminal — Product Showcase", ghlWorkflowId: null, category: "hardware", vertical: "all", inboxLabel: "SDR: Terminal", inboxTags: ["LB-SDR", "LB-SEQ-TERMINAL"] },
  "9. Surcharge & Cash Discount — Compliance": { sequenceName: "9. Surcharge & Cash Discount — Compliance", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Surcharge", inboxTags: ["LB-SDR", "LB-SEQ-SURCHARGE"] },
  "10. Retail Merchants — SDR Outbound + Drip": { sequenceName: "10. Retail Merchants — SDR Outbound + Drip", ghlWorkflowId: null, category: "sdr_outbound", vertical: "retail", inboxLabel: "SDR: Retail Outbound", inboxTags: ["LB-SDR", "LB-RETAIL", "LB-SEQ-RETAIL-SDR"] },
  "11. Auto Merchants — SDR Outbound + Drip": { sequenceName: "11. Auto Merchants — SDR Outbound + Drip", ghlWorkflowId: null, category: "sdr_outbound", vertical: "auto", inboxLabel: "SDR: Auto Outbound", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-AUTO-SDR"] },
  "12. Medical & Med Spa — SDR Outbound + Drip": { sequenceName: "12. Medical & Med Spa — SDR Outbound + Drip", ghlWorkflowId: null, category: "sdr_outbound", vertical: "medical", inboxLabel: "SDR: Medical Outbound", inboxTags: ["LB-SDR", "LB-MEDSPA", "LB-SEQ-MEDICAL-SDR"] },
  "13. Recurring Billing — Subscription Merchants": { sequenceName: "13. Recurring Billing — Subscription Merchants", ghlWorkflowId: null, category: "sales", vertical: "subscription", inboxLabel: "SDR: Recurring", inboxTags: ["LB-SDR", "LB-SEQ-RECURRING"] },
  "15. Omnichannel — Online + In-Person": { sequenceName: "15. Omnichannel — Online + In-Person", ghlWorkflowId: null, category: "sales", vertical: "omnichannel", inboxLabel: "SDR: Omnichannel", inboxTags: ["LB-SDR", "LB-SEQ-OMNICHANNEL"] },
  "16. Security & PCI Compliance — Made Easy": { sequenceName: "16. Security & PCI Compliance — Made Easy", ghlWorkflowId: null, category: "education", vertical: "all", inboxLabel: "SDR: PCI", inboxTags: ["LB-SDR", "LB-SEQ-PCI"] },
  "17. Contract Escape — Switch Help": { sequenceName: "17. Contract Escape — Switch Help", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Contract Escape", inboxTags: ["LB-SDR", "LB-SEQ-CONTRACT-ESCAPE"] },
  "18. Objection Crusher — Overcome Hesitation": { sequenceName: "18. Objection Crusher — Overcome Hesitation", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Objections", inboxTags: ["LB-SDR", "LB-SEQ-OBJECTION-CRUSHER"] },
  "19. Reactivation — Cold Lead Revival": { sequenceName: "19. Reactivation — Cold Lead Revival", ghlWorkflowId: null, category: "reactivation", vertical: "all", inboxLabel: "SDR: Reactivation", inboxTags: ["LB-SDR", "LB-SEQ-REACTIVATION"] },
  "20. Free Analysis Follow-Up": { sequenceName: "20. Free Analysis Follow-Up", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Analysis Follow-Up", inboxTags: ["LB-SDR", "LB-SEQ-ANALYSIS-FOLLOWUP"] },
  "Post-Call Review Follow-Up": { sequenceName: "Post-Call Review Follow-Up", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Post-Call", inboxTags: ["LB-SDR", "LB-SEQ-POST-CALL"] },
  "Proposal Follow-Up": { sequenceName: "Proposal Follow-Up", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: Proposal", inboxTags: ["LB-SDR", "LB-SEQ-PROPOSAL"] },
  "No-Show Reschedule": { sequenceName: "No-Show Reschedule", ghlWorkflowId: null, category: "sales", vertical: "all", inboxLabel: "SDR: No-Show", inboxTags: ["LB-SDR", "LB-SEQ-NOSHOW"] },
  "Long-Term Nurture": { sequenceName: "Long-Term Nurture", ghlWorkflowId: null, category: "nurture", vertical: "all", inboxLabel: "SDR: Nurture", inboxTags: ["LB-SDR", "LB-SEQ-NURTURE"] },
  "SDR: Cold Outbound — Auto Repair": { sequenceName: "SDR: Cold Outbound — Auto Repair", ghlWorkflowId: null, category: "sdr_cold_outbound", vertical: "Auto Repair", inboxLabel: "SDR: Cold Auto", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-COLD-AUTO"] },
  "SDR: Cold Outbound — Med Spa": { sequenceName: "SDR: Cold Outbound — Med Spa", ghlWorkflowId: null, category: "sdr_cold_outbound", vertical: "Med Spa", inboxLabel: "SDR: Cold MedSpa", inboxTags: ["LB-SDR", "LB-MEDSPA", "LB-SEQ-COLD-MEDSPA"] },
  "SDR: Cold Outbound — Dental": { sequenceName: "SDR: Cold Outbound — Dental", ghlWorkflowId: null, category: "sdr_cold_outbound", vertical: "Dental", inboxLabel: "SDR: Cold Dental", inboxTags: ["LB-SDR", "LB-DENTAL", "LB-SEQ-COLD-DENTAL"] },
  "SDR: Cold Outbound — Construction": { sequenceName: "SDR: Cold Outbound — Construction", ghlWorkflowId: null, category: "sdr_cold_outbound", vertical: "Construction", inboxLabel: "SDR: Cold Construction", inboxTags: ["LB-SDR", "LB-SDR-CONSTRUCTION", "LB-SEQ-COLD-CONSTRUCTION"] },
  "SDR: Reply Engaged": { sequenceName: "SDR: Reply Engaged", ghlWorkflowId: null, category: "sdr_reply_engaged", vertical: "all", inboxLabel: "SDR: Reply Engaged", inboxTags: ["LB-SDR", "LB-SEQ-REPLY-ENGAGED"] },
  "SDR: Statement Chase": { sequenceName: "SDR: Statement Chase", ghlWorkflowId: null, category: "sdr_statement_chase", vertical: "all", inboxLabel: "SDR: Statement Chase", inboxTags: ["LB-SDR", "LB-STATEMENT-PENDING", "LB-SEQ-STATEMENT-CHASE"] },
  "SDR: Proposal Follow-Up": { sequenceName: "SDR: Proposal Follow-Up", ghlWorkflowId: null, category: "sdr_proposal_followup", vertical: "all", inboxLabel: "SDR: Proposal FU", inboxTags: ["LB-SDR", "LB-PROPOSAL-SENT", "LB-SEQ-PROPOSAL-FU"] },
  "SDR: No-Show Recovery": { sequenceName: "SDR: No-Show Recovery", ghlWorkflowId: null, category: "sdr_noshow_recovery", vertical: "all", inboxLabel: "SDR: No-Show", inboxTags: ["LB-SDR", "LB-SEQ-NOSHOW-RECOVERY"] },
  "V-Retail: SDR Outbound Prospecting": { sequenceName: "V-Retail: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "retail", inboxLabel: "SDR: V-Retail", inboxTags: ["LB-SDR", "LB-RETAIL", "LB-SEQ-V-RETAIL-SDR"] },
  "V-Retail: Inbound Lead Nurture": { sequenceName: "V-Retail: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "retail", inboxLabel: "Inbound: Retail", inboxTags: ["LB-SDR", "LB-RETAIL", "LB-SEQ-V-RETAIL-INBOUND"] },
  "V-Retail: Account Management Ops": { sequenceName: "V-Retail: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "retail", inboxLabel: "Ops: Retail", inboxTags: ["LB-OPS", "LB-RETAIL"] },
  "V-Auto: SDR Outbound Prospecting": { sequenceName: "V-Auto: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "auto", inboxLabel: "SDR: V-Auto", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-V-AUTO-SDR"] },
  "V-Auto: Inbound Lead Nurture": { sequenceName: "V-Auto: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "auto", inboxLabel: "Inbound: Auto", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-V-AUTO-INBOUND"] },
  "V-Auto: Account Management Ops": { sequenceName: "V-Auto: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "auto", inboxLabel: "Ops: Auto", inboxTags: ["LB-OPS", "LB-AUTO"] },
  "V-Medical: SDR Outbound Prospecting": { sequenceName: "V-Medical: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "medical", inboxLabel: "SDR: V-Medical", inboxTags: ["LB-SDR", "LB-MEDICAL", "LB-SEQ-V-MEDICAL-SDR"] },
  "V-Medical: Inbound Lead Nurture": { sequenceName: "V-Medical: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "medical", inboxLabel: "Inbound: Medical", inboxTags: ["LB-SDR", "LB-MEDICAL", "LB-SEQ-V-MEDICAL-INBOUND"] },
  "V-Medical: Account Management Ops": { sequenceName: "V-Medical: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "medical", inboxLabel: "Ops: Medical", inboxTags: ["LB-OPS", "LB-MEDICAL"] },
  "V-Med Spa: SDR Outbound Prospecting": { sequenceName: "V-Med Spa: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "medspa", inboxLabel: "SDR: V-MedSpa", inboxTags: ["LB-SDR", "LB-MEDSPA", "LB-SEQ-V-MEDSPA-SDR"] },
  "V-Med Spa: Inbound Lead Nurture": { sequenceName: "V-Med Spa: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "medspa", inboxLabel: "Inbound: MedSpa", inboxTags: ["LB-SDR", "LB-MEDSPA", "LB-SEQ-V-MEDSPA-INBOUND"] },
  "V-Med Spa: Account Management Ops": { sequenceName: "V-Med Spa: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "medspa", inboxLabel: "Ops: MedSpa", inboxTags: ["LB-OPS", "LB-MEDSPA"] },
  "V-Dental: SDR Outbound Prospecting": { sequenceName: "V-Dental: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "dental", inboxLabel: "SDR: V-Dental", inboxTags: ["LB-SDR", "LB-DENTAL", "LB-SEQ-V-DENTAL-SDR"] },
  "V-Dental: Inbound Lead Nurture": { sequenceName: "V-Dental: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "dental", inboxLabel: "Inbound: Dental", inboxTags: ["LB-SDR", "LB-DENTAL", "LB-SEQ-V-DENTAL-INBOUND"] },
  "V-Dental: Account Management Ops": { sequenceName: "V-Dental: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "dental", inboxLabel: "Ops: Dental", inboxTags: ["LB-OPS", "LB-DENTAL"] },
  "V-Auto Repair: SDR Outbound Prospecting": { sequenceName: "V-Auto Repair: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "autorepair", inboxLabel: "SDR: V-AutoRepair", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-V-AUTOREPAIR-SDR"] },
  "V-Auto Repair: Inbound Lead Nurture": { sequenceName: "V-Auto Repair: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "autorepair", inboxLabel: "Inbound: AutoRepair", inboxTags: ["LB-SDR", "LB-AUTO", "LB-SEQ-V-AUTOREPAIR-INBOUND"] },
  "V-Auto Repair: Account Management Ops": { sequenceName: "V-Auto Repair: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "autorepair", inboxLabel: "Ops: AutoRepair", inboxTags: ["LB-OPS", "LB-AUTO"] },
  "V-Salon: SDR Outbound Prospecting": { sequenceName: "V-Salon: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "salon", inboxLabel: "SDR: V-Salon", inboxTags: ["LB-SDR", "LB-SDR-SALON", "LB-SEQ-V-SALON-SDR"] },
  "V-Salon: Inbound Lead Nurture": { sequenceName: "V-Salon: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "salon", inboxLabel: "Inbound: Salon", inboxTags: ["LB-SDR", "LB-SDR-SALON", "LB-SEQ-V-SALON-INBOUND"] },
  "V-Salon: Account Management Ops": { sequenceName: "V-Salon: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "salon", inboxLabel: "Ops: Salon", inboxTags: ["LB-OPS", "LB-SDR-SALON"] },
  "V-Gym: SDR Outbound Prospecting": { sequenceName: "V-Gym: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "gym", inboxLabel: "SDR: V-Gym", inboxTags: ["LB-SDR", "LB-SDR-GYM", "LB-SEQ-V-GYM-SDR"] },
  "V-Gym: Inbound Lead Nurture": { sequenceName: "V-Gym: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "gym", inboxLabel: "Inbound: Gym", inboxTags: ["LB-SDR", "LB-SDR-GYM", "LB-SEQ-V-GYM-INBOUND"] },
  "V-Gym: Account Management Ops": { sequenceName: "V-Gym: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "gym", inboxLabel: "Ops: Gym", inboxTags: ["LB-OPS", "LB-SDR-GYM"] },
  "V-Hotel: SDR Outbound Prospecting": { sequenceName: "V-Hotel: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "hotel", inboxLabel: "SDR: V-Hotel", inboxTags: ["LB-SDR", "LB-SDR-HOTEL", "LB-SEQ-V-HOTEL-SDR"] },
  "V-Hotel: Inbound Lead Nurture": { sequenceName: "V-Hotel: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "hotel", inboxLabel: "Inbound: Hotel", inboxTags: ["LB-SDR", "LB-SDR-HOTEL", "LB-SEQ-V-HOTEL-INBOUND"] },
  "V-Hotel: Account Management Ops": { sequenceName: "V-Hotel: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "hotel", inboxLabel: "Ops: Hotel", inboxTags: ["LB-OPS", "LB-SDR-HOTEL"] },
  "V-Landscaping: SDR Outbound Prospecting": { sequenceName: "V-Landscaping: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "landscaping", inboxLabel: "SDR: V-Landscaping", inboxTags: ["LB-SDR", "LB-SDR-LANDSCAPING", "LB-SEQ-V-LANDSCAPING-SDR"] },
  "V-Landscaping: Inbound Lead Nurture": { sequenceName: "V-Landscaping: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "landscaping", inboxLabel: "Inbound: Landscaping", inboxTags: ["LB-SDR", "LB-SDR-LANDSCAPING", "LB-SEQ-V-LANDSCAPING-INBOUND"] },
  "V-Landscaping: Account Management Ops": { sequenceName: "V-Landscaping: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "landscaping", inboxLabel: "Ops: Landscaping", inboxTags: ["LB-OPS", "LB-SDR-LANDSCAPING"] },
  "V-Construction: SDR Outbound Prospecting": { sequenceName: "V-Construction: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "construction", inboxLabel: "SDR: V-Construction", inboxTags: ["LB-SDR", "LB-SDR-CONSTRUCTION", "LB-SEQ-V-CONSTRUCTION-SDR"] },
  "V-Construction: Inbound Lead Nurture": { sequenceName: "V-Construction: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "construction", inboxLabel: "Inbound: Construction", inboxTags: ["LB-SDR", "LB-SDR-CONSTRUCTION", "LB-SEQ-V-CONSTRUCTION-INBOUND"] },
  "V-Construction: Account Management Ops": { sequenceName: "V-Construction: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "construction", inboxLabel: "Ops: Construction", inboxTags: ["LB-OPS", "LB-SDR-CONSTRUCTION"] },
  "V-Legal: SDR Outbound Prospecting": { sequenceName: "V-Legal: SDR Outbound Prospecting", ghlWorkflowId: null, category: "sdr", vertical: "legal", inboxLabel: "SDR: V-Legal", inboxTags: ["LB-SDR", "LB-SDR-LEGAL", "LB-SEQ-V-LEGAL-SDR"] },
  "V-Legal: Inbound Lead Nurture": { sequenceName: "V-Legal: Inbound Lead Nurture", ghlWorkflowId: null, category: "inbound", vertical: "legal", inboxLabel: "Inbound: Legal", inboxTags: ["LB-SDR", "LB-SDR-LEGAL", "LB-SEQ-V-LEGAL-INBOUND"] },
  "V-Legal: Account Management Ops": { sequenceName: "V-Legal: Account Management Ops", ghlWorkflowId: null, category: "operations", vertical: "legal", inboxLabel: "Ops: Legal", inboxTags: ["LB-OPS", "LB-SDR-LEGAL"] },
};

const INBOX_SMART_LIST_TAGS = {
  activeSdr: "LB-SDR",
  replied: "LB-REPLIED",
  meetingSet: "LB-BOOKING-READY",
  statementPending: "LB-STATEMENT-PENDING",
  humanHandoff: "LB-HUMAN-HANDOFF",
  activePipeline: "LB-ACTIVE-PIPELINE",
} as const;

async function resolveGhlWorkflowId(sequenceName: string): Promise<string | null> {
  const envKey = `GHL_WORKFLOW_${sequenceName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase()}`;

  const envValue = process.env[envKey];
  if (envValue) return envValue;

  try {
    const dbId = await storage.getGhlWorkflowIdBySequenceName(sequenceName);
    if (dbId) return dbId;
  } catch (err) {
    console.warn(`[GHL Enrollment] DB workflow ID lookup failed for "${sequenceName}":`, err);
  }

  const mapping = SEQUENCE_WORKFLOW_MAP[sequenceName];
  if (mapping?.ghlWorkflowId) return mapping.ghlWorkflowId;

  return process.env.GHL_DEFAULT_WORKFLOW_ID || null;
}

function getVerticalTag(vertical: string | null | undefined): string {
  if (!vertical) return "LB-VERTICAL-GENERAL";
  const v = vertical.toLowerCase().trim();
  if (/auto|automotive|repair|collision|body shop|tire/i.test(v)) return "LB-AUTO";
  if (/med.?spa|medspa|aesthetic|botox|filler|laser/i.test(v)) return "LB-MEDSPA";
  if (/dental|dentist/i.test(v)) return "LB-DENTAL";
  if (/medical|healthcare|clinic|chiro|optom|podiatr/i.test(v)) return "LB-MEDICAL";
  if (/restaurant|food|bar|cafe|catering/i.test(v)) return "LB-RESTAURANT";
  if (/retail|shop|store|boutique/i.test(v)) return "LB-RETAIL";
  if (/\bsalon\b|hair salon|nail salon|beauty salon|barber|beauty parlor|cosmetolog/i.test(v)) return "LB-SDR-SALON";
  if (/\bgym\b|fitness|crossfit|yoga|pilates|martial arts|personal training|boxing|dance studio|wellness center/i.test(v)) return "LB-SDR-GYM";
  if (/\bhotel\b|motel|\binn\b|\blodge\b|\bresort\b|hospitality|bed and breakfast/i.test(v)) return "LB-SDR-HOTEL";
  if (/landscap|lawn care|lawn service|lawn mowing|tree service|tree trimm|grounds.?keep/i.test(v)) return "LB-SDR-LANDSCAPING";
  if (/\bconstruct|contractor|builder|roofer|roofing|plumb|electrician|electrical|hvac|remodel|renovati/i.test(v)) return "LB-SDR-CONSTRUCTION";
  if (/attorney|law firm|\blawyer\b|\blegal\b|solicitor|paralegal|notary/i.test(v)) return "LB-SDR-LEGAL";
  return "LB-VERTICAL-GENERAL";
}

export interface GhlEnrollmentResult {
  enrolled: boolean;
  method: "ghl_workflow" | "replit_direct" | "skipped";
  ghlWorkflowId?: string;
  reason?: string;
  contactGhlId?: string;
}

export async function enrollContactInGhlWorkflow(params: {
  contactId: number;
  sequenceName: string;
  sequenceId: number;
  vertical?: string;
  dealId?: number;
}): Promise<GhlEnrollmentResult> {
  const { contactId, sequenceName, sequenceId, vertical, dealId } = params;

  const contact = await storage.getContact(contactId);
  if (!contact) {
    return { enrolled: false, method: "skipped", reason: "Contact not found" };
  }

  if (contact.doNotContact) {
    return { enrolled: false, method: "skipped", reason: "Contact is on do-not-contact list" };
  }

  const contactTags = contact.tags || [];
  if (contactTags.includes(INBOX_SMART_LIST_TAGS.activePipeline)) {
    return { enrolled: false, method: "skipped", reason: "Contact has LB-ACTIVE-PIPELINE tag — excluded from SDR enrollment" };
  }

  if (!isGhlConfigured() && !isSdrGhlConfigured()) {
    return { enrolled: false, method: "replit_direct", reason: "GHL not configured — falling back to Replit direct sends" };
  }

  let ghlContactId = contact.ghlContactId;
  if (!ghlContactId) {
    console.warn(`[GHL Enrollment] GUARD: Contact ${contactId} (${contact.firstName} ${contact.lastName}) has no GHL contact ID — blocking enrollment for sequence "${sequenceName}". Attempting auto-upsert to GHL first.`);
    try {
      ghlContactId = await unifiedUpsertContact(contact);
      if (ghlContactId) {
        await storage.updateContact(contactId, { ghlContactId });
        console.log(`[GHL Enrollment] Auto-upsert succeeded for contact ${contactId} — GHL ID: ${ghlContactId}. Retrying enrollment.`);
      }
    } catch (err) {
      console.error(`[GHL Enrollment] Auto-upsert FAILED for contact ${contactId}:`, err);
      await storage.createAuditLog({
        action: "ghl_enrollment_blocked",
        entityType: "contact",
        entityId: contactId,
        details: { sequenceName, sequenceId, reason: "ghl_upsert_failed" },
      }).catch(() => {});
      return { enrolled: false, method: "replit_direct", reason: "Failed to create GHL contact — enrollment blocked until GHL ID is confirmed" };
    }
  }

  if (!ghlContactId) {
    console.warn(`[GHL Enrollment] BLOCKED: Contact ${contactId} still has no GHL contact ID after upsert attempt — enrollment in "${sequenceName}" is blocked.`);
    await storage.createAuditLog({
      action: "ghl_enrollment_blocked",
      entityType: "contact",
      entityId: contactId,
      details: { sequenceName, sequenceId, reason: "no_ghl_contact_id" },
    }).catch(() => {});
    return { enrolled: false, method: "replit_direct", reason: "No confirmed GHL contact ID — enrollment blocked" };
  }

  const mapping = SEQUENCE_WORKFLOW_MAP[sequenceName];
  const inboxTags = mapping?.inboxTags || ["LB-SDR"];
  const verticalTag = getVerticalTag(vertical || mapping?.vertical);

  const allTags = [
    ...new Set([
      ...inboxTags,
      verticalTag,
      `LB-SEQ-ACTIVE`,
      INBOX_SMART_LIST_TAGS.activeSdr,
    ]),
  ];

  try {
    await addTag({ contactId: ghlContactId, tags: allTags });
  } catch (tagErr) {
    console.warn(`[GHL Enrollment] Failed to add tags for contact ${ghlContactId}:`, tagErr);
  }

  try {
    const noteBody = `Enrolled in sequence: ${sequenceName}\nCategory: ${mapping?.category || "unknown"}\nVertical: ${vertical || mapping?.vertical || "all"}\nReplit Sequence ID: ${sequenceId}\n${dealId ? `Deal ID: ${dealId}` : ""}`;
    await addNote({ contactId: ghlContactId, body: noteBody });
  } catch (noteErr) {
    console.warn(`[GHL Enrollment] Failed to add note for contact ${ghlContactId}:`, noteErr);
  }

  const ghlWorkflowId = await resolveGhlWorkflowId(sequenceName);

  if (ghlWorkflowId) {
    try {
      await triggerWorkflow({
        workflowId: ghlWorkflowId,
        contactId: ghlContactId,
        metadata: {
          sequenceName,
          sequenceId,
          vertical: vertical || mapping?.vertical || "all",
          dealId,
          source: "replit_sequence_worker",
          enrolledAt: new Date().toISOString(),
        },
      });

      await storage.createAuditLog({
        action: "ghl_workflow_enrolled",
        entityType: "contact",
        entityId: contactId,
        details: {
          sequenceName,
          sequenceId,
          ghlWorkflowId,
          ghlContactId,
          tags: allTags,
        },
      });

      console.log(`[GHL Enrollment] Contact ${contactId} enrolled in GHL workflow ${ghlWorkflowId} for sequence "${sequenceName}"`);

      return {
        enrolled: true,
        method: "ghl_workflow",
        ghlWorkflowId,
        contactGhlId: ghlContactId,
      };
    } catch (err) {
      console.error(`[GHL Enrollment] Failed to trigger GHL workflow ${ghlWorkflowId} for contact ${contactId}:`, err);
      return { enrolled: false, method: "replit_direct", reason: `GHL workflow trigger failed: ${err}` };
    }
  }

  return {
    enrolled: false,
    method: "replit_direct",
    reason: "No GHL workflow ID configured for this sequence — using Replit direct sends",
    contactGhlId: ghlContactId,
  };
}

export async function enrollInInboundConfirmation(params: {
  contactId: number;
  formType: string;
  dealId?: number;
}): Promise<void> {
  const { contactId, formType, dealId } = params;

  const contact = await storage.getContact(contactId);
  if (!contact) return;

  const inboundWorkflowId = process.env.GHL_WORKFLOW_INBOUND_CONFIRMATION;

  if (inboundWorkflowId && (isGhlConfigured() || isSdrGhlConfigured())) {
    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      try {
        ghlContactId = await unifiedUpsertContact(contact);
      } catch (err) {
        console.error(`[GHL Inbound] Failed to upsert contact for inbound confirmation:`, err);
      }
    }

    if (ghlContactId) {
      try {
        await addTag({
          contactId: ghlContactId,
          tags: ["LB-INBOUND", `LB-FORM-${formType.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`, getVerticalTag(contact.vertical)],
        });

        await triggerWorkflow({
          workflowId: inboundWorkflowId,
          contactId: ghlContactId,
          metadata: {
            formType,
            contactId,
            dealId,
            firstName: contact.firstName,
            companyName: contact.companyName,
            vertical: contact.vertical,
            source: "website_form",
            bookingLink: getCalendarBookingUrl({
              contactEmail: contact.email,
              contactName: `${contact.firstName} ${contact.lastName}`,
              source: formType,
            }) || SALES_CALENDAR,
          },
        });

        await storage.createAuditLog({
          action: "ghl_inbound_confirmation_enrolled",
          entityType: "contact",
          entityId: contactId,
          details: { formType, ghlWorkflowId: inboundWorkflowId, ghlContactId },
        });

        console.log(`[GHL Inbound] Contact ${contactId} enrolled in inbound confirmation workflow`);
        return;
      } catch (err) {
        console.error(`[GHL Inbound] Workflow trigger failed, falling back to direct sends:`, err);
      }
    }
  }

  if (isGhlConfigured() || isSdrGhlConfigured()) {
    let fallbackGhlContactId = contact.ghlContactId;
    if (!fallbackGhlContactId) {
      try {
        fallbackGhlContactId = await unifiedUpsertContact(contact);
      } catch (err) {
        console.error(`[GHL Inbound] Failed to upsert contact for fallback sends:`, err);
      }
    }

    if (!fallbackGhlContactId) {
      console.error(`[GHL Inbound] No GHL contact ID for fallback sends — skipping`);
      return;
    }

    const bookingLink = getCalendarBookingUrl({
      contactEmail: contact.email,
      contactName: `${contact.firstName} ${contact.lastName}`,
      source: formType,
    }) || SALES_CALENDAR;

    try {
      await unifiedSendEmail({
        contactId,
        ghlContactId: fallbackGhlContactId,
        subject: `Thanks for reaching out, ${contact.firstName}!`,
        body: buildInboundConfirmationEmail(contact.firstName || "there", contact.companyName || "your business", formType, bookingLink),
      });
    } catch (err) {
      console.error(`[GHL Inbound] Confirmation email failed:`, err);
    }

    if (contact.consentSms && contact.phone) {
      try {
        await unifiedSendSms({
          contactId,
          ghlContactId: fallbackGhlContactId,
          body: `Hi ${contact.firstName}, thanks for connecting with Liberty Bancard! We'll review your info and follow up soon. Book a call anytime: ${bookingLink} — Liberty Bancard`,
        });
      } catch (err) {
        console.error(`[GHL Inbound] Confirmation SMS failed:`, err);
      }
    }

    if (dealId) {
      const capturedGhlContactId = fallbackGhlContactId;
      setTimeout(async () => {
        try {
          const updatedContact = await storage.getContact(contactId);
          if (!updatedContact) return;

          const deal = dealId ? await storage.getDeal(dealId) : null;
          const hasBooked = deal && ["Statement Received", "Engaged", "Call Scheduled"].includes(deal.stage);
          if (hasBooked) return;

          await unifiedSendEmail({
            contactId,
            ghlContactId: capturedGhlContactId,
            subject: `Still want to see how much you could save, ${updatedContact.firstName}?`,
            body: buildInbound24hFollowupEmail(updatedContact.firstName || "there", bookingLink),
          });

          await storage.createAuditLog({
            action: "inbound_24h_followup_sent",
            entityType: "contact",
            entityId: contactId,
            details: { formType, dealId },
          });
        } catch (err) {
          console.error(`[GHL Inbound] 24h follow-up failed:`, err);
        }
      }, 24 * 60 * 60 * 1000);
    }
  } else {
    await storage.createAuditLog({
      action: "inbound_confirmation_skipped",
      entityType: "contact",
      entityId: contactId,
      details: { formType, dealId, reason: "GHL not configured — no confirmation sent" },
    });
  }
}

export async function enrollInAppointmentWorkflow(params: {
  contactId: number;
  appointmentDate: Date;
  calendarType: "sales" | "account_management";
  dealId?: number;
}): Promise<void> {
  const { contactId, appointmentDate, calendarType, dealId } = params;
  const contact = await storage.getContact(contactId);
  if (!contact) return;

  const appointmentWorkflowId = process.env.GHL_WORKFLOW_APPOINTMENT;

  if (appointmentWorkflowId && (isGhlConfigured() || isSdrGhlConfigured())) {
    let ghlContactId = contact.ghlContactId;
    if (!ghlContactId) {
      try {
        ghlContactId = await unifiedUpsertContact(contact);
      } catch (err) {
        console.error(`[GHL Appointment] Failed to upsert contact:`, err);
      }
    }

    if (ghlContactId) {
      try {
        await addTag({
          contactId: ghlContactId,
          tags: ["LB-BOOKING-READY", "LB-MEETING-SET"],
        });

        await triggerWorkflow({
          workflowId: appointmentWorkflowId,
          contactId: ghlContactId,
          metadata: {
            appointmentDate: appointmentDate.toISOString(),
            calendarType,
            contactId,
            dealId,
            firstName: contact.firstName,
            companyName: contact.companyName,
          },
        });

        await storage.createAuditLog({
          action: "ghl_appointment_workflow_enrolled",
          entityType: "contact",
          entityId: contactId,
          details: { appointmentDate, calendarType, ghlWorkflowId: appointmentWorkflowId },
        });

        return;
      } catch (err) {
        console.error(`[GHL Appointment] Workflow trigger failed:`, err);
      }
    }
  }

  if (isGhlConfigured() || isSdrGhlConfigured()) {
    let apptGhlContactId = contact.ghlContactId;
    if (!apptGhlContactId) {
      try {
        apptGhlContactId = await unifiedUpsertContact(contact);
      } catch (err) {
        console.error(`[GHL Appointment] Failed to upsert contact for fallback sends:`, err);
      }
    }

    if (!apptGhlContactId) {
      console.error(`[GHL Appointment] No GHL contact ID for fallback sends — skipping`);
      return;
    }

    try {
      const dateStr = appointmentDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });

      await unifiedSendEmail({
        contactId,
        ghlContactId: apptGhlContactId,
        subject: `Your call with Liberty Bancard is confirmed — ${dateStr}`,
        body: buildAppointmentConfirmationEmail(contact.firstName || "there", dateStr, calendarType),
      });

      const msUntilAppt = appointmentDate.getTime() - Date.now();
      const capturedApptGhlId = apptGhlContactId;

      if (msUntilAppt > 24 * 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            await unifiedSendEmail({
              contactId,
              ghlContactId: capturedApptGhlId,
              subject: `Reminder: Your call with Liberty Bancard is tomorrow`,
              body: buildAppointmentReminderEmail(contact.firstName || "there", dateStr, "24h"),
            });
          } catch (err) {
            console.error(`[GHL Appointment] 24h reminder failed:`, err);
          }
        }, msUntilAppt - 24 * 60 * 60 * 1000);
      }

      if (msUntilAppt > 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            if (contact.consentSms && contact.phone) {
              await unifiedSendSms({
                contactId,
                ghlContactId: capturedApptGhlId,
                body: `Hi ${contact.firstName}, just a reminder — your call with Liberty Bancard is in about 1 hour. Looking forward to speaking with you! — Liberty Bancard`,
              });
            }
          } catch (err) {
            console.error(`[GHL Appointment] 1h reminder failed:`, err);
          }
        }, msUntilAppt - 60 * 60 * 1000);
      }

      setTimeout(async () => {
        try {
          const calLink = calendarType === "account_management" ? AM_CALENDAR : SALES_CALENDAR;
          await unifiedSendEmail({
            contactId,
            ghlContactId: capturedApptGhlId,
            subject: `Thanks for your time, ${contact.firstName}`,
            body: buildPostMeetingFollowupEmail(contact.firstName || "there", calendarType, calLink),
          });
        } catch (err) {
          console.error(`[GHL Appointment] Post-meeting follow-up failed:`, err);
        }
      }, msUntilAppt + 60 * 60 * 1000);
    } catch (err) {
      console.error(`[GHL Appointment] Confirmation email failed:`, err);
    }
  }
}

export async function tagContactForInboxOrganization(params: {
  contactId: number;
  ghlContactId: string;
  sequenceName: string;
  vertical?: string;
  stage?: string;
}): Promise<void> {
  const { ghlContactId, sequenceName, vertical, stage } = params;

  const tags: string[] = [INBOX_SMART_LIST_TAGS.activeSdr];

  const mapping = SEQUENCE_WORKFLOW_MAP[sequenceName];
  if (mapping) {
    tags.push(...mapping.inboxTags);
  }

  if (vertical) {
    tags.push(getVerticalTag(vertical));
  }

  if (stage) {
    const stageTagMap: Record<string, string> = {
      "replied": INBOX_SMART_LIST_TAGS.replied,
      "meeting_set": INBOX_SMART_LIST_TAGS.meetingSet,
      "statement_pending": INBOX_SMART_LIST_TAGS.statementPending,
      "human_handoff": INBOX_SMART_LIST_TAGS.humanHandoff,
    };
    const stageTag = stageTagMap[stage];
    if (stageTag) tags.push(stageTag);
  }

  try {
    await addTag({ contactId: ghlContactId, tags: [...new Set(tags)] });
  } catch (err) {
    console.warn(`[GHL Inbox] Failed to tag contact ${ghlContactId}:`, err);
  }
}

export async function markEsignComplete(params: {
  applicationId: number;
  documentId: string;
}): Promise<{ verified: boolean; status: string }> {
  const { applicationId, documentId } = params;

  try {
    const { getDocumentStatus } = await import("./ghl");
    const docStatus = await getDocumentStatus(documentId);

    if (docStatus.status === "completed" || docStatus.status === "signed") {
      await storage.updateMerchantApplication(applicationId, {
        esignStatus: "signed",
        esignedAt: new Date(),
      });

      await storage.createAuditLog({
        action: "esign_verified_complete",
        entityType: "merchant_application",
        entityId: applicationId,
        details: { documentId, status: docStatus.status, signedAt: docStatus.signedAt },
      });

      return { verified: true, status: "signed" };
    }

    return { verified: false, status: docStatus.status };
  } catch (err) {
    console.error(`[GHL E-Sign] Verification failed for document ${documentId}:`, err);
    return { verified: false, status: "error" };
  }
}

export function getWorkflowMappings(): Record<string, GhlWorkflowMapping> {
  return { ...SEQUENCE_WORKFLOW_MAP };
}

export function getInboxSmartListTags(): Record<string, string> {
  return { ...INBOX_SMART_LIST_TAGS };
}

export function getEnrollmentStatus(): {
  ghlConfigured: boolean;
  sdrGhlConfigured: boolean;
  ghlWorkflowOnlyMode: boolean;
  totalMappedSequences: number;
  sequencesWithWorkflowIds: number;
  unmappedSequences: string[];
  hasInboundWorkflow: boolean;
  hasAppointmentWorkflow: boolean;
  hasDefaultWorkflow: boolean;
  platformEmailSeparation: {
    transactionalViaReplit: string[];
    marketingViaGhl: string[];
  };
  esignFlow: {
    platform: string;
    templateConfigured: boolean;
    webhookEndpoint: string;
  };
  workflowProvisioningNote: string;
} {
  const mappings = Object.values(SEQUENCE_WORKFLOW_MAP);
  const withIds = mappings.filter(m => resolveGhlWorkflowIdSync(m.sequenceName) !== null);
  const unmapped = mappings.filter(m => resolveGhlWorkflowIdSync(m.sequenceName) === null).map(m => m.sequenceName);

  return {
    ghlConfigured: isGhlConfigured(),
    sdrGhlConfigured: isSdrGhlConfigured(),
    ghlWorkflowOnlyMode: process.env.GHL_WORKFLOW_ONLY_MODE === "true",
    totalMappedSequences: mappings.length,
    sequencesWithWorkflowIds: withIds.length,
    unmappedSequences: unmapped,
    hasInboundWorkflow: !!process.env.GHL_WORKFLOW_INBOUND_CONFIRMATION,
    hasAppointmentWorkflow: !!process.env.GHL_WORKFLOW_APPOINTMENT,
    hasDefaultWorkflow: !!process.env.GHL_DEFAULT_WORKFLOW_ID,
    workflowProvisioningNote: "GHL workflows must be created in the GHL UI (GoHighLevel does not expose a public workflow creation API). Configure workflow IDs via GHL_WORKFLOW_<SEQUENCE_NAME> environment variables. Set GHL_WORKFLOW_ONLY_MODE=true to disable direct sends and enforce GHL-native delivery.",
    platformEmailSeparation: {
      transactionalViaReplit: [
        "Password reset emails",
        "Email verification / account confirmation",
        "Account notification emails (security alerts, plan changes)",
        "System error notifications",
        "Admin-only internal alerts",
      ],
      marketingViaGhl: [
        "SDR outreach sequences (all verticals)",
        "Inbound lead confirmation and nurture",
        "Appointment confirmations and reminders",
        "Proposal follow-ups",
        "Post-call review summaries",
        "Long-term nurture drips",
        "Reactivation campaigns",
        "Account management operations emails",
      ],
    },
    esignFlow: {
      platform: "GHL Documents / E-Sign",
      templateConfigured: !!process.env.GHL_MERCHANT_AGREEMENT_TEMPLATE_ID,
      webhookEndpoint: "/api/webhooks/ghl-document",
    },
  };
}

function buildInboundConfirmationEmail(firstName: string, companyName: string, formType: string, bookingLink: string): string {
  const formTypeLabels: Record<string, string> = {
    statement_upload: "uploading your processing statement",
    estimate: "requesting a savings estimate",
    get_started: "getting started with Liberty Bancard",
    support: "reaching out to our support team",
    callback: "requesting a callback",
  };
  const action = formTypeLabels[formType] || "connecting with us";

  return `<p>Hi ${firstName},</p>
<p>Thanks for ${action}! We're glad you reached out.</p>
<p>Here's what happens next:</p>
<ol>
  <li>Our team will review your information (usually within a few hours)</li>
  <li>We'll prepare a personalized analysis for ${companyName}</li>
  <li>A team member will follow up with your results and recommendations</li>
</ol>
<p>Want to skip the wait? Book a call directly with our team:</p>
<p><a href="${bookingLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Call Now</a></p>
<p>In the meantime, feel free to reply to this email with any questions.</p>
<p>— Liberty Bancard Team</p>
<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;
}

function buildInbound24hFollowupEmail(firstName: string, bookingLink: string): string {
  return `<p>Hi ${firstName},</p>
<p>Just checking in — we received your information yesterday and wanted to make sure you saw our follow-up.</p>
<p>If you haven't had a chance to book a call yet, here's the link:</p>
<p><a href="${bookingLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Schedule Your Free Review</a></p>
<p>Most merchants we work with are surprised by what we find — and the review only takes about 10 minutes.</p>
<p>No obligation, no pressure. Just clarity on what you're paying.</p>
<p>— Liberty Bancard Team</p>
<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;
}

function buildAppointmentConfirmationEmail(firstName: string, dateStr: string, calendarType: string): string {
  const teamLabel = calendarType === "account_management" ? "your Account Manager" : "our sales team";
  return `<p>Hi ${firstName},</p>
<p>Your call with ${teamLabel} is confirmed for:</p>
<p style="font-size:18px;font-weight:600;color:#1a56db;">${dateStr} (Eastern Time)</p>
<p>What to expect:</p>
<ul>
  <li>A friendly, no-pressure conversation about your payment processing</li>
  <li>If you have a recent statement, we can do a live line-by-line review</li>
  <li>We'll answer any questions you have about pricing, hardware, or switching</li>
</ul>
<p>If you need to reschedule, just reply to this email and we'll find another time.</p>
<p>Looking forward to speaking with you!</p>
<p>— Liberty Bancard Team</p>
<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;
}

function buildAppointmentReminderEmail(firstName: string, dateStr: string, timing: string): string {
  return `<p>Hi ${firstName},</p>
<p>Just a friendly reminder — your call with Liberty Bancard is ${timing === "24h" ? "tomorrow" : "coming up soon"}:</p>
<p style="font-size:16px;font-weight:600;color:#1a56db;">${dateStr} (Eastern Time)</p>
<p>If you have a recent processing statement handy, bring it along — we can review it live on the call.</p>
<p>See you then!</p>
<p>— Liberty Bancard Team</p>`;
}

function buildPostMeetingFollowupEmail(firstName: string, calendarType: string, rebookLink: string): string {
  return `<p>Hi ${firstName},</p>
<p>Thanks for taking the time to connect with us today. We hope the conversation was helpful!</p>
<p>As a quick recap, here are the next steps we discussed:</p>
<ul>
  <li>We'll finalize the analysis based on our conversation</li>
  <li>You'll receive a detailed savings breakdown within 24 hours</li>
  <li>If you have any additional documents to share, just reply to this email</li>
</ul>
<p>If you'd like to schedule a follow-up call to review the results:</p>
<p><a href="${rebookLink}" style="display:inline-block;background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Book a Follow-Up</a></p>
<p>Thanks again — we're looking forward to helping you!</p>
<p>— Liberty Bancard Team</p>
<p style="font-size:11px;color:#888;margin-top:24px;">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>`;
}
