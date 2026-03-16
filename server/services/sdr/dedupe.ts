import { db } from "../../db";
import { businesses, businessAliases, leadSources, sdrMerchants, sdrLeadState } from "@shared/schema";
import type { Business, InsertBusiness, InsertBusinessAlias, InsertLeadSource } from "@shared/schema";
import { eq, and, or, sql, ilike, isNull } from "drizzle-orm";

const MATCH_WEIGHTS = {
  domain: 50,
  phone: 40,
  googlePlaceId: 60,
  nameCitySimilarity: 25,
  addressSimilarity: 20,
};

const MATCH_THRESHOLD = 40;

export function normalizeBusinessName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|corporation|incorporated|limited|ltd|co|company|enterprises|group|holdings|international|services|solutions)\b\.?/gi, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    let domain = url.toLowerCase().trim();
    domain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split("?")[0];
    if (!domain || domain.length < 3) return null;
    return domain;
  } catch {
    return null;
  }
}

export function normalizePhoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return address
    .toLowerCase()
    .replace(/\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|cir|circle|pl|place|way|pkwy|parkway|hwy|highway)\b\.?/g, (m) => {
      const map: Record<string, string> = {
        st: "street", ave: "avenue", blvd: "boulevard", dr: "drive",
        rd: "road", ln: "lane", ct: "court", cir: "circle", pl: "place",
        pkwy: "parkway", hwy: "highway",
      };
      const clean = m.replace(".", "").toLowerCase();
      return map[clean] || clean;
    })
    .replace(/\b(suite|ste|apt|unit|#)\b\.?\s*/gi, "unit ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const maxLen = Math.max(s1.length, s2.length);
  const matchWindow = Math.floor(maxLen / 2) - 1;
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

export interface DedupeMatch {
  businessId: number;
  score: number;
  matchDetails: Record<string, number>;
}

export async function findMatchingBusiness(
  normalizedName: string,
  domain: string | null,
  phone: string | null,
  googlePlaceId: string | null,
  city: string | null,
  state: string | null,
  address: string | null
): Promise<DedupeMatch | null> {
  const candidates: Business[] = [];
  const candidateSet = new Set<number>();

  const addCandidates = (rows: Business[]) => {
    for (const row of rows) {
      if (!candidateSet.has(row.id)) {
        candidateSet.add(row.id);
        candidates.push(row);
      }
    }
  };

  if (domain) {
    const byDomain = await db.select().from(businesses)
      .where(eq(businesses.websiteDomain, domain)).limit(10);
    addCandidates(byDomain);
  }

  if (phone) {
    const byPhone = await db.select().from(businesses)
      .where(eq(businesses.mainPhone, phone)).limit(10);
    addCandidates(byPhone);
  }

  if (googlePlaceId) {
    const byPlace = await db.select().from(businesses)
      .where(eq(businesses.googlePlaceId, googlePlaceId)).limit(5);
    addCandidates(byPlace);
  }

  if (normalizedName && normalizedName.length >= 3) {
    const namePrefix = normalizedName.substring(0, Math.min(8, normalizedName.length));
    const byName = await db.select().from(businesses)
      .where(ilike(businesses.normalizedName, `${namePrefix}%`)).limit(20);
    addCandidates(byName);

    const aliasCandidates = await db.select({ businessId: businessAliases.businessId })
      .from(businessAliases)
      .where(ilike(businessAliases.aliasName, `${namePrefix}%`)).limit(10);
    if (aliasCandidates.length > 0) {
      const aliasIds = aliasCandidates.map(a => a.businessId);
      const { inArray } = await import("drizzle-orm");
      const byAlias = await db.select().from(businesses)
        .where(inArray(businesses.id, aliasIds)).limit(10);
      addCandidates(byAlias);
    }
  }

  if (candidates.length === 0) return null;

  let bestMatch: DedupeMatch | null = null;

  for (const biz of candidates) {
    let score = 0;
    const matchDetails: Record<string, number> = {};

    if (domain && biz.websiteDomain && domain === biz.websiteDomain) {
      score += MATCH_WEIGHTS.domain;
      matchDetails.domain = MATCH_WEIGHTS.domain;
    }

    if (phone && biz.mainPhone && phone === biz.mainPhone) {
      score += MATCH_WEIGHTS.phone;
      matchDetails.phone = MATCH_WEIGHTS.phone;
    }

    if (googlePlaceId && biz.googlePlaceId && googlePlaceId === biz.googlePlaceId) {
      score += MATCH_WEIGHTS.googlePlaceId;
      matchDetails.googlePlaceId = MATCH_WEIGHTS.googlePlaceId;
    }

    if (normalizedName && biz.normalizedName) {
      const similarity = jaroWinkler(normalizedName, biz.normalizedName);
      const sameCity = city && biz.city && city.toLowerCase() === biz.city.toLowerCase();
      const sameState = state && biz.state && state.toLowerCase() === biz.state.toLowerCase();
      if (similarity >= 0.85 && sameCity && sameState) {
        const pts = Math.round(similarity * MATCH_WEIGHTS.nameCitySimilarity);
        score += pts;
        matchDetails.nameCitySimilarity = pts;
      }
    }

    if (address && biz.streetAddress) {
      const normalizedAddr = normalizeAddress(address);
      const bizAddr = normalizeAddress(biz.streetAddress);
      if (normalizedAddr && bizAddr) {
        const addrSim = jaroWinkler(normalizedAddr, bizAddr);
        if (addrSim >= 0.9) {
          const pts = Math.round(addrSim * MATCH_WEIGHTS.addressSimilarity);
          score += pts;
          matchDetails.addressSimilarity = pts;
        }
      }
    }

    if (score >= MATCH_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { businessId: biz.id, score, matchDetails };
    }
  }

  return bestMatch;
}

const SOURCE_STRENGTH: Record<string, number> = {
  outscraper: 90,
  apify_google: 88,
  apify_yelp: 85,
  serper: 85,
  sunbiz: 80,
  csv_import: 60,
  ghl_form: 55,
  chat_widget: 50,
  affiliate: 45,
  seo: 40,
  manual_upload: 30,
  unknown: 10,
};

function getSourceStrength(sourceType: string): number {
  return SOURCE_STRENGTH[sourceType] || SOURCE_STRENGTH.unknown;
}

export interface IngestBusinessInput {
  name: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  googlePlaceId?: string | null;
  vertical?: string | null;
  subVertical?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  yelpUrl?: string | null;
  reviewCount?: number | null;
  rating?: number | null;
  industryPrimary?: string | null;
  industrySecondary?: string | null;
  sourceType: string;
  sourceLabel?: string | null;
  sourceExternalId?: string | null;
  campaignTag?: string | null;
  importBatchId?: string | null;
  contactId?: number | null;
}

export interface IngestResult {
  businessId: number;
  isNew: boolean;
  matchScore?: number;
  matchDetails?: Record<string, number>;
}

export async function ingestBusiness(input: IngestBusinessInput): Promise<IngestResult> {
  const normalizedName = normalizeBusinessName(input.name);
  const domain = normalizeDomain(input.website);
  const phone = normalizePhoneE164(input.phone);

  const match = await findMatchingBusiness(
    normalizedName,
    domain,
    phone,
    input.googlePlaceId || null,
    input.city || null,
    input.state || null,
    input.address || null
  );

  if (match) {
    const existing = await db.select().from(businesses).where(eq(businesses.id, match.businessId));
    if (existing.length > 0) {
      const biz = existing[0];
      const updates: Partial<InsertBusiness> = {};
      const incomingStrength = getSourceStrength(input.sourceType);
      const existingStrength = getSourceStrength(biz.lastSourceType || "unknown");
      const freshnessThresholdMs = 7 * 24 * 60 * 60 * 1000;
      const lastUpdated = biz.updatedAt ? new Date(biz.updatedAt).getTime() : 0;
      const isStale = (Date.now() - lastUpdated) > freshnessThresholdMs;
      const isStrongerOrFresher = incomingStrength > existingStrength || (incomingStrength === existingStrength && isStale);

      if (domain && (!biz.websiteDomain || isStrongerOrFresher)) updates.websiteDomain = domain;
      if (phone && (!biz.mainPhone || isStrongerOrFresher)) updates.mainPhone = phone;
      if (input.email && (!biz.mainEmail || isStrongerOrFresher)) updates.mainEmail = input.email;
      if (input.address && (!biz.streetAddress || isStrongerOrFresher)) updates.streetAddress = input.address;
      if (input.city && (!biz.city || isStrongerOrFresher)) updates.city = input.city;
      if (input.state && (!biz.state || isStrongerOrFresher)) updates.state = input.state;
      if (input.postalCode && (!biz.postalCode || isStrongerOrFresher)) updates.postalCode = input.postalCode;
      if (input.googlePlaceId && (!biz.googlePlaceId || isStrongerOrFresher)) updates.googlePlaceId = input.googlePlaceId;
      if (input.vertical && (!biz.vertical || isStrongerOrFresher)) updates.vertical = input.vertical;
      if (input.facebookUrl && (!biz.facebookUrl || isStrongerOrFresher)) updates.facebookUrl = input.facebookUrl;
      if (input.instagramUrl && (!biz.instagramUrl || isStrongerOrFresher)) updates.instagramUrl = input.instagramUrl;
      if (input.yelpUrl && (!biz.yelpUrl || isStrongerOrFresher)) updates.yelpUrl = input.yelpUrl;
      if (input.reviewCount && (!biz.reviewCount || input.reviewCount > biz.reviewCount)) updates.reviewCount = input.reviewCount;
      if (input.rating && (!biz.rating || input.rating > biz.rating)) updates.rating = input.rating;
      if (isStrongerOrFresher) {
        updates.lastSourceType = input.sourceType;
        updates.lastEnrichedAt = new Date();
      }

      if (Object.keys(updates).length > 0) {
        await db.update(businesses).set({ ...updates, updatedAt: new Date() }).where(eq(businesses.id, match.businessId));
      }

      if (normalizedName !== biz.normalizedName) {
        try {
          await db.insert(businessAliases).values({
            businessId: match.businessId,
            aliasName: input.name,
            aliasType: "imported",
          });
        } catch (aliasErr) {
          console.warn(`[Dedupe] Failed to insert alias for business ${match.businessId}:`, aliasErr);
        }
      }
    }

    await db.insert(leadSources).values({
      businessId: match.businessId,
      contactId: input.contactId || null,
      sourceType: input.sourceType,
      sourceLabel: input.sourceLabel || null,
      sourceExternalId: input.sourceExternalId || null,
      campaignTag: input.campaignTag || null,
      importBatchId: input.importBatchId || null,
      discoveredAt: new Date(),
    });

    return {
      businessId: match.businessId,
      isNew: false,
      matchScore: match.score,
      matchDetails: match.matchDetails,
    };
  }

  const [newBiz] = await db.insert(businesses).values({
    canonicalName: input.name,
    normalizedName,
    websiteDomain: domain,
    mainPhone: phone,
    mainEmail: input.email || null,
    streetAddress: input.address || null,
    city: input.city || null,
    state: input.state || null,
    postalCode: input.postalCode || null,
    googlePlaceId: input.googlePlaceId || null,
    vertical: input.vertical || null,
    subVertical: input.subVertical || null,
    facebookUrl: input.facebookUrl || null,
    instagramUrl: input.instagramUrl || null,
    yelpUrl: input.yelpUrl || null,
    reviewCount: input.reviewCount || null,
    rating: input.rating || null,
    industryPrimary: input.industryPrimary || null,
    industrySecondary: input.industrySecondary || null,
    status: "new",
    lastSourceType: input.sourceType,
  }).returning();

  await db.insert(leadSources).values({
    businessId: newBiz.id,
    contactId: input.contactId || null,
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel || null,
    sourceExternalId: input.sourceExternalId || null,
    campaignTag: input.campaignTag || null,
    importBatchId: input.importBatchId || null,
    discoveredAt: new Date(),
  });

  return {
    businessId: newBiz.id,
    isNew: true,
  };
}

export async function bridgeContactsToBusinesses(options?: { limit?: number; contactIds?: number[] }): Promise<{
  created: number;
  merged: number;
  skipped: number;
  errors: number;
}> {
  const { contacts: contactsTable } = await import("@shared/schema");
  const allContacts = await db.select().from(contactsTable);

  let contactsToProcess = allContacts;
  if (options?.contactIds && options.contactIds.length > 0) {
    contactsToProcess = allContacts.filter(c => options.contactIds!.includes(c.id));
  }
  if (options?.limit) {
    contactsToProcess = contactsToProcess.slice(0, options.limit);
  }

  let created = 0;
  let merged = 0;
  let skipped = 0;
  let errors = 0;

  for (const contact of contactsToProcess) {
    if (contact.businessId) {
      skipped++;
      continue;
    }

    const name = contact.companyName || `${contact.firstName} ${contact.lastName}`.trim();
    if (!name || name === "Unknown") {
      skipped++;
      continue;
    }

    try {
      const result = await ingestBusiness({
        name,
        website: contact.website,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        city: contact.city,
        state: contact.state,
        vertical: contact.vertical,
        industryPrimary: contact.industry,
        facebookUrl: contact.facebookUrl,
        sourceType: contact.leadSource || "manual_upload",
        sourceLabel: `contact_bridge_${contact.id}`,
        contactId: contact.id,
      });

      await db.update(contactsTable)
        .set({ businessId: result.businessId, updatedAt: new Date() })
        .where(eq(contactsTable.id, contact.id));

      if (result.isNew) created++;
      else merged++;

      const linkedMerchants = await db.select().from(sdrMerchants)
        .where(and(
          eq(sdrMerchants.sourceRef, `contact_${contact.id}`),
          isNull(sdrMerchants.businessId)
        ));
      for (const merchant of linkedMerchants) {
        await db.update(sdrMerchants)
          .set({ businessId: result.businessId })
          .where(eq(sdrMerchants.id, merchant.id));
        await db.update(sdrLeadState)
          .set({ businessId: result.businessId })
          .where(and(
            eq(sdrLeadState.merchantId, merchant.id),
            isNull(sdrLeadState.businessId)
          ));
      }
    } catch (err) {
      errors++;
      console.error(`[Dedupe] Failed to bridge contact ${contact.id}:`, err);
    }
  }

  return { created, merged, skipped, errors };
}

export async function ingestBusinessFromContact(contactId: number, sourceType: string, sourceLabel?: string): Promise<IngestResult | null> {
  const { contacts: contactsTable } = await import("@shared/schema");
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!contact) return null;
  if (contact.businessId) {
    try {
      await db.insert(leadSources).values({
        businessId: contact.businessId,
        sourceType,
        sourceLabel: sourceLabel || `contact_${contactId}`,
        contactId,
      });
    } catch (_) {}
    return { businessId: contact.businessId, isNew: false };
  }

  const name = contact.companyName || `${contact.firstName} ${contact.lastName}`.trim();
  if (!name || name === "Unknown") return null;

  const result = await ingestBusiness({
    name,
    website: contact.website,
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    city: contact.city,
    state: contact.state,
    vertical: contact.vertical,
    industryPrimary: contact.industry,
    facebookUrl: contact.facebookUrl,
    sourceType,
    sourceLabel: sourceLabel || `contact_${contactId}`,
    contactId,
  });

  await db.update(contactsTable)
    .set({ businessId: result.businessId, updatedAt: new Date() })
    .where(eq(contactsTable.id, contactId));

  return result;
}

export async function getDedupeStats(): Promise<{
  totalBusinesses: number;
  totalAliases: number;
  totalSources: number;
  businessesByStatus: Record<string, number>;
  topSourceTypes: Array<{ sourceType: string; count: number }>;
}> {
  const [bizCount] = await db.select({ count: sql<number>`count(*)` }).from(businesses);
  const [aliasCount] = await db.select({ count: sql<number>`count(*)` }).from(businessAliases);
  const [sourceCount] = await db.select({ count: sql<number>`count(*)` }).from(leadSources);

  const statusCounts = await db.select({
    status: businesses.status,
    count: sql<number>`count(*)`,
  }).from(businesses).groupBy(businesses.status);

  const sourceCounts = await db.select({
    sourceType: leadSources.sourceType,
    count: sql<number>`count(*)`,
  }).from(leadSources).groupBy(leadSources.sourceType).orderBy(sql`count(*) desc`).limit(10);

  const businessesByStatus: Record<string, number> = {};
  for (const row of statusCounts) {
    businessesByStatus[row.status || "unknown"] = Number(row.count);
  }

  return {
    totalBusinesses: Number(bizCount.count),
    totalAliases: Number(aliasCount.count),
    totalSources: Number(sourceCount.count),
    businessesByStatus,
    topSourceTypes: sourceCounts.map(r => ({ sourceType: r.sourceType, count: Number(r.count) })),
  };
}
