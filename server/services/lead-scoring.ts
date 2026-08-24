import { storage } from "../storage";
import type { Contact, Deal, EmailLog, CallLog, SequenceEnrollment } from "@shared/schema";
import { sendCriticalEmailNotification, createPreferenceAwareNotification } from "./digest-service";
import { updateContactLocalFirst } from "./contact-writer";

/**
 * Contact fields directly consumed by applyScoringInputs() for revenue potential,
 * switchability, underwriting confidence, and quiz bonus calculations.
 *
 * Future event-trigger scope (not wired in this task):
 *  - deals table: riskTier, statementReceived, totalVolume
 *  - emailLogs table: repliedAt, openedAt
 *  - callLogs table: outcome
 *  - sequenceEnrollments table: contactId (presence = in-sequence signal)
 */
export const LEAD_SCORING_DEPENDENT_FIELDS: Array<keyof Contact> = [
  "monthlyVolume",
  "vertical",
  "locationCount",
  "currentProvider",
  "contractStatus",
  "lookingReason",
  "painPoints",
  "businessAge",
  "offerRoutingSource",
  "offerConfidence",
  "tags",
];

interface ScoreBreakdown {
  revPotential: { score: number; max: 30; factors: Record<string, number> };
  switchability: { score: number; max: 25; factors: Record<string, number> };
  uwConfidence: { score: number; max: 25; factors: Record<string, number> };
  engagement: { score: number; max: 20; factors: Record<string, number> };
  quizBonus?: { score: number; max: 20; factors: Record<string, number> };
  total: number;
  tier: "hot" | "warm" | "cold" | "unqualified";
  summary: string;
}

const VOLUME_SCORES: Record<string, number> = {
  "Under $10K": 3,
  "$10K-$25K": 8,
  "$25K-$50K": 14,
  "$50K-$100K": 20,
  "$100K-$250K": 25,
  "$250K-$500K": 28,
  "$500K+": 30,
  "$500K-$1M": 30,
  "$1M+": 30,
};

const VERTICAL_REVENUE_MULTIPLIER: Record<string, number> = {
  "Restaurant": 1.2,
  "Medical/Dental/Medspa": 1.15,
  "Retail": 1.1,
  "Automotive": 1.05,
  "Home Services": 0.95,
  "Salon/Spa": 0.9,
  "Professional Services": 0.85,
  "E-commerce": 0.8,
  "Other": 0.75,
};

const SWITCHABLE_PROCESSORS: Record<string, number> = {
  "square": 22,
  "stripe": 20,
  "toast": 15,
  "clover": 18,
  "paypal": 20,
  "shopify payments": 18,
  "bank of america": 16,
  "chase paymentech": 14,
  "wells fargo": 14,
  "worldpay": 12,
  "first data": 12,
  "heartland": 10,
  "paysafe": 15,
  "elavon": 13,
  "tsys": 11,
  "other": 14,
  "none": 25,
  "cash only": 25,
  "unknown": 10,
};

const PAIN_SCORES: Record<string, number> = {
  "high_rates": 5,
  "poor_service": 4,
  "slow_funding": 5,
  "chargebacks": 3,
  "contract_ending": 5,
  "rate_increase": 5,
  "technology": 3,
  "security_concerns": 2,
  "growth": 3,
  "switching_costs": -2,
};

const CONTRACT_STATUS_SCORES: Record<string, number> = {
  "month_to_month": 8,
  "no_contract": 8,
  "contract_ending": 6,
  "1_year_left": 3,
  "2_years_left": 1,
  "3_years_plus": -2,
  "locked_with_etf": -3,
  "unknown": 2,
};

const LOOKING_REASON_SCORES: Record<string, number> = {
  "rates_too_high": 5,
  "rate_increase": 5,
  "poor_customer_service": 4,
  "slow_funding": 5,
  "chargeback_issues": 3,
  "need_new_equipment": 3,
  "referral": 4,
  "proactive_shopping": 3,
  "reactive_problem": 5,
  "contract_ending": 4,
  "new_business": 3,
  "unknown": 1,
};

const VERTICAL_RISK: Record<string, number> = {
  "Restaurant": 22,
  "Retail": 20,
  "Medical/Dental/Medspa": 23,
  "Automotive": 18,
  "Home Services": 16,
  "Salon/Spa": 19,
  "Professional Services": 21,
  "E-commerce": 12,
  "Other": 15,
};

function normalizeProcessor(provider: string | null | undefined): string {
  if (!provider) return "unknown";
  const p = provider.toLowerCase().trim();
  for (const key of Object.keys(SWITCHABLE_PROCESSORS)) {
    if (p.includes(key)) return key;
  }
  return "other";
}

function calculateRevenuePotential(contact: Contact, deal: Deal | null): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  let score = 0;

  const volume = contact.monthlyVolume || deal?.totalVolume || "";
  let volumeScore = 0;
  for (const [range, pts] of Object.entries(VOLUME_SCORES)) {
    if (volume.toLowerCase().includes(range.toLowerCase().replace("$", "").replace("+", ""))) {
      volumeScore = pts;
      break;
    }
  }
  if (volumeScore === 0 && volume) {
    const numMatch = volume.replace(/[^0-9.]/g, "");
    const num = parseFloat(numMatch);
    if (!isNaN(num)) {
      if (num >= 500000) volumeScore = 30;
      else if (num >= 250000) volumeScore = 25;
      else if (num >= 100000) volumeScore = 20;
      else if (num >= 50000) volumeScore = 14;
      else if (num >= 25000) volumeScore = 8;
      else if (num >= 10000) volumeScore = 5;
      else volumeScore = 3;
    }
  }

  const verticalMult = VERTICAL_REVENUE_MULTIPLIER[contact.vertical || "Other"] || 0.75;
  score = Math.min(30, Math.round(volumeScore * verticalMult));
  factors.volume = volumeScore;
  factors.verticalMultiplier = Math.round(verticalMult * 100) / 100;

  if (contact.locationCount && contact.locationCount > 1) {
    const locBonus = Math.min(5, (contact.locationCount - 1) * 2);
    score = Math.min(30, score + locBonus);
    factors.multiLocation = locBonus;
  }

  return { score, factors };
}

function calculateSwitchability(contact: Contact): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  let score = 0;

  const processor = normalizeProcessor(contact.currentProvider);
  const processorScore = SWITCHABLE_PROCESSORS[processor] || 10;
  score += Math.min(12, processorScore);
  factors.processorVulnerability = Math.min(12, processorScore);

  const contractStatus = contact.contractStatus || "unknown";
  const contractScore = CONTRACT_STATUS_SCORES[contractStatus] || 2;
  score += Math.max(-3, contractScore);
  factors.contractStatus = Math.max(-3, contractScore);

  const reason = contact.lookingReason || "unknown";
  const reasonScore = LOOKING_REASON_SCORES[reason] || 1;
  score += Math.min(5, reasonScore);
  factors.lookingReason = Math.min(5, reasonScore);

  if (contact.painPoints && contact.painPoints.length > 0) {
    let painTotal = 0;
    for (const pain of contact.painPoints) {
      const normalized = pain.toLowerCase().replace(/\s+/g, "_");
      painTotal += PAIN_SCORES[normalized] || 1;
    }
    const painScore = Math.min(6, painTotal);
    score += painScore;
    factors.painIntensity = painScore;
  }

  score = Math.max(0, Math.min(25, score));
  return { score, factors };
}

function calculateUnderwritingConfidence(contact: Contact, deal: Deal | null): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  let score = 0;

  const verticalRisk = VERTICAL_RISK[contact.vertical || "Other"] || 15;
  score += Math.min(8, Math.round(verticalRisk * 0.35));
  factors.verticalRisk = Math.min(8, Math.round(verticalRisk * 0.35));

  if (contact.businessAge) {
    const age = contact.businessAge.toLowerCase();
    let ageScore = 3;
    if (age.includes("10+") || age.includes("established")) ageScore = 7;
    else if (age.includes("5") || age.includes("6") || age.includes("7") || age.includes("8") || age.includes("9")) ageScore = 6;
    else if (age.includes("3") || age.includes("4")) ageScore = 5;
    else if (age.includes("2")) ageScore = 4;
    else if (age.includes("1")) ageScore = 3;
    else if (age.includes("new") || age.includes("startup") || age.includes("<1")) ageScore = 1;
    score += ageScore;
    factors.businessAge = ageScore;
  } else {
    score += 3;
    factors.businessAge = 3;
  }

  const riskTier = deal?.riskTier || "Medium";
  let riskScore = 4;
  if (riskTier === "Low") riskScore = 7;
  else if (riskTier === "Medium") riskScore = 5;
  else if (riskTier === "High") riskScore = 2;
  else if (riskTier === "Review Required") riskScore = 1;
  score += riskScore;
  factors.riskTier = riskScore;

  if (deal?.statementReceived) {
    score += 3;
    factors.statementAvailable = 3;
  }

  score = Math.max(0, Math.min(25, score));
  return { score, factors };
}

async function calculateEngagement(contactId: number): Promise<{ score: number; factors: Record<string, number> }> {
  const factors: Record<string, number> = {};
  let score = 0;

  try {
    const emailLogs = await storage.getEmailLogs(contactId);
    const callLogs = await storage.getCallLogs(contactId);

    const repliedEmails = emailLogs.filter(e => e.repliedAt).length;
    const openedEmails = emailLogs.filter(e => e.openedAt).length;
    const connectedCalls = callLogs.filter(c => c.outcome === "Connected" || c.outcome === "Interested" || c.outcome === "Appointment Set").length;

    if (repliedEmails > 0) {
      const replyScore = Math.min(6, repliedEmails * 3);
      score += replyScore;
      factors.emailReplies = replyScore;
    }

    if (openedEmails > 0) {
      const openScore = Math.min(3, openedEmails);
      score += openScore;
      factors.emailOpens = openScore;
    }

    if (connectedCalls > 0) {
      const callScore = Math.min(5, connectedCalls * 3);
      score += callScore;
      factors.callsConnected = callScore;
    }

    const appointmentCalls = callLogs.filter(c => c.outcome === "Appointment Set").length;
    if (appointmentCalls > 0) {
      score += 4;
      factors.appointmentSet = 4;
    }

    const enrollments = await storage.getContactEnrollments(contactId);
    if (enrollments.length > 0) {
      score += 2;
      factors.inSequence = 2;
    }
  } catch (err) {
    score = 5;
    factors.default = 5;
  }

  score = Math.max(0, Math.min(20, score));
  return { score, factors };
}

function calculateQuizBonus(contact: Contact): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  let score = 0;

  const tags = contact.tags || [];
  if (tags.includes("lead_free_analysis") || tags.includes("src_quiz")) {
    score += 20;
    factors.quizCompletion = 20;
  }

  return { score, factors };
}

function determineTier(total: number): "hot" | "warm" | "cold" | "unqualified" {
  if (total >= 70) return "hot";
  if (total >= 45) return "warm";
  if (total >= 20) return "cold";
  return "unqualified";
}

function generateSummary(breakdown: ScoreBreakdown, contact: Contact): string {
  const parts: string[] = [];
  const tier = breakdown.tier;

  if (tier === "hot") {
    parts.push(`High-value ${contact.vertical || "business"} prospect.`);
  } else if (tier === "warm") {
    parts.push(`Promising ${contact.vertical || "business"} prospect with growth potential.`);
  } else if (tier === "cold") {
    parts.push(`Early-stage ${contact.vertical || "business"} lead requiring nurture.`);
  } else {
    parts.push(`Low-fit prospect. Consider deprioritizing.`);
  }

  if (breakdown.revPotential.score >= 20) parts.push("Strong revenue potential.");
  if (breakdown.switchability.score >= 18) parts.push("High switchability - current processor is vulnerable.");
  if (breakdown.uwConfidence.score >= 18) parts.push("Clean underwriting profile.");
  if (breakdown.engagement.score >= 12) parts.push("Active engagement signals.");

  return parts.join(" ");
}

// ── Canonical scoring input types ─────────────────────────────────────────────

export interface ScoringInputs {
  contact: Contact;
  deal: Deal | null;
  emailLogs: EmailLog[];
  callLogs: CallLog[];
  enrollments: SequenceEnrollment[];
}

export interface ScoringOutput {
  leadScore: number;
  revPotentialScore: number;
  switchabilityScore: number;
  uwConfidenceScore: number;
  engagementScore: number;
  scoreBreakdown: ScoreBreakdown;
  tier: "hot" | "warm" | "cold" | "unqualified";
}

/**
 * Build scoring inputs from pre-fetched data (no DB access).
 * Pure function — same inputs → same outputs.
 */
export function buildScoringInputs(
  contact: Contact,
  deal: Deal | null,
  emailLogs: EmailLog[],
  callLogs: CallLog[],
  enrollments: SequenceEnrollment[]
): ScoringInputs {
  return { contact, deal, emailLogs, callLogs, enrollments };
}

/**
 * Apply scoring inputs to compute scores.
 * Pure function — no DB access, no side effects.
 */
export function applyScoringInputs(inputs: ScoringInputs): ScoringOutput {
  const { contact, deal, emailLogs, callLogs, enrollments } = inputs;

  const revPotential = calculateRevenuePotential(contact, deal);
  const switchability = calculateSwitchability(contact);
  const uwConfidence = calculateUnderwritingConfidence(contact, deal);

  // Engagement computed from pre-fetched data (not async DB calls)
  let engScore = 0;
  const engFactors: Record<string, number> = {};
  try {
    const repliedEmails = emailLogs.filter(e => e.repliedAt).length;
    const openedEmails = emailLogs.filter(e => e.openedAt).length;
    const connectedCalls = callLogs.filter(c => c.outcome === "Connected" || c.outcome === "Interested" || c.outcome === "Appointment Set").length;

    if (repliedEmails > 0) {
      const v = Math.min(6, repliedEmails * 3);
      engScore += v;
      engFactors.emailReplies = v;
    }
    if (openedEmails > 0) {
      const v = Math.min(3, openedEmails);
      engScore += v;
      engFactors.emailOpens = v;
    }
    if (connectedCalls > 0) {
      const v = Math.min(5, connectedCalls * 3);
      engScore += v;
      engFactors.callsConnected = v;
    }
    const appointmentCalls = callLogs.filter(c => c.outcome === "Appointment Set").length;
    if (appointmentCalls > 0) {
      engScore += 4;
      engFactors.appointmentSet = 4;
    }
    if (enrollments.length > 0) {
      engScore += 2;
      engFactors.inSequence = 2;
    }
  } catch {
    engScore = 5;
    engFactors.default = 5;
  }
  engScore = Math.max(0, Math.min(20, engScore));

  const quizBonus = calculateQuizBonus(contact);

  let offerBonus = 0;
  if (contact.offerRoutingSource !== "manual_override" && contact.offerConfidence != null) {
    offerBonus = Math.min(5, Math.round(contact.offerConfidence / 20));
  }
  const uwWithBonus = Math.min(25, uwConfidence.score + offerBonus);

  const total = Math.min(100, revPotential.score + switchability.score + uwWithBonus + engScore + quizBonus.score);
  const tier = determineTier(total);

  const breakdown: ScoreBreakdown = {
    revPotential: { score: revPotential.score, max: 30, factors: revPotential.factors },
    switchability: { score: switchability.score, max: 25, factors: switchability.factors },
    uwConfidence: { score: uwWithBonus, max: 25, factors: offerBonus > 0 ? { ...uwConfidence.factors, offerConfidenceBonus: offerBonus } : uwConfidence.factors },
    engagement: { score: engScore, max: 20, factors: engFactors },
    quizBonus: { score: quizBonus.score, max: 20, factors: quizBonus.factors },
    total,
    tier,
    summary: "",
  };
  breakdown.summary = generateSummary(breakdown, contact);

  return {
    leadScore: total,
    revPotentialScore: revPotential.score,
    switchabilityScore: switchability.score,
    uwConfidenceScore: uwWithBonus,
    engagementScore: engScore,
    scoreBreakdown: breakdown,
    tier,
  };
}

export interface PageScoringResult {
  scores: Array<{
    id: number;
    leadScore: number;
    revPotentialScore: number;
    switchabilityScore: number;
    uwConfidenceScore: number;
    engagementScore: number;
    scoreBreakdown: ScoreBreakdown;
    tier: "hot" | "warm" | "cold" | "unqualified";
    lastScoredAt: Date;
    inputVersionSnapshot: Date | null;
  }>;
  updated: number;
  skipped: number;
}

/**
 * Score a page of contacts in bulk using 5 parallel batch reads + in-memory scoring.
 * No DB writes — caller owns the write transaction.
 */
export async function scoreContactPageBulk(ids: number[]): Promise<PageScoringResult> {
  if (ids.length === 0) return { scores: [], updated: 0, skipped: 0 };

  const [contactRows, dealRows, emailLogRows, callLogRows, enrollmentRows] = await Promise.all([
    storage.getContactsByIds(ids),
    storage.getDealsByContactIds(ids),
    storage.getEmailLogsByContactIds(ids),
    storage.getCallLogsByContactIds(ids),
    storage.getContactEnrollmentsForContacts(ids),
  ]);

  const contactMap = new Map(contactRows.map(c => [c.id, c]));
  const dealsByContact = new Map<number, Deal[]>();
  for (const d of dealRows) {
    if (d.contactId == null) continue;
    const arr = dealsByContact.get(d.contactId) ?? [];
    arr.push(d);
    dealsByContact.set(d.contactId, arr);
  }
  const emailsByContact = new Map<number, EmailLog[]>();
  for (const e of emailLogRows) {
    if (e.contactId == null) continue;
    const arr = emailsByContact.get(e.contactId) ?? [];
    arr.push(e);
    emailsByContact.set(e.contactId, arr);
  }
  const callsByContact = new Map<number, CallLog[]>();
  for (const c of callLogRows) {
    if (c.contactId == null) continue;
    const arr = callsByContact.get(c.contactId) ?? [];
    arr.push(c);
    callsByContact.set(c.contactId, arr);
  }
  const enrollmentsByContact = new Map<number, SequenceEnrollment[]>();
  for (const e of enrollmentRows) {
    if (e.contactId == null) continue;
    const arr = enrollmentsByContact.get(e.contactId) ?? [];
    arr.push(e);
    enrollmentsByContact.set(e.contactId, arr);
  }

  const scores: PageScoringResult["scores"] = [];
  let updated = 0;
  let skipped = 0;
  const now = new Date();

  for (const id of ids) {
    const contact = contactMap.get(id);
    if (!contact) {
      skipped++;
      continue;
    }
    const contactDeals = dealsByContact.get(id) ?? [];
    const primaryDeal = contactDeals[0] ?? null;
    const emailLogs = emailsByContact.get(id) ?? [];
    const callLogs = callsByContact.get(id) ?? [];
    const enrollments = enrollmentsByContact.get(id) ?? [];

    const inputs = buildScoringInputs(contact, primaryDeal, emailLogs, callLogs, enrollments);
    const output = applyScoringInputs(inputs);

    scores.push({
      id,
      leadScore: output.leadScore,
      revPotentialScore: output.revPotentialScore,
      switchabilityScore: output.switchabilityScore,
      uwConfidenceScore: output.uwConfidenceScore,
      engagementScore: output.engagementScore,
      scoreBreakdown: output.scoreBreakdown,
      tier: output.tier,
      lastScoredAt: now,
      inputVersionSnapshot: contact.lastMeaningfulContactMutationAt ?? null,
    });
    updated++;
  }

  return { scores, updated, skipped };
}

export async function scoreContact(contactId: number): Promise<ScoreBreakdown | null> {
  const contact = await storage.getContact(contactId);
  if (!contact) return null;

  const contactDeals = await storage.getDealsByContact(contactId);
  const primaryDeal = contactDeals[0] || null;

  const revPotential = calculateRevenuePotential(contact, primaryDeal);
  const switchability = calculateSwitchability(contact);
  const uwConfidence = calculateUnderwritingConfidence(contact, primaryDeal);
  const engagement = await calculateEngagement(contactId);

  const quizBonus = calculateQuizBonus(contact);

  let offerBonus = 0;
  if (contact.offerRoutingSource !== "manual_override" && contact.offerConfidence != null) {
    offerBonus = Math.min(5, Math.round(contact.offerConfidence / 20));
  }
  const uwConfidenceWithBonus = Math.min(25, uwConfidence.score + offerBonus);
  const uwConfidenceFactors = offerBonus > 0
    ? { ...uwConfidence.factors, offerConfidenceBonus: offerBonus }
    : uwConfidence.factors;

  const total = Math.min(100, revPotential.score + switchability.score + uwConfidenceWithBonus + engagement.score + quizBonus.score);
  const tier = determineTier(total);

  const breakdown: ScoreBreakdown = {
    revPotential: { score: revPotential.score, max: 30, factors: revPotential.factors },
    switchability: { score: switchability.score, max: 25, factors: switchability.factors },
    uwConfidence: { score: uwConfidenceWithBonus, max: 25, factors: uwConfidenceFactors },
    engagement: { score: engagement.score, max: 20, factors: engagement.factors },
    quizBonus: { score: quizBonus.score, max: 20, factors: quizBonus.factors },
    total,
    tier,
    summary: "",
  };

  breakdown.summary = generateSummary(breakdown, contact);

  const previousScore = contact.leadScore || 0;

  await updateContactLocalFirst(contactId, {
    leadScore: total,
    revPotentialScore: revPotential.score,
    switchabilityScore: switchability.score,
    uwConfidenceScore: uwConfidenceWithBonus,
    engagementScore: engagement.score,
    scoreBreakdown: breakdown,
    lastScoredAt: new Date(),
  });

  if (total >= 80 && previousScore < 80) {
    await createPreferenceAwareNotification({
      channel: "internal",
      title: `Hot Lead: ${contact.firstName} ${contact.lastName}`,
      message: `Lead score crossed 80 (now ${total}). ${contact.companyName || ""} — Immediate follow-up recommended.`,
      type: "urgent",
      metadata: { contactId, eventType: "hot_lead", leadScore: total },
    }, "hot_lead");
    sendCriticalEmailNotification({
      eventType: "hot_lead",
      subject: `Hot Lead Alert: ${contact.firstName} ${contact.lastName} (Score: ${total})`,
      body: `<h3>Hot Lead Alert</h3><p><strong>${contact.firstName} ${contact.lastName}</strong>${contact.companyName ? ` (${contact.companyName})` : ""} just crossed the hot lead threshold with a score of <strong>${total}</strong>.</p><p>Email: ${contact.email || "N/A"}<br/>Phone: ${contact.phone || "N/A"}</p><p>Take action immediately.</p>`,
    }).catch((err) => console.error("[LeadScoring] Failed to send hot lead email:", err));
  }

  if (primaryDeal) {
    await storage.updateDeal(primaryDeal.id, {
      priorityScore: total,
      merchantTier: total >= 70 ? "Strategic" : total >= 50 ? "Growth" : total >= 30 ? "Starter" : "Starter",
    });
  }

  return breakdown;
}

/**
 * persistContactScore — shared guarded write for both per-contact and batch paths.
 *
 * Version guard logic:
 *  - inputVersionSnapshot = null  → write unconditionally (safe backfill-only path)
 *  - inputVersionSnapshot = Date  → re-read contact's lastMeaningfulContactMutationAt;
 *                                    write only if the timestamps match (no intervening mutation)
 *
 * Never calls the generic contact update command, fires no notifications, and never touches deals.
 */
export async function persistContactScore(
  contactId: number,
  output: ScoringOutput,
  inputVersionSnapshot: Date | null,
): Promise<"written" | "stale" | "contact_not_found"> {
  const contact = await storage.getContact(contactId);
  if (!contact) return "contact_not_found";

  if (inputVersionSnapshot !== null) {
    const currentMutation = contact.lastMeaningfulContactMutationAt;
    const snapshotMs = inputVersionSnapshot.getTime();
    const currentMs = currentMutation ? currentMutation.getTime() : null;
    if (currentMs !== snapshotMs) {
      return "stale";
    }
  }

  await storage.syncUpdateContact(contactId, {
    leadScore: output.leadScore,
    revPotentialScore: output.revPotentialScore,
    switchabilityScore: output.switchabilityScore,
    uwConfidenceScore: output.uwConfidenceScore,
    engagementScore: output.engagementScore,
    scoreBreakdown: output.scoreBreakdown as any,
    lastScoredAt: new Date(),
  });

  return "written";
}

export async function scoreContactBatch(contactIds: number[]): Promise<number> {
  let scored = 0;
  for (const id of contactIds) {
    try {
      await scoreContact(id);
      scored++;
    } catch (err) {
      console.error(`Scoring failed for contact ${id}:`, err);
    }
  }
  return scored;
}

/**
 * scoreContactBatchSafe — compute and persist scores without GHL sync,
 * notifications, or deal updates. Safe for batch processing 100k+ contacts.
 * Returns null if contact not found. Uses shared buildScoringInputs/applyScoringInputs helpers.
 * Accepts an optional inputVersionSnapshot for the guarded write path.
 */
export async function scoreContactBatchSafe(
  contactId: number,
  opts?: { inputVersionSnapshot?: Date | null },
): Promise<{ tier: string; total: number; persistResult: "written" | "stale" | "contact_not_found" } | null> {
  const contact = await storage.getContact(contactId);
  if (!contact) return null;

  const snapshot = opts?.inputVersionSnapshot !== undefined
    ? opts.inputVersionSnapshot
    : contact.lastMeaningfulContactMutationAt ?? null;

  const contactDeals = await storage.getDealsByContact(contactId);
  const primaryDeal = contactDeals[0] || null;
  const emailLogs = await storage.getEmailLogs(contactId);
  const callLogs = await storage.getCallLogs(contactId);
  const enrollments = await storage.getContactEnrollments(contactId);

  const inputs = buildScoringInputs(contact, primaryDeal, emailLogs, callLogs, enrollments);
  const output = applyScoringInputs(inputs);

  const persistResult = await persistContactScore(contactId, output, snapshot);
  if (persistResult === "contact_not_found") return null;

  return { tier: output.tier, total: output.leadScore, persistResult };
}

export { calculateRevenuePotential as calculateRevenuePotentialFn };
export { calculateSwitchability as calculateSwitchabilityFn };
export { calculateUnderwritingConfidence as calculateUnderwritingConfidenceFn };
export { calculateEngagement as calculateEngagementFn };
export { calculateQuizBonus as calculateQuizBonusFn };
export type { ScoreBreakdown };
