import type { SdrLeadState } from "@shared/schema";

export interface VoiceScript {
  verticalKey: string;
  verticalLabel: string;
  opening: string;
  qualifyingQuestions: string[];
  valuePitch: string;
  close: string;
  objectionHandlers: Record<string, string>;
  complianceDisclosure: string;
  gatekeeperScript?: string;
  meetingOffer: string;
}

const FL_AUTO_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_auto",
  verticalLabel: "Florida Auto Repair",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We work with Florida repair shops on card processing costs, especially on bigger repair tickets. Who handles your merchant services?",
  qualifyingQuestions: [
    "Who is your current processor?",
    "What's your approximate monthly card volume?",
    "What's your biggest frustration with your current setup?",
    "Are you currently using text-to-pay or financing for larger tickets?",
  ],
  valuePitch: "We specialize in helping Florida auto shops lower their effective processing cost, set up text-to-pay for customer convenience, and reduce chargebacks on big-ticket repairs. Most shops we work with save between $200 and $500 a month.",
  close: "We do a free 10-minute statement review that usually finds $200-500/month in savings. Can I send you a link to upload your latest statement?",
  objectionHandlers: {
    "happy_with_current": "Totally fair — most shops we work with thought the same thing until they saw a line-by-line breakdown. Even if you don't switch, you'll know exactly what you're paying and whether it's competitive.",
    "too_busy": "I completely understand. The review takes less than 10 minutes and we do all the work. I can send a secure upload link and have results back to you within 24 hours.",
    "under_contract": "No problem. Most contracts have already rolled to month-to-month without the owner knowing. We can check that for you too — takes 2 minutes.",
    "rates_are_fine": "That's great to hear. But rates are only part of the picture — most overpayment we find is in junk fees and downgrades, not the advertised rate. The review covers all of that.",
    "not_the_decision_maker": "No worries — who would be the best person to speak with about this? I can call back at a time that works for them.",
    "send_info_by_email": "Absolutely. What's the best email address? I'll send over a quick summary and a link for the free statement review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company. This is a business solicitation call. Florida surcharging applies to credit only, requires disclosure, signage, receipt language, and 30-day notice to acquirer per card brand rules.",
  meetingOffer: "Merchant statement review — a free 10-minute review of your latest processing statement to find hidden fees and savings opportunities.",
};

const FL_MEDSPA_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_medspa",
  verticalLabel: "Florida Med Spa",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We work with Florida med spas on membership billing, deposits, and payment experience. Is the owner or practice manager available?",
  qualifyingQuestions: [
    "Are you currently offering memberships or treatment packages?",
    "What's your current card-on-file process for appointments?",
    "Are you dealing with no-show issues?",
    "Who is your current processor and how long have you been with them?",
  ],
  valuePitch: "We help med spas build a payment workflow that supports recurring memberships, protects against no-shows with card-on-file and deposit policies, and offers patient financing for higher-ticket procedures like body contouring and injectable packages. It's not about commodity processing — it's about your revenue workflow.",
  close: "We do a complimentary payment workflow review that usually uncovers $300-800/month in savings or revenue opportunities. Can I send you the details?",
  objectionHandlers: {
    "happy_with_current": "That's great. Our review isn't about switching processors — it's about your entire payment workflow. Memberships, deposits, financing, checkout experience. Most practices find at least one area to improve.",
    "too_busy": "Totally understand — practice owners are always busy. The review is 10 minutes and we can do it over a quick call or even email. I'll send a link and you can book whenever works.",
    "not_interested": "No problem at all. Can I ask — are you currently offering memberships? Most med spas we talk to find that's where the biggest revenue opportunity is, and the payment side is often the bottleneck.",
    "already_have_memberships": "Perfect — then this review is especially relevant. We'd look at your churn rate, failed payment handling, and whether card updater is set up properly. Those three things alone usually recover thousands per year.",
    "not_the_decision_maker": "Understood — is the owner or practice manager available? Or can I leave a message with the best time to reach them?",
    "send_info_by_email": "Happy to. What's the best email for the owner or practice manager? I'll send a quick summary of what we cover in the review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company specializing in aesthetic and medical practices. This is a business solicitation call.",
  meetingOffer: "Membership/recurring billing review — a complimentary review of your payment workflow including memberships, deposits, card-on-file, and patient financing.",
};

const FL_MEDICAL_VOICE_SCRIPT: VoiceScript = {
  verticalKey: "fl_medical",
  verticalLabel: "Florida Medical (Dental, Chiro, PT, Urgent Care)",
  gatekeeperScript: "We help Florida medical practices improve patient payment flow — things like text-to-pay, payment plans, and front-desk collections. Who handles payment systems or merchant services there?",
  opening: "Hi, this is {{agentName}} with Liberty Bancard. We help Florida medical practices improve patient payment flow — text-to-pay, payment plans, and front-desk collections. Who handles payment systems there?",
  qualifyingQuestions: [
    "What does your current patient payment collection process look like?",
    "Are you offering payment plans for larger balances?",
    "Do you currently use text-to-pay for patient balances?",
    "What's the biggest frustration for your front desk around payments?",
  ],
  valuePitch: "We help medical practices collect patient payments faster with text-to-pay, structured payment plans, and card-on-file — all without adding front-desk complexity. Our practices typically see a significant reduction in outstanding balances and manual collection work.",
  close: "We do a free patient collections review that usually finds ways to speed up payments and reduce manual work. Can I send you the details?",
  objectionHandlers: {
    "hipaa_concern": "Great question. We don't access any patient health information — we only handle the payment side. Our systems are PCI-compliant and we never touch PHI. We're not a business associate under HIPAA for payment processing.",
    "too_busy": "I hear that from every practice — that's exactly why we focus on reducing front-desk workload. The review itself is 10 minutes and we do it by phone or email.",
    "have_a_billing_company": "That's common. We work alongside billing companies — they handle insurance, we handle the patient-pay side. Text-to-pay and payment plans are usually gaps that billing companies don't cover.",
    "happy_with_current": "That's fine. Can I ask — does your current processor offer text-to-pay for patient balances? That's usually the biggest gap we find, and it has nothing to do with rates.",
    "not_the_decision_maker": "Understood. We help with patient payment flow — text-to-pay, payment plans, and front-desk collections. Who handles payment systems or merchant services there?",
    "send_info_by_email": "Absolutely. What's the best email for whoever handles payment systems? I'll send a quick summary of the review.",
  },
  complianceDisclosure: "This is {{agentName}} calling from Liberty Bancard. We're a payment processing company specializing in medical practices. This is a business solicitation call. We do not access or store protected health information.",
  meetingOffer: "Patient collections review — a free review of your patient payment workflow including text-to-pay, payment plans, card-on-file, and front-desk efficiency.",
};

const VOICE_SCRIPTS: Record<string, VoiceScript> = {
  fl_auto: FL_AUTO_VOICE_SCRIPT,
  fl_medspa: FL_MEDSPA_VOICE_SCRIPT,
  fl_medical: FL_MEDICAL_VOICE_SCRIPT,
};

export function getVoiceScript(verticalKey: string): VoiceScript | null {
  return VOICE_SCRIPTS[verticalKey] || null;
}

export function getAllVoiceScripts(): VoiceScript[] {
  return Object.values(VOICE_SCRIPTS);
}

export function resolveVoiceScriptForLead(lead: SdrLeadState): VoiceScript | null {
  const vertical = (lead.vertical || "").toLowerCase();
  const state = (lead.state || "").toLowerCase();
  const isFlorida = state === "fl" || state === "florida";

  if (!isFlorida) return null;

  if (/auto|automotive|car|vehicle|mechanic|tire|collision|body shop|transmission|brake|repair/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_auto;
  }

  const hasMedSpaTerms = /med.?spa|medspa|aesthetic|beauty|salon/i.test(vertical);
  const hasClinicalTerms = /dental|dentist|chiro|optom|podiatr|dermat|urgent care|physical therapy|behavioral|healthcare|clinic/i.test(vertical);
  const hasMedicalPrimary = /^medical(?!.*spa)/i.test(vertical) || hasClinicalTerms;

  if (hasMedSpaTerms && !hasMedicalPrimary) {
    return VOICE_SCRIPTS.fl_medspa;
  }

  if (hasMedicalPrimary || /^medical/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_medical;
  }

  if (hasMedSpaTerms || /spa\b/i.test(vertical)) {
    return VOICE_SCRIPTS.fl_medspa;
  }

  return null;
}

export function personalizeVoiceScript(script: VoiceScript, lead: SdrLeadState, agentName: string = "a team member"): VoiceScript {
  const firstName = lead.ownerName?.split(" ")[0] || "there";
  const companyName = lead.companyName || "your business";

  function replaceVars(text: string): string {
    return text
      .replace(/\{\{agentName\}\}/g, agentName)
      .replace(/\{\{firstName\}\}/g, firstName)
      .replace(/\{\{companyName\}\}/g, companyName)
      .replace(/\{\{shopName\}\}/g, companyName)
      .replace(/\{\{spaName\}\}/g, companyName)
      .replace(/\{\{practiceName\}\}/g, companyName);
  }

  return {
    ...script,
    opening: replaceVars(script.opening),
    valuePitch: replaceVars(script.valuePitch),
    close: replaceVars(script.close),
    complianceDisclosure: replaceVars(script.complianceDisclosure),
    gatekeeperScript: script.gatekeeperScript ? replaceVars(script.gatekeeperScript) : undefined,
    qualifyingQuestions: script.qualifyingQuestions.map(replaceVars),
    objectionHandlers: Object.fromEntries(
      Object.entries(script.objectionHandlers).map(([k, v]) => [k, replaceVars(v)])
    ),
  };
}

export function buildGhlVoicePayload(script: VoiceScript, lead: SdrLeadState, agentName: string = "a team member"): Record<string, any> {
  const personalized = personalizeVoiceScript(script, lead, agentName);

  return {
    type: "outbound_call",
    vertical: personalized.verticalKey,
    script: {
      greeting: personalized.complianceDisclosure,
      opening: personalized.opening,
      gatekeeperScript: personalized.gatekeeperScript || null,
      qualifyingQuestions: personalized.qualifyingQuestions,
      valuePitch: personalized.valuePitch,
      close: personalized.close,
      objectionHandlers: personalized.objectionHandlers,
      meetingOffer: personalized.meetingOffer,
    },
    lead: {
      name: lead.ownerName || lead.companyName,
      company: lead.companyName,
      phone: lead.ownerPhone || lead.phone,
      vertical: lead.vertical,
      state: lead.state,
      city: lead.city,
    },
  };
}
