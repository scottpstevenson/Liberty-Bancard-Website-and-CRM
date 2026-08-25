import { storage } from "../../storage";
import type { InsertLeadDiscoveryResult, InsertSdrMerchant, InsertSdrLeadState, InsertSdrMerchantContact } from "@shared/schema";
import { searchOutscraperByVerticalMetro, isOutscraperConfigured } from "./outscraper";
import { searchApifyByVerticalMetro, isApifyConfigured } from "./apify";
import { searchApolloForDiscovery, isApolloConfigured } from "./apollo";
import { isSerperConfigured } from "../serper";
import { serperGateway } from "../serper-gateway";
import { isChainBusiness } from "./chain-blocklist";

const DEFAULT_VERTICALS = [
  "auto repair",
  "med spa",
  "dental",
  "chiropractic",
  "restaurant",
  "medical practice",
  "construction",
];

const DEFAULT_METROS = [
  "Miami",
  "Fort Lauderdale",
  "Tampa",
  "Orlando",
  "Jacksonville",
];

const DEFAULT_SOURCES = ["outscraper", "serper", "osm", "yellowpages", "bbb"];

interface SearchMatrixConfig {
  verticals: string[];
  metros: string[];
  dataSources: string[];
  state: string;
  limitPerSearch: number;
  enabled: boolean;
  schedule: "nightly" | "weekly" | "manual";
  dailyBudgetCap: number;
}

interface NormalizedBusiness {
  businessName: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  vertical: string;
  category?: string | null;
  metro: string;
  source: string;
  rawData: Record<string, any>;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  ownerTitle?: string | null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FUZZY_THRESHOLD = 0.85;

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1.length || !s2.length) return 0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
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

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  const prefixLen = Math.min(
    4,
    [...s1].findIndex((c, i) => c !== s2[i]) === -1 ? Math.min(s1.length, s2.length) : [...s1].findIndex((c, i) => c !== s2[i])
  );

  return jaro + prefixLen * 0.1 * (1 - jaro);
}


function classifyVertical(category: string | null, name: string): string {
  const text = `${category || ""} ${name}`.toLowerCase();
  if (/auto|car |vehicle|mechanic|tire|collision|body shop|transmission|brake|oil change|automotive/.test(text)) return "Auto";
  if (/med spa|medical spa|medspa|aesthetic|botox|laser|skin care/.test(text)) return "Salon/Spa";
  if (/dental|dentist|orthodont|oral surg/.test(text)) return "Healthcare";
  if (/chiropr/.test(text)) return "Healthcare";
  if (/restaurant|food|pizza|burger|sushi|cafe|coffee|bakery|bar\b|grill|diner/.test(text)) return "Restaurant";
  if (/medical|doctor|physician|clinic|hospital|healthcare|urgent care/.test(text)) return "Healthcare";
  if (/salon|spa\b|beauty|hair|nail|barber|cosmet/.test(text)) return "Salon/Spa";
  if (/retail|store|shop\b|boutique/.test(text)) return "Retail";
  if (/fitness|gym|yoga|crossfit/.test(text)) return "Fitness/Recreation";
  if (/construct|contractor|plumb|electric|hvac|roof/.test(text)) return "Construction";
  if (/law|legal|attorney/.test(text)) return "Legal";
  return "Other";
}

/**
 * Canonical campaign verticals used by smart-router.ts ROUTING_RULES / seed-vertical-campaigns.ts
 * trigger configs. This is the *fine-grained* mapping layer sitting on top of the coarse
 * classifyVertical() bucket above — classifyVertical() is left untouched so existing callers
 * (search-result labeling, lead_discovery_results.vertical, etc.) keep their current behavior.
 *
 * Order matters: Med Spa is checked before the generic Salon keyword set so aesthetic/medspa
 * businesses never fall through to the plain "Salon" campaign (they have different compliance
 * and messaging needs).
 */
export interface DiscoveryVerticalMapping {
  canonicalVertical: string;
  classifierBucket: string;
  rawCategory: string | null;
  confidence: "high" | "medium" | "low";
  matchedRule: string | null;
}

export const CANONICAL_DISCOVERY_VERTICALS = [
  "Med Spa", "Salon", "Dental", "Auto Repair", "Restaurant",
  "Retail", "Gym", "Hotel", "Landscaping", "Construction", "Legal",
] as const;

const BUCKET_TO_CANONICAL: Record<string, string | undefined> = {
  "Auto": "Auto Repair",
  "Restaurant": "Restaurant",
  "Salon/Spa": "Salon",
  "Retail": "Retail",
  "Fitness/Recreation": "Gym",
  "Construction": "Construction",
  "Legal": "Legal",
};

export function normalizeDiscoveryVertical(input: {
  rawCategory?: string | null;
  businessName?: string | null;
  source?: string | null;
  classifierBucket?: string | null;
}): DiscoveryVerticalMapping {
  const rawCategory = input.rawCategory ?? null;
  const businessName = input.businessName ?? "";
  const classifierBucket = input.classifierBucket || classifyVertical(rawCategory, businessName);
  const text = `${rawCategory || ""} ${businessName}`.toLowerCase();

  if (/med.?spa|medical spa|medspa|aesthetic|botox|injectable|dermal filler|laser (hair|skin)|iv therapy|cryotherapy|coolsculpt|cosmetic injectio/.test(text)) {
    return { canonicalVertical: "Med Spa", classifierBucket, rawCategory, confidence: "high", matchedRule: "medspa_keyword" };
  }
  if (/dental|dentist|orthodont|oral surg|endodont|periodont/.test(text)) {
    return { canonicalVertical: "Dental", classifierBucket, rawCategory, confidence: "high", matchedRule: "dental_keyword" };
  }
  if (/\bauto\b|automotive|car wash|vehicle|mechanic|\btire\b|collision|body shop|transmission|\bbrake\b|oil change|muffler|smog check/.test(text)) {
    return { canonicalVertical: "Auto Repair", classifierBucket, rawCategory, confidence: "high", matchedRule: "auto_repair_keyword" };
  }
  if (/restaurant|pizzeria|pizza|burger|sushi|\bcafe\b|coffee shop|bakery|\bbar\b|\bgrill\b|\bdiner\b|bistro|eatery|steakhouse|taqueria/.test(text)) {
    return { canonicalVertical: "Restaurant", classifierBucket, rawCategory, confidence: "high", matchedRule: "restaurant_keyword" };
  }
  if (/\bsalon\b|\bspa\b|beauty|\bhair\b|\bnail\b|barber|cosmetolog|waxing|esthetician/.test(text)) {
    return { canonicalVertical: "Salon", classifierBucket, rawCategory, confidence: "high", matchedRule: "salon_keyword" };
  }
  if (/\bhotel\b|\bmotel\b|\bresort\b|hospitality|\binn\b|bed and breakfast|\bbnb\b/.test(text)) {
    return { canonicalVertical: "Hotel", classifierBucket, rawCategory, confidence: "high", matchedRule: "hotel_keyword" };
  }
  if (/landscap|lawn care|lawn service|tree service|cleaning service|janitorial|pest control|pressure wash/.test(text)) {
    return { canonicalVertical: "Landscaping", classifierBucket, rawCategory, confidence: "high", matchedRule: "landscaping_keyword" };
  }
  if (/\bconstruct|contractor|remodel|renovation|\broofing\b|\bhvac\b|\bplumb|electrician/.test(text)) {
    return { canonicalVertical: "Construction", classifierBucket, rawCategory, confidence: "high", matchedRule: "construction_keyword" };
  }
  if (/law firm|attorney|\blegal\b|\blawyer\b|\bcpa\b|accounting firm|bookkeep/.test(text)) {
    return { canonicalVertical: "Legal", classifierBucket, rawCategory, confidence: "high", matchedRule: "legal_keyword" };
  }
  if (/\bgym\b|fitness center|\bcrossfit\b|\byoga\b|\bpilates\b|health club|personal training/.test(text)) {
    return { canonicalVertical: "Gym", classifierBucket, rawCategory, confidence: "high", matchedRule: "gym_keyword" };
  }
  if (/\bretail\b|boutique|\bstore\b|gift shop|clothing store|apparel|convenience store|general merchandise/.test(text)) {
    return { canonicalVertical: "Retail", classifierBucket, rawCategory, confidence: "high", matchedRule: "retail_keyword" };
  }

  const bucketMapped = BUCKET_TO_CANONICAL[classifierBucket];
  if (bucketMapped) {
    return { canonicalVertical: bucketMapped, classifierBucket, rawCategory, confidence: "medium", matchedRule: "bucket_fallback" };
  }

  return { canonicalVertical: classifierBucket, classifierBucket, rawCategory, confidence: "low", matchedRule: null };
}

export async function getSearchMatrix(): Promise<SearchMatrixConfig> {
  const saved = await storage.getSystemSetting("lead_discovery_matrix") as SearchMatrixConfig | null;
  return saved || {
    verticals: DEFAULT_VERTICALS,
    metros: DEFAULT_METROS,
    dataSources: DEFAULT_SOURCES,
    state: "FL",
    limitPerSearch: 200,
    enabled: true,
    schedule: "nightly",
    dailyBudgetCap: 50,
  };
}

export async function updateSearchMatrix(updates: Partial<SearchMatrixConfig>): Promise<SearchMatrixConfig> {
  const current = await getSearchMatrix();
  const updated = { ...current, ...updates };
  await storage.setSystemSetting("lead_discovery_matrix", updated);
  return updated;
}

async function searchSerperForDiscovery(
  vertical: string,
  metro: string,
  state: string,
  _limit: number
): Promise<NormalizedBusiness[]> {
  if (!isSerperConfigured()) return [];

  const results: NormalizedBusiness[] = [];

  try {
    const queries = [
      `${vertical} ${metro} ${state}`,
      `best ${vertical} near ${metro} ${state}`,
    ];

    for (const query of queries) {
      const gatewayResult = await serperGateway.executeSearch(
        "/places",
        { q: query, location: `${metro}, ${state}`, gl: "us", hl: "en" },
        "lead_finder_discovery",
      );
      if (!gatewayResult.ok) continue;

      const data = gatewayResult.data as any;
      const places = data.places || [];

      for (const place of places) {
        if (!place.title) continue;
        const phone = place.phoneNumber ? place.phoneNumber.replace(/[^\d]/g, "") : null;
        const website = place.website ? (() => {
          try {
            const url = new URL(place.website.startsWith("http") ? place.website : `https://${place.website}`);
            return url.hostname.replace(/^www\./, "");
          } catch { return null; }
        })() : null;

        results.push({
          businessName: place.title,
          phone: phone && phone.length >= 10 ? phone.slice(-10) : null,
          email: null,
          website,
          address: place.address || null,
          city: metro,
          state,
          zip: null,
          rating: place.rating ? parseFloat(place.rating) : null,
          reviewCount: place.reviewsCount ? parseInt(place.reviewsCount) : null,
          placeId: place.cid || place.placeId || null,
          vertical: classifyVertical(place.category || null, place.title),
          category: place.category || null,
          metro,
          source: "serper",
          rawData: place,
        });
      }

      await new Promise(r => setTimeout(r, 300));
    }
  } catch (err) {
    console.error(`[LeadFinder/Serper] Error searching ${vertical} in ${metro}:`, err);
  }

  return results;
}

async function searchOutscraperForDiscovery(
  vertical: string,
  metro: string,
  state: string,
  limit: number
): Promise<NormalizedBusiness[]> {
  if (!isOutscraperConfigured()) return [];

  try {
    const outscrResults = await searchOutscraperByVerticalMetro(vertical, metro, state, limit);
    return outscrResults.map(r => ({
      businessName: r.name,
      phone: r.phone,
      email: r.email,
      website: r.website,
      address: r.address,
      city: r.city || metro,
      state: r.state || state,
      zip: r.zip,
      rating: r.rating,
      reviewCount: r.reviewCount,
      placeId: r.placeId,
      vertical: classifyVertical(r.category, r.name),
      category: r.category ?? null,
      metro,
      source: "outscraper",
      rawData: r.rawData,
    }));
  } catch (err) {
    console.error(`[LeadFinder/Outscraper] Error searching ${vertical} in ${metro}:`, err);
    return [];
  }
}

async function searchApifyForDiscovery(
  vertical: string,
  metro: string,
  state: string,
  limit: number
): Promise<NormalizedBusiness[]> {
  if (!isApifyConfigured()) return [];

  try {
    const apifyResults = await searchApifyByVerticalMetro(vertical, metro, state, ["yelp"]);
    return apifyResults.map(r => ({
      businessName: r.name,
      phone: r.phone,
      email: r.email,
      website: r.website,
      address: r.address,
      city: r.city || metro,
      state: r.state || state,
      zip: r.zip,
      rating: r.rating,
      reviewCount: r.reviewCount,
      placeId: null,
      vertical: classifyVertical(r.category, r.name),
      category: r.category ?? null,
      metro,
      source: "apify",
      rawData: r.rawData,
    }));
  } catch (err) {
    console.error(`[LeadFinder/Apify] Error searching ${vertical} in ${metro}:`, err);
    return [];
  }
}

async function searchApolloForDiscoveryLocal(
  vertical: string,
  metro: string,
  state: string,
  limit: number
): Promise<NormalizedBusiness[]> {
  if (!isApolloConfigured()) return [];

  try {
    const apolloResults = await searchApolloForDiscovery(vertical, metro, state, Math.min(limit, 100));
    return apolloResults
      .filter(r => r.name)
      .map(r => ({
        businessName: r.name,
        phone: r.phone,
        email: r.email,
        website: r.website,
        address: r.address,
        city: r.city || metro,
        state: r.state || state,
        zip: r.zip,
        rating: null,
        reviewCount: null,
        placeId: null,
        vertical: classifyVertical(r.category, r.name),
        category: r.category ?? null,
        metro,
        source: "apollo",
        rawData: r.rawData,
        ownerFirstName: r.ownerFirstName,
        ownerLastName: r.ownerLastName,
        ownerEmail: r.ownerEmail,
        ownerPhone: r.ownerPhone,
        ownerTitle: r.ownerTitle,
      }));
  } catch (err) {
    console.error(`[LeadFinder/Apollo] Error searching ${vertical} in ${metro}:`, err);
    return [];
  }
}

async function mergeApolloContact(merchantId: number, biz: NormalizedBusiness): Promise<void> {
  if (biz.source !== "apollo" || (!biz.ownerFirstName && !biz.ownerLastName)) return;
  try {
    const contactName = [biz.ownerFirstName, biz.ownerLastName].filter(Boolean).join(" ");
    const contactData: InsertSdrMerchantContact = {
      merchantId,
      contactName: contactName || undefined,
      title: biz.ownerTitle || undefined,
      email: biz.ownerEmail || undefined,
      mobile: biz.ownerPhone || undefined,
      roleGuess: "owner",
      primaryContactFlag: true,
    };
    await storage.createSdrMerchantContact(contactData);
  } catch (contactErr) {
    console.error(`[LeadFinder/Apollo] Failed to merge contact for merchant ${merchantId}:`, contactErr);
  }
}

async function dedupeAndInsert(
  businesses: NormalizedBusiness[],
  jobId: number
): Promise<{ newInserted: number; duplicatesSkipped: number; enrichmentQueued: number; results: InsertLeadDiscoveryResult[] }> {
  let newInserted = 0;
  let duplicatesSkipped = 0;
  let enrichmentQueued = 0;
  const resultRecords: InsertLeadDiscoveryResult[] = [];

  const seenExact = new Set<string>();
  const seenByCity = new Map<string, string[]>();

  const cityMerchantsCache = new Map<string, Array<{ id: number; businessName: string }>>();

  async function getCityMerchants(city: string): Promise<Array<{ id: number; businessName: string }>> {
    const key = city.toLowerCase();
    if (!cityMerchantsCache.has(key)) {
      const rows = await storage.getSdrMerchantsByCity(city);
      cityMerchantsCache.set(key, rows.map(r => ({ id: r.id, businessName: r.businessName })));
    }
    return cityMerchantsCache.get(key)!;
  }

  for (const biz of businesses) {
    if (!biz.businessName || biz.businessName.length < 2) continue;
    if (isChainBusiness(biz.businessName)) { duplicatesSkipped++; continue; }

    const normalizedName = normalizeBusinessName(biz.businessName);
    const cityKey = (biz.city || "").toLowerCase();
    const dedupeKey = `${normalizedName}|${cityKey}`;

    if (seenExact.has(dedupeKey)) {
      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "duplicate_batch",
        dedupReason: "Exact duplicate within same batch",
      });
      duplicatesSkipped++;
      continue;
    }

    const citySeenNames = seenByCity.get(cityKey) || [];
    const fuzzyBatchMatch = citySeenNames.find(n => jaroWinkler(n, normalizedName) >= FUZZY_THRESHOLD);
    if (fuzzyBatchMatch) {
      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "duplicate_batch",
        dedupReason: `Fuzzy duplicate within batch (matched "${fuzzyBatchMatch}")`,
      });
      duplicatesSkipped++;
      continue;
    }

    seenExact.add(dedupeKey);
    citySeenNames.push(normalizedName);
    seenByCity.set(cityKey, citySeenNames);

    const existing = await storage.findSdrMerchantByNameCity(biz.businessName, biz.city);

    if (existing) {
      // Suppression guard: skip if the matched merchant is suppressed/dead/discarded
      const existingLeadState = await storage.getSdrLeadStateByMerchant(existing.id);
      const isSupp = (existing as any).doNotContactFlag === true
        || ["SUPPRESSED", "DISCARDED", "DEAD"].includes(existingLeadState?.stage ?? "")
        || ["human_suppressed", "human_discarded", "internal_not_a_fit"].includes(existingLeadState?.statusReason ?? "");
      if (isSupp) {
        console.log(`[LeadFinder/Apollo] Suppressed skip for existing merchant #${existing.id} (${biz.businessName}): doNotContact=${(existing as any).doNotContactFlag}, stage=${existingLeadState?.stage}, reason=${existingLeadState?.statusReason}`);
        resultRecords.push({
          jobId,
          source: biz.source,
          vertical: biz.vertical,
          metro: biz.metro,
          businessName: biz.businessName,
          phone: biz.phone,
          email: biz.email,
          website: biz.website,
          address: biz.address,
          city: biz.city,
          state: biz.state,
          zip: biz.zip,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          placeId: biz.placeId,
          rawData: biz.rawData,
          status: "suppressed_skip",
          merchantId: existing.id,
          dedupReason: `Suppressed: doNotContact=${(existing as any).doNotContactFlag}, stage=${existingLeadState?.stage}`,
        });
        duplicatesSkipped++;
        continue;
      }

      await mergeApolloContact(existing.id, biz);
      const existingSourcedVia = (existing as any).sourcedVia as string | null;
      const confirmedSourcesExact = existingSourcedVia
        ? existingSourcedVia.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      if (!confirmedSourcesExact.includes(biz.source)) {
        confirmedSourcesExact.push(biz.source);
        await storage.updateSdrMerchant(existing.id, {
          sourceCount: confirmedSourcesExact.length,
          sourcedVia: confirmedSourcesExact.join(","),
        } as any);
      }
      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "duplicate_existing",
        merchantId: existing.id,
        dedupReason: `Exact match to existing merchant #${existing.id}`,
      });
      duplicatesSkipped++;
      continue;
    }

    let fuzzyExisting: { id: number; businessName: string } | undefined;
    if (biz.city) {
      const candidates = await getCityMerchants(biz.city);
      fuzzyExisting = candidates.find(
        m => jaroWinkler(normalizeBusinessName(m.businessName), normalizedName) >= FUZZY_THRESHOLD
      );
    }

    if (fuzzyExisting) {
      // Suppression guard for fuzzy match
      const fuzzyLeadState = await storage.getSdrLeadStateByMerchant(fuzzyExisting.id);
      const fuzzyFullRecord = await storage.findSdrMerchantByNameCity(fuzzyExisting.businessName, biz.city);
      const isFuzzySupp = (fuzzyFullRecord as any)?.doNotContactFlag === true
        || ["SUPPRESSED", "DISCARDED", "DEAD"].includes(fuzzyLeadState?.stage ?? "")
        || ["human_suppressed", "human_discarded", "internal_not_a_fit"].includes(fuzzyLeadState?.statusReason ?? "");
      if (isFuzzySupp) {
        console.log(`[LeadFinder/Apollo] Suppressed skip for fuzzy merchant #${fuzzyExisting.id} (${biz.businessName}): stage=${fuzzyLeadState?.stage}`);
        resultRecords.push({
          jobId,
          source: biz.source,
          vertical: biz.vertical,
          metro: biz.metro,
          businessName: biz.businessName,
          phone: biz.phone,
          email: biz.email,
          website: biz.website,
          address: biz.address,
          city: biz.city,
          state: biz.state,
          zip: biz.zip,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          placeId: biz.placeId,
          rawData: biz.rawData,
          status: "suppressed_skip",
          merchantId: fuzzyExisting.id,
          dedupReason: `Suppressed (fuzzy): stage=${fuzzyLeadState?.stage}`,
        });
        duplicatesSkipped++;
        continue;
      }

      await mergeApolloContact(fuzzyExisting.id, biz);
      if (fuzzyFullRecord) {
        const fuzzySourcedVia = (fuzzyFullRecord as any).sourcedVia as string | null;
        const confirmedSourcesFuzzy = fuzzySourcedVia
          ? fuzzySourcedVia.split(",").map((s: string) => s.trim()).filter(Boolean)
          : [];
        if (!confirmedSourcesFuzzy.includes(biz.source)) {
          confirmedSourcesFuzzy.push(biz.source);
          await storage.updateSdrMerchant(fuzzyExisting.id, {
            sourceCount: confirmedSourcesFuzzy.length,
            sourcedVia: confirmedSourcesFuzzy.join(","),
          } as any);
        }
      }
      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "duplicate_existing",
        merchantId: fuzzyExisting.id,
        dedupReason: `Fuzzy match to existing merchant #${fuzzyExisting.id} ("${fuzzyExisting.businessName}")`,
      });
      duplicatesSkipped++;
      continue;
    }

    try {
      // Domain-based inactive pre-check before insert
      if (biz.website) {
        const domainMatch = await storage.findSdrMerchantByDomain(biz.website);
        if (domainMatch) {
          const domainLeadState = await storage.getSdrLeadStateByMerchant(domainMatch.id);
          const isDomainSupp = (domainMatch as any).doNotContactFlag === true
            || ["SUPPRESSED", "DISCARDED", "DEAD"].includes(domainLeadState?.stage ?? "")
            || ["human_suppressed", "human_discarded", "internal_not_a_fit"].includes(domainLeadState?.statusReason ?? "");
          if (isDomainSupp) {
            console.log(`[LeadFinder/Apollo] Domain-based suppressed skip for ${biz.businessName} (domain=${biz.website}): existing merchant #${domainMatch.id}, stage=${domainLeadState?.stage}`);
            resultRecords.push({
              jobId,
              source: biz.source,
              vertical: biz.vertical,
              metro: biz.metro,
              businessName: biz.businessName,
              phone: biz.phone,
              email: biz.email,
              website: biz.website,
              address: biz.address,
              city: biz.city,
              state: biz.state,
              zip: biz.zip,
              rating: biz.rating,
              reviewCount: biz.reviewCount,
              placeId: biz.placeId,
              rawData: biz.rawData,
              status: "suppressed_skip",
              merchantId: domainMatch.id,
              dedupReason: `Domain match to suppressed merchant #${domainMatch.id}: stage=${domainLeadState?.stage}`,
            });
            duplicatesSkipped++;
            continue;
          }
        }
      }

      const discoveryMapping = normalizeDiscoveryVertical({
        rawCategory: biz.category ?? null,
        businessName: biz.businessName,
        source: biz.source,
        classifierBucket: biz.vertical,
      });

      const merchantData: InsertSdrMerchant = {
        businessName: biz.businessName,
        website: biz.website,
        domain: biz.website,
        mainPhone: biz.phone,
        mainEmail: biz.email,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        vertical: biz.vertical,
        subvertical: discoveryMapping.canonicalVertical,
        source: `discovery_${biz.source}`,
        sourceRef: biz.placeId || undefined,
      };

      try {
        const resolved = await storage.findOrCreateBusinessForMerchant(
          biz.website || null,
          biz.businessName,
          biz.city || null,
          biz.state || null,
        );
        if (resolved?.id) merchantData.businessId = resolved.id;
      } catch (bizErr) {
        console.error(`[LeadFinder/Apollo] Business canonical resolution failed for ${biz.businessName}:`, bizErr);
      }

      const merchant = await storage.createSdrMerchant(merchantData);

      if (biz.source === "apollo" && (biz.ownerFirstName || biz.ownerLastName)) {
        try {
          const contactName = [biz.ownerFirstName, biz.ownerLastName].filter(Boolean).join(" ");
          const contactData: InsertSdrMerchantContact = {
            merchantId: merchant.id,
            contactName: contactName || undefined,
            title: biz.ownerTitle || undefined,
            email: biz.ownerEmail || undefined,
            mobile: biz.ownerPhone || undefined,
            roleGuess: "owner",
            primaryContactFlag: true,
          };
          await storage.createSdrMerchantContact(contactData);
        } catch (contactErr) {
          console.error(`[LeadFinder/Apollo] Failed to create contact for merchant ${merchant.id}:`, contactErr);
        }
      }

      const leadStateData: InsertSdrLeadState = {
        merchantId: merchant.id,
        currentStage: "DISCOVERED",
        stage: "DISCOVERED",
        companyName: biz.businessName,
        email: biz.ownerEmail || biz.email || undefined,
        phone: biz.ownerPhone || biz.phone || undefined,
        website: biz.website || undefined,
        vertical: biz.vertical,
        city: biz.city || undefined,
        state: biz.state || undefined,
      };

      await storage.createSdrLeadState(leadStateData);

      const newEntry = { id: merchant.id, businessName: biz.businessName };
      if (biz.city) {
        const cityKey2 = biz.city.toLowerCase();
        const cached = cityMerchantsCache.get(cityKey2);
        if (cached) cached.push(newEntry);
        else cityMerchantsCache.set(cityKey2, [newEntry]);
      }

      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "inserted",
        merchantId: merchant.id,
      });

      newInserted++;
      enrichmentQueued++;
    } catch (err) {
      console.error(`[LeadFinder] Error inserting merchant ${biz.businessName}:`, err);
      resultRecords.push({
        jobId,
        source: biz.source,
        vertical: biz.vertical,
        metro: biz.metro,
        businessName: biz.businessName,
        phone: biz.phone,
        email: biz.email,
        website: biz.website,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        placeId: biz.placeId,
        rawData: biz.rawData,
        status: "error",
        dedupReason: String(err),
      });
    }
  }

  if (resultRecords.length > 0) {
    await storage.createLeadDiscoveryResultsBulk(resultRecords);
  }

  return { newInserted, duplicatesSkipped, enrichmentQueued, results: resultRecords };
}

export async function dedupeAndInsertFree(
  businesses: Array<{
    businessName: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    vertical: string;
    metro: string;
    source: string;
    rawData: Record<string, any>;
    rating: number | null;
    reviewCount: number | null;
    placeId: string | null;
  }>,
  jobId?: number,
  maxInsert?: number
): Promise<{ newInserted: number; duplicatesSkipped: number }> {
  let newInserted = 0;
  let duplicatesSkipped = 0;

  const seenExact = new Set<string>();
  const seenByCity = new Map<string, string[]>();
  const cityMerchantsCache = new Map<string, Array<{ id: number; businessName: string }>>();
  const resultRecords: import("@shared/schema").InsertLeadDiscoveryResult[] = [];

  async function getCityMerchants(city: string): Promise<Array<{ id: number; businessName: string }>> {
    const key = city.toLowerCase();
    if (!cityMerchantsCache.has(key)) {
      const rows = await storage.getSdrMerchantsByCity(city);
      cityMerchantsCache.set(key, rows.map(r => ({ id: r.id, businessName: r.businessName })));
    }
    return cityMerchantsCache.get(key)!;
  }

  for (const biz of businesses) {
    if (!biz.businessName || biz.businessName.length < 2) continue;
    if (isChainBusiness(biz.businessName)) { duplicatesSkipped++; continue; }

    const normalizedName = normalizeBusinessName(biz.businessName);
    const cityKey = (biz.city || "").toLowerCase();
    const dedupeKey = `${normalizedName}|${cityKey}`;

    if (seenExact.has(dedupeKey)) { duplicatesSkipped++; continue; }

    const citySeenNames = seenByCity.get(cityKey) || [];
    if (citySeenNames.some(n => jaroWinkler(n, normalizedName) >= FUZZY_THRESHOLD)) {
      duplicatesSkipped++;
      continue;
    }

    seenExact.add(dedupeKey);
    citySeenNames.push(normalizedName);
    seenByCity.set(cityKey, citySeenNames);

    const existing = await storage.findSdrMerchantByNameCity(biz.businessName, biz.city);
    if (existing) {
      // Suppression guard: skip if the matched merchant is suppressed/dead/discarded
      const existingLeadState = await storage.getSdrLeadStateByMerchant(existing.id);
      const isSupp = (existing as any).doNotContactFlag === true
        || ["SUPPRESSED", "DISCARDED", "DEAD"].includes(existingLeadState?.stage ?? "")
        || ["human_suppressed", "human_discarded", "internal_not_a_fit"].includes(existingLeadState?.statusReason ?? "");
      if (isSupp) {
        console.log(`[LeadFinder/Free] Suppressed skip for existing merchant #${existing.id} (${biz.businessName}): doNotContact=${(existing as any).doNotContactFlag}, stage=${existingLeadState?.stage}`);
        if (jobId) {
          resultRecords.push({
            jobId,
            source: biz.source,
            vertical: biz.vertical,
            metro: biz.metro,
            businessName: biz.businessName,
            phone: biz.phone,
            email: biz.email,
            website: biz.website,
            address: biz.address,
            city: biz.city,
            state: biz.state,
            zip: biz.zip,
            rating: biz.rating,
            reviewCount: biz.reviewCount,
            placeId: biz.placeId,
            rawData: biz.rawData,
            status: "suppressed_skip",
            merchantId: existing.id,
            dedupReason: `Suppressed: doNotContact=${(existing as any).doNotContactFlag}, stage=${existingLeadState?.stage}`,
          });
        }
        duplicatesSkipped++;
        continue;
      }

      const existingSourcedVia = (existing as any).sourcedVia as string | null;
      const confirmedSources = existingSourcedVia
        ? existingSourcedVia.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      if (!confirmedSources.includes(biz.source)) {
        confirmedSources.push(biz.source);
        await storage.updateSdrMerchant(existing.id, {
          sourceCount: confirmedSources.length,
          sourcedVia: confirmedSources.join(","),
        } as any);
      }
      if (jobId) {
        resultRecords.push({
          jobId,
          source: biz.source,
          vertical: biz.vertical,
          metro: biz.metro,
          businessName: biz.businessName,
          phone: biz.phone,
          email: biz.email,
          website: biz.website,
          address: biz.address,
          city: biz.city,
          state: biz.state,
          zip: biz.zip,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          placeId: biz.placeId,
          rawData: biz.rawData,
          status: "duplicate_existing",
          merchantId: existing.id,
          dedupReason: "existing_merchant",
        });
      }
      duplicatesSkipped++;
      continue;
    }

    if (biz.city) {
      const candidates = await getCityMerchants(biz.city);
      if (candidates.some(m => jaroWinkler(normalizeBusinessName(m.businessName), normalizedName) >= FUZZY_THRESHOLD)) {
        duplicatesSkipped++;
        continue;
      }
    }

    try {
      if (maxInsert !== undefined && newInserted >= maxInsert) break;

      // Domain-based inactive pre-check before insert
      if (biz.website) {
        const domainMatch = await storage.findSdrMerchantByDomain(biz.website);
        if (domainMatch) {
          const domainLeadState = await storage.getSdrLeadStateByMerchant(domainMatch.id);
          const isDomainSupp = (domainMatch as any).doNotContactFlag === true
            || ["SUPPRESSED", "DISCARDED", "DEAD"].includes(domainLeadState?.stage ?? "")
            || ["human_suppressed", "human_discarded", "internal_not_a_fit"].includes(domainLeadState?.statusReason ?? "");
          if (isDomainSupp) {
            console.log(`[LeadFinder/Free] Domain-based suppressed skip for ${biz.businessName} (domain=${biz.website}): existing merchant #${domainMatch.id}, stage=${domainLeadState?.stage}`);
            if (jobId) {
              resultRecords.push({
                jobId,
                source: biz.source,
                vertical: biz.vertical,
                metro: biz.metro,
                businessName: biz.businessName,
                phone: biz.phone,
                email: biz.email,
                website: biz.website,
                address: biz.address,
                city: biz.city,
                state: biz.state,
                zip: biz.zip,
                rating: biz.rating,
                reviewCount: biz.reviewCount,
                placeId: biz.placeId,
                rawData: biz.rawData,
                status: "suppressed_skip",
                merchantId: domainMatch.id,
                dedupReason: `Domain match to suppressed merchant #${domainMatch.id}: stage=${domainLeadState?.stage}`,
              });
            }
            duplicatesSkipped++;
            continue;
          }
        }
      }

      const resolvedVertical = classifyVertical(null, biz.businessName) !== "Other"
        ? classifyVertical(null, biz.businessName)
        : biz.vertical;

      const discoveryMapping = normalizeDiscoveryVertical({
        rawCategory: biz.vertical,
        businessName: biz.businessName,
        source: biz.source,
        classifierBucket: resolvedVertical,
      });

      const merchantData: InsertSdrMerchant = {
        businessName: biz.businessName,
        website: biz.website,
        domain: biz.website,
        mainPhone: biz.phone,
        mainEmail: biz.email,
        address: biz.address,
        city: biz.city,
        state: biz.state,
        zip: biz.zip,
        vertical: resolvedVertical,
        subvertical: discoveryMapping.canonicalVertical,
        source: `discovery_${biz.source}`,
        sourceRef: biz.placeId || undefined,
        sourcedVia: biz.source,
      };

      try {
        const resolved = await storage.findOrCreateBusinessForMerchant(
          biz.website || null,
          biz.businessName,
          biz.city || null,
          biz.state || null,
        );
        if (resolved?.id) merchantData.businessId = resolved.id;
      } catch (bizErr) {
        console.error(`[LeadFinder/Free] Business canonical resolution failed for ${biz.businessName}:`, bizErr);
      }

      const merchant = await storage.createSdrMerchant(merchantData);

      const leadStateData: InsertSdrLeadState = {
        merchantId: merchant.id,
        currentStage: "DISCOVERED",
        stage: "DISCOVERED",
        companyName: biz.businessName,
        email: biz.email || undefined,
        phone: biz.phone || undefined,
        website: biz.website || undefined,
        vertical: resolvedVertical,
        city: biz.city || undefined,
        state: biz.state || undefined,
      };
      await storage.createSdrLeadState(leadStateData);

      const newEntry = { id: merchant.id, businessName: biz.businessName };
      if (biz.city) {
        const cityKey2 = biz.city.toLowerCase();
        const cached = cityMerchantsCache.get(cityKey2);
        if (cached) cached.push(newEntry);
        else cityMerchantsCache.set(cityKey2, [newEntry]);
      }

      if (jobId) {
        resultRecords.push({
          jobId,
          source: biz.source,
          vertical: resolvedVertical,
          metro: biz.metro,
          businessName: biz.businessName,
          phone: biz.phone,
          email: biz.email,
          website: biz.website,
          address: biz.address,
          city: biz.city,
          state: biz.state,
          zip: biz.zip,
          rating: biz.rating,
          reviewCount: biz.reviewCount,
          placeId: biz.placeId,
          rawData: biz.rawData,
          status: "inserted",
          merchantId: merchant.id,
        });
      }

      newInserted++;
    } catch (err) {
      console.error(`[LeadFinder/Free] Error inserting ${biz.businessName}:`, err);
    }
  }

  if (jobId && resultRecords.length > 0) {
    try {
      await storage.createLeadDiscoveryResultsBulk(resultRecords);
    } catch (err) {
      console.error("[LeadFinder/Free] Error writing result records:", err);
    }
  }

  return { newInserted, duplicatesSkipped };
}

let discoveryRunning = false;
export function isDiscoveryRunning(): boolean {
  return discoveryRunning;
}

export async function runLeadDiscovery(
  triggerType: "manual" | "nightly" | "scheduled" = "manual",
  overrides?: { verticals?: string[]; metros?: string[]; dataSources?: string[] },
  existingLease?: { lockToken: string },
): Promise<{ jobId: number; rawFound: number; newInserted: number; duplicatesSkipped: number; enrichmentQueued: number }> {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat } = await import("../job-registry");
  let lockToken: string;
  if (existingLease) {
    lockToken = existingLease.lockToken;
  } else {
    const lease = await acquireJobLock("sdr-lead-discovery");
    if (lease.status !== "acquired") throw new Error(`LEAD_DISCOVERY_${lease.status.toUpperCase()}`);
    lockToken = lease.lockToken;
  }
  if (discoveryRunning) {
    await releaseJobLock("sdr-lead-discovery", true, undefined, lockToken);
    throw new Error("Lead discovery is already running");
  }

  discoveryRunning = true;

  const matrix = await getSearchMatrix().catch(async (error) => {
    await releaseJobLock(
      "sdr-lead-discovery",
      false,
      error instanceof Error ? error.message : "Unable to load discovery configuration",
      lockToken,
    );
    throw error;
  });
  const verticals = overrides?.verticals || matrix.verticals;
  const metros = overrides?.metros || matrix.metros;
  const dataSources = overrides?.dataSources || matrix.dataSources;
  const state = matrix.state;
  const limitPerSearch = matrix.limitPerSearch;

  const job = await storage.createLeadDiscoveryJob({
    status: "running",
    triggerType,
    searchVerticals: verticals,
    searchMetros: metros,
    dataSources,
    startedAt: new Date(),
  }).catch(async (error) => {
    await releaseJobLock(
      "sdr-lead-discovery",
      false,
      error instanceof Error ? error.message : "Unable to create discovery job",
      lockToken,
    );
    throw error;
  });
  const heartbeat = startJobLockHeartbeat("sdr-lead-discovery", lockToken);

  let totalRawFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;
  let totalEnrichmentQueued = 0;
  let totalErrors = 0;
  const errorMessages: string[] = [];

  let fatalError: unknown;
  try {
    for (const vertical of verticals) {
      for (const metro of metros) {
        const allBusinesses: NormalizedBusiness[] = [];

        for (const source of dataSources) {
          heartbeat.assertOwned();
          if (["osm", "yellowpages", "bbb"].includes(source)) continue;
          try {
            let results: NormalizedBusiness[] = [];

            if (source === "outscraper") {
              results = await searchOutscraperForDiscovery(vertical, metro, state, limitPerSearch);
            } else if (source === "apify") {
              results = await searchApifyForDiscovery(vertical, metro, state, limitPerSearch);
            } else if (source === "serper") {
              results = await searchSerperForDiscovery(vertical, metro, state, limitPerSearch);
            } else if (source === "apollo") {
              results = await searchApolloForDiscoveryLocal(vertical, metro, state, limitPerSearch);
            }

            allBusinesses.push(...results);
            console.log(`[LeadFinder] ${source}: ${results.length} results for ${vertical} in ${metro}`);
          } catch (err) {
            const msg = `Error with ${source} for ${vertical}/${metro}: ${err}`;
            console.error(`[LeadFinder] ${msg}`);
            errorMessages.push(msg);
            totalErrors++;
          }
        }

        totalRawFound += allBusinesses.length;

        if (allBusinesses.length > 0) {
          const dedupeResult = await dedupeAndInsert(allBusinesses, job.id);
          totalNewInserted += dedupeResult.newInserted;
          totalDuplicatesSkipped += dedupeResult.duplicatesSkipped;
          totalEnrichmentQueued += dedupeResult.enrichmentQueued;
        }

        await storage.updateLeadDiscoveryJob(job.id, {
          rawFound: totalRawFound,
          newInserted: totalNewInserted,
          duplicatesSkipped: totalDuplicatesSkipped,
          enrichmentQueued: totalEnrichmentQueued,
          errorsCount: totalErrors,
        });

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (dataSources.includes("osm")) {
      try {
        console.log("[LeadFinder] Running OSM Overpass discovery...");
        const { runOsmDiscoveryJob } = await import("./osm-discovery");
        const osmCounts = await runOsmDiscoveryJob(job.id);
        totalRawFound += osmCounts.found;
        totalNewInserted += osmCounts.newInserted;
        totalDuplicatesSkipped += osmCounts.duplicatesSkipped;
      } catch (err) {
        const msg = `Error running OSM discovery: ${err}`;
        console.error(`[LeadFinder] ${msg}`);
        errorMessages.push(msg);
        totalErrors++;
      }
    }

    if (dataSources.includes("yellowpages")) {
      try {
        console.log("[LeadFinder] Running Yellow Pages discovery...");
        const { runYellowPagesDiscoveryJob } = await import("./yellowpages-discovery");
        const ypCounts = await runYellowPagesDiscoveryJob(job.id);
        totalRawFound += ypCounts.found;
        totalNewInserted += ypCounts.newInserted;
        totalDuplicatesSkipped += ypCounts.duplicatesSkipped;
      } catch (err) {
        const msg = `Error running Yellow Pages discovery: ${err}`;
        console.error(`[LeadFinder] ${msg}`);
        errorMessages.push(msg);
        totalErrors++;
      }
    }

    if (dataSources.includes("bbb")) {
      try {
        console.log("[LeadFinder] Running BBB discovery...");
        const { runBBBDiscoveryJob } = await import("./bbb-discovery");
        const bbbCounts = await runBBBDiscoveryJob(job.id);
        totalRawFound += bbbCounts.found;
        totalNewInserted += bbbCounts.newInserted;
        totalDuplicatesSkipped += bbbCounts.duplicatesSkipped;
      } catch (err) {
        const msg = `Error running BBB discovery: ${err}`;
        console.error(`[LeadFinder] ${msg}`);
        errorMessages.push(msg);
        totalErrors++;
      }
    }

    await storage.updateLeadDiscoveryJob(job.id, {
      status: totalErrors > 0 ? "completed_with_errors" : "completed",
      rawFound: totalRawFound,
      newInserted: totalNewInserted,
      duplicatesSkipped: totalDuplicatesSkipped,
      enrichmentQueued: totalEnrichmentQueued,
      errorsCount: totalErrors,
      errorLog: errorMessages.length > 0 ? errorMessages.join("\n") : undefined,
      completedAt: new Date(),
    });

    console.log(`[LeadFinder] Discovery complete: ${totalRawFound} raw, ${totalNewInserted} new, ${totalDuplicatesSkipped} dupes, ${totalEnrichmentQueued} queued for enrichment`);
  } catch (fatalErr) {
    fatalError = fatalErr;
    console.error("[LeadFinder] Fatal error:", fatalErr);
    await storage.updateLeadDiscoveryJob(job.id, {
      status: "failed",
      errorLog: String(fatalErr),
      completedAt: new Date(),
    });
  } finally {
    discoveryRunning = false;
    heartbeat.stop();
    await releaseJobLock(
      "sdr-lead-discovery",
      !fatalError,
      fatalError instanceof Error ? fatalError.message : undefined,
      lockToken,
    );
  }

  return {
    jobId: job.id,
    rawFound: totalRawFound,
    newInserted: totalNewInserted,
    duplicatesSkipped: totalDuplicatesSkipped,
    enrichmentQueued: totalEnrichmentQueued,
  };
}

export interface PilotDiscoveryProviders {
  searchSerperFn?: (v: string, m: string, s: string, n: number) => Promise<NormalizedBusiness[]>;
  searchOutscraperFn?: (v: string, m: string, s: string, n: number) => Promise<NormalizedBusiness[]>;
  searchApifyFn?: (v: string, m: string, s: string, n: number) => Promise<NormalizedBusiness[]>;
  dedupeAndInsertFn?: (businesses: NormalizedBusiness[], jobId: number) => Promise<{ newInserted: number; duplicatesSkipped: number; enrichmentQueued: number; results: any[] }>;
  updateJobFn?: (id: number, data: any) => Promise<void>;
}

export interface PilotDiscoveryOptions {
  limit: number;
  sources: string[];
  verticals?: string[];
  metros?: string[];
  jobId?: number;
  _providers?: PilotDiscoveryProviders;
}

export async function runPilotDiscovery(options: PilotDiscoveryOptions): Promise<{
  jobId: number;
  rawFound: number;
  newInserted: number;
  duplicatesSkipped: number;
}> {
  const { verifyEmail } = await import("./zerobounce");
  const p = options._providers ?? {};

  const ALLOWED_PAID_SOURCES = ["serper", "outscraper", "apify"];
  const ALLOWED_FREE_SOURCES = ["osm", "yellowpages", "bbb"];
  const globalCap = Math.min(options.limit ?? 25, 50);

  const paidSources = (options.sources || []).filter(s => ALLOWED_PAID_SOURCES.includes(s));
  const freeSources = (options.sources || []).filter(s => ALLOWED_FREE_SOURCES.includes(s));
  // Apollo enrichment runs silently post-discovery whenever APOLLO_API_KEY is configured;
  // it is not a user-selectable discovery source.
  const runApolloEnrichment = isApolloConfigured();

  const matrix = await getSearchMatrix();
  const verticals = options.verticals?.length ? options.verticals : matrix.verticals.slice(0, 2);
  const metros = options.metros?.length ? options.metros : matrix.metros.slice(0, 1);
  const state = matrix.state || "FL";

  const jobId = options.jobId;
  if (!jobId) {
    throw new Error("[PilotDiscovery] jobId is required — caller must create the job record");
  }

  const updateJob = p.updateJobFn ?? ((id: number, data: any) => storage.updateLeadDiscoveryJob(id, data));
  await updateJob(jobId, { status: "running", startedAt: new Date() });

  let totalRawFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;
  const errorMessages: string[] = [];

  try {
    const allBusinesses: NormalizedBusiness[] = [];

    // --- Paid sources: rolling remaining budget — fetch budget decrements per source ---
    for (const source of paidSources) {
      const remaining = globalCap - allBusinesses.length;
      if (remaining <= 0) break;
      try {
        for (const vertical of verticals.slice(0, 1)) {
          const rem2 = globalCap - allBusinesses.length;
          if (rem2 <= 0) break;
          for (const metro of metros.slice(0, 1)) {
            const remInner = globalCap - allBusinesses.length;
            if (remInner <= 0) break;
            let results: NormalizedBusiness[] = [];

            if (source === "outscraper") {
              results = await (p.searchOutscraperFn ?? searchOutscraperForDiscovery)(vertical, metro, state, remInner);
            } else if (source === "apify") {
              results = await (p.searchApifyFn ?? searchApifyForDiscovery)(vertical, metro, state, remInner);
            } else if (source === "serper") {
              results = await (p.searchSerperFn ?? searchSerperForDiscovery)(vertical, metro, state, remInner);
            }

            // Defensive slice ensures we never exceed the rolling budget
            allBusinesses.push(...results.slice(0, remInner));
          }
        }
      } catch (err) {
        const msg = `Pilot error with ${source}: ${err}`;
        console.error(`[PilotDiscovery] ${msg}`);
        errorMessages.push(msg);
      }
    }

    // allBusinesses is already within globalCap via rolling remInner passed to each API call
    totalRawFound += allBusinesses.length;

    let insertedMerchants: Array<{ merchantId: number; source: string; businessName: string }> = [];

    if (allBusinesses.length > 0) {
      const insertFn = p.dedupeAndInsertFn ?? dedupeAndInsert;
      const dedupeResult = await insertFn(allBusinesses, jobId);
      totalNewInserted += dedupeResult.newInserted;
      totalDuplicatesSkipped += dedupeResult.duplicatesSkipped;
      insertedMerchants = (dedupeResult.results as any[])
        .filter((r: any) => r.status === "inserted" && r.merchantId != null)
        .map((r: any) => ({ merchantId: r.merchantId as number, source: r.source as string, businessName: r.businessName as string }));
    }

    if (runApolloEnrichment && insertedMerchants.length > 0) {
      const apolloResults: NormalizedBusiness[] = [];
      for (const vertical of verticals.slice(0, 1)) {
        for (const metro of metros.slice(0, 1)) {
          try {
            const aResults = await searchApolloForDiscoveryLocal(vertical, metro, state, Math.min(insertedMerchants.length, 50));
            apolloResults.push(...aResults);
          } catch (err) {
            console.error(`[PilotDiscovery] Apollo enrichment error for ${vertical}/${metro}:`, err);
          }
        }
      }

      if (apolloResults.length > 0) {
        const apolloByName = new Map<string, NormalizedBusiness>();
        for (const r of apolloResults) {
          apolloByName.set(normalizeBusinessName(r.businessName), r);
        }

        for (const { merchantId, businessName } of insertedMerchants) {
          const merchantNorm = normalizeBusinessName(businessName);
          const apolloMatch = apolloByName.get(merchantNorm) ||
            [...apolloByName.entries()].find(([k]) => jaroWinkler(k, merchantNorm) >= FUZZY_THRESHOLD)?.[1];

          if (apolloMatch && (apolloMatch.ownerFirstName || apolloMatch.ownerLastName)) {
            try {
              await mergeApolloContact(merchantId, { ...apolloMatch, source: "apollo" });
            } catch (err) {
              console.error(`[PilotDiscovery] Apollo mergeContact error for merchant ${merchantId}:`, err);
            }

            if (apolloMatch.ownerEmail) {
              try {
                const zbResult = await verifyEmail(apolloMatch.ownerEmail);
                const leadState = await storage.getSdrLeadStateByMerchant(merchantId);
                if (leadState) {
                  const existingData = (leadState.enrichmentData as Record<string, any>) || {};
                  await storage.updateSdrLeadState(leadState.id, {
                    enrichmentData: { ...existingData, emailVerification: zbResult },
                  });
                }
              } catch (zbErr) {
                console.error(`[PilotDiscovery] ZeroBounce error for merchant ${merchantId}:`, zbErr);
              }
            }
          }
        }
      }
    }

    // --- Free sources: rolling remaining budget — both fetch and insert are capped ---
    for (const source of freeSources) {
      const remaining = globalCap - (totalRawFound + totalNewInserted);
      if (remaining <= 0) break;
      try {
        if (source === "osm") {
          const { runOsmDiscovery } = await import("./osm-discovery");
          const osmCounts = await runOsmDiscovery({ jobId, maxInsert: remaining, maxFetch: remaining });
          totalRawFound += osmCounts.found;
          totalNewInserted += osmCounts.newInserted;
          totalDuplicatesSkipped += osmCounts.duplicatesSkipped;
        } else if (source === "yellowpages") {
          const { runYellowPagesDiscovery } = await import("./yellowpages-discovery");
          const ypCounts = await runYellowPagesDiscovery({ jobId, maxInsert: remaining, maxFetch: remaining });
          totalRawFound += ypCounts.found;
          totalNewInserted += ypCounts.newInserted;
          totalDuplicatesSkipped += ypCounts.duplicatesSkipped;
        } else if (source === "bbb") {
          const { runBBBDiscovery } = await import("./bbb-discovery");
          const bbbCounts = await runBBBDiscovery({ jobId, maxInsert: remaining, maxFetch: remaining });
          totalRawFound += bbbCounts.found;
          totalNewInserted += bbbCounts.newInserted;
          totalDuplicatesSkipped += bbbCounts.duplicatesSkipped;
        }
      } catch (err) {
        const msg = `Pilot error with ${source}: ${err}`;
        console.error(`[PilotDiscovery] ${msg}`);
        errorMessages.push(msg);
      }
    }

    const finalRaw = Math.min(totalRawFound, globalCap);
    await updateJob(jobId, {
      status: errorMessages.length > 0 ? "completed_with_errors" : "completed",
      rawFound: finalRaw,
      newInserted: totalNewInserted,
      duplicatesSkipped: totalDuplicatesSkipped,
      errorsCount: errorMessages.length,
      errorLog: errorMessages.length > 0 ? errorMessages.join("\n") : undefined,
      completedAt: new Date(),
    });

    console.log(`[PilotDiscovery] Complete: cap=${globalCap}, rawFound=${totalRawFound}, newInserted=${totalNewInserted}`);
  } catch (fatalErr) {
    console.error("[PilotDiscovery] Fatal error:", fatalErr);
    await updateJob(jobId, {
      status: "failed",
      errorLog: String(fatalErr),
      completedAt: new Date(),
    });
  }

  return {
    jobId,
    rawFound: Math.min(totalRawFound, globalCap),
    newInserted: totalNewInserted,
    duplicatesSkipped: totalDuplicatesSkipped,
  };
}

let nightlyInterval: NodeJS.Timeout | null = null;

function getNextRunTime(): Date {
  const now = new Date();
  const estStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const estNow = new Date(estStr);
  const estHour = estNow.getHours();

  const targetHourEST = 2;
  const next = new Date(estStr);
  next.setHours(targetHourEST, 0, 0, 0);

  if (estHour >= targetHourEST) {
    next.setDate(next.getDate() + 1);
  }

  const offsetMs = now.getTime() - estNow.getTime();
  return new Date(next.getTime() + offsetMs);
}

export function startNightlyDiscovery(): void {
  const { featureFlags } = require("../../services/feature-flags");
  if (!featureFlags.NIGHTLY_DISCOVERY_ENABLED) {
    console.log("[LeadFinder] NIGHTLY_DISCOVERY_ENABLED=false, nightly discovery not started");
    return;
  }

  if (nightlyInterval) {
    console.log("[LeadFinder] Nightly discovery already running");
    return;
  }

  const checkInterval = () => {
    const now = new Date();
    const nextRun = getNextRunTime();
    const msUntilRun = nextRun.getTime() - now.getTime();

    if (msUntilRun <= 60000) {
      console.log("[LeadFinder] Starting nightly discovery run...");
      runLeadDiscovery("nightly").catch(err =>
        console.error("[LeadFinder] Nightly discovery error:", err)
      );
    }
  };

  nightlyInterval = setInterval(checkInterval, 60000);
  console.log("[LeadFinder] Nightly discovery scheduler started (2 AM EST)");
}

export function stopNightlyDiscovery(): void {
  if (nightlyInterval) {
    clearInterval(nightlyInterval);
    nightlyInterval = null;
    console.log("[LeadFinder] Nightly discovery scheduler stopped");
  }
}

export function isNightlyDiscoveryRunning(): boolean {
  return nightlyInterval !== null;
}
