import { db } from "../../db";
import { adSignals, businesses } from "@shared/schema";
import type { InsertAdSignal } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { isSerperConfigured, searchBusiness } from "../serper";

interface AdDetectionResult {
  platform: string;
  isRunningAds: boolean;
  confidence: number;
  adCountEstimate: number;
  evidence: string;
}

function isFacebookAdLibraryConfigured(): boolean {
  return !!(process.env.FACEBOOK_AD_LIBRARY_TOKEN);
}

async function queryFacebookAdLibrary(businessName: string, pageId?: string): Promise<AdDetectionResult | null> {
  const token = process.env.FACEBOOK_AD_LIBRARY_TOKEN;
  if (!token) return null;

  try {
    const searchField = pageId ? `search_page_ids=${pageId}` : `search_terms=${encodeURIComponent(businessName)}`;
    const url = `https://graph.facebook.com/v18.0/ads_archive?${searchField}&ad_reached_countries=US&ad_active_status=ACTIVE&access_token=${token}&limit=5`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[AdDetector] Facebook Ad Library API returned ${response.status}`);
      return null;
    }

    const data: { data?: Array<{ id: string; ad_creative_link_titles?: string[] }> } = await response.json();
    const ads = data?.data || [];

    if (ads.length > 0) {
      return {
        platform: "facebook",
        isRunningAds: true,
        confidence: 0.90,
        adCountEstimate: ads.length,
        evidence: `Facebook Ad Library: ${ads.length} active ads found`,
      };
    }
  } catch (err) {
    console.error("[AdDetector] Facebook Ad Library API failed:", err);
  }

  return null;
}

async function detectFacebookAds(businessName: string, facebookUrl?: string | null): Promise<AdDetectionResult | null> {
  if (isFacebookAdLibraryConfigured()) {
    const pageId = facebookUrl?.match(/facebook\.com\/(\d+)/)?.[1];
    const adLibResult = await queryFacebookAdLibrary(businessName, pageId || undefined);
    if (adLibResult) return adLibResult;
  }

  if (!isSerperConfigured()) return null;

  try {
    const searchQuery = facebookUrl
      ? `site:facebook.com/ads/library "${businessName}"`
      : `"${businessName}" facebook ads`;

    const result = await searchBusiness(searchQuery);

    const allText = [
      result.website || "",
      ...result.organicUrls,
      ...result.sources,
    ].join(" ").toLowerCase();

    const hasAdSignals = /facebook\s+ad|sponsored|ad\s+library|currently\s+running\s+ads|active\s+ads/i.test(allText);

    if (hasAdSignals) {
      return {
        platform: "facebook",
        isRunningAds: true,
        confidence: 0.65,
        adCountEstimate: 1,
        evidence: `Search result suggests active Facebook ads: ${allText.slice(0, 200)}`,
      };
    }
  } catch (err) {
    console.error("[AdDetector] Facebook ad detection failed:", err);
  }

  return null;
}

async function queryGoogleAdsTransparency(businessName: string, website?: string | null): Promise<AdDetectionResult | null> {
  if (!isSerperConfigured()) return null;

  try {
    const searchQuery = website
      ? `site:adstransparency.google.com "${businessName}" OR "${website}"`
      : `site:adstransparency.google.com "${businessName}"`;

    const result = await searchBusiness(searchQuery);

    const allText = [
      result.website || "",
      ...result.organicUrls,
      ...result.sources,
    ].join(" ").toLowerCase();

    if (/adstransparency\.google\.com/i.test(allText)) {
      return {
        platform: "google",
        isRunningAds: true,
        confidence: 0.80,
        adCountEstimate: 1,
        evidence: `Google Ads Transparency Center listing found: ${allText.slice(0, 200)}`,
      };
    }
  } catch (err) {
    console.error("[AdDetector] Google Ads Transparency check failed:", err);
  }

  return null;
}

async function detectGoogleAds(businessName: string, website?: string | null): Promise<AdDetectionResult | null> {
  const transparencyResult = await queryGoogleAdsTransparency(businessName, website);
  if (transparencyResult) return transparencyResult;

  if (!isSerperConfigured()) return null;

  try {
    const searchQuery = website
      ? `"${businessName}" OR "${website}" google ads`
      : `"${businessName}" google ads sponsored`;

    const result = await searchBusiness(searchQuery);

    const allText = [
      result.website || "",
      ...result.organicUrls,
      ...result.sources,
    ].join(" ").toLowerCase();

    const hasAdSignals = /google\s+ads|adwords|sponsored\s+result|ppc|pay.per.click|running\s+ads/i.test(allText);

    if (hasAdSignals) {
      return {
        platform: "google",
        isRunningAds: true,
        confidence: 0.55,
        adCountEstimate: 1,
        evidence: `Search result suggests Google Ads activity: ${allText.slice(0, 200)}`,
      };
    }
  } catch (err) {
    console.error("[AdDetector] Google ad detection failed:", err);
  }

  return null;
}

async function detectAdsFromWebsite(html: string): Promise<AdDetectionResult[]> {
  const results: AdDetectionResult[] = [];

  const fbPixelPatterns = [
    /fbevents\.js/i,
    /facebook\.com\/tr/i,
    /fbq\s*\(/i,
    /fb-pixel/i,
  ];

  for (const pattern of fbPixelPatterns) {
    if (pattern.test(html)) {
      results.push({
        platform: "facebook",
        isRunningAds: true,
        confidence: 0.70,
        adCountEstimate: 1,
        evidence: "Facebook Pixel detected on website (indicates ad tracking)",
      });
      break;
    }
  }

  const googleAdsPatterns = [
    /googleads\.g\.doubleclick\.net/i,
    /google-analytics\.com\/analytics\.js/i,
    /gtag.*AW-/i,
    /adsbygoogle/i,
    /google_ad_client/i,
    /googlesyndication/i,
  ];

  for (const pattern of googleAdsPatterns) {
    if (pattern.test(html)) {
      results.push({
        platform: "google",
        isRunningAds: true,
        confidence: 0.60,
        adCountEstimate: 1,
        evidence: "Google Ads tracking code detected on website",
      });
      break;
    }
  }

  return results;
}

export async function detectAds(businessId: number): Promise<AdDetectionResult[]> {
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) {
    console.log(`[AdDetector] Business ${businessId} not found`);
    return [];
  }

  let allResults: AdDetectionResult[] = [];

  if (business.websiteDomain) {
    try {
      const cleanUrl = business.websiteDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`https://${cleanUrl}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
      });
      clearTimeout(timeout);

      if (response.ok) {
        const html = await response.text();
        const websiteResults = await detectAdsFromWebsite(html);
        allResults.push(...websiteResults);
      }
    } catch {
    }
  }

  if (allResults.length === 0) {
    const fbResult = await detectFacebookAds(business.canonicalName, business.facebookUrl);
    if (fbResult) allResults.push(fbResult);

    const googleResult = await detectGoogleAds(business.canonicalName, business.websiteDomain);
    if (googleResult) allResults.push(googleResult);
  }

  const uniqueResults = new Map<string, AdDetectionResult>();
  for (const result of allResults) {
    const existing = uniqueResults.get(result.platform);
    if (!existing || result.confidence > existing.confidence) {
      uniqueResults.set(result.platform, result);
    }
  }

  const finalResults = Array.from(uniqueResults.values());

  for (const result of finalResults) {
    try {
      const existing = await db.select()
        .from(adSignals)
        .where(and(
          eq(adSignals.businessId, businessId),
          eq(adSignals.platform, result.platform),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(adSignals)
          .set({
            isRunningAds: result.isRunningAds,
            confidenceScore: result.confidence,
            adCountEstimate: result.adCountEstimate,
            lastSeenAt: new Date(),
            evidence: result.evidence,
          })
          .where(eq(adSignals.id, existing[0].id));
      } else {
        const signal: InsertAdSignal = {
          businessId,
          platform: result.platform,
          isRunningAds: result.isRunningAds,
          confidenceScore: result.confidence,
          adCountEstimate: result.adCountEstimate,
          lastSeenAt: new Date(),
          evidence: result.evidence,
        };
        await db.insert(adSignals).values(signal);
      }
    } catch (err) {
      console.error(`[AdDetector] Failed to store ad signal for ${result.platform}:`, err);
    }
  }

  console.log(`[AdDetector] Detected ${finalResults.length} ad platforms for business ${businessId}: ${finalResults.map(r => r.platform).join(", ")}`);
  return finalResults;
}

export async function getAdSignals(businessId: number) {
  return db.select()
    .from(adSignals)
    .where(eq(adSignals.businessId, businessId));
}

export async function getAdDistribution() {
  const signals = await db.select({
    platform: adSignals.platform,
    isRunningAds: adSignals.isRunningAds,
  }).from(adSignals);

  const distribution: Record<string, { running: number; notRunning: number }> = {};
  for (const signal of signals) {
    if (!distribution[signal.platform]) {
      distribution[signal.platform] = { running: 0, notRunning: 0 };
    }
    if (signal.isRunningAds) {
      distribution[signal.platform].running++;
    } else {
      distribution[signal.platform].notRunning++;
    }
  }

  return Object.entries(distribution)
    .map(([platform, counts]) => ({ platform, ...counts }))
    .sort((a, b) => b.running - a.running);
}
