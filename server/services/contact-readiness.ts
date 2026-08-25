/**
 * Contact Data Readiness Scoring Service
 *
 * Measures RECORD COMPLETENESS ONLY — 0-100 integer score.
 * Consent state, lifecycle stage, lead score, and behavioral signals
 * MUST NOT affect this score (see kill lines in task-968.md).
 *
 * This module is the single canonical owner of:
 *   - READINESS_MODEL_VERSION (bump to invalidate all existing scores)
 *   - READINESS_DEPENDENT_FIELDS (which contact fields trigger recalculation)
 *   - computeDataReadinessScore (pure function, no DB reads)
 *   - enqueueReadinessRecalculation (idempotent BullMQ job enqueue)
 */
import type { Contact } from "@shared/schema";
import { getQueueManager } from "./queue-manager";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Increment to invalidate all existing scores and trigger a full re-backfill. */
export const READINESS_MODEL_VERSION = 1;

/** Contact fields whose changes warrant a readiness recalculation. */
export const READINESS_DEPENDENT_FIELDS: Array<keyof Contact> = [
  "email",
  "companyName",
  "vertical",
  "phone",
  "phoneType",
  "firstName",
  "city",
  "state",
  "website",
  "lastName",
];

export const READINESS_GRADE_THRESHOLDS = { A: 80, B: 60, C: 40, D: 20 } as const;

export const REASON_CODES = {
  MISSING_EMAIL: "missing_email",
  INVALID_EMAIL: "invalid_email",
  MISSING_COMPANY: "missing_company",
  PLACEHOLDER_COMPANY: "placeholder_company",
  MISSING_VERTICAL: "missing_vertical",
  NON_CANONICAL_VERTICAL: "non_canonical_vertical",
  MISSING_PHONE: "missing_phone",
  INVALID_PHONE_TYPE: "invalid_phone_type",
  MISSING_FIRST_NAME: "missing_first_name",
  MISSING_CITY: "missing_city",
  MISSING_STATE: "missing_state",
  MISSING_WEBSITE: "missing_website",
  INVALID_WEBSITE: "invalid_website",
  MISSING_LAST_NAME: "missing_last_name",
} as const;

export type ReasonCode = typeof REASON_CODES[keyof typeof REASON_CODES];

// ---------------------------------------------------------------------------
// Validation helpers (pure, no side effects)
// ---------------------------------------------------------------------------

const CANONICAL_VERTICALS = new Set([
  "Restaurant", "Retail", "Healthcare", "Salon", "Auto Repair",
  "Dental", "Med Spa", "Hotel", "Gym", "Landscaping", "Construction", "Legal",
  "Fitness", "Barbershop", "Contractor",
]);

const EMAIL_PLACEHOLDERS = new Set([
  "test@test.com", "noemail@noemail.com", "n/a@n/a.com", "unknown@unknown.com",
  "placeholder@placeholder.com", "example@example.com",
]);

const COMPANY_PLACEHOLDERS = new Set([
  "unknown", "n/a", "na", "test", "none", "null", "no name",
  "no company", "not applicable", "tbd", "n/a",
]);

const INVALID_PHONE_TYPES = new Set(["invalid", "landline_unverified"]);

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email || !email.trim()) return false;
  const e = email.trim().toLowerCase();
  if (EMAIL_PLACEHOLDERS.has(e)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isPlaceholderCompany(name: string | null | undefined): boolean {
  if (!name || !name.trim()) return true;
  return COMPANY_PLACEHOLDERS.has(name.trim().toLowerCase());
}

function isValidWebsite(url: string | null | undefined): boolean {
  if (!url || !url.trim()) return false;
  const u = url.trim();
  return /^https?:\/\/.+/.test(u) || /^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}/.test(u);
}

// ---------------------------------------------------------------------------
// Breakdown schema
// ---------------------------------------------------------------------------

type ComponentEntry<MaxPts extends number> = {
  maxPoints: MaxPts;
  earnedPoints: number;
  status: string;
  reasonCode: string | null;
};

export type ReadinessBreakdown = {
  version: number;
  components: {
    email: ComponentEntry<25>;
    companyName: ComponentEntry<15>;
    vertical: ComponentEntry<15>;
    phone: ComponentEntry<15>;
    firstName: ComponentEntry<10>;
    city: ComponentEntry<5>;
    state: ComponentEntry<5>;
    website: ComponentEntry<5>;
    lastName: ComponentEntry<5>;
  };
  missingReasons: string[];
};

// ---------------------------------------------------------------------------
// Core scoring function — pure, no DB reads
// ---------------------------------------------------------------------------

export function computeDataReadinessScore(contact: Pick<Contact,
  "email" | "companyName" | "vertical" | "phone" | "phoneType" |
  "firstName" | "city" | "state" | "website" | "lastName"
>): { score: number; grade: string; breakdown: ReadinessBreakdown; missingFields: string[] } {
  const missingReasons: string[] = [];

  // Email (25 pts)
  let emailStatus: string, emailReason: string | null = null, emailPts = 0;
  if (!contact.email || !contact.email.trim()) {
    emailStatus = "missing"; emailReason = REASON_CODES.MISSING_EMAIL; missingReasons.push(emailReason);
  } else if (!isValidEmail(contact.email)) {
    emailStatus = "invalid"; emailReason = REASON_CODES.INVALID_EMAIL; missingReasons.push(emailReason);
  } else {
    emailStatus = "present"; emailPts = 25;
  }

  // Company name (15 pts)
  let companyStatus: string, companyReason: string | null = null, companyPts = 0;
  if (!contact.companyName || !contact.companyName.trim()) {
    companyStatus = "missing"; companyReason = REASON_CODES.MISSING_COMPANY; missingReasons.push(companyReason);
  } else if (isPlaceholderCompany(contact.companyName)) {
    companyStatus = "placeholder"; companyReason = REASON_CODES.PLACEHOLDER_COMPANY; missingReasons.push(companyReason);
  } else {
    companyStatus = "present"; companyPts = 15;
  }

  // Vertical (15 pts) — must be a known canonical value
  let verticalStatus: string, verticalReason: string | null = null, verticalPts = 0;
  if (!contact.vertical || !contact.vertical.trim()) {
    verticalStatus = "missing"; verticalReason = REASON_CODES.MISSING_VERTICAL; missingReasons.push(verticalReason);
  } else if (!CANONICAL_VERTICALS.has(contact.vertical)) {
    verticalStatus = "non_canonical"; verticalReason = REASON_CODES.NON_CANONICAL_VERTICAL; missingReasons.push(verticalReason);
  } else {
    verticalStatus = "present"; verticalPts = 15;
  }

  // Phone (15 pts)
  let phoneStatus: string, phoneReason: string | null = null, phonePts = 0;
  if (!contact.phone || !contact.phone.trim()) {
    phoneStatus = "missing"; phoneReason = REASON_CODES.MISSING_PHONE; missingReasons.push(phoneReason);
  } else if (contact.phoneType && INVALID_PHONE_TYPES.has(contact.phoneType)) {
    phoneStatus = "invalid_type"; phoneReason = REASON_CODES.INVALID_PHONE_TYPE; missingReasons.push(phoneReason);
  } else {
    phoneStatus = "present"; phonePts = 15;
  }

  // First name (10 pts)
  let firstNameStatus: string, firstNameReason: string | null = null, firstNamePts = 0;
  if (!contact.firstName || !contact.firstName.trim()) {
    firstNameStatus = "missing"; firstNameReason = REASON_CODES.MISSING_FIRST_NAME; missingReasons.push(firstNameReason);
  } else {
    firstNameStatus = "present"; firstNamePts = 10;
  }

  // City (5 pts)
  let cityStatus: string, cityReason: string | null = null, cityPts = 0;
  if (!contact.city || !contact.city.trim()) {
    cityStatus = "missing"; cityReason = REASON_CODES.MISSING_CITY; missingReasons.push(cityReason);
  } else {
    cityStatus = "present"; cityPts = 5;
  }

  // State (5 pts) — must be a 2-letter code
  let stateStatus: string, stateReason: string | null = null, statePts = 0;
  if (!contact.state || !contact.state.trim() || !/^[A-Za-z]{2}$/.test(contact.state.trim())) {
    stateStatus = "missing"; stateReason = REASON_CODES.MISSING_STATE; missingReasons.push(stateReason);
  } else {
    stateStatus = "present"; statePts = 5;
  }

  // Website (5 pts)
  let websiteStatus: string, websiteReason: string | null = null, websitePts = 0;
  if (!contact.website || !contact.website.trim()) {
    websiteStatus = "missing"; websiteReason = REASON_CODES.MISSING_WEBSITE; missingReasons.push(websiteReason);
  } else if (!isValidWebsite(contact.website)) {
    websiteStatus = "invalid"; websiteReason = REASON_CODES.INVALID_WEBSITE; missingReasons.push(websiteReason);
  } else {
    websiteStatus = "present"; websitePts = 5;
  }

  // Last name (5 pts)
  let lastNameStatus: string, lastNameReason: string | null = null, lastNamePts = 0;
  if (!contact.lastName || !contact.lastName.trim()) {
    lastNameStatus = "missing"; lastNameReason = REASON_CODES.MISSING_LAST_NAME; missingReasons.push(lastNameReason);
  } else {
    lastNameStatus = "present"; lastNamePts = 5;
  }

  const score = emailPts + companyPts + verticalPts + phonePts + firstNamePts + cityPts + statePts + websitePts + lastNamePts;

  let grade: string;
  if (score >= READINESS_GRADE_THRESHOLDS.A) grade = "A";
  else if (score >= READINESS_GRADE_THRESHOLDS.B) grade = "B";
  else if (score >= READINESS_GRADE_THRESHOLDS.C) grade = "C";
  else if (score >= READINESS_GRADE_THRESHOLDS.D) grade = "D";
  else grade = "F";

  return {
    score,
    grade,
    missingFields: missingReasons,
    breakdown: {
      version: READINESS_MODEL_VERSION,
      components: {
        email:       { maxPoints: 25, earnedPoints: emailPts,     status: emailStatus,     reasonCode: emailReason },
        companyName: { maxPoints: 15, earnedPoints: companyPts,   status: companyStatus,   reasonCode: companyReason },
        vertical:    { maxPoints: 15, earnedPoints: verticalPts,  status: verticalStatus,  reasonCode: verticalReason },
        phone:       { maxPoints: 15, earnedPoints: phonePts,     status: phoneStatus,     reasonCode: phoneReason },
        firstName:   { maxPoints: 10, earnedPoints: firstNamePts, status: firstNameStatus, reasonCode: firstNameReason },
        city:        { maxPoints: 5,  earnedPoints: cityPts,      status: cityStatus,      reasonCode: cityReason },
        state:       { maxPoints: 5,  earnedPoints: statePts,     status: stateStatus,     reasonCode: stateReason },
        website:     { maxPoints: 5,  earnedPoints: websitePts,   status: websiteStatus,   reasonCode: websiteReason },
        lastName:    { maxPoints: 5,  earnedPoints: lastNamePts,  status: lastNameStatus,  reasonCode: lastNameReason },
      },
      missingReasons,
    },
  };
}

// ---------------------------------------------------------------------------
// BullMQ recalculation enqueue — idempotent via jobId deduplication
// ---------------------------------------------------------------------------

/**
 * Enqueue an idempotent BullMQ job to recalculate readiness for a contact.
 * The job deduplication key `readiness-${contactId}` collapses repeated
 * enqueues for the same contact into one pending job.
 * Never throws — recalculation is eventual, not request-blocking.
 */
export async function enqueueReadinessRecalculation(contactId: number): Promise<void> {
  try {
    const { requireQueueManagerReady } = await import("./queue-manager");
    const qm = requireQueueManagerReady();
    const queue = qm.getQueue("enrichment");
    if (!queue) return;
    await queue.add(
      "readiness_recalculation",
      { contactId },
      {
        jobId: `readiness-${contactId}`,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  } catch (err) {
    console.warn(`[Readiness] Failed to enqueue recalculation for contact ${contactId}:`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Prospect conversion readiness — pure, no DB reads, no process.env
// ---------------------------------------------------------------------------

import type { Prospect } from "@shared/schema";

export interface ProspectConversionReadinessResult {
  conversionReadinessScore: number;
  grade: string;
  breakdown: ReadinessBreakdown;
  missingFields: string[];
  meetsThreshold: boolean;
}

/**
 * Compute conversion readiness for a prospect by mapping prospect fields to the
 * Contact-shaped input required by computeDataReadinessScore().
 *
 * Pure — no DB reads, no process.env access.
 * threshold is provided by the caller (from server/config.ts).
 */
export function computeProspectConversionReadiness(
  prospect: Prospect,
  threshold: number,
): ProspectConversionReadinessResult {
  const contactShape = {
    email: prospect.email || prospect.ownerEmail || null,
    firstName: prospect.ownerFirstName || null,
    lastName: prospect.ownerLastName || null,
    phone: prospect.phone || prospect.ownerPhone || null,
    phoneType: null as string | null,
    companyName: prospect.companyName || null,
    vertical: prospect.vertical || null,
    city: prospect.city || null,
    state: prospect.state || null,
    website: prospect.website || null,
  } as any;

  const { score, grade, breakdown, missingFields } = computeDataReadinessScore(contactShape);

  return {
    conversionReadinessScore: score,
    grade,
    breakdown,
    missingFields,
    meetsThreshold: score >= threshold,
  };
}
