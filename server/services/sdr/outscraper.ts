import { storage } from "../../storage";
import { assertProviderActivation } from "../provider-manifest";

const OUTSCRAPER_API_URL = "https://api.app.outscraper.com";

export interface OutscraperBusiness {
  name: string;
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
  category: string | null;
  rawData: Record<string, any>;
}

interface OutscraperUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  businessesFound: number;
  lastCallAt: string | null;
  estimatedCost: number;
}

const rateLimitState = {
  tokens: 2,
  maxTokens: 2,
  lastRefill: Date.now(),
};

function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const elapsed = now - rateLimitState.lastRefill;
      if (elapsed >= 2000) {
        rateLimitState.tokens = rateLimitState.maxTokens;
        rateLimitState.lastRefill = now;
      }
      if (rateLimitState.tokens > 0) {
        rateLimitState.tokens--;
        resolve();
      } else {
        setTimeout(tryAcquire, 500);
      }
    };
    tryAcquire();
  });
}

export function isOutscraperConfigured(): boolean {
  return !!process.env.OUTSCRAPER_API_KEY;
}

async function trackOutscraperCall(success: boolean, businessesFound: number = 0) {
  try {
    const existing = await storage.getSystemSetting("outscraper_usage") as OutscraperUsageStats | null;
    const stats: OutscraperUsageStats = existing || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      businessesFound: 0,
      lastCallAt: null,
      estimatedCost: 0,
    };
    stats.totalCalls++;
    if (success) {
      stats.successfulCalls++;
      stats.businessesFound += businessesFound;
      stats.estimatedCost += businessesFound * 0.002;
    } else {
      stats.failedCalls++;
    }
    stats.lastCallAt = new Date().toISOString();
    await storage.setSystemSetting("outscraper_usage", stats);
  } catch (err) {
    console.error("[Outscraper] Usage tracking error:", err);
  }
}

export async function getOutscraperUsage(): Promise<OutscraperUsageStats> {
  const stats = await storage.getSystemSetting("outscraper_usage") as OutscraperUsageStats | null;
  return stats || {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    businessesFound: 0,
    lastCallAt: null,
    estimatedCost: 0,
  };
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length > 11) return digits.slice(-10);
  return digits.length >= 10 ? digits : null;
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parseOutscraperResult(raw: Record<string, any>): OutscraperBusiness {
  return {
    name: raw.name || raw.title || "",
    phone: normalizePhone(raw.phone || raw.phone_number),
    email: raw.email || raw.emails?.[0] || null,
    website: extractDomain(raw.site || raw.website),
    address: raw.full_address || raw.address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.postal_code || raw.zip || null,
    rating: raw.rating ? parseFloat(raw.rating) : null,
    reviewCount: raw.reviews ? parseInt(raw.reviews) : null,
    placeId: raw.place_id || raw.google_id || null,
    category: raw.category || raw.type || null,
    rawData: raw,
  };
}

export async function searchOutscraper(
  query: string,
  limit: number = 200,
  region: string = "US"
): Promise<OutscraperBusiness[]> {
  assertProviderActivation({
    sourceId: "outscraper",
    caller: "unapproved",
    explicitPaidApproval: false,
  });
  if (!process.env.OUTSCRAPER_API_KEY) {
    console.warn("[Outscraper] No API key configured. Set OUTSCRAPER_API_KEY env variable.");
    return [];
  }

  await acquireToken();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const params = new URLSearchParams({
      query,
      limit: String(Math.min(limit, 500)),
      region,
      language: "en",
      async: "false",
    });

    const response = await fetch(`${OUTSCRAPER_API_URL}/maps/search-v3?${params}`, {
      method: "GET",
      headers: {
        "X-API-KEY": process.env.OUTSCRAPER_API_KEY,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(`[Outscraper] API error ${response.status}: ${errorText}`);
      await trackOutscraperCall(false);
      return [];
    }

    const data = await response.json();
    const results: OutscraperBusiness[] = [];

    const items = Array.isArray(data) ? data.flat() : data.data ? [].concat(...data.data) : [];

    for (const item of items) {
      if (!item || !item.name) continue;
      results.push(parseOutscraperResult(item));
    }

    await trackOutscraperCall(true, results.length);
    console.log(`[Outscraper] Found ${results.length} businesses for query: ${query}`);
    return results;
  } catch (err) {
    console.error("[Outscraper] Search error:", err);
    await trackOutscraperCall(false);
    return [];
  }
}

export async function searchOutscraperByVerticalMetro(
  vertical: string,
  metro: string,
  state: string = "FL",
  limit: number = 200
): Promise<OutscraperBusiness[]> {
  const query = `${vertical} ${metro} ${state}`;
  return searchOutscraper(query, limit);
}
