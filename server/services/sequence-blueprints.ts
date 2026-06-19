// Shared sequence blueprint data used by /api/sequences/list and the Google Doc append route

export const CATEGORY_GROUP: Record<string, string> = {
  inbound: "Inbound",
  sales: "Sales",
  onboarding: "Sales",
  reactivation: "Sales",
  nurture: "Sales",
  sdr: "Cold SDR",
  sdr_cold_outbound: "Cold SDR",
  sdr_reply_engaged: "Cold SDR",
  sdr_statement_chase: "Cold SDR",
  sdr_proposal_followup: "Cold SDR",
  sdr_noshow_recovery: "Cold SDR",
  operations: "Ops",
  education: "Ops",
};

export const CADENCE_MODEL: Record<string, string> = {
  inbound: "Immediate (< 15 min): Email + SMS -> 15-min Call Attempt 1 -> Voicemail Drop -> 2-hr Retry Call -> Retry Voicemail -> Day 1 Email -> Day 2 SMS -> Day 3 AI",
  sales: "Consultative (Days 1-10): Email/SMS days 1-5, Call + Voicemail drop day 6-10",
  onboarding: "Completion (Days 1-7): Task-driven escalation, calls at day 3 and day 7",
  reactivation: "Re-engagement (Days 1-14): Email/SMS days 1-7, Call + Voicemail day 10-14",
  nurture: "Long-term (Day 14+): Monthly call check-ins, educational emails, no voicemail",
  sdr: "SDR Vertical (Days 1-8): Email/SMS days 1-5, Call + Voicemail day 6-8",
  sdr_cold_outbound: "Cold Outbound (Days 1-12): Email/SMS days 1-7, Call + Voicemail days 8-10, exit day 12",
  sdr_reply_engaged: "Reply Follow-Up (Days 1-5): Immediate reply ack, escalating SDR follow-ups",
  sdr_statement_chase: "Statement Chase (Days 1-7): Multi-touch statement request with call on day 5",
  sdr_proposal_followup: "Proposal Follow-Up (Days 1-7): Decision-focused escalation, call on day 5",
  sdr_noshow_recovery: "No-Show Recovery (Days 1-5): Reschedule-focused sequence with call + voicemail day 3",
  operations: "Ops Check-In (Day 14+): Quarterly relationship touchpoints, call only (no voicemail)",
  education: "Education (Days 1-21): Content-driven, call check-in day 14, no voicemail",
};

export const BRANCHES: Record<string, Array<{ type: string; action: string }>> = {
  inbound: [
    { type: "Call Answered (any attempt)", action: "Remove from sequence -> update deal stage to Call Booked -> enroll in Inbound Nurture workflow" },
    { type: "Voicemail (attempt 1 or 2)", action: "Drop voicemail audio -> send follow-up SMS in 5 min -> schedule retry call or continue to Day 1 email" },
    { type: "No Answer (attempt 1)", action: "Wait 2 hours -> trigger retry call step (attempt 2)" },
    { type: "No Answer (attempt 2)", action: "Continue sequence to Day 1 email follow-up" },
  ],
  sales: [
    { type: "Call Answered", action: "Remove from sequence -> update deal stage -> notify assigned rep" },
    { type: "Voicemail", action: "Drop voicemail audio -> send follow-up SMS in 5 min" },
    { type: "No Answer", action: "Continue sequence to next step" },
  ],
  onboarding: [
    { type: "Call Answered", action: "Log call -> update deal stage to Application In Progress" },
    { type: "No Answer", action: "Continue sequence, escalate on day 7" },
  ],
  reactivation: [
    { type: "Call Answered", action: "Re-engage -> move to appropriate Sales or Inbound Nurture sequence" },
    { type: "Voicemail", action: "Drop voicemail audio -> follow-up SMS in 5 min" },
    { type: "No Answer", action: "Continue sequence" },
  ],
  nurture: [
    { type: "Call Answered", action: "Log call -> re-qualify -> move to Sales sequence if ready" },
    { type: "No Answer", action: "Continue nurture cadence (no voicemail for ops calls)" },
  ],
  sdr: [
    { type: "Call Answered", action: "Qualify prospect -> move to Inbound Nurture or book appointment" },
    { type: "Voicemail", action: "Drop voicemail audio -> follow-up SMS in 5 min" },
    { type: "No Answer", action: "Continue sequence to next step" },
  ],
  sdr_cold_outbound: [
    { type: "Call Answered", action: "Remove from sequence -> enroll in Inbound Nurture workflow" },
    { type: "Voicemail", action: "Drop voicemail audio -> follow-up SMS in 5 min" },
    { type: "No Answer", action: "Continue sequence; exit after day 12" },
  ],
  sdr_reply_engaged: [
    { type: "Appointment Booked", action: "Stop sequence -> move to appointment confirmation workflow" },
    { type: "Statement Sent", action: "Stop sequence -> enroll in Statement Chase" },
    { type: "No Response", action: "Continue sequence" },
  ],
  sdr_statement_chase: [
    { type: "Statement Received", action: "Stop sequence -> trigger statement review workflow" },
    { type: "No Response", action: "Escalate with call + voicemail on day 5" },
  ],
  sdr_proposal_followup: [
    { type: "Deal Closed", action: "Stop sequence -> move to Onboarding workflow" },
    { type: "Objection Raised", action: "Enroll in Objection Crusher sequence" },
    { type: "No Response", action: "Continue sequence" },
  ],
  sdr_noshow_recovery: [
    { type: "Appointment Rescheduled", action: "Stop sequence -> update calendar" },
    { type: "No Response", action: "Exit after day 5 with final DNC check" },
  ],
  operations: [
    { type: "Call Answered", action: "Log account health check -> update CRM notes" },
    { type: "No Answer", action: "Continue ops cadence (no voicemail for account calls)" },
  ],
  education: [
    { type: "Content Engaged", action: "Move to appropriate Sales sequence" },
    { type: "Call Answered", action: "Qualify for upgrade or referral opportunity" },
    { type: "No Answer", action: "Continue education cadence" },
  ],
};

export const EXIT_CONDITIONS: Record<string, string[]> = {
  inbound: [
    "Contact replies to any email or SMS -> stop sequence",
    "Appointment booked (LB-BOOKING-READY tag added) -> stop",
    "DNC / STOP reply received -> stop immediately",
  ],
  sales: [
    "Contact replies to any email or SMS -> stop sequence",
    "Appointment booked -> stop",
    "Deal stage moves to Proposal Sent or higher -> stop",
    "DNC / STOP reply -> stop immediately",
  ],
  onboarding: [
    "Application submitted -> stop sequence",
    "Merchant goes live (LB-LIVE tag) -> stop",
    "DNC / STOP -> stop immediately",
  ],
  reactivation: [
    "Contact re-engages (replies or books) -> move to Inbound Nurture",
    "DNC / STOP -> stop immediately",
  ],
  nurture: [
    "Contact re-engages -> move to Sales sequence",
    "Churned / DNC tag -> stop immediately",
  ],
  sdr: [
    "Reply received -> enroll in SDR Reply Engaged sequence",
    "Appointment booked -> stop",
    "DNC / STOP -> stop immediately",
  ],
  sdr_cold_outbound: [
    "Reply received -> enroll in SDR Reply Engaged sequence",
    "Appointment booked -> stop",
    "Statement received -> enroll in Statement Chase sequence",
    "DNC / STOP -> stop immediately",
    "No engagement after day 12 -> exit sequence",
  ],
  sdr_reply_engaged: [
    "Appointment booked -> stop",
    "Proposal sent -> enroll in SDR Proposal Follow-Up",
    "DNC / STOP -> stop immediately",
  ],
  sdr_statement_chase: [
    "Statement received -> stop and trigger Review workflow",
    "DNC / STOP -> stop immediately",
  ],
  sdr_proposal_followup: [
    "Deal closed (won or lost) -> stop",
    "DNC / STOP -> stop immediately",
  ],
  sdr_noshow_recovery: [
    "Appointment rescheduled -> stop",
    "DNC / STOP -> stop immediately",
  ],
  operations: [
    "Churn detected -> move to Reactivation sequence",
    "DNC / opt-out tag added -> stop immediately",
  ],
  education: [
    "Contact engages with content -> move to Sales sequence",
    "DNC / STOP -> stop immediately",
  ],
};

export const NODE_ORDER: Record<string, string[]> = {
  inbound: ["Immediate Email", "2-min SMS", "5-min SDR Task", "15-min Call Step", "Voicemail Drop (if VM)", "2-hr Retry Call", "Retry Voicemail Drop (if VM)", "Day 1 Email", "Day 2 SMS", "Day 3 AI Conversation"],
  sales: ["Day 1 Email", "Day 2 SMS", "Day 3 Task", "Day 5 Email", "Day 7 Call Step", "Day 7 Voicemail Drop", "Day 10 SMS"],
  onboarding: ["Immediate Email", "Day 1 Task", "Day 3 Call Step", "Day 5 SMS", "Day 7 Call Step"],
  reactivation: ["Day 1 Email", "Day 3 SMS", "Day 7 Email", "Day 10 Call Step", "Day 10 Voicemail Drop", "Day 14 SMS"],
  nurture: ["Day 14 Email", "Day 30 SMS", "Day 45 Call Step (no voicemail)", "Day 60 Email"],
  sdr: ["Day 1 Email", "Day 2 SMS", "Day 4 Email", "Day 6 Call Step", "Day 6 Voicemail Drop", "Day 8 SMS"],
  sdr_cold_outbound: ["Day 1 Email", "Day 3 SMS", "Day 5 Email", "Day 7 SMS", "Day 8 Call Step", "Day 8 Voicemail Drop", "Day 10 Email", "Day 12 Final SMS"],
  sdr_reply_engaged: ["Immediate Reply Ack SMS", "Day 1 Task", "Day 2 Email", "Day 3 Call Step", "Day 3 Voicemail Drop", "Day 5 Follow-Up SMS"],
  sdr_statement_chase: ["Day 1 SMS", "Day 2 Email", "Day 3 SMS", "Day 5 Call Step", "Day 5 Voicemail Drop", "Day 7 Final Email"],
  sdr_proposal_followup: ["Day 1 Email", "Day 2 SMS", "Day 3 Task", "Day 5 Call Step", "Day 5 Voicemail Drop", "Day 7 SMS"],
  sdr_noshow_recovery: ["Immediate Reschedule SMS", "Day 1 Email", "Day 2 SMS", "Day 3 Call Step", "Day 3 Voicemail Drop", "Day 5 Final SMS"],
  operations: ["Day 14 Task", "Day 30 Call Step (no voicemail)", "Day 60 Email", "Day 90 Call Step (no voicemail)"],
  education: ["Day 1 Email", "Day 5 SMS", "Day 10 Email", "Day 14 Call Step (no voicemail)", "Day 21 Email"],
};

export const NO_VOICEMAIL_CATEGORIES = new Set(["operations", "education", "nurture"]);

export interface RawSequence {
  id: string;
  name: string;
  category: string;
  trigger: string;
}

export interface SequenceEntry {
  id: string;
  name: string;
  category: string;
  groupLabel: string;
  cadenceModel: string;
  nodeOrder: string[];
  branches: Array<{ type: string; action: string }>;
  exitConditions: string[];
  hasVoicemail: boolean;
  trigger: string;
}

export const RAW_SEQUENCES: RawSequence[] = [
  { id: "inbound-confirmation", name: "Inbound Confirmation", category: "inbound", trigger: "Form submission or GHL webhook — tag LB-INBOUND-NEW added" },
  { id: "statement-audit", name: "1. Switch & Save — Statement Audit", category: "sales", trigger: "Statement uploaded — tag LB-STATEMENT-RECEIVED added" },
  { id: "free-analysis-followup", name: "20. Free Analysis Follow-Up", category: "sales", trigger: "Free analysis requested — tag LB-FREE-ANALYSIS added" },
  { id: "fast-approval", name: "3. Fast Approval — Application Completion", category: "onboarding", trigger: "Application started — tag LB-APPLICATION-STARTED added" },
  { id: "switch-and-save", name: "Switch & Save (Core Sales)", category: "sales", trigger: "Lead qualified for switch — tag LB-SWITCH-SAVE added" },
  { id: "trust-builder", name: "4. Trust Builder — Authority Sequence", category: "sales", trigger: "Prospect in consideration phase — tag LB-TRUST-BUILDER added" },
  { id: "funding-speed", name: "6. Funding Speed & Reliability", category: "sales", trigger: "Prospect interested in funding speed — tag LB-FUNDING-SPEED added" },
  { id: "surcharge-cash-discount", name: "9. Surcharge & Cash Discount — Compliance", category: "sales", trigger: "Prospect interested in surcharge/cash discount — tag LB-SURCHARGE added" },
  { id: "objection-crusher", name: "18. Objection Crusher — Overcome Hesitation", category: "sales", trigger: "Objection raised in pipeline — tag LB-OBJECTION added" },
  { id: "contract-escape", name: "17. Contract Escape — Switch Help", category: "sales", trigger: "Prospect locked in contract — tag LB-CONTRACT-ESCAPE added" },
  { id: "omnichannel", name: "15. Omnichannel — Online + In-Person", category: "sales", trigger: "Prospect needs omnichannel solution — tag LB-OMNICHANNEL added" },
  { id: "recurring-billing", name: "13. Recurring Billing — Subscription Merchants", category: "sales", trigger: "Recurring billing merchant identified — tag LB-RECURRING-BILLING added" },
  { id: "post-call-review", name: "Post-Call Review Follow-Up", category: "sales", trigger: "Call completed — deal stage updated to Call Booked or Review In Progress" },
  { id: "proposal-followup", name: "Proposal Follow-Up", category: "sales", trigger: "Proposal sent — deal stage updated to Proposal Sent" },
  { id: "no-show-reschedule", name: "No-Show Reschedule", category: "sales", trigger: "Appointment missed — tag LB-NOSHOW added" },
  { id: "long-term-nurture", name: "Long-Term Nurture", category: "nurture", trigger: "Lead inactive 30+ days — tag LB-NURTURE-LONGTERM added" },
  { id: "reactivation", name: "19. Reactivation — Cold Lead Revival", category: "reactivation", trigger: "Cold lead inactive 90+ days — tag LB-REACTIVATION added" },
  { id: "v-retail-sdr-outbound", name: "V-Retail: SDR Outbound Prospecting", category: "sdr", trigger: "Retail prospect identified — tag LB-SDR-RETAIL added" },
  { id: "v-retail-inbound-nurture", name: "V-Retail: Inbound Lead Nurture", category: "inbound", trigger: "Retail inbound lead — tag LB-INBOUND-RETAIL added" },
  { id: "v-retail-account-ops", name: "V-Retail: Account Management Ops", category: "operations", trigger: "Active retail merchant — monthly ops tag LB-OPS-RETAIL added" },
  { id: "v-auto-sdr-outbound", name: "V-Auto: SDR Outbound Prospecting", category: "sdr", trigger: "Auto dealer prospect — tag LB-SDR-AUTO added" },
  { id: "v-auto-inbound-nurture", name: "V-Auto: Inbound Lead Nurture", category: "inbound", trigger: "Auto inbound lead — tag LB-INBOUND-AUTO added" },
  { id: "v-auto-account-ops", name: "V-Auto: Account Management Ops", category: "operations", trigger: "Active auto merchant — monthly ops tag LB-OPS-AUTO added" },
  { id: "v-medical-sdr-outbound", name: "V-Medical: SDR Outbound Prospecting", category: "sdr", trigger: "Medical practice prospect — tag LB-SDR-MEDICAL added" },
  { id: "v-medical-inbound-nurture", name: "V-Medical: Inbound Lead Nurture", category: "inbound", trigger: "Medical inbound lead — tag LB-INBOUND-MEDICAL added" },
  { id: "v-medical-account-ops", name: "V-Medical: Account Management Ops", category: "operations", trigger: "Active medical merchant — monthly ops tag LB-OPS-MEDICAL added" },
  { id: "cold-outbound-medspa", name: "SDR: Cold Outbound — Med Spa", category: "sdr_cold_outbound", trigger: "Contact Tag Added = LB-COLD-MEDSPA" },
  { id: "v-medspa-sdr-outbound", name: "V-Med Spa: SDR Outbound Prospecting", category: "sdr", trigger: "Med Spa prospect identified — tag LB-SDR-MEDSPA added" },
  { id: "v-medspa-inbound-nurture", name: "V-Med Spa: Inbound Lead Nurture", category: "inbound", trigger: "Med Spa inbound — tag LB-INBOUND-MEDSPA added" },
  { id: "v-medspa-account-ops", name: "V-Med Spa: Account Management Ops", category: "operations", trigger: "Active med spa merchant — monthly ops tag LB-OPS-MEDSPA added" },
  { id: "v-dental-sdr-outbound", name: "V-Dental: SDR Outbound Prospecting", category: "sdr", trigger: "Dental practice prospect identified — tag LB-SDR-DENTAL added" },
  { id: "v-dental-inbound-nurture", name: "V-Dental: Inbound Lead Nurture", category: "inbound", trigger: "Dental inbound lead — tag LB-INBOUND-DENTAL added" },
  { id: "v-dental-account-ops", name: "V-Dental: Account Management Ops", category: "operations", trigger: "Active dental merchant — monthly ops tag LB-OPS-DENTAL added" },
  { id: "v-autorepair-sdr-outbound", name: "V-Auto Repair: SDR Outbound Prospecting", category: "sdr", trigger: "Auto repair shop prospect identified — tag LB-SDR-AUTOREPAIR added" },
  { id: "v-autorepair-inbound-nurture", name: "V-Auto Repair: Inbound Lead Nurture", category: "inbound", trigger: "Auto repair inbound lead — tag LB-INBOUND-AUTOREPAIR added" },
  { id: "v-autorepair-account-ops", name: "V-Auto Repair: Account Management Ops", category: "operations", trigger: "Active auto repair merchant — monthly ops tag LB-OPS-AUTOREPAIR added" },
  { id: "payment-stack-101", name: "2. Payment Stack 101 — Education", category: "education", trigger: "New merchant onboarded — tag LB-EDUCATION-PAYSTACK added" },
  { id: "pci-security", name: "16. Security & PCI Compliance — Made Easy", category: "education", trigger: "Merchant flagged for PCI education — tag LB-EDUCATION-PCI added" },
  { id: "sdr-reply-engaged", name: "SDR: Reply Engaged", category: "sdr_reply_engaged", trigger: "Prospect replied to cold outbound — tag LB-SDR-REPLY-ENGAGED added" },
  { id: "sdr-statement-chase", name: "SDR: Statement Chase", category: "sdr_statement_chase", trigger: "Prospect agreed to send statement — tag LB-SDR-STATEMENT-CHASE added" },
  { id: "sdr-proposal-followup", name: "SDR: Proposal Follow-Up", category: "sdr_proposal_followup", trigger: "SDR proposal sent — tag LB-SDR-PROPOSAL added" },
  { id: "sdr-noshow-recovery", name: "SDR: No-Show Recovery", category: "sdr_noshow_recovery", trigger: "SDR appointment missed — tag LB-SDR-NOSHOW added" },
  { id: "cold-outbound-dental", name: "SDR: Cold Outbound — Dental", category: "sdr_cold_outbound", trigger: "Contact Tag Added = LB-COLD-DENTAL" },
  { id: "cold-outbound-auto-repair", name: "SDR: Cold Outbound — Auto Repair", category: "sdr_cold_outbound", trigger: "Contact Tag Added = LB-COLD-AUTO-REPAIR" },
  { id: "v-salon-sdr-outbound", name: "V-Salon: SDR Outbound Prospecting", category: "sdr", trigger: "Salon/beauty prospect identified — tag LB-SDR-SALON added" },
  { id: "v-salon-inbound-nurture", name: "V-Salon: Inbound Lead Nurture", category: "inbound", trigger: "Salon inbound lead — tag LB-INBOUND-SALON added" },
  { id: "v-salon-account-ops", name: "V-Salon: Account Management Ops", category: "operations", trigger: "Active salon merchant — monthly ops tag LB-OPS-SALON added" },
  { id: "v-gym-sdr-outbound", name: "V-Gym: SDR Outbound Prospecting", category: "sdr", trigger: "Gym/fitness prospect identified — tag LB-SDR-GYM added" },
  { id: "v-gym-inbound-nurture", name: "V-Gym: Inbound Lead Nurture", category: "inbound", trigger: "Gym inbound lead — tag LB-INBOUND-GYM added" },
  { id: "v-gym-account-ops", name: "V-Gym: Account Management Ops", category: "operations", trigger: "Active gym merchant — monthly ops tag LB-OPS-GYM added" },
  { id: "v-hotel-sdr-outbound", name: "V-Hotel: SDR Outbound Prospecting", category: "sdr", trigger: "Hotel/hospitality prospect identified — tag LB-SDR-HOTEL added" },
  { id: "v-hotel-inbound-nurture", name: "V-Hotel: Inbound Lead Nurture", category: "inbound", trigger: "Hotel inbound lead — tag LB-INBOUND-HOTEL added" },
  { id: "v-hotel-account-ops", name: "V-Hotel: Account Management Ops", category: "operations", trigger: "Active hotel merchant — monthly ops tag LB-OPS-HOTEL added" },
  { id: "v-landscaping-sdr-outbound", name: "V-Landscaping: SDR Outbound Prospecting", category: "sdr", trigger: "Landscaping prospect identified — tag LB-SDR-LANDSCAPING added" },
  { id: "v-landscaping-inbound-nurture", name: "V-Landscaping: Inbound Lead Nurture", category: "inbound", trigger: "Landscaping inbound lead — tag LB-INBOUND-LANDSCAPING added" },
  { id: "v-landscaping-account-ops", name: "V-Landscaping: Account Management Ops", category: "operations", trigger: "Active landscaping merchant — monthly ops tag LB-OPS-LANDSCAPING added" },
  { id: "v-construction-sdr-outbound", name: "V-Construction: SDR Outbound Prospecting", category: "sdr", trigger: "Construction/trades prospect identified — tag LB-SDR-CONSTRUCTION added" },
  { id: "v-construction-inbound-nurture", name: "V-Construction: Inbound Lead Nurture", category: "inbound", trigger: "Construction inbound lead — tag LB-INBOUND-CONSTRUCTION added" },
  { id: "v-construction-account-ops", name: "V-Construction: Account Management Ops", category: "operations", trigger: "Active construction merchant — monthly ops tag LB-OPS-CONSTRUCTION added" },
  { id: "v-legal-sdr-outbound", name: "V-Legal: SDR Outbound Prospecting", category: "sdr", trigger: "Legal/professional services prospect identified — tag LB-SDR-LEGAL added" },
  { id: "v-legal-inbound-nurture", name: "V-Legal: Inbound Lead Nurture", category: "inbound", trigger: "Legal inbound lead — tag LB-INBOUND-LEGAL added" },
  { id: "v-legal-account-ops", name: "V-Legal: Account Management Ops", category: "operations", trigger: "Active legal/professional services merchant — monthly ops tag LB-OPS-LEGAL added" },
];

export function buildSequenceList(): SequenceEntry[] {
  return RAW_SEQUENCES.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    groupLabel: CATEGORY_GROUP[s.category] || "Other",
    cadenceModel: CADENCE_MODEL[s.category] || "Custom cadence — see AI Workflow Prompts tab",
    nodeOrder: NODE_ORDER[s.category] || [],
    branches: BRANCHES[s.category] || BRANCHES.sales,
    exitConditions: EXIT_CONDITIONS[s.category] || EXIT_CONDITIONS.sales,
    hasVoicemail: !NO_VOICEMAIL_CATEGORIES.has(s.category),
    trigger: s.trigger,
  }));
}

// Parity check utility — validates that a client-side sequence ID set matches RAW_SEQUENCES
// Usage: call validateSequenceIdParity(SEQUENCE_PROMPTS.map(s => s.id)) at startup or in tests
// to catch drift between ghl-workflow-prompts.ts and this server-side blueprint registry.
export function validateSequenceIdParity(clientIds: string[]): { missing: string[]; extra: string[] } {
  const serverIds = new Set(RAW_SEQUENCES.map(s => s.id));
  const clientSet = new Set(clientIds);
  const missing = [...clientSet].filter(id => !serverIds.has(id));
  const extra = [...serverIds].filter(id => !clientSet.has(id));
  if (missing.length > 0 || extra.length > 0) {
    console.warn("[sequence-blueprints] ID parity mismatch detected:", { missing, extra });
  }
  return { missing, extra };
}
