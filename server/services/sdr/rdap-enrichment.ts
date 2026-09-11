import { db } from "../../db";
import { sdrMerchants, sdrMerchantContacts } from "@shared/schema";
import { eq, isNull, or, and, sql } from "drizzle-orm";
import { isSafeFetchTarget } from "./url-safety";

const RDAP_BASE = "https://rdap.org/domain";
const PRIVACY_PATTERNS = ["privacy", "proxy", "redacted", "protect", "withheld", "not disclosed"];

let _lastRdapCallAt = 0;
const RDAP_MIN_INTERVAL_MS = 1000;

async function rdapRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - _lastRdapCallAt;
  if (elapsed < RDAP_MIN_INTERVAL_MS) {
    await new Promise(r => setTimeout(r, RDAP_MIN_INTERVAL_MS - elapsed));
  }
  _lastRdapCallAt = Date.now();
}

function isPrivacyEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PRIVACY_PATTERNS.some(p => lower.includes(p));
}

function parseName(vcardArray: any[]): string | null {
  if (!Array.isArray(vcardArray)) return null;
  for (const entry of vcardArray) {
    if (entry[0] === "fn") {
      const val = entry[3];
      if (typeof val === "string" && val.trim()) return val.trim();
    }
  }
  return null;
}

function parseEmail(vcardArray: any[]): string | null {
  if (!Array.isArray(vcardArray)) return null;
  for (const entry of vcardArray) {
    if (entry[0] === "email") {
      const val = entry[3];
      if (typeof val === "string" && val.trim() && !isPrivacyEmail(val)) {
        return val.trim().toLowerCase();
      }
    }
  }
  return null;
}

function extractRegistrantFromEntities(entities: any[]): { name: string | null; email: string | null } {
  if (!Array.isArray(entities)) return { name: null, email: null };
  for (const entity of entities) {
    const roles: string[] = entity.roles || [];
    if (!roles.includes("registrant")) continue;
    const vcard = entity.vcardArray?.[1];
    if (!Array.isArray(vcard)) continue;
    const name = parseName(vcard);
    const email = parseEmail(vcard);
    if (name || email) return { name, email };
  }
  return { name: null, email: null };
}

async function fetchRdapData(domain: string): Promise<{ name: string | null; email: string | null } | null> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  if (!cleanDomain) return null;

  await rdapRateLimit();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${RDAP_BASE}/${cleanDomain}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json() as any;
    return extractRegistrantFromEntities(data.entities || []);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function runRdapEnrichment(merchantId: number): Promise<{ enriched: boolean; emailFound: boolean; source: "rdap" }> {
  const [merchant] = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, merchantId));
  if (!merchant) return { enriched: false, emailFound: false, source: "rdap" };

  const domain = merchant.domain || merchant.website;
  if (!domain) return { enriched: false, emailFound: false, source: "rdap" };

  const safe = await isSafeFetchTarget(domain.startsWith("http") ? domain : `https://${domain}`);
  if (!safe) {
    console.warn(`[RDAP] Blocked unsafe domain for merchant ${merchantId}: ${domain}`);
    return { enriched: false, emailFound: false, source: "rdap" };
  }

  const result = await fetchRdapData(domain);
  if (!result || (!result.email && !result.name)) return { enriched: false, emailFound: false, source: "rdap" };

  if (result.email && isPrivacyEmail(result.email)) {
    return { enriched: false, emailFound: false, source: "rdap" };
  }

  const emailFound = !!result.email;

  if (result.email || result.name) {
    await db.insert(sdrMerchantContacts).values({
      merchantId,
      contactName: result.name || null,
      email: result.email || null,
      roleGuess: "owner",
      emailConfidence: 85,
      primaryContactFlag: false,
    } as any);
  }

  return { enriched: emailFound, emailFound, source: "rdap" };
}

/**
 * Exported for testing only. Do not call from production code directly —
 * use `runRdapBusinessEnrichment` which adds SSRF checks and rate limiting.
 * Returns the jCard `org` property or null; never reads `fn` or email.
 */
export function _parseOrgOnlyForTesting(vcardArray: any[]): string | null {
  return parseOrgOnly(vcardArray);
}

/**
 * Parse ONLY the jCard `org` property from a vCard array.
 * The `fn` (formatted name) field is intentionally excluded because it frequently
 * contains an individual registrant's personal name rather than an organization name.
 * Business enrichment must never persist personal-name data as registrantOrg.
 */
function parseOrgOnly(vcardArray: any[]): string | null {
  if (!Array.isArray(vcardArray)) return null;
  for (const entry of vcardArray) {
    if (entry[0] === "org") {
      const val = entry[3];
      if (typeof val === "string" && val.trim()) {
        const org = val.trim();
        // Skip values that look like privacy-redacted strings
        if (PRIVACY_PATTERNS.some(p => org.toLowerCase().includes(p))) return null;
        return org;
      }
    }
  }
  return null;
}

/**
 * Extract registrant organization name ONLY from RDAP entity list.
 * Does NOT extract email, `fn` (formatted name), or any personal identifier.
 * Returns the `org` jCard property for the registrant role, or null.
 */
function extractRegistrantOrgFromEntities(entities: any[]): string | null {
  if (!Array.isArray(entities)) return null;
  for (const entity of entities) {
    const roles: string[] = entity.roles || [];
    if (!roles.includes("registrant")) continue;
    const vcard = entity.vcardArray?.[1];
    if (!Array.isArray(vcard)) continue;
    const org = parseOrgOnly(vcard);
    if (org) return org;
  }
  return null;
}

/**
 * Business-scoped RDAP enrichment — MI-04 free enrichment path.
 *
 * Fetches RDAP registrant ORGANIZATION data only (jCard `org` property).
 * NEVER reads `fn`, personal names, email addresses, or any personal identifier.
 * NEVER writes contacts or sdr_merchant_contacts rows.
 * Returns registrant organization name for evidence only; registrar is always null.
 */
export interface RdapBusinessResult {
  registrantOrg: string | null;
  registrar: string | null;
  /** true when the fetch round-trip completed (even if no org found); false on transport/SSRF failure */
  fetchCompleted: boolean;
}

export async function runRdapBusinessEnrichment(
  businessId: number,
  domain: string
): Promise<RdapBusinessResult> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
  if (!cleanDomain) return { registrantOrg: null, registrar: null, fetchCompleted: false };

  const safe = await isSafeFetchTarget(`https://${cleanDomain}`);
  if (!safe) {
    console.warn(`[RDAP-Business] Blocked unsafe domain for business ${businessId}: ${cleanDomain}`);
    // SSRF block is a valid skip — not a transient transport failure.
    return { registrantOrg: null, registrar: null, fetchCompleted: true };
  }

  await rdapRateLimit();
  const controller = new AbortController();
  // The abort timer covers BOTH headers AND body read (res.json()).
  // clearTimeout is called only after res.json() completes, so a server that
  // sends headers then stalls the body will eventually be aborted.
  const timeout = setTimeout(() => controller.abort(), 10000);
  let rdapData: any;
  try {
    const res = await fetch(`${RDAP_BASE}/${cleanDomain}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });
    if (!res.ok) {
      clearTimeout(timeout);
      // HTTP error (e.g. 404 domain not found) — fetch completed, no data available.
      return { registrantOrg: null, registrar: null, fetchCompleted: true };
    }
    // Do NOT clearTimeout before res.json() — timer must cover body consumption.
    rdapData = await res.json();
    clearTimeout(timeout);
  } catch {
    clearTimeout(timeout);
    // Network/timeout/abort error — transport failure, BullMQ should retry.
    return { registrantOrg: null, registrar: null, fetchCompleted: false };
  }

  const registrantOrg = extractRegistrantOrgFromEntities(rdapData?.entities ?? []);
  return { registrantOrg, registrar: null, fetchCompleted: true };
}

export async function runRdapEnrichmentBatch(limit = 50): Promise<{ processed: number; enriched: number }> {
  const merchants = await db
    .select({ id: sdrMerchants.id, domain: sdrMerchants.domain, website: sdrMerchants.website })
    .from(sdrMerchants)
    .where(
      and(
        sql`(${sdrMerchants.domain} IS NOT NULL OR ${sdrMerchants.website} IS NOT NULL)`,
        sql`${sdrMerchants.ownerEnrichmentStatus} = 'pending'`,
        sql`${sdrMerchants.doNotContactFlag} IS NOT TRUE`,
        sql`NOT EXISTS (SELECT 1 FROM sdr_merchant_contacts mc WHERE mc.merchant_id = ${sdrMerchants.id} AND mc.email IS NOT NULL)`,
      )
    )
    .limit(limit);

  let processed = 0;
  let enriched = 0;
  for (const m of merchants) {
    try {
      const res = await runRdapEnrichment(m.id);
      processed++;
      if (res.enriched) enriched++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[RDAP] Error enriching merchant ${m.id}:`, err);
      processed++;
    }
  }
  console.log(`[RDAP] Batch done: ${processed} processed, ${enriched} enriched`);
  return { processed, enriched };
}
