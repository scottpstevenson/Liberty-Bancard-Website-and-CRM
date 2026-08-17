/**
 * Serper public API — thin wrappers over the canonical SerperGateway (#1600).
 *
 * All network access flows through `serperGateway.executeSearch(...)`; this
 * module keeps its historical exports (searchBusiness, searchBusinessEmail,
 * searchBusinessContacts, isSerperConfigured, getSerperUsage, resetSerperUsage)
 * so existing callsites in enrichment.ts, sunbiz-enrichment.ts, and routes
 * are undisturbed. Usage stats now read from the durable serper_control row.
 */

import { serperGateway } from "./serper-gateway";

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface SerperKnowledgeGraph {
  title?: string;
  type?: string;
  website?: string;
  phone?: string;
  address?: string;
  description?: string;
}

interface SerperSearchResponse {
  organic: SerperOrganicResult[];
  knowledgeGraph?: SerperKnowledgeGraph;
  answerBox?: any;
  searchParameters?: any;
}

interface SerperUsageStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  websitesFound: number;
  emailsFound: number;
  phonesFound: number;
  lastCallAt: string | null;
  resetAt: string;
  monthlyQuota: number;
  remainingCalls: number;
}

export function isSerperConfigured(): boolean {
  return !!process.env.SERPER_API_KEY;
}

const SERPER_MONTHLY_QUOTA = 50000;

function defaultUsageStats(): SerperUsageStats {
  return {
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    websitesFound: 0,
    emailsFound: 0,
    phonesFound: 0,
    lastCallAt: null,
    resetAt: new Date().toISOString(),
    monthlyQuota: SERPER_MONTHLY_QUOTA,
    remainingCalls: SERPER_MONTHLY_QUOTA,
  };
}

export async function getSerperUsage(): Promise<SerperUsageStats> {
  try {
    const control = await serperGateway.getControl();
    if (!control) return defaultUsageStats();
    const lastSuccess = control.last_success_at ? new Date(control.last_success_at).getTime() : 0;
    const lastFailure = control.last_failure_at ? new Date(control.last_failure_at).getTime() : 0;
    const lastCall = Math.max(lastSuccess, lastFailure);
    return {
      totalCalls: control.window_calls,
      successfulCalls: control.window_successes,
      failedCalls: control.window_failures,
      websitesFound: Number(control.yield_websites),
      emailsFound: Number(control.yield_emails),
      phonesFound: Number(control.yield_phones),
      lastCallAt: lastCall > 0 ? new Date(lastCall).toISOString() : null,
      resetAt: new Date(control.window_started_at).toISOString(),
      monthlyQuota: control.local_budget,
      remainingCalls: Math.max(0, control.local_budget - control.window_calls),
    };
  } catch (err) {
    console.error("[Serper] Usage read error:", err);
    return defaultUsageStats();
  }
}

export async function resetSerperUsage(): Promise<void> {
  await serperGateway.resetWindowCounters();
}

async function serperSearch(query: string, num: number = 10, callSite: string = "serper_search"): Promise<SerperSearchResponse | null> {
  if (!isSerperConfigured()) {
    console.warn("[Serper] No API key configured. Set SERPER_API_KEY env variable.");
    return null;
  }
  const result = await serperGateway.executeSearch("/search", { q: query, num }, callSite);
  if (!result.ok) {
    if (result.blocked) {
      console.warn(`[Serper] Blocked by gateway (${result.blockReason}) for ${callSite}`);
    } else {
      console.error(`[Serper] Gateway error for ${callSite}: ${result.error ?? result.status}`);
    }
    return null;
  }
  return result.data as SerperSearchResponse;
}

const DIRECTORY_DOMAINS = [
  "google.com", "gstatic.com", "googleapis.com",
  "sunbiz.org", "wikipedia.org", "reddit.com", "pinterest.com",
  "tiktok.com", "apple.com", "amazon.com", "nextdoor.com",
  "dandb.com", "indeed.com", "glassdoor.com",
  "facebook.com", "linkedin.com", "yelp.com", "bbb.org",
  "yellowpages.com", "mapquest.com", "tripadvisor.com",
  "chamberofcommerce.com", "manta.com", "angi.com",
  "thumbtack.com", "homeadvisor.com", "instagram.com",
  "twitter.com", "x.com",
];

function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isBusinessWebsite(domain: string): boolean {
  if (domain.length < 4) return false;
  return !DIRECTORY_DOMAINS.some(dd => domain === dd || domain.endsWith(`.${dd}`));
}

function extractContactFromText(text: string): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];

  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const emailMatches = text.match(emailRegex);
  if (emailMatches) {
    const skipDomains = ["example.com", "test.com", "placeholder.com", "sentry.io", "wixpress.com", "w3.org", "schema.org", "googleapis.com", "facebook.com", "google.com"];
    const unique = Array.from(new Set(emailMatches.map(e => e.toLowerCase())));
    emails.push(...unique.filter(e => !skipDomains.some(d => e.endsWith(`@${d}`))).slice(0, 5));
  }

  const phoneRegex = /(?:\+1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)[2-9]\d{2}[\s.-]?\d{4}/g;
  const phoneMatches = text.match(phoneRegex);
  if (phoneMatches) {
    const cleaned = Array.from(new Set(phoneMatches.map(p => p.replace(/[^\d+]/g, ""))));
    phones.push(...cleaned.filter(p => p.length >= 10 && p.length <= 12).slice(0, 5));
  }

  return { emails, phones };
}

function cleanEntityName(name: string): string {
  return name
    .replace(/\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|PLLC|PA|PC|P\.A\.|P\.C\.|L\.L\.C\.|GROUP|ENTERPRISES|SERVICES|SOLUTIONS|INTERNATIONAL|PARTNERS|ASSOCIATES|OF\s+FLORIDA|OF\s+FL)\b\.*/gi, "")
    .replace(/[^a-zA-Z0-9\s&'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SerperBusinessResult {
  website: string | null;
  emails: string[];
  phones: string[];
  knowledgeGraphPhone: string | null;
  knowledgeGraphWebsite: string | null;
  organicUrls: string[];
  sources: string[];
}

export async function searchBusiness(
  name: string,
  city?: string,
  state: string = "FL"
): Promise<SerperBusinessResult> {
  const result: SerperBusinessResult = {
    website: null,
    emails: [],
    phones: [],
    knowledgeGraphPhone: null,
    knowledgeGraphWebsite: null,
    organicUrls: [],
    sources: [],
  };

  const cleanName = cleanEntityName(name);
  const location = city ? `${city}, ${state}` : state === "FL" ? "Florida" : state;
  const query = `${cleanName} ${location}`;

  const data = await serperSearch(query, 10, "search_business");
  if (!data) return result;

  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    if (kg.website) {
      const domain = extractDomainFromUrl(kg.website);
      if (domain && isBusinessWebsite(domain)) {
        result.knowledgeGraphWebsite = domain;
        result.website = domain;
        result.sources.push("serper_knowledge_graph");
      }
    }
    if (kg.phone) {
      const cleaned = kg.phone.replace(/[^\d]/g, "");
      if (cleaned.length >= 10 && cleaned.length <= 11) {
        result.knowledgeGraphPhone = cleaned;
        result.phones.push(cleaned);
        result.sources.push("serper_kg_phone");
      }
    }
  }

  if (data.organic) {
    for (const item of data.organic.slice(0, 5)) {
      const domain = extractDomainFromUrl(item.link);
      if (domain && isBusinessWebsite(domain)) {
        result.organicUrls.push(item.link);
        if (!result.website) {
          result.website = domain;
          result.sources.push("serper_organic");
        }
      }

      const snippetContacts = extractContactFromText(item.snippet || "");
      if (snippetContacts.emails.length > 0) {
        result.emails.push(...snippetContacts.emails);
        result.sources.push("serper_snippet_email");
      }
      if (snippetContacts.phones.length > 0) {
        result.phones.push(...snippetContacts.phones);
        result.sources.push("serper_snippet_phone");
      }
    }
  }

  result.emails = [...new Set(result.emails)];
  result.phones = [...new Set(result.phones)];
  result.sources = [...new Set(result.sources)];

  await serperGateway.recordYield({
    website: !!result.website,
    email: result.emails.length > 0,
    phone: result.phones.length > 0,
  });

  return result;
}

export async function searchBusinessEmail(
  name: string,
  domain?: string,
  city?: string,
  state: string = "FL"
): Promise<{ emails: string[]; phones: string[]; sources: string[] }> {
  const cleanName = cleanEntityName(name);
  const emails: string[] = [];
  const phones: string[] = [];
  const sources: string[] = [];

  const query = domain
    ? `"${cleanName}" "${domain}" email contact`
    : city
      ? `"${cleanName}" "${city}" ${state} email "@"`
      : `"${cleanName}" Florida email "@"`;

  const data = await serperSearch(query, 5, "search_business_email");
  if (!data) return { emails, phones, sources };

  for (const item of (data.organic || [])) {
    const contacts = extractContactFromText(item.snippet || "");
    if (contacts.emails.length > 0) {
      emails.push(...contacts.emails);
      sources.push("serper_email_search");
    }
    if (contacts.phones.length > 0) {
      phones.push(...contacts.phones);
      sources.push("serper_email_search_phone");
    }
  }

  const uniqueEmails = [...new Set(emails)];
  const uniquePhones = [...new Set(phones)];

  await serperGateway.recordYield({
    email: uniqueEmails.length > 0,
    phone: uniquePhones.length > 0,
  });

  return { emails: uniqueEmails, phones: uniquePhones, sources: [...new Set(sources)] };
}

export async function searchBusinessContacts(
  name: string,
  city?: string,
  address?: string,
  state: string = "FL"
): Promise<{ emails: string[]; phones: string[]; website: string | null; sources: string[] }> {
  const cleanName = cleanEntityName(name);
  const emails: string[] = [];
  const phones: string[] = [];
  let website: string | null = null;
  const sources: string[] = [];

  const location = city ? `"${city}" ${state}` : "Florida";
  const query = `"${cleanName}" ${location} phone email`;

  const data = await serperSearch(query, 10, "search_business_contacts");
  if (!data) return { emails, phones, website, sources };

  if (data.knowledgeGraph) {
    const kg = data.knowledgeGraph;
    if (kg.phone) {
      const cleaned = kg.phone.replace(/[^\d]/g, "");
      if (cleaned.length >= 10) { phones.push(cleaned); sources.push("serper_kg_phone"); }
    }
    if (kg.website) {
      const domain = extractDomainFromUrl(kg.website);
      if (domain && isBusinessWebsite(domain)) { website = domain; sources.push("serper_kg_website"); }
    }
  }

  for (const item of (data.organic || []).slice(0, 5)) {
    const contacts = extractContactFromText(item.snippet || "");
    emails.push(...contacts.emails);
    phones.push(...contacts.phones);

    if (!website) {
      const domain = extractDomainFromUrl(item.link);
      if (domain && isBusinessWebsite(domain)) { website = domain; }
    }
  }

  if (emails.length > 0) sources.push("serper_contact_search");
  if (phones.length > 0) sources.push("serper_contact_search");

  const uniqueEmails = [...new Set(emails)];
  const uniquePhones = [...new Set(phones)];

  await serperGateway.recordYield({
    website: !!website,
    email: uniqueEmails.length > 0,
    phone: uniquePhones.length > 0,
  });

  return { emails: uniqueEmails, phones: uniquePhones, website, sources: [...new Set(sources)] };
}
