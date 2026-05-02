import { storage } from "../../storage";
import type { InsertLeadDiscoveryResult, InsertSdrMerchant, InsertSdrLeadState, InsertSdrMerchantContact } from "@shared/schema";
import { searchOutscraperByVerticalMetro, isOutscraperConfigured } from "./outscraper";
import { searchApifyByVerticalMetro, isApifyConfigured } from "./apify";
import { searchApolloForDiscovery, isApolloConfigured } from "./apollo";
import { isSerperConfigured } from "../serper";

const DEFAULT_VERTICALS = [
  "auto repair",
  "med spa",
  "dental",
  "chiropractic",
  "restaurant",
  "medical practice",
];

const DEFAULT_METROS = [
  "Miami",
  "Fort Lauderdale",
  "Tampa",
  "Orlando",
  "Jacksonville",
];

const DEFAULT_SOURCES = ["outscraper", "serper"];

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
    const SERPER_API_URL = "https://google.serper.dev";
    const queries = [
      `${vertical} ${metro} ${state}`,
      `best ${vertical} near ${metro} ${state}`,
    ];

    for (const query of queries) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${SERPER_API_URL}/places`, {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, location: `${metro}, ${state}`, gl: "us", hl: "en" }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json() as any;
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
      await mergeApolloContact(existing.id, biz);
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
      await mergeApolloContact(fuzzyExisting.id, biz);
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
        source: `discovery_${biz.source}`,
        sourceRef: biz.placeId || undefined,
      };

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

let discoveryRunning = false;
export function isDiscoveryRunning(): boolean {
  return discoveryRunning;
}

export async function runLeadDiscovery(
  triggerType: "manual" | "nightly" | "scheduled" = "manual",
  overrides?: { verticals?: string[]; metros?: string[]; dataSources?: string[] }
): Promise<{ jobId: number; rawFound: number; newInserted: number; duplicatesSkipped: number; enrichmentQueued: number }> {
  if (discoveryRunning) {
    throw new Error("Lead discovery is already running");
  }

  discoveryRunning = true;

  const matrix = await getSearchMatrix();
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
  });

  let totalRawFound = 0;
  let totalNewInserted = 0;
  let totalDuplicatesSkipped = 0;
  let totalEnrichmentQueued = 0;
  let totalErrors = 0;
  const errorMessages: string[] = [];

  try {
    for (const vertical of verticals) {
      for (const metro of metros) {
        const allBusinesses: NormalizedBusiness[] = [];

        for (const source of dataSources) {
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
    console.error("[LeadFinder] Fatal error:", fatalErr);
    await storage.updateLeadDiscoveryJob(job.id, {
      status: "failed",
      errorLog: String(fatalErr),
      completedAt: new Date(),
    });
  } finally {
    discoveryRunning = false;
  }

  return {
    jobId: job.id,
    rawFound: totalRawFound,
    newInserted: totalNewInserted,
    duplicatesSkipped: totalDuplicatesSkipped,
    enrichmentQueued: totalEnrichmentQueued,
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
