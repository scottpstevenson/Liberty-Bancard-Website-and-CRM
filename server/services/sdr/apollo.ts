import { storage } from "../../storage";

const APOLLO_API_URL = "https://api.apollo.io/v1";

export interface ApolloBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  category: string | null;
  rawData: Record<string, any>;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  ownerTitle: string | null;
}

interface ApolloUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  contactsFound: number;
  lastCallAt: string | null;
  estimatedCost: number;
}

const rateLimitState = {
  lastCallAt: 0,
  minIntervalMs: 1100,
};

function acquireToken(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      const now = Date.now();
      const elapsed = now - rateLimitState.lastCallAt;
      if (elapsed >= rateLimitState.minIntervalMs) {
        rateLimitState.lastCallAt = now;
        resolve();
      } else {
        setTimeout(tryAcquire, rateLimitState.minIntervalMs - elapsed);
      }
    };
    tryAcquire();
  });
}

export function isApolloConfigured(): boolean {
  return !!process.env.APOLLO_API_KEY;
}

async function trackApolloCall(success: boolean, contactsFound: number = 0) {
  try {
    const existing = await storage.getSystemSetting("apollo_usage") as ApolloUsageStats | null;
    const stats: ApolloUsageStats = existing || {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      contactsFound: 0,
      lastCallAt: null,
      estimatedCost: 0,
    };
    stats.totalCalls++;
    if (success) {
      stats.successfulCalls++;
      stats.contactsFound += contactsFound;
      stats.estimatedCost += contactsFound * 0.10;
    } else {
      stats.failedCalls++;
    }
    stats.lastCallAt = new Date().toISOString();
    await storage.setSystemSetting("apollo_usage", stats);
  } catch (err) {
    console.error("[Apollo] Usage tracking error:", err);
  }
}

export async function getApolloUsage(): Promise<ApolloUsageStats> {
  const stats = await storage.getSystemSetting("apollo_usage") as ApolloUsageStats | null;
  return stats || {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    contactsFound: 0,
    lastCallAt: null,
    estimatedCost: 0,
  };
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "");
  }
}

function extractFirstPhone(phoneNumbers: any[]): string | null {
  if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) return null;
  const primary = phoneNumbers.find(p => p.type === "work" || p.type === "direct_phone") || phoneNumbers[0];
  return normalizePhone(primary?.sanitized_number || primary?.raw_number);
}

function parseApolloPerson(raw: Record<string, any>): ApolloBusiness {
  const org = raw.organization || {};
  const orgPhone = normalizePhone(org.phone);
  const personPhone = extractFirstPhone(raw.phone_numbers || []);

  return {
    name: org.name || "",
    phone: orgPhone || personPhone,
    email: raw.email || null,
    website: extractDomain(org.primary_domain || org.website_url),
    address: org.street_address || null,
    city: org.city || null,
    state: org.state || null,
    zip: org.postal_code || null,
    category: Array.isArray(org.keywords) ? org.keywords[0] : null,
    rawData: raw,
    ownerFirstName: raw.first_name || null,
    ownerLastName: raw.last_name || null,
    ownerEmail: raw.email || null,
    ownerPhone: personPhone,
    ownerTitle: raw.title || null,
  };
}

function parseApolloOrg(raw: Record<string, any>): ApolloBusiness {
  return {
    name: raw.name || "",
    phone: normalizePhone(raw.phone),
    email: raw.email || null,
    website: extractDomain(raw.primary_domain || raw.website_url),
    address: raw.street_address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.postal_code || null,
    category: Array.isArray(raw.keywords) ? raw.keywords[0] : null,
    rawData: raw,
    ownerFirstName: null,
    ownerLastName: null,
    ownerEmail: null,
    ownerPhone: null,
    ownerTitle: null,
  };
}

export async function testApolloConnection(): Promise<{ success: true; count: number; message: string }> {
  if (!process.env.APOLLO_API_KEY) {
    throw new Error("Apollo API key not configured. Set APOLLO_API_KEY environment variable.");
  }

  await acquireToken();

  const body = {
    q_organization_keyword_tags: ["restaurant"],
    person_titles: ["owner", "ceo"],
    organization_locations: ["Miami, FL"],
    page: 1,
    per_page: 1,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    response = await fetch(`${APOLLO_API_URL}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === "AbortError") {
      throw new Error("Apollo API request timed out.");
    }
    throw new Error(`Apollo API network error: ${err.message}`);
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Apollo authentication failed (HTTP ${response.status}). Check your APOLLO_API_KEY and ensure your plan supports API access (Professional or higher required).`);
    }
    if (response.status === 422) {
      throw new Error(`Apollo rejected the request (HTTP 422): ${errorText}`);
    }
    throw new Error(`Apollo API error (HTTP ${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const people: any[] = data.people || [];
  const organizations: any[] = data.organizations || [];
  const count = people.length + organizations.length;

  return {
    success: true,
    count,
    message: `Apollo connection successful. Found ${count} result(s) in test search.`,
  };
}

export async function searchApolloForDiscovery(
  vertical: string,
  metro: string,
  state: string = "FL",
  limit: number = 100
): Promise<ApolloBusiness[]> {
  if (!process.env.APOLLO_API_KEY) {
    console.warn("[Apollo] No API key configured. Set APOLLO_API_KEY env variable. Apollo Professional plan or higher required for API access.");
    return [];
  }

  await acquireToken();

  const perPage = Math.min(limit, 100);
  const ownerTitles = ["owner", "president", "ceo", "founder", "co-founder", "partner", "managing partner", "principal", "gm", "general manager", "director"];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const body = {
      q_organization_keyword_tags: [vertical],
      person_titles: ownerTitles,
      organization_locations: [`${metro}, ${state}`],
      page: 1,
      per_page: perPage,
    };

    const response = await fetch(`${APOLLO_API_URL}/mixed_people/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": process.env.APOLLO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      if (response.status === 401 || response.status === 403) {
        console.error(`[Apollo] Authentication failed (${response.status}). Check APOLLO_API_KEY and ensure your plan supports API access (Professional or higher required).`);
      } else if (response.status === 422) {
        console.error(`[Apollo] Invalid request parameters: ${errorText}`);
      } else {
        console.error(`[Apollo] API error ${response.status}: ${errorText}`);
      }
      await trackApolloCall(false);
      return [];
    }

    const data = await response.json() as any;
    const people: Record<string, any>[] = data.people || [];
    const organizations: Record<string, any>[] = data.organizations || [];

    const results: ApolloBusiness[] = [];
    const seenOrgs = new Set<string>();
    let peopleCount = 0;

    for (const person of people) {
      const orgName = person.organization?.name;
      if (!orgName) continue;
      const parsed = parseApolloPerson(person);
      if (parsed.name) {
        results.push(parsed);
        seenOrgs.add(orgName.toLowerCase());
        peopleCount++;
      }
    }

    for (const org of organizations) {
      if (!org.name) continue;
      if (seenOrgs.has(org.name.toLowerCase())) continue;
      results.push(parseApolloOrg(org));
    }

    await trackApolloCall(true, peopleCount);
    console.log(`[Apollo] Found ${results.length} results (${peopleCount} contact records, ${results.length - peopleCount} org-only) for ${vertical} in ${metro}, ${state}`);
    return results;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      console.error(`[Apollo] Request timed out for ${vertical} in ${metro}`);
    } else {
      console.error(`[Apollo] Search error for ${vertical} in ${metro}:`, err);
    }
    await trackApolloCall(false);
    return [];
  }
}
