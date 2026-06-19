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
}

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

function jaroWinkler(s1: string, s2: string): number {
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

async function findMatchingMerchant(
  normalizedName: string,
  city: string,
  state: string,
  phone: string | null,
  address: string
): Promise<number | null> {
  const stateUpper = state.toUpperCase();

  if (phone) {
    const byPhone = await db.select({ id: sdrMerchants.id })
      .from(sdrMerchants)
      .where(eq(sdrMerchants.mainPhone, phone))
      .limit(1);
    if (byPhone.length > 0) return byPhone[0].id;
  }

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

    if (bestId) return bestId;
  }

  return null;
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

    const merchantId = await findMatchingMerchant(normalizedName, rawCity, rawState, normalizedPhone, rawAddress);

    if (merchantId) {
      matched++;
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

  return { importId, total, matched, updated, unmatched, skipped };
}
