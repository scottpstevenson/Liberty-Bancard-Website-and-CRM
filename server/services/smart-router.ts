import { storage } from "../storage";
import type { Contact } from "@shared/schema";

interface RoutingResult {
  sequenceIds: number[];
  sequenceNames: string[];
  reason: string;
  complianceBlocked: boolean;
  complianceReason?: string;
}

interface RoutingRule {
  verticals: string[];
  minScore: number;
  maxScore: number;
  painKeywords: string[];
  sequenceKeywords: string[];
  volumeMin?: string;
  priority: number;
}

const ROUTING_RULES: RoutingRule[] = [
  // ── Vertical-specific rules (prefer V-series sequences) ──────────────────
  { verticals: ["Restaurant", "Food/Beverage", "Food & Beverage"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["restaurant", "retail merchants", "switch & save"], volumeMin: undefined, priority: 10 },
  { verticals: ["Retail"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-retail", "retail"], volumeMin: undefined, priority: 10 },
  { verticals: ["Automotive", "Auto", "Auto Repair"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-auto repair", "v-auto", "auto repair", "auto merchants"], volumeMin: undefined, priority: 10 },
  { verticals: ["Salon/Spa", "Salon", "Spa"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-salon", "salon"], volumeMin: undefined, priority: 11 },
  { verticals: ["Med Spa", "Medspa", "Medical Spa", "Aesthetic"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-med spa", "med spa"], volumeMin: undefined, priority: 12 },
  { verticals: ["Medical/Dental/Medspa", "Healthcare", "Medical"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-medical", "medical"], volumeMin: undefined, priority: 12 },
  { verticals: ["Dental", "Dentist", "Chiropractic"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-dental", "dental"], volumeMin: undefined, priority: 12 },
  { verticals: ["Gym", "Fitness", "Fitness/Recreation"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-gym", "gym"], volumeMin: undefined, priority: 10 },
  { verticals: ["Hotel", "Hospitality"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-hotel", "hotel"], volumeMin: undefined, priority: 10 },
  { verticals: ["Landscaping", "Cleaning Services"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-landscaping", "landscaping"], volumeMin: undefined, priority: 10 },
  { verticals: ["Construction", "Contractor"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-construction", "construction"], volumeMin: undefined, priority: 10 },
  { verticals: ["Legal", "Professional Services", "Accounting"], minScore: 50, maxScore: 100, painKeywords: [], sequenceKeywords: ["v-legal", "legal"], volumeMin: undefined, priority: 10 },

  // ── Pain-point rules (cross-vertical, score-gated) ───────────────────────
  { verticals: [], minScore: 70, maxScore: 100, painKeywords: ["high_rates", "rate_increase", "rates_too_high"], sequenceKeywords: ["switch", "save", "rate"], volumeMin: undefined, priority: 8 },
  { verticals: [], minScore: 70, maxScore: 100, painKeywords: ["chargeback", "dispute"], sequenceKeywords: ["chargeback", "defense"], volumeMin: undefined, priority: 8 },
  { verticals: [], minScore: 70, maxScore: 100, painKeywords: ["slow_funding"], sequenceKeywords: ["funding", "speed"], volumeMin: undefined, priority: 8 },
  { verticals: [], minScore: 45, maxScore: 100, painKeywords: ["technology", "terminal", "equipment"], sequenceKeywords: ["terminal", "pos", "smart"], volumeMin: undefined, priority: 7 },

  // ── Score-bucket fallbacks ────────────────────────────────────────────────
  { verticals: [], minScore: 70, maxScore: 100, painKeywords: [], sequenceKeywords: ["fast approval", "quick"], volumeMin: undefined, priority: 5 },
  { verticals: [], minScore: 45, maxScore: 69, painKeywords: [], sequenceKeywords: ["trust", "trust builder", "payment stack"], volumeMin: undefined, priority: 5 },
  { verticals: [], minScore: 20, maxScore: 44, painKeywords: [], sequenceKeywords: ["reactivation", "nurture"], volumeMin: undefined, priority: 3 },
  { verticals: [], minScore: 0, maxScore: 19, painKeywords: [], sequenceKeywords: ["referral", "nurture"], volumeMin: undefined, priority: 1 },
];

function checkCompliance(contact: Contact): { allowed: boolean; reason?: string; channelsAllowed: string[] } {
  const channelsAllowed: string[] = [];

  if (contact.doNotContact) {
    return { allowed: false, reason: "Contact flagged as Do Not Contact", channelsAllowed: [] };
  }

  if (contact.coolingUntil && new Date(contact.coolingUntil) > new Date()) {
    return { allowed: false, reason: `Contact in cooling period until ${new Date(contact.coolingUntil).toLocaleDateString()}`, channelsAllowed: [] };
  }

  if (contact.contactAttempts && contact.contactAttempts >= 10) {
    const lastContact = contact.lastContactedAt ? new Date(contact.lastContactedAt) : null;
    const daysSinceContact = lastContact ? (Date.now() - lastContact.getTime()) / 86400000 : 999;
    if (daysSinceContact < 30) {
      return { allowed: false, reason: "Contact attempt limit reached (10 in 30 days). Cooling required.", channelsAllowed: [] };
    }
  }

  if (contact.consentEmail !== false) {
    channelsAllowed.push("email");
  }

  if (contact.consentSms && contact.smsOptInAt) {
    channelsAllowed.push("sms");
  }

  channelsAllowed.push("task");
  channelsAllowed.push("call_reminder");

  if (channelsAllowed.length === 0) {
    return { allowed: false, reason: "No communication channels consented", channelsAllowed: [] };
  }

  return { allowed: true, channelsAllowed };
}

function matchSequenceToRules(
  contact: Contact,
  sequences: { id: number; name: string; triggerType: string; status: string | null }[]
): { sequenceId: number; sequenceName: string; reason: string }[] {
  const score = contact.leadScore || 0;
  const vertical = contact.vertical || "Other";
  const painPoints = contact.painPoints || [];
  const painTags = (contact.tags || []).filter(t => t?.startsWith("pain_")).map(t => t!.replace("pain_", ""));
  const allPainsSet = new Set([...painPoints, ...painTags]);
  const allPains = Array.from(allPainsSet).map(p => p.toLowerCase().replace(/\s+/g, "_"));

  const matched: { sequenceId: number; sequenceName: string; reason: string; priority: number }[] = [];

  for (const rule of ROUTING_RULES) {
    const verticalMatch = rule.verticals.length === 0 || rule.verticals.some(v => vertical.toLowerCase().includes(v.toLowerCase()));
    const scoreMatch = score >= rule.minScore && score <= rule.maxScore;

    if (!verticalMatch || !scoreMatch) continue;

    const painMatch = rule.painKeywords.length === 0 || rule.painKeywords.some(p => allPains.some(ap => ap.includes(p)));
    if (!painMatch && rule.painKeywords.length > 0) continue;

    for (const seq of sequences) {
      if (seq.status !== "active") continue;
      const seqName = seq.name.toLowerCase();

      const keywordMatch = rule.sequenceKeywords.some(kw => seqName.includes(kw.toLowerCase()));
      if (!keywordMatch) continue;

      if (!matched.some(m => m.sequenceId === seq.id)) {
        let reason = "";
        if (rule.verticals.length > 0) reason = `Vertical match: ${vertical}. `;
        if (rule.painKeywords.length > 0) reason += `Pain match: ${rule.painKeywords.join(", ")}. `;
        reason += `Score ${score}/100 (${score >= 70 ? "hot" : score >= 45 ? "warm" : "cold"}).`;

        matched.push({
          sequenceId: seq.id,
          sequenceName: seq.name,
          reason: reason.trim(),
          priority: rule.priority,
        });
      }
    }
  }

  matched.sort((a, b) => b.priority - a.priority);
  return matched.slice(0, 3).map(m => ({ sequenceId: m.sequenceId, sequenceName: m.sequenceName, reason: m.reason }));
}

export async function routeContact(contactId: number): Promise<RoutingResult> {
  const contact = await storage.getContact(contactId);
  if (!contact) {
    return { sequenceIds: [], sequenceNames: [], reason: "Contact not found", complianceBlocked: false };
  }

  const { evaluateContactability } = await import("./contactability");
  const contactability = await evaluateContactability({
    contactId,
    channel: "email",
    campaignType: "smart_router_enrollment",
    mode: "enforcement",
  });
  if (!contactability.allowed) {
    return {
      sequenceIds: [],
      sequenceNames: [],
      reason: contactability.reason || "Contactability blocked",
      complianceBlocked: true,
      complianceReason: contactability.reason,
    };
  }

  const allSequences = await storage.getFollowUpSequences();
  const matches = matchSequenceToRules(contact, allSequences);

  if (matches.length === 0) {
    return {
      sequenceIds: [],
      sequenceNames: [],
      reason: "No matching sequences found for this lead profile",
      complianceBlocked: false,
    };
  }

  const enrolledIds: number[] = [];
  const enrolledNames: string[] = [];
  const existing = await storage.getContactEnrollments(contactId);

  for (const match of matches) {
    const alreadyEnrolled = existing.some(
      e => e.sequenceId === match.sequenceId && (e.status === "active" || e.status === "completed")
    );
    if (alreadyEnrolled) continue;

    const steps = await storage.getSequenceSteps(match.sequenceId);
    const firstStep = steps.find(s => s.stepOrder === 1) || steps[0];
    const delayMs = firstStep
      ? ((firstStep.delayDays || 0) * 86400000) + ((firstStep.delayHours || 0) * 3600000)
      : 0;

    const contactDeals = await storage.getDealsByContact(contactId);
    const dealId = contactDeals[0]?.id;

    await storage.createSequenceEnrollment({
      sequenceId: match.sequenceId,
      contactId,
      dealId,
      status: "active",
      currentStep: 0,
      nextActionAt: new Date(Date.now() + Math.max(delayMs, 1000)),
    });

    await storage.createAuditLog({
      action: "smart_route_enrolled",
      entityType: "contact",
      entityId: contactId,
      details: {
        sequenceId: match.sequenceId,
        sequenceName: match.sequenceName,
        reason: match.reason,
        leadScore: contact.leadScore,
        vertical: contact.vertical,
      },
    });

    enrolledIds.push(match.sequenceId);
    enrolledNames.push(match.sequenceName);
  }

  return {
    sequenceIds: enrolledIds,
    sequenceNames: enrolledNames,
    reason: matches.map(m => m.reason).join(" | "),
    complianceBlocked: false,
  };
}

export async function getRoutingRecommendation(contactId: number): Promise<{
  recommendations: { sequenceName: string; reason: string }[];
  complianceStatus: { allowed: boolean; reason?: string; channelsAllowed: string[] };
  currentEnrollments: { sequenceName: string; status: string }[];
}> {
  const contact = await storage.getContact(contactId);
  if (!contact) {
    return { recommendations: [], complianceStatus: { allowed: false, reason: "Contact not found", channelsAllowed: [] }, currentEnrollments: [] };
  }

  const compliance = checkCompliance(contact);
  const allSequences = await storage.getFollowUpSequences();
  const matches = matchSequenceToRules(contact, allSequences);

  const enrollments = await storage.getContactEnrollments(contactId);
  const currentEnrollments = await Promise.all(
    enrollments.filter(e => e.status === "active").map(async e => {
      const seq = allSequences.find(s => s.id === e.sequenceId);
      return { sequenceName: seq?.name || `Sequence #${e.sequenceId}`, status: e.status || "unknown" };
    })
  );

  return {
    recommendations: matches.map(m => ({ sequenceName: m.sequenceName, reason: m.reason })),
    complianceStatus: compliance,
    currentEnrollments,
  };
}

export { checkCompliance };
