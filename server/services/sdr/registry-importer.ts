import { db } from "../../db";
import { sdrMerchants, registryImportLog } from "@shared/schema";
import { eq, ilike, or } from "drizzle-orm";
import { toProperCase } from "../sunbiz-scraper";
import { normalizeBusinessName, normalizePhoneE164 } from "./dedupe";
import { parse } from "csv-parse/sync";
import { randomUUID } from "crypto";

export type SourceType = "registry" | "license";

export interface ColumnMapping {
  businessName?: string;
  legalName?: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerName?: string;
  formationDate?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  licenseNumber?: string;
}

export interface ImportSummary {
  importId: string;
  total: number;
  matched: number;
  updated: number;
  unmatched: number;
  skipped: number;
  lowConfidence: number;
  ambiguous: number;
}

// ---------------------------------------------------------------------------
// Phone-tier confidence constants (PROVISIONAL — pending distribution review)
// Run scripts/test-registry-phone-distribution.ts against prod data before
// treating these as final.
// ---------------------------------------------------------------------------
export const REGISTRY_MATCH_THRESHOLD = 60;        // provisional
export const REGISTRY_MATCH_MARGIN = 15;           // provisional
export const REGISTRY_MATCH_ALGORITHM_VERSION = "v2"; // provisional

// ---------------------------------------------------------------------------
// Typed reason codes — stored as stable JSON, never prose
// ---------------------------------------------------------------------------
export type RegistryMatchBasis =
  | "phone_exact"
  | "name_strong"
  | "name_moderate"
  | "name_weak"
  | "name_missing"
  | "state_same"
  | "state_different"
  | "state_missing"
  | "name_conflict";

export type RegistryMatchContradiction = "name_conflict";

export interface RegistryPhoneCandidateScore {
  merchantId: number;
  score: number;
  basis: RegistryMatchBasis[];
  contradictions: RegistryMatchContradiction[];
  corroborated: boolean;
}

// Returned by findMatchingMerchant — covers all outcome branches
export type FindMatchResult =
  | { outcome: "phone_accepted"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore | null }
  | { outcome: "phone_low_confidence"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore | null }
  | { outcome: "phone_ambiguous"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore }
  | { outcome: "fuzzy_matched"; merchantId: number }
  | { outcome: "unmatched" };

const STATE_REGISTRY_MAPPINGS: Record<string, ColumnMapping> = {
  FL: {
    businessName: "EntityName",
    legalName: "EntityName",
    ownerName: "RegisteredAgent",
    formationDate: "FilingDate",
    address: "Address",
    city: "City",
    state: "State",
    zip: "Zip",
  },
  TX: {
    businessName: "EntityName",
    legalName: "EntityName",
    ownerName: "OfficerName",
    formationDate: "FormationDate",
    address: "Address",
    city: "City",
    state: "State",
    zip: "PostalCode",
  },
  CA: {
    businessName: "ENTITY_NAME",
    legalName: "ENTITY_NAME",
    ownerName: "AGENT_NAME",
    formationDate: "FILING_DATE",
    address: "PRINCIPAL_ADDRESS",
    city: "PRINCIPAL_CITY",
    state: "PRINCIPAL_STATE",
    zip: "PRINCIPAL_ZIP",
  },
  NY: {
    businessName: "Entity Name",
    legalName: "Entity Name",
    ownerName: "Registered Agent",
    formationDate: "Formation Date",
    address: "Street Address",
    city: "City",
    state: "State",
    zip: "Zip Code",
  },
  GA: {
    businessName: "business_name",
    legalName: "business_name",
    ownerName: "registered_agent",
    formationDate: "registration_date",
    address: "address",
    city: "city",
    state: "state",
    zip: "zip",
  },
  NC: {
    businessName: "Entity Name",
    legalName: "Legal Entity Name",
    ownerName: "Registered Agent",
    formationDate: "Date of Incorporation",
    address: "Principal Office Address",
    city: "Principal Office City",
    state: "Principal Office State",
    zip: "Principal Office Zip",
  },
  AZ: {
    businessName: "Corporation Name",
    legalName: "Corporation Name",
    ownerName: "Statutory Agent",
    formationDate: "Incorporation Date",
    address: "Known Place of Business Address",
    city: "Known Place of Business City",
    state: "Known Place of Business State",
    zip: "Known Place of Business Zip",
  },
  IL: {
    businessName: "Corporation Name",
    legalName: "Corporation Name",
    ownerName: "Registered Agent",
    formationDate: "Incorporation Date",
    address: "Address",
    city: "City",
    state: "State",
    zip: "Zip",
  },
};

const LICENSE_BOARD_MAPPINGS: Record<string, ColumnMapping> = {
  dental: {
    businessName: "Business Name",
    legalName: "Business Name",
    licenseNumber: "License Number",
    ownerFirstName: "First Name",
    ownerLastName: "Last Name",
    ownerName: "Licensee Name",
    formationDate: "License Date",
    city: "City",
    state: "State",
    zip: "Zip",
    phone: "Phone",
  },
  medical: {
    businessName: "Business Name",
    legalName: "Business Name",
    licenseNumber: "License No",
    ownerFirstName: "First Name",
    ownerLastName: "Last Name",
    ownerName: "Licensee",
    formationDate: "Initial License Date",
    city: "City",
    state: "State",
    zip: "Zip Code",
    phone: "Phone Number",
  },
  cosmetology: {
    businessName: "Establishment Name",
    legalName: "Establishment Name",
    licenseNumber: "License Number",
    ownerFirstName: "Owner First",
    ownerLastName: "Owner Last",
    formationDate: "License Date",
    address: "Street Address",
    city: "City",
    state: "State",
    zip: "Zip",
    phone: "Phone",
  },
  veterinary: {
    businessName: "Business Name",
    legalName: "Business Name",
    licenseNumber: "License Number",
    ownerFirstName: "First Name",
    ownerLastName: "Last Name",
    formationDate: "License Date",
    city: "City",
    state: "State",
    zip: "Zip",
    phone: "Phone",
  },
};

export function getRegistryMapping(state: string): ColumnMapping {
  return STATE_REGISTRY_MAPPINGS[state.toUpperCase()] || {};
}

export function getLicenseBoardMapping(boardType: string): ColumnMapping {
  return LICENSE_BOARD_MAPPINGS[boardType.toLowerCase()] || {};
}

function getField(row: Record<string, string>, fieldName: string | undefined): string {
  if (!fieldName) return "";
  return (row[fieldName] || "").trim();
}

function parseFormationDate(raw: string): Date | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  const formats = [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
    /^(\d{4})(\d{2})(\d{2})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  ];

  for (const fmt of formats) {
    const m = cleaned.match(fmt);
    if (m) {
      let year: number, month: number, day: number;
      if (cleaned.includes("-") && m[1].length === 4) {
        year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]);
      } else if (m[3] && m[3].length === 4) {
        month = parseInt(m[1]); day = parseInt(m[2]); year = parseInt(m[3]);
      } else {
        year = parseInt(m[1]); month = parseInt(m[2]); day = parseInt(m[3]);
      }
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime()) && year >= 1900 && year <= new Date().getFullYear()) {
        return d;
      }
    }
  }

  const fallback = new Date(cleaned);
  if (!isNaN(fallback.getTime())) return fallback;
  return null;
}

function computeYearsInBusiness(formationDate: Date | null): number | null {
  if (!formationDate) return null;
  const now = new Date();
  const diffMs = now.getTime() - formationDate.getTime();
  const years = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
  return years >= 0 ? years : null;
}

const FUZZY_THRESHOLD = 0.82;

export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const maxLen = Math.max(s1.length, s2.length);
  const matchWindow = Math.max(0, Math.floor(maxLen / 2) - 1);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|lane|ln|drive|dr|court|ct|way|wy|place|pl)\b\.?/gi, (m) => m.trim()[0])
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Pure scoring helper for the phone-tier (exported for testing)
// ---------------------------------------------------------------------------
// Name-conflict contradiction floor: below this similarity AND both names
// non-empty → the names are strongly incompatible and the candidate is
// disqualified.  0.40 is too low for typical English business name strings
// (shared common characters push JW above 0.40 even for unrelated names);
// 0.65 reliably separates genuinely different business name pairs.
const NAME_CONFLICT_FLOOR = 0.65;

export function scorePhoneCandidate(
  registryNormalizedName: string,
  registryState: string,
  candidate: {
    id: number;
    businessName: string | null;
    legalName: string | null;
    state: string | null;
  }
): RegistryPhoneCandidateScore {
  const basis: RegistryMatchBasis[] = ["phone_exact"];
  const contradictions: RegistryMatchContradiction[] = [];

  const candidateName = normalizeBusinessName(candidate.businessName || "");
  const candidateLegal = normalizeBusinessName(candidate.legalName || "");
  const candidateState = (candidate.state || "").toUpperCase().trim();
  const registryStateUpper = registryState.toUpperCase().trim();

  const hasRegistryName = registryNormalizedName.length > 0;
  const hasCandidateName = candidateName.length > 0 || candidateLegal.length > 0;

  let nameScore = 0;
  let corroborated = false;

  if (!hasRegistryName || !hasCandidateName) {
    // Missing on one side — not a contradiction, just no corroboration
    basis.push("name_missing");
  } else {
    const nameSim = Math.max(
      jaroWinkler(registryNormalizedName, candidateName),
      candidateLegal ? jaroWinkler(registryNormalizedName, candidateLegal) : 0
    );

    if (nameSim >= 0.85) {
      basis.push("name_strong");
      nameScore = 60;
      corroborated = true;
    } else if (nameSim >= 0.72) {
      basis.push("name_moderate");
      nameScore = 40;
      corroborated = true;
    } else if (nameSim < NAME_CONFLICT_FLOOR) {
      // Strong name conflict — disqualifies the candidate
      basis.push("name_conflict");
      contradictions.push("name_conflict");
    } else {
      // Weak similarity: not a contradiction, not corroboration
      basis.push("name_weak");
      nameScore = 20;
    }
  }

  // State comparison
  if (!registryStateUpper || !candidateState) {
    basis.push("state_missing");
  } else if (registryStateUpper === candidateState) {
    basis.push("state_same");
  } else {
    basis.push("state_different");
  }

  const stateScore = basis.includes("state_same") ? 10 : 0;
  // Disqualified candidates get score = 0 regardless of name/state points
  const score = contradictions.length > 0 ? 0 : nameScore + stateScore;

  return {
    merchantId: candidate.id,
    score,
    basis,
    contradictions,
    corroborated,
  };
}

// ---------------------------------------------------------------------------
// Pure evaluation step — exported so the smoke test can call it without a DB
// ---------------------------------------------------------------------------
export function evaluatePhoneCandidates(
  scoredCandidates: RegistryPhoneCandidateScore[]
): { outcome: "accepted"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore | null }
 | { outcome: "low_confidence"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore | null }
 | { outcome: "ambiguous"; best: RegistryPhoneCandidateScore; runnerUp: RegistryPhoneCandidateScore }
 | { outcome: "fallthrough" } {
  if (scoredCandidates.length === 0) return { outcome: "fallthrough" };

  // Rank: score desc, then merchantId asc for stable tiebreak
  const ranked = [...scoredCandidates].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.merchantId - b.merchantId
  );

  const best = ranked[0];
  const runnerUp = ranked[1] ?? null;

  const hasDisqualifyingContradiction = best.contradictions.length > 0;

  // Hard gates for acceptance
  const meetsThreshold = best.score >= REGISTRY_MATCH_THRESHOLD;
  const meetsMargin = !runnerUp || (best.score - runnerUp.score) >= REGISTRY_MATCH_MARGIN;
  const isCorroborated = best.corroborated;

  if (meetsThreshold && meetsMargin && isCorroborated && !hasDisqualifyingContradiction) {
    return { outcome: "accepted", best, runnerUp };
  }

  // Two candidates with scores within REGISTRY_MATCH_MARGIN of each other and
  // neither has a disqualifying contradiction → ambiguous
  if (
    runnerUp &&
    !hasDisqualifyingContradiction &&
    runnerUp.contradictions.length === 0 &&
    (best.score - runnerUp.score) < REGISTRY_MATCH_MARGIN &&
    best.score > 0 &&
    runnerUp.score > 0
  ) {
    return { outcome: "ambiguous", best, runnerUp };
  }

  // Everything else that had phone candidates but didn't qualify → low_confidence
  return { outcome: "low_confidence", best, runnerUp };
}

async function findMatchingMerchant(
  normalizedName: string,
  city: string,
  state: string,
  phone: string | null,
  address: string
): Promise<FindMatchResult> {
  const stateUpper = state.toUpperCase();

  // ------------------------------------------------------------------
  // Phone tier: fetch ALL exact-phone candidates, score each one, then
  // apply the confidence/margin/corroboration gates before committing.
  // ------------------------------------------------------------------
  if (phone) {
    const byPhone = await db
      .select({
        id: sdrMerchants.id,
        businessName: sdrMerchants.businessName,
        legalName: sdrMerchants.legalName,
        state: sdrMerchants.state,
      })
      .from(sdrMerchants)
      .where(eq(sdrMerchants.mainPhone, phone));

    if (byPhone.length > 0) {
      const scored = byPhone.map((c) =>
        scorePhoneCandidate(normalizedName, stateUpper, c)
      );
      const evaluation = evaluatePhoneCandidates(scored);

      if (evaluation.outcome === "accepted") {
        return { outcome: "phone_accepted", best: evaluation.best, runnerUp: evaluation.runnerUp };
      }
      if (evaluation.outcome === "ambiguous") {
        return { outcome: "phone_ambiguous", best: evaluation.best, runnerUp: evaluation.runnerUp };
      }
      if (evaluation.outcome === "low_confidence") {
        return { outcome: "phone_low_confidence", best: evaluation.best, runnerUp: evaluation.runnerUp };
      }
      // fallthrough means evaluatePhoneCandidates returned no candidates (shouldn't
      // happen here since byPhone.length > 0, but handle gracefully)
    }
  }

  // ------------------------------------------------------------------
  // Fuzzy-name tier — unchanged behaviour from before this task
  // ------------------------------------------------------------------
  if (normalizedName.length >= 3) {
    const namePrefix = normalizedName.substring(0, Math.min(10, normalizedName.length));
    const candidates = await db.select({
      id: sdrMerchants.id,
      businessName: sdrMerchants.businessName,
      legalName: sdrMerchants.legalName,
      city: sdrMerchants.city,
      state: sdrMerchants.state,
      address: sdrMerchants.address,
    })
      .from(sdrMerchants)
      .where(
        or(
          ilike(sdrMerchants.businessName, `%${namePrefix}%`),
          ilike(sdrMerchants.legalName, `%${namePrefix}%`)
        )
      )
      .limit(50);

    const cityNorm = city.toLowerCase().trim();
    const addrNorm = address ? normalizeAddress(address) : "";

    let bestId: number | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const candidateName = normalizeBusinessName(candidate.businessName || "");
      const candidateLegal = normalizeBusinessName(candidate.legalName || "");
      const candidateCity = (candidate.city || "").toLowerCase().trim();
      const candidateState = (candidate.state || "").toUpperCase().trim();
      const candidateAddr = candidate.address ? normalizeAddress(candidate.address) : "";

      const stateMatch = !stateUpper || !candidateState || candidateState === stateUpper;
      if (!stateMatch) continue;

      const nameSim = Math.max(
        jaroWinkler(normalizedName, candidateName),
        jaroWinkler(normalizedName, candidateLegal)
      );

      if (nameSim < FUZZY_THRESHOLD) continue;

      const cityMatch = !cityNorm || !candidateCity || cityNorm === candidateCity;
      const addrMatch = addrNorm && candidateAddr ? jaroWinkler(addrNorm, candidateAddr) >= 0.75 : true;

      const combined = nameSim
        + (cityMatch ? 0.1 : 0)
        + (addrMatch && addrNorm && candidateAddr ? 0.05 : 0);

      if (combined > bestScore) {
        bestScore = combined;
        bestId = candidate.id;
      }
    }

    if (bestId) return { outcome: "fuzzy_matched", merchantId: bestId };
  }

  return { outcome: "unmatched" };
}

export async function runRegistryImport(
  csvBuffer: Buffer,
  sourceType: SourceType,
  state: string,
  columnMapping: ColumnMapping,
  subType?: string
): Promise<ImportSummary> {
  const importId = randomUUID();
  let total = 0;
  let matched = 0;
  let updated = 0;
  let unmatched = 0;
  let skipped = 0;
  let lowConfidence = 0;
  let ambiguous = 0;

  let rows: Record<string, string>[];
  try {
    rows = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (err) {
    throw new Error(`CSV parse error: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const row of rows) {
    total++;

    const rawBusinessName = getField(row, columnMapping.businessName);
    const rawLegalName = getField(row, columnMapping.legalName) || rawBusinessName;
    const rawOwnerFirst = getField(row, columnMapping.ownerFirstName);
    const rawOwnerLast = getField(row, columnMapping.ownerLastName);
    const rawOwnerName = getField(row, columnMapping.ownerName);
    const rawFormationDate = getField(row, columnMapping.formationDate);
    const rawAddress = getField(row, columnMapping.address);
    const rawCity = getField(row, columnMapping.city);
    const rawState = getField(row, columnMapping.state) || state;
    const rawPhone = getField(row, columnMapping.phone);
    const rawLicenseNumber = getField(row, columnMapping.licenseNumber);

    const businessName = rawBusinessName || rawLegalName;
    if (!businessName) {
      skipped++;
      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: null,
        status: "skipped",
      });
      continue;
    }

    const normalizedName = normalizeBusinessName(businessName);
    const normalizedPhone = normalizePhoneE164(rawPhone) || null;
    const formationDate = parseFormationDate(rawFormationDate);
    const yearsInBusiness = computeYearsInBusiness(formationDate);

    let ownerFirstName = toProperCase(rawOwnerFirst) || null;
    let ownerLastName = toProperCase(rawOwnerLast) || null;
    if (!ownerFirstName && rawOwnerName) {
      const parts = toProperCase(rawOwnerName).split(" ");
      ownerFirstName = parts[0] || null;
      ownerLastName = parts.slice(1).join(" ") || null;
    }

    const matchResult = await findMatchingMerchant(normalizedName, rawCity, rawState, normalizedPhone, rawAddress);

    if (matchResult.outcome === "phone_accepted") {
      // Accepted via phone tier — corroborated match, apply update with evidence
      matched++;
      const { best, runnerUp } = matchResult;
      const updates: Record<string, any> = {
        registrySource: `${sourceType}:${state}${subType ? `:${subType}` : ""}`,
        updatedAt: new Date(),
      };

      if (rawLegalName) updates.legalName = toProperCase(rawLegalName);
      if (ownerFirstName) updates.ownerFirstName = ownerFirstName;
      if (ownerLastName) updates.ownerLastName = ownerLastName;
      if (formationDate) updates.formationDate = formationDate;
      if (yearsInBusiness !== null) updates.yearsInBusiness = yearsInBusiness;
      if (rawLicenseNumber) updates.licenseNumber = rawLicenseNumber;

      await db.update(sdrMerchants).set(updates).where(eq(sdrMerchants.id, best.merchantId));
      updated++;

      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: best.merchantId,
        status: "matched",
        matchConfidence: best.score,
        matchBasis: best.basis as any,
        contradictions: best.contradictions as any,
        runnerUpMerchantId: runnerUp?.merchantId ?? null,
        runnerUpConfidence: runnerUp?.score ?? null,
        matchAlgorithmVersion: REGISTRY_MATCH_ALGORITHM_VERSION,
      });

    } else if (matchResult.outcome === "phone_low_confidence") {
      // Phone matched but insufficient corroboration — log only, no update
      lowConfidence++;
      const { best, runnerUp } = matchResult;
      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: null,
        status: "low_confidence",
        matchConfidence: best.score,
        matchBasis: best.basis as any,
        contradictions: best.contradictions as any,
        runnerUpMerchantId: runnerUp?.merchantId ?? null,
        runnerUpConfidence: runnerUp?.score ?? null,
        matchAlgorithmVersion: REGISTRY_MATCH_ALGORITHM_VERSION,
      });

    } else if (matchResult.outcome === "phone_ambiguous") {
      // Two candidates too close to distinguish — log both, no update
      ambiguous++;
      const { best, runnerUp } = matchResult;
      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: null,
        status: "ambiguous",
        matchConfidence: best.score,
        matchBasis: best.basis as any,
        contradictions: best.contradictions as any,
        runnerUpMerchantId: runnerUp.merchantId,
        runnerUpConfidence: runnerUp.score,
        matchAlgorithmVersion: REGISTRY_MATCH_ALGORITHM_VERSION,
      });

    } else if (matchResult.outcome === "fuzzy_matched") {
      // Matched via fuzzy-name tier (unchanged behaviour)
      matched++;
      const merchantId = matchResult.merchantId;
      const updates: Record<string, any> = {
        registrySource: `${sourceType}:${state}${subType ? `:${subType}` : ""}`,
        updatedAt: new Date(),
      };

      if (rawLegalName) updates.legalName = toProperCase(rawLegalName);
      if (ownerFirstName) updates.ownerFirstName = ownerFirstName;
      if (ownerLastName) updates.ownerLastName = ownerLastName;
      if (formationDate) updates.formationDate = formationDate;
      if (yearsInBusiness !== null) updates.yearsInBusiness = yearsInBusiness;
      if (rawLicenseNumber) updates.licenseNumber = rawLicenseNumber;

      await db.update(sdrMerchants).set(updates).where(eq(sdrMerchants.id, merchantId));
      updated++;

      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: merchantId,
        status: "matched",
      });

    } else {
      // unmatched
      unmatched++;
      await db.insert(registryImportLog).values({
        importId,
        source: sourceType,
        state,
        rawRow: row as any,
        matchedMerchantId: null,
        status: "unmatched",
      });
    }
  }

  return { importId, total, matched, updated, unmatched, skipped, lowConfidence, ambiguous };
}
