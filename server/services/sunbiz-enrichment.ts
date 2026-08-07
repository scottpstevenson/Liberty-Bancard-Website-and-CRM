import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { SunbizEntity } from "@shared/schema";
import OpenAI from "openai";
import { checkAiGate, recordAiSpend } from "./ai-audit-logger";
import { toProperCase } from "./sunbiz-scraper";
import { isSerperConfigured, searchBusiness, searchBusinessEmail, searchBusinessContacts } from "./serper";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

const MAX_RESPONSE_BYTES = 3 * 1024 * 1024; // 3 MB hard cap per fetched body

// Reads a fetch Response body with a hard byte cap. Returns null (and logs)
// if the body exceeds the cap, so a single oversized response can never be
// fully buffered/parsed and exhaust the heap.
async function readCappedText(response: Response, label: string, maxBytes = MAX_RESPONSE_BYTES): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    console.warn(`[Enrich] Skipping oversized response (${contentLength} bytes via content-length) from ${label}`);
    try { await response.body?.cancel(); } catch {}
    return null;
  }

  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      console.warn(`[Enrich] Skipping oversized response (no stream) from ${label}`);
      return null;
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          console.warn(`[Enrich] Skipping oversized response (>${maxBytes} bytes) from ${label}`);
          try { await reader.cancel(); } catch {}
          return null;
        }
        chunks.push(value);
      }
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function fetchWebsite(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(cleanUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      redirect: "follow",
    });
    if (!response.ok) { clearTimeout(timeout); return null; }
    const html = await readCappedText(response, cleanUrl);
    clearTimeout(timeout);
    if (html === null) return null;
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return null;
  }
}

async function fetchContactPages(domain: string): Promise<string> {
  const contactPaths = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/staff"];
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let combined = "";

  for (const path of contactPaths) {
    if (combined.length > 20000) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`https://${cleanDomain}${path}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        redirect: "follow",
      });
      if (!response.ok) { clearTimeout(timeout); continue; }
      const html = await readCappedText(response, `${cleanDomain}${path}`);
      clearTimeout(timeout);
      if (html !== null) {
        const cleaned = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .slice(0, 8000);
        if (cleaned.length > 50) combined += ` ${cleaned}`;
      }
    } catch {
      continue;
    }
  }
  return combined;
}

function extractContactFromHtml(html: string): { emails: string[]; phones: string[] } {
  const emails: string[] = [];
  const phones: string[] = [];

  const emailRegex = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
  const emailMatches = html.match(emailRegex);
  if (emailMatches) {
    const uniqueEmails = Array.from(new Set(emailMatches.map(e => e.toLowerCase())));
    const skipDomains = ["example.com", "test.com", "placeholder.com", "sentry.io", "wixpress.com", "w3.org", "schema.org", "googleapis.com", "facebook.com", "google.com"];
    emails.push(...uniqueEmails.filter(e => !skipDomains.some(d => e.endsWith(`@${d}`))).slice(0, 5));
  }

  const phoneRegex = /(?:\+1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-]?)[2-9]\d{2}[\s.-]?\d{4}/g;
  const phoneMatches = html.match(phoneRegex);
  if (phoneMatches) {
    const cleaned = Array.from(new Set(phoneMatches.map(p => p.replace(/[^\d+]/g, ""))));
    phones.push(...cleaned.filter(p => p.length >= 10 && p.length <= 12).slice(0, 5));
  }

  return { emails, phones };
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BROWSER_HEADERS = { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" };

async function fetchPage(url: string, timeoutMs = 6000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS, redirect: "follow" });
    if (!r.ok) { clearTimeout(t); return null; }
    const text = await readCappedText(r, url);
    clearTimeout(t);
    return text;
  } catch { return null; }
}

function cleanEntityName(name: string): string {
  return name
    .replace(/\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|PLLC|PA|PC|P\.A\.|P\.C\.|L\.L\.C\.|GROUP|ENTERPRISES|SERVICES|SOLUTIONS|INTERNATIONAL|PARTNERS|ASSOCIATES|OF\s+FLORIDA|OF\s+FL)\b\.*/gi, "")
    .replace(/[^a-zA-Z0-9\s&'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGoogleResultUrls(html: string, includeSocial = false): string[] {
  const directoryDomains = [
    "google.com", "gstatic.com", "googleapis.com",
    "sunbiz.org", "wikipedia.org", "reddit.com", "pinterest.com",
    "tiktok.com", "apple.com", "amazon.com", "nextdoor.com",
    "dandb.com", "indeed.com", "glassdoor.com",
  ];
  const socialDomains = ["facebook.com", "linkedin.com", "yelp.com", "bbb.org", "yellowpages.com"];
  const skipDomains = includeSocial ? directoryDomains : [...directoryDomains, ...socialDomains];
  const urls: string[] = [];
  const urlRegex = /href="\/url\?q=(https?:\/\/[^&"]+)/g;
  let match;
  while ((match = urlRegex.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      const url = new URL(decoded);
      const domain = url.hostname.replace(/^www\./, "");
      if (domain.length >= 4
        && !skipDomains.some(sd => domain === sd || domain.endsWith(`.${sd}`))
        && !domain.includes("google") && !domain.includes("gstatic")) {
        urls.push(decoded);
      }
    } catch { continue; }
  }
  return [...new Set(urls)];
}

async function googleSearch(query: string): Promise<string | null> {
  return fetchPage(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`);
}

async function searchGoogleForWebsite(businessName: string, city?: string): Promise<string | null> {
  const clean = cleanEntityName(businessName);
  const query = city ? `${clean} ${city} FL` : `${clean} Florida`;
  const html = await googleSearch(query);
  if (!html) return null;

  const urls = extractGoogleResultUrls(html, false);
  for (const fullUrl of urls.slice(0, 3)) {
    try {
      const domain = new URL(fullUrl).hostname.replace(/^www\./, "");
      if (domain.length < 5) continue;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const r = await fetch(`https://${domain}`, {
        signal: controller.signal,
        headers: { "User-Agent": BROWSER_UA },
        method: "HEAD",
        redirect: "follow",
      });
      clearTimeout(t);
      if (r.ok || r.status === 301 || r.status === 302) return domain;
    } catch { continue; }
  }
  return null;
}

async function searchGoogleForContacts(businessName: string, city?: string, address?: string): Promise<{ emails: string[]; phones: string[]; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const queries = [];
  if (city && address) {
    queries.push(`"${clean}" "${city}" FL phone email`);
    queries.push(`"${clean}" "${address}" phone`);
  } else if (city) {
    queries.push(`"${clean}" "${city}" FL phone email`);
  } else {
    queries.push(`"${clean}" Florida phone email`);
  }

  const allEmails: string[] = [];
  const allPhones: string[] = [];
  let foundWebsite: string | null = null;

  for (const q of queries) {
    const html = await googleSearch(q);
    if (!html) continue;
    const serpContacts = extractContactFromHtml(html);
    if (serpContacts.phones.length > 0) allPhones.push(...serpContacts.phones);
    if (serpContacts.emails.length > 0) allEmails.push(...serpContacts.emails);

    const urls = extractGoogleResultUrls(html, true);
    for (const url of urls.slice(0, 3)) {
      try {
        const pageHtml = await fetchWebsite(url);
        if (pageHtml) {
          const extracted = extractContactFromHtml(pageHtml);
          allEmails.push(...extracted.emails);
          allPhones.push(...extracted.phones);
          if (!foundWebsite) {
            const domain = new URL(url).hostname.replace(/^www\./, "");
            const directoryDomains = ["facebook.com", "linkedin.com", "yelp.com", "bbb.org", "yellowpages.com", "mapquest.com", "tripadvisor.com", "instagram.com", "twitter.com", "chamberofcommerce.com"];
            if (!directoryDomains.some(sd => domain === sd || domain.endsWith(`.${sd}`))) {
              foundWebsite = domain;
            }
          }
        }
      } catch { continue; }
      await new Promise(r => setTimeout(r, 800));
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  return { emails: [...new Set(allEmails)], phones: [...new Set(allPhones)], website: foundWebsite };
}

async function scrapeFacebookPage(businessName: string, city?: string): Promise<{ phone: string | null; email: string | null; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const query = city ? `site:facebook.com "${clean}" "${city}" FL` : `site:facebook.com "${clean}" Florida`;
  const html = await googleSearch(query);
  if (!html) return { phone: null, email: null, website: null };

  const fbUrls = extractGoogleResultUrls(html, true).filter(u => u.includes("facebook.com"));
  if (fbUrls.length === 0) return { phone: null, email: null, website: null };

  const fbHtml = await fetchPage(fbUrls[0]);
  if (!fbHtml) return { phone: null, email: null, website: null };

  const contacts = extractContactFromHtml(fbHtml);

  const websiteMatch = fbHtml.match(/"website"\s*:\s*"(https?:\/\/[^"]+)"/) ||
    fbHtml.match(/(?:Website|External link)[\s\S]{0,200}(https?:\/\/(?!facebook\.com)[a-zA-Z0-9][a-zA-Z0-9\-]*\.[a-zA-Z]{2,}[^\s"<]*)/i);
  let website: string | null = null;
  if (websiteMatch) {
    try { website = new URL(websiteMatch[1]).hostname.replace(/^www\./, ""); } catch {}
  }

  return {
    phone: contacts.phones[0] || null,
    email: contacts.emails[0] || null,
    website,
  };
}

async function scrapeLinkedInPage(businessName: string, city?: string): Promise<{ phone: string | null; email: string | null; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const query = city ? `site:linkedin.com/company "${clean}" "${city}" FL` : `site:linkedin.com/company "${clean}" Florida`;
  const html = await googleSearch(query);
  if (!html) return { phone: null, email: null, website: null };

  const liUrls = extractGoogleResultUrls(html, true).filter(u => u.includes("linkedin.com/company"));
  if (liUrls.length === 0) return { phone: null, email: null, website: null };

  const liHtml = await fetchPage(liUrls[0]);
  if (!liHtml) return { phone: null, email: null, website: null };

  const contacts = extractContactFromHtml(liHtml);
  const websiteMatch = liHtml.match(/"companyUrl"\s*:\s*"(https?:\/\/[^"]+)"/) ||
    liHtml.match(/"url"\s*:\s*"(https?:\/\/(?!linkedin\.com)[^"]+)"/);
  let website: string | null = null;
  if (websiteMatch) {
    try { website = new URL(websiteMatch[1]).hostname.replace(/^www\./, ""); } catch {}
  }

  return {
    phone: contacts.phones[0] || null,
    email: contacts.emails[0] || null,
    website,
  };
}

async function scrapeYellowPages(businessName: string, city?: string): Promise<{ phone: string | null; email: string | null; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const loc = city ? `${city}, FL` : "Florida";
  const url = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(clean)}&geo_location_terms=${encodeURIComponent(loc)}`;
  const html = await fetchPage(url);
  if (!html) return { phone: null, email: null, website: null };

  const phoneMatch = html.match(/class="phones[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  let phone: string | null = null;
  if (phoneMatch) {
    const p = phoneMatch[1].match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (p) phone = p[0].replace(/[^\d]/g, "");
  }
  if (!phone) {
    const altPhone = html.match(/\(\d{3}\)\s*\d{3}-\d{4}/);
    if (altPhone) phone = altPhone[0].replace(/[^\d]/g, "");
  }

  const websiteMatch = html.match(/class="track-visit-website"[^>]*href="([^"]+)"/i) ||
    html.match(/href="(https?:\/\/[^"]+)"[^>]*class="[^"]*website/i);
  let website: string | null = null;
  if (websiteMatch) {
    try { website = new URL(websiteMatch[1]).hostname.replace(/^www\./, ""); } catch {}
  }

  const emailMatch = html.match(/href="mailto:([^"]+)"/i);
  const email = emailMatch ? emailMatch[1] : null;

  return {
    phone: phone && phone.length >= 10 ? phone : null,
    email,
    website,
  };
}

async function scrapeBBB(businessName: string, city?: string): Promise<{ phone: string | null; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const query = city ? `site:bbb.org "${clean}" "${city}" FL` : `site:bbb.org "${clean}" Florida`;
  const html = await googleSearch(query);
  if (!html) return { phone: null, website: null };

  const bbbUrls = extractGoogleResultUrls(html, true).filter(u => u.includes("bbb.org"));
  if (bbbUrls.length === 0) return { phone: null, website: null };

  const bbbHtml = await fetchPage(bbbUrls[0]);
  if (!bbbHtml) return { phone: null, website: null };

  const contacts = extractContactFromHtml(bbbHtml);
  const websiteMatch = bbbHtml.match(/"website"\s*:\s*"(https?:\/\/[^"]+)"/) ||
    bbbHtml.match(/href="(https?:\/\/(?!bbb\.org)[a-zA-Z0-9][a-zA-Z0-9\-]*\.[a-zA-Z]{2,}[^"]*)"[^>]*>.*?(?:Visit Website|Website)/is);
  let website: string | null = null;
  if (websiteMatch) {
    try { website = new URL(websiteMatch[1]).hostname.replace(/^www\./, ""); } catch {}
  }

  return { phone: contacts.phones[0] || null, website };
}

async function scrapeYelpForContacts(businessName: string, city?: string): Promise<{ phone: string | null; email: string | null; website: string | null }> {
  const clean = cleanEntityName(businessName);
  const location = city ? `${city}, FL` : "Florida";
  const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(clean)}&find_loc=${encodeURIComponent(location)}`;
  const html = await fetchPage(searchUrl);
  if (!html) return { phone: null, email: null, website: null };

  const bizUrlMatch = html.match(/href="(\/biz\/[^"?]+)/);
  if (!bizUrlMatch) {
    const phoneMatch = html.match(/\(\d{3}\)\s*\d{3}[-.]?\d{4}/);
    return {
      phone: phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "") : null,
      email: null,
      website: null,
    };
  }

  const bizHtml = await fetchPage(`https://www.yelp.com${bizUrlMatch[1]}`);
  if (!bizHtml) return { phone: null, email: null, website: null };

  const contacts = extractContactFromHtml(bizHtml);
  const phoneMatch = bizHtml.match(/\(\d{3}\)\s*\d{3}[-.]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0].replace(/[^\d]/g, "") : (contacts.phones[0] || null);

  const websiteMatch = bizHtml.match(/biz-website.*?href="([^"]+)"/s) ||
    bizHtml.match(/"externalUrl"\s*:\s*"(https?:\/\/[^"]+)"/) ||
    bizHtml.match(/href="(https?:\/\/(?!yelp\.com)[a-zA-Z0-9][a-zA-Z0-9\-]*\.[a-zA-Z]{2,}[^"]*)"[^>]*rel="noopener[^"]*"/i);
  let website: string | null = null;
  if (websiteMatch) {
    try { website = new URL(websiteMatch[1]).hostname.replace(/^www\./, ""); } catch {}
  }

  return {
    phone: phone && phone.length >= 10 ? phone : null,
    email: contacts.emails[0] || null,
    website,
  };
}

async function scrapeSunbizDetailPage(entity: SunbizEntity): Promise<{
  officers: any[];
  registeredAgentName: string | null;
  registeredAgentAddress: string | null;
}> {
  const filingNum = entity.filingNumber;
  if (!filingNum) return { officers: [], registeredAgentName: null, registeredAgentAddress: null };

  const detailUrl = `https://search.sunbiz.org/Inquiry/CorporationSearch/ConvertDocNum?searchTerm=${encodeURIComponent(filingNum)}`;

  const html = await fetchPage(detailUrl, 8000);
  if (!html) return { officers: [], registeredAgentName: null, registeredAgentAddress: null };

  const officers: any[] = [];

  const officerBlocks = html.match(/Officer\/Director Detail[\s\S]*?(?=Annual Reports|Document Images|$)/i);
  if (officerBlocks) {
    const block = officerBlocks[0];
    const titleRegex = /Title\s*<\/span>\s*<span[^>]*>(.*?)<\/span>/gi;
    const nameRegex = /(?:Name|Officer)\s*<\/span>\s*<span[^>]*>(.*?)<\/span>/gi;
    const addrRegex = /Address\s*<\/span>\s*<span[^>]*>(.*?)<\/span>/gi;
    const titles: string[] = [];
    const names: string[] = [];
    const addrs: string[] = [];
    let m;
    while ((m = titleRegex.exec(block)) !== null) titles.push(m[1].trim());
    while ((m = nameRegex.exec(block)) !== null) names.push(m[1].trim());
    while ((m = addrRegex.exec(block)) !== null) addrs.push(m[1].trim());
    for (let i = 0; i < Math.max(titles.length, names.length); i++) {
      if (names[i]) officers.push({
        title: titles[i] || "Officer",
        name: names[i],
        address: addrs[i] || undefined,
      });
    }
  }

  if (officers.length === 0) {
    const nameSpans = [...html.matchAll(/<span[^>]*class="[^"]*officerName[^"]*"[^>]*>(.*?)<\/span>/gi)];
    const titleSpans = [...html.matchAll(/<span[^>]*class="[^"]*officerTitle[^"]*"[^>]*>(.*?)<\/span>/gi)];
    for (let i = 0; i < nameSpans.length; i++) {
      const name = nameSpans[i]?.[1]?.trim();
      const title = titleSpans[i]?.[1]?.trim() || "Officer";
      if (name) officers.push({ title, name });
    }
  }

  const agentMatch = html.match(/Registered Agent[\s\S]{0,100}?Name[\s\S]*?<span[^>]*>(.*?)<\/span>/i) ||
    html.match(/Registered Agent Name[\s\S]*?<span[^>]*>(.*?)<\/span>/i);
  const agentAddrMatch = html.match(/Registered Agent[\s\S]{0,100}?Address[\s\S]*?<span[^>]*>(.*?)<\/span>/i) ||
    html.match(/Registered Agent Address[\s\S]*?<span[^>]*>(.*?)<\/span>/i);
  const registeredAgentName = agentMatch ? agentMatch[1].trim() : null;
  const registeredAgentAddress = agentAddrMatch ? agentAddrMatch[1].trim() : null;

  return { officers, registeredAgentName, registeredAgentAddress };
}

async function scrapeFloridaDBPR(businessName: string): Promise<{ phone: string | null; email: string | null; ownerName: string | null }> {
  const clean = cleanEntityName(businessName);
  const query = `site:myfloridalicense.com OR site:mqa.doh.state.fl.us "${clean}"`;
  const html = await googleSearch(query);
  if (!html) return { phone: null, email: null, ownerName: null };

  const urls = extractGoogleResultUrls(html, true).filter(u =>
    u.includes("myfloridalicense.com") || u.includes("mqa.doh.state.fl.us")
  );
  if (urls.length === 0) return { phone: null, email: null, ownerName: null };

  const pageHtml = await fetchPage(urls[0]);
  if (!pageHtml) return { phone: null, email: null, ownerName: null };

  const contacts = extractContactFromHtml(pageHtml);
  const nameMatch = pageHtml.match(/(?:Licensee|DBA|Business) Name[\s\S]{0,100}?<[^>]*>([\w\s,.'-]+)<\//i);

  return {
    phone: contacts.phones[0] || null,
    email: contacts.emails[0] || null,
    ownerName: nameMatch ? nameMatch[1].trim() : null,
  };
}

interface AIEnrichResult {
  website?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  email?: string;
  phone?: string;
  vertical?: string;
  score?: string;
  aiSummary?: string;
}

async function enrichWithAI(
  entity: SunbizEntity,
  websiteText: string | null,
  foundEmails: string[],
  foundPhones: string[],
  scrapedOfficers?: any[],
  scrapedAgentName?: string | null,
): Promise<AIEnrichResult> {
  const officers = scrapedOfficers && scrapedOfficers.length > 0
    ? scrapedOfficers
    : ((entity.officers as any[]) || []);
  const agentName = scrapedAgentName || entity.registeredAgentName || null;
  const ownerOfficer = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title)
  ) || officers[0];

  const prompt = `You are a B2B sales intelligence analyst for Liberty Bancard (merchant payment processing). Analyze this Florida business entity and determine the best contact information and business classification.

Business Info:
- Entity Name: ${entity.entityName}
- DBA: ${entity.dba || "N/A"}
- Type: ${entity.entityType || "Unknown"}
- Status: ${entity.entityStatus || "Unknown"}
- Filing Date: ${entity.filingDate || "N/A"}
- Principal Address: ${entity.principalAddress || "N/A"}, ${entity.principalCity || ""} ${entity.principalState || "FL"} ${entity.principalZip || ""}
- Registered Agent: ${agentName || "N/A"}
- Officers: ${officers.map((o: any) => `${o.title}: ${o.name}`).join(", ") || "N/A"}
- Owner/Key Person: ${ownerOfficer ? `${ownerOfficer.name} (${ownerOfficer.title})` : "N/A"}

Found on website:
- Emails: ${foundEmails.length > 0 ? foundEmails.join(", ") : "None found"}
- Phones: ${foundPhones.length > 0 ? foundPhones.join(", ") : "None found"}

${websiteText ? `Website Content (excerpt):\n${websiteText.slice(0, 2000)}` : "No website content available."}

Provide JSON:
{
  "bestEmail": "pick the best email from the found emails list above to reach the owner/decision maker, or null if none found (do NOT guess or fabricate emails)",
  "bestPhone": "pick the best phone from the found phones list above, or null if none found (do NOT guess or fabricate phone numbers)",
  "ownerName": "full name of the likely owner/decision maker from officers list",
  "vertical": "business vertical (Restaurant, Retail, Professional Services, Healthcare, Auto, Salon/Spa, Construction, Real Estate, E-commerce, Legal, Accounting, Other)",
  "score": "hot/warm/cold/unqualified - likelihood they process card payments and would benefit from merchant services",
  "scoreReason": "brief reason",
  "summary": "one sentence about what this business likely does and why they might need payment processing"
}`;

  const slot = await checkAiGate("gpt-4o-mini");
  let response;
  try {
    response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
  } catch (providerErr) {
    slot.refund();
    throw providerErr;
  }

  try {
    slot.settle(recordAiSpend("gpt-4o-mini", response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "enrichment"));
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No AI response");

    const result = JSON.parse(content);

    const allFoundEmails = foundEmails.map(e => e.toLowerCase());
    const allFoundPhones = foundPhones.map(p => p.replace(/[^\d]/g, ""));

    const validatedEmail = result.bestEmail && allFoundEmails.includes(result.bestEmail.toLowerCase())
      ? result.bestEmail : (foundEmails[0] || undefined);
    const validatedPhone = result.bestPhone && allFoundPhones.includes(result.bestPhone.replace(/[^\d]/g, ""))
      ? result.bestPhone : (foundPhones[0] || undefined);

    return {
      ownerName: result.ownerName || undefined,
      ownerEmail: validatedEmail,
      ownerPhone: validatedPhone,
      email: validatedEmail,
      phone: validatedPhone,
      vertical: result.vertical || undefined,
      score: ["hot", "warm", "cold", "unqualified"].includes(result.score) ? result.score : "cold",
      aiSummary: `${result.summary || ""}${result.scoreReason ? ` [${result.score}: ${result.scoreReason}]` : ""}`,
    };
  } catch (err) {
    console.error("Sunbiz AI enrichment failed:", err);
    return { score: "cold", aiSummary: "AI enrichment failed" };
  }
}

export async function enrichSunbizEntity(entityId: number): Promise<SunbizEntity | null> {
  const entity = await storage.getSunbizEntity(entityId);
  if (!entity) return null;

  await storage.updateSunbizEntity(entityId, { enrichmentStatus: "processing" });

  let website = entity.website || null;
  let websiteText: string | null = null;
  let foundEmails: string[] = [];
  let foundPhones: string[] = [];
  const sources: string[] = [];
  const city = entity.principalCity?.replace(/\s*(FL|FLA|FLORIDA)\s*$/i, "").trim() || undefined;
  const address = entity.principalAddress || undefined;

  let officers = (entity.officers as any[]) || [];
  let registeredAgentName = entity.registeredAgentName || null;

  console.log(`[Enrich] === Entity ${entity.id}: ${entity.entityName} (${city || "no city"}) ===`);

  if (officers.length === 0 || !registeredAgentName) {
    console.log(`[Enrich] Step 1: Sunbiz detail page`);
    const sunbizDetail = await scrapeSunbizDetailPage(entity);
    if (sunbizDetail.officers.length > 0) {
      officers = sunbizDetail.officers;
      sources.push("sunbiz_detail");
      console.log(`[Enrich]   → Found ${officers.length} officers: ${officers.map((o: any) => `${o.title}:${o.name}`).join(", ")}`);
    }
    if (sunbizDetail.registeredAgentName) {
      registeredAgentName = sunbizDetail.registeredAgentName;
      console.log(`[Enrich]   → Registered agent: ${registeredAgentName}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  if (!website) {
    if (isSerperConfigured()) {
      console.log(`[Enrich] Step 2: Serper business search`);
      const serperResult = await searchBusiness(entity.entityName, city);
      if (serperResult.website) {
        website = serperResult.website;
        sources.push(...serperResult.sources);
        console.log(`[Enrich]   → Serper found website: ${website}`);
      }
      if (serperResult.emails.length > 0) {
        foundEmails.push(...serperResult.emails);
        console.log(`[Enrich]   → Serper found emails: ${serperResult.emails.join(", ")}`);
      }
      if (serperResult.phones.length > 0) {
        foundPhones.push(...serperResult.phones);
        console.log(`[Enrich]   → Serper found phones: ${serperResult.phones.join(", ")}`);
      }
    } else {
      console.log(`[Enrich] Step 2: Google website search (Serper not configured)`);
      website = await searchGoogleForWebsite(entity.entityName, city);
      if (website) {
        sources.push("google_website");
        console.log(`[Enrich]   → Found website: ${website}`);
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (website) {
    console.log(`[Enrich] Step 3: Scraping website ${website}`);
    const rawHtml = await fetchWebsite(website);
    if (rawHtml) {
      websiteText = rawHtml;
      const extracted = extractContactFromHtml(rawHtml);
      foundEmails.push(...extracted.emails);
      foundPhones.push(...extracted.phones);
      if (extracted.emails.length > 0 || extracted.phones.length > 0) sources.push("website");
    }

    if (foundEmails.length === 0 || foundPhones.length === 0) {
      const contactPageText = await fetchContactPages(website);
      if (contactPageText) {
        const contactExtracted = extractContactFromHtml(contactPageText);
        foundEmails.push(...contactExtracted.emails);
        foundPhones.push(...contactExtracted.phones);
        if (websiteText) websiteText += " " + contactPageText.slice(0, 2000);
        else websiteText = contactPageText;
        if (contactExtracted.emails.length > 0 || contactExtracted.phones.length > 0) sources.push("contact_page");
      }
    }
    if (foundEmails.length > 0 || foundPhones.length > 0) {
      console.log(`[Enrich]   → Website contacts: ${foundEmails.length} emails, ${foundPhones.length} phones`);
    }
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 4: Facebook search`);
    const fb = await scrapeFacebookPage(entity.entityName, city);
    if (fb.phone) { foundPhones.push(fb.phone); sources.push("facebook"); console.log(`[Enrich]   → FB phone: ${fb.phone}`); }
    if (fb.email) { foundEmails.push(fb.email); sources.push("facebook"); console.log(`[Enrich]   → FB email: ${fb.email}`); }
    if (fb.website && !website) { website = fb.website; sources.push("facebook_website"); }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 5: Yelp search`);
    const yelp = await scrapeYelpForContacts(entity.entityName, city);
    if (yelp.phone) { foundPhones.push(yelp.phone); sources.push("yelp"); console.log(`[Enrich]   → Yelp phone: ${yelp.phone}`); }
    if (yelp.email) { foundEmails.push(yelp.email); sources.push("yelp"); console.log(`[Enrich]   → Yelp email: ${yelp.email}`); }
    if (yelp.website && !website) { website = yelp.website; sources.push("yelp_website"); }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundPhones.length === 0 || foundEmails.length === 0) {
    console.log(`[Enrich] Step 6: YellowPages search`);
    const yp = await scrapeYellowPages(entity.entityName, city);
    if (yp.phone) { foundPhones.push(yp.phone); sources.push("yellowpages"); console.log(`[Enrich]   → YP phone: ${yp.phone}`); }
    if (yp.email) { foundEmails.push(yp.email); sources.push("yellowpages"); console.log(`[Enrich]   → YP email: ${yp.email}`); }
    if (yp.website && !website) { website = yp.website; sources.push("yellowpages_website"); console.log(`[Enrich]   → YP website: ${yp.website}`); }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 7: LinkedIn search`);
    const li = await scrapeLinkedInPage(entity.entityName, city);
    if (li.phone) { foundPhones.push(li.phone); sources.push("linkedin"); }
    if (li.email) { foundEmails.push(li.email); sources.push("linkedin"); }
    if (li.website && !website) { website = li.website; sources.push("linkedin_website"); }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundPhones.length === 0) {
    console.log(`[Enrich] Step 8: BBB search`);
    const bbb = await scrapeBBB(entity.entityName, city);
    if (bbb.phone) { foundPhones.push(bbb.phone); sources.push("bbb"); console.log(`[Enrich]   → BBB phone: ${bbb.phone}`); }
    if (bbb.website && !website) { website = bbb.website; sources.push("bbb_website"); }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    if (isSerperConfigured()) {
      console.log(`[Enrich] Step 9: Serper contact search`);
      const sc = await searchBusinessContacts(entity.entityName, city, address);
      if (sc.emails.length > 0) { foundEmails.push(...sc.emails); sources.push(...sc.sources); }
      if (sc.phones.length > 0) { foundPhones.push(...sc.phones); sources.push(...sc.sources); }
      if (sc.website && !website) { website = sc.website; sources.push("serper_contacts_website"); }
    } else {
      console.log(`[Enrich] Step 9: Google direct contact search`);
      const gc = await searchGoogleForContacts(entity.entityName, city, address);
      if (gc.emails.length > 0) { foundEmails.push(...gc.emails); sources.push("google_contacts"); }
      if (gc.phones.length > 0) { foundPhones.push(...gc.phones); sources.push("google_contacts"); }
      if (gc.website && !website) { website = gc.website; sources.push("google_contacts_website"); }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (foundPhones.length === 0 && entity.vertical && ["Healthcare", "Salon/Spa", "Restaurant"].includes(entity.vertical)) {
    console.log(`[Enrich] Step 10: FL DBPR license search`);
    const dbpr = await scrapeFloridaDBPR(entity.entityName);
    if (dbpr.phone) { foundPhones.push(dbpr.phone); sources.push("fl_dbpr"); }
    if (dbpr.email) { foundEmails.push(dbpr.email); sources.push("fl_dbpr"); }
    if (dbpr.ownerName && officers.length === 0) {
      officers.push({ title: "Licensee", name: dbpr.ownerName });
      sources.push("fl_dbpr_name");
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const directoryDomains = ["localsearch.com", "yellowpages.com", "yelp.com", "facebook.com", "bbb.org", "linkedin.com", "mapquest.com", "tripadvisor.com", "chamberofcommerce.com", "manta.com", "angi.com", "thumbtack.com", "homeadvisor.com"];
  const isRealDomain = (d: string | null) => d && !directoryDomains.some(dd => d === dd || d.endsWith(`.${dd}`));

  if (website && foundEmails.length === 0 && isRealDomain(website)) {
    console.log(`[Enrich] Step 11: Scraping website for emails: ${website}`);
    const rawHtml = await fetchWebsite(website);
    if (rawHtml) {
      const extracted = extractContactFromHtml(rawHtml);
      foundEmails.push(...extracted.emails);
      if (extracted.phones.length > 0 && foundPhones.length === 0) foundPhones.push(...extracted.phones);
      if (extracted.emails.length > 0) sources.push("website_rescrape");
    }
    if (foundEmails.length === 0) {
      const contactHtml = await fetchContactPages(website);
      if (contactHtml) {
        const ex = extractContactFromHtml(contactHtml);
        foundEmails.push(...ex.emails);
        if (ex.phones.length > 0 && foundPhones.length === 0) foundPhones.push(...ex.phones);
        if (ex.emails.length > 0) sources.push("contact_page_rescrape");
      }
    }
  }

  if (foundEmails.length === 0) {
    if (isSerperConfigured()) {
      console.log(`[Enrich] Step 13: Serper email search`);
      const domain = website || undefined;
      const se = await searchBusinessEmail(entity.entityName, domain, city);
      if (se.emails.length > 0) {
        foundEmails.push(...se.emails);
        sources.push(...se.sources);
        console.log(`[Enrich]   → Serper email: ${se.emails[0]}`);
      }
      if (se.phones.length > 0 && foundPhones.length === 0) {
        foundPhones.push(...se.phones);
      }
    } else {
      console.log(`[Enrich] Step 13: Google email search`);
      const clean = cleanEntityName(entity.entityName);
      const emailQuery = city ? `"${clean}" "${city}" FL email "@"` : `"${clean}" Florida email "@"`;
      const emailHtml = await googleSearch(emailQuery);
      if (emailHtml) {
        const serpEmails = extractContactFromHtml(emailHtml);
        if (serpEmails.emails.length > 0) {
          foundEmails.push(...serpEmails.emails);
          sources.push("google_email_search");
          console.log(`[Enrich]   → Google email: ${serpEmails.emails[0]}`);
        }
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  foundEmails = [...new Set(foundEmails)];
  foundPhones = [...new Set(foundPhones.map(p => p.replace(/[^\d]/g, "")).filter(p => p.length >= 10 && p.length <= 11))];

  console.log(`[Enrich] === RESULTS: ${foundEmails.length} emails, ${foundPhones.length} phones, ${officers.length} officers, website=${website || "none"}, sources=[${sources.join(",")}] ===`);

  const aiResult = await enrichWithAI(entity, websiteText, foundEmails, foundPhones, officers, registeredAgentName);
  const aiFailed = aiResult.aiSummary === "AI enrichment failed";

  const ownerOfficer = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title)
  ) || officers[0];

  const updates: Record<string, any> = {
    enrichmentStatus: aiFailed ? "pending" : "enriched",
    enrichedAt: aiFailed ? undefined : new Date(),
  };

  if (officers.length > 0 && (!entity.officers || (entity.officers as any[]).length === 0)) {
    updates.officers = officers;
  }
  if (registeredAgentName && !entity.registeredAgentName) {
    updates.registeredAgentName = registeredAgentName;
  }

  if (website) updates.website = website;
  if (aiResult.email || foundEmails[0]) updates.email = aiResult.email || foundEmails[0];
  if (aiResult.phone || foundPhones[0]) updates.phone = aiResult.phone || foundPhones[0];
  if (aiResult.ownerName) updates.ownerName = aiResult.ownerName;
  else if (ownerOfficer) updates.ownerName = ownerOfficer.name;
  if (aiResult.ownerEmail) updates.ownerEmail = aiResult.ownerEmail;
  if (aiResult.ownerPhone) updates.ownerPhone = aiResult.ownerPhone;
  if (aiResult.vertical) updates.vertical = aiResult.vertical;
  if (aiResult.score) updates.score = aiResult.score;
  if (aiResult.aiSummary) updates.aiSummary = aiResult.aiSummary;
  updates.enrichmentData = {
    websiteFound: !!website,
    emailsFound: foundEmails,
    phonesFound: foundPhones,
    officerCount: officers.length,
    officerNames: officers.map((o: any) => o.name).slice(0, 5),
    registeredAgent: registeredAgentName,
    sources: [...new Set(sources)],
    enrichedAt: new Date().toISOString(),
  };

  const updated = await storage.updateSunbizEntity(entityId, updates);
  return updated || entity;
}

export type SunbizEnrichmentStatus = "success" | "partial_success" | "skipped" | "failed";

export interface SunbizEnrichmentOutcome {
  entityId: number;
  entityName?: string;
  status: SunbizEnrichmentStatus;
  reason: string;
  entity?: SunbizEntity;
}

// Non-throwing wrapper around enrichSunbizEntity(). One bad record (bad data,
// network timeout, scraper exception, AI failure, etc.) must never crash a
// batch — every entity resolves to success/partial_success/skipped/failed
// with a human-readable reason instead of propagating an exception.
export async function enrichSunbizEntitySafe(entityId: number): Promise<SunbizEnrichmentOutcome> {
  let existing: SunbizEntity | null = null;
  try {
    existing = await storage.getSunbizEntity(entityId);
  } catch (err: any) {
    console.error(`[Enrich] Failed to load entity ${entityId} before enrichment:`, err?.message || err);
    return { entityId, status: "failed", reason: `Could not load entity: ${err?.message ? String(err.message).slice(0, 300) : "unknown error"}` };
  }

  if (!existing) {
    return { entityId, status: "skipped", reason: "Entity not found" };
  }

  try {
    const result = await enrichSunbizEntity(entityId);
    if (!result) {
      return { entityId, entityName: existing.entityName, status: "skipped", reason: "Entity not found during enrichment" };
    }

    const hasContact = !!(result.email || result.phone || result.ownerEmail || result.ownerPhone);

    if (result.enrichmentStatus === "enriched" && hasContact) {
      return { entityId, entityName: result.entityName, status: "success", reason: "Enrichment completed and contact data was found", entity: result };
    }
    if (result.enrichmentStatus === "enriched") {
      return { entityId, entityName: result.entityName, status: "partial_success", reason: "Enrichment completed but no email/phone contact data was found", entity: result };
    }
    // enrichmentStatus stayed "pending" here, meaning scraping ran but AI
    // classification failed — some raw data may still have been captured.
    return { entityId, entityName: result.entityName, status: "partial_success", reason: "AI classification failed; entity left pending for retry", entity: result };
  } catch (err: any) {
    const reason = err?.message ? String(err.message).slice(0, 500) : "Unknown enrichment error";
    console.error(`[Enrich] Entity ${entityId} (${existing.entityName}) enrichment failed:`, err?.message || err);
    try {
      await storage.updateSunbizEntity(entityId, { enrichmentStatus: "failed" });
    } catch (updateErr: any) {
      console.error(`[Enrich] Also failed to mark entity ${entityId} as failed:`, updateErr?.message || updateErr);
    }
    return { entityId, entityName: existing.entityName, status: "failed", reason };
  }
}

export interface SunbizEnrichmentBatchResult {
  results: SunbizEnrichmentOutcome[];
  summary: {
    total: number;
    success: number;
    partial_success: number;
    skipped: number;
    failed: number;
  };
}

// Batch entry point used by the "Enrich All" UI/API. Every entity is
// processed via the non-throwing enrichSunbizEntitySafe() wrapper, so one bad
// record can never 500 the whole batch — the endpoint always returns 200
// with a per-record + summary breakdown.
export async function processSunbizEnrichmentBatch(limit: number = 10): Promise<SunbizEnrichmentBatchResult> {
  const results: SunbizEnrichmentOutcome[] = [];
  // Short-circuit immediately for zero or negative limits — callers that pass 0
  // mean "do nothing now" (e.g. test harness queue-guard check).  Without this
  // guard the storage layer's `if (limit)` falsy check drops the LIMIT clause
  // and triggers an unbounded 968 k-row scan that causes a 60 s spawnSync kill.
  if (limit <= 0) {
    return { results, summary: { total: 0, success: 0, partial_success: 0, skipped: 0, failed: 0 } };
  }
  if (sunbizQueueRunning) {
    return { results, summary: { total: 0, success: 0, partial_success: 0, skipped: 0, failed: 0 } };
  }
  sunbizQueueRunning = true;
  try {
    // Pass `limit` directly to the storage layer so the database emits
    // `LIMIT ${limit}` and the index idx_sunbiz_enrichment_status is used for
    // an index seek + N-row fetch, not a full 968 k-row scan.
    // The previous pattern of fetching all pending rows then .slice()-ing was
    // the cause of PG statement-timeout (57014) errors.
    const toProcess = await storage.getSunbizEntitiesByStatus("pending", limit);

    for (const entity of toProcess) {
      const outcome = await enrichSunbizEntitySafe(entity.id);
      results.push(outcome);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } finally {
    sunbizQueueRunning = false;
  }

  const summary = results.reduce(
    (acc, r) => {
      acc.total++;
      acc[r.status]++;
      return acc;
    },
    { total: 0, success: 0, partial_success: 0, skipped: 0, failed: 0 }
  );

  return { results, summary };
}

const VERTICAL_KEYWORDS: Record<string, string[]> = {
  "Restaurant": ["restaurant", "grill", "pizza", "sushi", "cafe", "café", "bistro", "diner", "taco", "burrito", "bbq", "barbecue", "bakery", "catering", "food truck", "steakhouse", "seafood", "wings", "sandwich", "deli", "donut", "doughnut", "cupcake", "ice cream", "frozen yogurt", "juice bar", "smoothie", "coffee shop", "coffee house", "brewpub", "taproom", "bar & grill", "bar and grill", "cantina", "trattoria", "ramen", "pho", "thai", "chinese", "indian", "japanese", "mexican", "italian", "mediterranean", "bagel", "pub ", "tavern", "brewery", "winery", "distillery", "food service", "kitchen", "eatery", "chophouse", "oyster", "creamery", "gelato", "acai", "poke", "hibachi", "buffet", "pancake", "waffle", "brunch", "soul food", "fried chicken", "burger", "hot dog", "sub shop", "wrap", "noodle", "dim sum", "korean bbq", "shawarma", "falafel", "crepe"],
  "Retail": ["store", "shop", "boutique", "mart", "outlet", "wholesale", "retail", "gallery", "market", "emporium", "supermarket", "convenience", "gift shop", "antique", "thrift", "consignment", "furniture store", "hardware", "pet store", "toy store", "book store", "bookstore", "clothing", "apparel", "shoes", "jewelry store", "jeweler", "florist", "flower shop", "wine shop", "liquor store", "smoke shop", "vape", "smoke & vape", "cigar", "sporting goods", "surf shop", "bike shop", "music store", "instrument", "optical", "eyewear", "sunglasses", "nutrition store", "supplement", "vitamin", "cell phone", "phone repair", "mattress", "luggage", "candle", "soap", "bath & body", "home décor", "home decor", "frame shop", "art supply", "craft", "hobby", "comic", "game store", "pawn", "resale", "dollar store", "variety", "general store"],
  "Healthcare": ["medical", "dental", "clinic", "doctor", "physician", "healthcare", "health care", "therapy", "chiropractic", "chiropractor", "dermatology", "dermatologist", "optometry", "ophthalmology", "pediatric", "orthopedic", "cardiology", "neurology", "urgent care", "pharmacy", "physical therapy", "mental health", "counseling", "psychiatry", "veterinary", "vet clinic", "animal hospital", "wellness center", "medspa", "med spa", "aesthetic", "cosmetic surgery", "plastic surgery", "orthodont", "endodont", "periodont", "prosthodont", "oral surgery", "podiatry", "podiatrist", "acupuncture", "naturopath", "holistic", "rehab center", "rehabilitation", "dialysis", "radiology", "imaging center", "diagnostics", "laboratory", "lab corp", "blood bank", "hospice", "home health", "nursing", "assisted living", "memory care", "hearing aid", "audiology", "speech therapy", "occupational therapy", "pain management", "sleep center", "allergy", "immunology", "gastro", "urology", "oncology", "fertility", "obgyn", "ob-gyn", "gynecology", "prenatal"],
  "Salon/Spa": ["salon", "barbershop", "barber", "spa", "nails", "nail salon", "beauty", "hair", "lashes", "waxing", "tanning", "skincare", "skin care", "makeup", "tattoo", "piercing", "massage", "day spa", "beauty supply", "cosmetology", "braiding", "extensions", "blowout", "brow bar", "threading", "microblading", "facial", "body sculpting", "laser hair", "electrolysis"],
  "Auto": ["auto", "automotive", "car wash", "tire", "mechanic", "body shop", "collision", "transmission", "brake", "muffler", "oil change", "lube", "detailing", "auto repair", "car dealer", "used car", "truck", "motorcycle", "marine", "boat", "auto parts", "auto glass", "windshield", "tow", "towing", "wrecker", "alignment", "exhaust", "radiator", "auto electric", "auto body", "paint body", "upholstery", "auto sales", "motor", "motorsport", "atv", "powersport", "jet ski", "rv ", "camper", "trailer", "diesel", "fleet service"],
  "Construction": ["construction", "roofing", "roofer", "plumbing", "plumber", "electric", "electrician", "electrical contractor", "hvac", "air conditioning", "heating", "cooling", "painting", "painter", "flooring", "carpet", "tile", "concrete", "masonry", "framing", "drywall", "demolition", "excavation", "excavating", "paving", "asphalt", "landscaping", "lawn", "lawn care", "tree service", "tree removal", "pool", "pool service", "fence", "fencing", "remodeling", "renovation", "general contractor", "handyman", "pest control", "exterminator", "cleaning service", "janitorial", "pressure washing", "power washing", "screen", "aluminum", "screen enclosure", "gutter", "siding", "stucco", "insulation", "waterproofing", "foundation", "grading", "land clearing", "hauling", "junk removal", "roll off", "dumpster", "septic", "well drilling", "irrigation", "sprinkler", "garage door", "locksmith", "glass ", "window", "door install", "cabinet", "countertop", "granite", "marble", "quartz", "kitchen bath", "home improvement", "home repair", "build", "builder", "contracting", "restoration", "mold", "fire damage", "water damage", "solar", "awning", "shutter", "blinds", "closet"],
  "Real Estate": ["real estate", "realty", "property", "properties", "mortgage", "title", "escrow", "appraisal", "brokerage", "property management", "leasing", "rental"],
  "Legal": ["law firm", "attorney", "lawyer", "legal", "law office", "law group", "paralegal", "notary", "mediation", "arbitration"],
  "Accounting": ["accounting", "accountant", "cpa", "bookkeeping", "tax service", "tax prep", "payroll", "tax advisor"],
  "Professional Services": ["consulting", "consultant", "advisory", "marketing", "advertising", "design", "architect", "engineering", "staffing", "recruiting", "insurance agency", "financial advisor", "wealth management", "photography", "photographer", "videograph", "printing", "sign shop", "signs ", "graphic design", "web design", "it service", "tech support", "computer repair", "tutoring", "training center", "driving school", "dance studio", "yoga", "fitness", "gym", "crossfit", "martial art", "karate", "boxing", "pilates", "personal train", "daycare", "child care", "childcare", "preschool", "learning center", "montessori", "kennel", "dog groom", "pet groom", "dog walk", "pet sit", "boarding", "storage", "self storage", "moving", "courier", "shipping", "dry clean", "laundry", "laundromat", "alteration", "tailor", "seamstress", "event plan", "wedding", "party rental", "limo", "charter", "travel agency"],
  "E-commerce": ["online store", "e-commerce", "ecommerce", "web store", "marketplace", "online retail", "dropship", "fulfillment"],
  "Food/Beverage": ["grocery", "bodega", "butcher", "meat market", "fish market", "produce", "organic", "health food", "food store", "food mart", "snack", "candy", "chocolate", "popcorn", "pretzel", "food distributor", "beverage", "water delivery", "coffee roast"],
  "Fitness/Recreation": ["gym", "fitness", "crossfit", "yoga studio", "pilates", "martial art", "boxing", "mma", "karate", "dance studio", "ballet", "swimming", "aquatic", "bowling", "arcade", "trampoline", "go kart", "mini golf", "escape room", "axe throwing", "gun range", "shooting range", "golf course", "country club", "tennis", "pickleball", "skate park"],
  "Transportation": ["trucking", "freight", "logistics", "delivery", "courier", "moving company", "movers", "taxi", "rideshare", "limo", "charter bus", "shuttle", "parking", "valet", "tow truck"],
};

const HOT_VERTICALS = ["Restaurant", "Retail", "Healthcare", "Salon/Spa", "Auto", "Food/Beverage", "Fitness/Recreation", "Construction", "Professional Services", "Legal", "Accounting", "E-commerce", "Transportation"];
const WARM_VERTICALS = ["Real Estate"];

const UNQUALIFIED_KEYWORDS = [
  "holding", "holdings", "trust", "investment", "investments", "capital", "ventures", "venture",
  "asset", "assets", "fund", "funding", "equity", "securities", "financial group",
  "management company", "management corp", "real estate investment", "reit",
  "llc series", "shell", "dormant", "dissolved", "inactive",
  "not for profit", "nonprofit", "non-profit", "charity", "charitable", "foundation",
  "church", "ministry", "temple", "mosque", "synagogue", "congregation",
  "association", "homeowner", "hoa", "condominium", "condo assoc",
  "government", "county", "municipal", "state of", "federal",
];

function classifyByName(entityName: string, officers: any[]): {
  vertical: string;
  score: string;
  ownerName: string | null;
  aiSummary: string;
} {
  const lower = entityName.toLowerCase();

  for (const kw of UNQUALIFIED_KEYWORDS) {
    if (lower.includes(kw)) {
      return { vertical: "Other", score: "unqualified", ownerName: extractOwnerFromOfficers(officers), aiSummary: `Likely holding/investment/nonprofit entity: ${entityName}` };
    }
  }

  for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const score = HOT_VERTICALS.includes(vertical) ? "hot" : (WARM_VERTICALS.includes(vertical) ? "warm" : "cold");
        return {
          vertical,
          score,
          ownerName: extractOwnerFromOfficers(officers),
          aiSummary: `${vertical} business identified by name: ${entityName}. ${score === "hot" ? "High likelihood of card processing." : "Moderate card processing potential."}`,
        };
      }
    }
  }

  return {
    vertical: "Other",
    score: "cold",
    ownerName: extractOwnerFromOfficers(officers),
    aiSummary: `Business type unclear from name: ${entityName}. Needs deeper enrichment.`,
  };
}

function extractOwnerFromOfficers(officers: any[]): string | null {
  if (!officers || officers.length === 0) return null;
  const owner = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title || "")
  ) || officers[0];
  return owner?.name || null;
}

export async function fastClassifyBatch(batchSize: number = 500): Promise<{ processed: number; classified: number }> {
  const result = await runSqlClassification(batchSize);
  return { processed: result.total, classified: result.classified };
}

export async function runBulkFastClassification(): Promise<{ total: number; classified: number; rounds: number }> {
  return runSqlClassification();
}

export async function runSqlClassification(batchLimit?: number): Promise<{ total: number; classified: number; rounds: number }> {
  console.log(`[SQLClassify] Starting pure-SQL keyword classification...`);

  const verticalRules: Array<{ vertical: string; score: string; keywords: string[] }> = [];
  for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
    const score = HOT_VERTICALS.includes(vertical) ? "hot" : (WARM_VERTICALS.includes(vertical) ? "warm" : "cold");
    verticalRules.push({ vertical, score, keywords });
  }

  const unqualifiedKws = UNQUALIFIED_KEYWORDS;

  let totalClassified = 0;
  let rounds = 0;

  await storage.setSystemSetting("bulk_classify_progress", {
    status: "running", processed: 0, classified: 0, startedAt: new Date().toISOString(),
  });

  try {
    const limitClause = batchLimit ? sql` LIMIT ${batchLimit}` : sql``;

    const unqLikes = unqualifiedKws.map(kw => sql`LOWER(entity_name) LIKE ${'%' + kw + '%'}`);
    const unqLikeSql = sql.join(unqLikes, sql` OR `);

    const unqResult = await db.execute(sql`
      UPDATE sunbiz_entities
      SET vertical = 'Other',
          score = 'unqualified',
          enrichment_status = 'classified',
          ai_summary = 'Likely holding/investment/nonprofit entity'
      WHERE id IN (
        SELECT id FROM sunbiz_entities
        WHERE entity_status = 'Active'
          AND (vertical IS NULL OR vertical = '' OR vertical = 'Other')
          AND score IS DISTINCT FROM 'unqualified'
          AND (${unqLikeSql})
        ${limitClause}
      )
    `);
    const unqCount = (unqResult as any).rowCount || 0;
    console.log(`[SQLClassify] Marked ${unqCount} as unqualified`);
    rounds++;

    for (const rule of verticalRules) {
      const likeClauses = rule.keywords.map(kw =>
        sql`LOWER(entity_name) LIKE ${'%' + kw + '%'} OR LOWER(COALESCE(dba,'')) LIKE ${'%' + kw + '%'}`
      );
      const likeSql = sql.join(likeClauses, sql` OR `);
      const aiSummary = `${rule.vertical} business identified by keyword match`;

      try {
        const result = await db.execute(sql`
          UPDATE sunbiz_entities
          SET vertical = ${rule.vertical},
              score = ${rule.score},
              enrichment_status = 'classified',
              ai_summary = ${aiSummary},
              owner_name = CASE
                WHEN owner_name IS NULL AND officers IS NOT NULL AND officers::text != '[]'
                THEN COALESCE(officers->0->>'name', NULL)
                ELSE owner_name
              END
          WHERE id IN (
            SELECT id FROM sunbiz_entities
            WHERE entity_status = 'Active'
              AND (vertical IS NULL OR vertical = '' OR vertical = 'Other')
              AND score IS DISTINCT FROM 'unqualified'
              AND (${likeSql})
            ${limitClause}
          )
        `);
        const count = (result as any).rowCount || 0;
        if (count > 0) {
          totalClassified += count;
          console.log(`[SQLClassify] ${rule.vertical}: ${count} classified (${rule.score})`);
        }
        rounds++;
      } catch (err: any) {
        console.error(`[SQLClassify] Error classifying ${rule.vertical}:`, err.message?.slice(0, 100));
      }
    }

    const coldResult = await db.execute(sql`
      UPDATE sunbiz_entities
      SET score = 'cold',
          enrichment_status = 'classified',
          vertical = 'Other',
          ai_summary = 'Business type unclear from name',
          owner_name = CASE
            WHEN owner_name IS NULL AND officers IS NOT NULL AND officers::text != '[]'
            THEN COALESCE(officers->0->>'name', NULL)
            ELSE owner_name
          END
      WHERE id IN (
        SELECT id FROM sunbiz_entities
        WHERE entity_status = 'Active'
          AND (vertical IS NULL OR vertical = '' OR vertical = 'Other')
          AND (enrichment_status IS NULL OR enrichment_status = 'pending' OR enrichment_status = 'raw')
          AND score IS DISTINCT FROM 'unqualified'
        ${limitClause}
      )
    `);
    const coldCount = (coldResult as any).rowCount || 0;
    console.log(`[SQLClassify] Remaining ${coldCount} marked as cold/Other`);
    rounds++;

  } catch (err: any) {
    console.error(`[SQLClassify] Fatal error:`, err.message?.slice(0, 200));
  }

  await storage.setSystemSetting("bulk_classify_progress", {
    status: "complete", classified: totalClassified, rounds,
    completedAt: new Date().toISOString(),
  });

  console.log(`[SQLClassify] Complete: ${totalClassified} classified into verticals in ${rounds} rounds`);
  return { total: totalClassified, classified: totalClassified, rounds };
}

let sunbizQueueRunning = false;

export async function processSunbizEnrichmentQueue(limit: number = 5): Promise<number> {
  if (sunbizQueueRunning) {
    console.log("[Sunbiz Enrich] Skipping queue tick — previous batch still running");
    return 0;
  }
  sunbizQueueRunning = true;
  try {
    // Forward `limit` to the DB query so the index is used for a bounded seek.
    // Fetching all pending rows then slicing caused a full 968 k-row scan and
    // PG statement-timeout (57014). See getSunbizEntitiesByStatus in storage.
    const toProcess = await storage.getSunbizEntitiesByStatus("pending", limit);
    let processed = 0;

    for (const entity of toProcess) {
      const outcome = await enrichSunbizEntitySafe(entity.id);
      if (outcome.status === "success" || outcome.status === "partial_success") {
        processed++;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return processed;
  } finally {
    sunbizQueueRunning = false;
  }
}

function computeQualificationScore(data: {
  email?: string | null;
  phone?: string | null;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  website?: string | null;
  vertical?: string | null;
  address?: string | null;
  city?: string | null;
  enrichmentStatus?: string | null;
  score?: string | null;
}): string {
  let points = 0;
  if (data.email || data.ownerEmail) points += 20;
  if (data.phone || data.ownerPhone) points += 15;
  if (data.website) points += 15;
  if (data.vertical) points += 10;
  if (data.address && data.city) points += 10;
  if (data.enrichmentStatus === "enriched") points += 15;
  if (data.score === "hot") points += 15;
  else if (data.score === "warm") points += 10;
  else if (data.score === "cold") points += 5;

  if (points >= 80) return "A";
  if (points >= 60) return "B";
  if (points >= 40) return "C";
  if (points >= 20) return "D";
  return "F";
}

export async function convertToProspect(entityId: number, listId?: number): Promise<number | null> {
  const entity = await storage.getSunbizEntity(entityId);
  if (!entity) return null;

  const qualificationScore = computeQualificationScore({
    email: entity.email,
    phone: entity.phone,
    ownerEmail: entity.ownerEmail,
    ownerPhone: entity.ownerPhone,
    website: entity.website,
    vertical: entity.vertical,
    address: entity.principalAddress,
    city: entity.principalCity,
    enrichmentStatus: entity.enrichmentStatus,
    score: entity.score,
  });

  const prospect = await storage.createProspect({
    listId: listId || entity.listId || undefined,
    companyName: toProperCase(entity.entityName),
    dba: toProperCase(entity.dba) || undefined,
    website: entity.website || undefined,
    phone: entity.phone || undefined,
    email: entity.email || undefined,
    ownerFirstName: toProperCase(entity.ownerName?.split(" ")[0]) || undefined,
    ownerLastName: toProperCase(entity.ownerName?.split(" ").slice(1).join(" ")) || undefined,
    ownerEmail: entity.ownerEmail || undefined,
    ownerPhone: entity.ownerPhone || undefined,
    address: toProperCase(entity.principalAddress) || undefined,
    city: toProperCase(entity.principalCity) || undefined,
    state: entity.principalState || "FL",
    zip: entity.principalZip || undefined,
    vertical: entity.vertical || undefined,
    score: entity.score || "cold",
    qualificationScore,
    status: entity.enrichmentStatus === "enriched" ? "enriched" : "raw",
    aiSummary: entity.aiSummary || undefined,
    notes: `Imported from Sunbiz. Filing: ${entity.filingNumber || "N/A"}. ${entity.notes || ""}`.trim(),
    tags: ["sunbiz", ...(entity.tags || [])],
    enrichmentData: entity.enrichmentData || undefined,
    enrichedAt: entity.enrichedAt || undefined,
  });

  await storage.updateSunbizEntity(entityId, { prospectId: prospect.id });
  return prospect.id;
}

export async function aiBatchClassify(entities: SunbizEntity[]): Promise<{ classified: number; errors: number }> {
  if (entities.length === 0) return { classified: 0, errors: 0 };

  const batchLines = entities.map((e, i) => {
    const officers = ((e.officers as any[]) || []).map((o: any) => `${o.title}:${o.name}`).join("; ");
    return `${i}|${e.entityName}|${e.dba || ""}|${e.entityType || ""}|${e.principalCity || ""}|${officers}`;
  }).join("\n");

  const prompt = `Classify these Florida businesses into merchant verticals. For each line (format: index|name|dba|type|city|officers), return the vertical and score.

Verticals: Restaurant, Retail, Healthcare, Salon/Spa, Auto, Construction, Professional Services, Real Estate, Legal, Accounting, E-commerce, Food/Beverage, Fitness/Recreation, Transportation, Other
Score: hot (takes cards daily: restaurants, retail, healthcare, salons, auto, food/bev, fitness), warm (sometimes takes cards: construction, services, legal, accounting, real estate, ecommerce, transportation), cold (unlikely: generic LLCs, unclear), unqualified (holdings, trusts, nonprofits, churches, HOAs, government)

Businesses:
${batchLines}

Return JSON: {"results": [{"i": 0, "v": "Restaurant", "s": "hot"}, ...]}
Only return the JSON, no explanation.`;

  const slot2 = await checkAiGate("gpt-4o-mini");
  let batchResponse;
  try {
    batchResponse = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 2000,
    });
  } catch (providerErr) {
    slot2.refund();
    throw providerErr;
  }

  try {
    const response = batchResponse;
    slot2.settle(recordAiSpend("gpt-4o-mini", response.usage?.prompt_tokens ?? 0, response.usage?.completion_tokens ?? 0, "enrichment"));
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No AI response");
    const parsed = JSON.parse(content);
    const results = parsed.results || [];

    let classified = 0;
    for (const r of results) {
      const idx = r.i;
      if (idx < 0 || idx >= entities.length) continue;
      const entity = entities[idx];
      const vertical = r.v || "Other";
      const score = ["hot", "warm", "cold", "unqualified"].includes(r.s) ? r.s : "cold";
      const ownerName = extractOwnerFromOfficers((entity.officers as any[]) || []);

      await storage.updateSunbizEntity(entity.id, {
        enrichmentStatus: "classified",
        vertical,
        score,
        ownerName: ownerName || undefined,
        aiSummary: `AI classified as ${vertical} (${score})`,
      });
      classified++;
    }

    return { classified, errors: entities.length - classified };
  } catch (err) {
    console.error("[AI Batch Classify] Error:", err);
    return { classified: 0, errors: entities.length };
  }
}

export async function runBulkAIClassification(dailyLimit: number = 5000): Promise<{ total: number; classified: number; rounds: number }> {
  let total = 0;
  let classified = 0;
  let rounds = 0;
  const batchSize = 25;

  console.log(`[BulkAIClassify] Starting AI classification (up to ${dailyLimit} entities)...`);

  await storage.setSystemSetting("ai_classify_progress", {
    status: "running",
    dailyLimit,
    processed: 0,
    classified: 0,
    startedAt: new Date().toISOString(),
  });

  while (total < dailyLimit) {
    const remaining = Math.min(batchSize, dailyLimit - total);
    const batch = await storage.getSunbizEntitiesForAIClassification(remaining);
    if (batch.length === 0) break;

    const result = await aiBatchClassify(batch);
    total += batch.length;
    classified += result.classified;
    rounds++;

    if (rounds % 10 === 0) {
      console.log(`[BulkAIClassify] Progress: ${total}/${dailyLimit} processed, ${classified} classified`);
      await storage.setSystemSetting("ai_classify_progress", {
        status: "running", dailyLimit, processed: total, classified,
        lastUpdate: new Date().toISOString(),
      });
    }

    await new Promise(r => setTimeout(r, 200));
  }

  await storage.setSystemSetting("ai_classify_progress", {
    status: "complete", dailyLimit, processed: total, classified, rounds,
    completedAt: new Date().toISOString(),
  });

  console.log(`[BulkAIClassify] Complete: ${total} processed, ${classified} classified in ${rounds} rounds`);
  return { total, classified, rounds };
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    fn().then(result => { clearTimeout(timer); resolve(result); })
        .catch(() => { clearTimeout(timer); resolve(fallback); });
  });
}

export async function deepEnrichEntity(entityId: number): Promise<{
  email: string | null;
  phone: string | null;
  ownerName: string | null;
  website: string | null;
  vertical: string | null;
}> {
  const nullResult = { email: null, phone: null, ownerName: null, website: null, vertical: null };

  let entity: SunbizEntity | null = null;
  try {
    entity = await storage.getSunbizEntity(entityId);
  } catch (err) {
    console.error(`[DeepEnrich] DB error fetching entity ${entityId}:`, err);
    return nullResult;
  }
  if (!entity) return nullResult;

  try {
    await storage.updateSunbizEntity(entityId, { enrichmentStatus: "processing" });
  } catch {}

  const officers = ((entity.officers as any[]) || []);
  const ownerOfficer = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title)
  ) || officers[0];
  const ownerName = ownerOfficer?.name || entity.ownerName || entity.registeredAgentName || null;
  const city = entity.principalCity?.replace(/\s*(FL|FLA|FLORIDA)\s*$/i, "").trim() || "";
  const cleanName = cleanEntityName(entity.entityName);
  const searchName = entity.dba ? cleanEntityName(entity.dba) : cleanName;

  let website = entity.website || null;
  let foundEmails: string[] = [];
  let foundPhones: string[] = [];
  const sources: string[] = [];

  if (!website) {
    if (isSerperConfigured()) {
      try {
        const sr = await withTimeout(() => searchBusiness(searchName, city), 10000, { website: null, emails: [], phones: [], knowledgeGraphPhone: null, knowledgeGraphWebsite: null, organicUrls: [], sources: [] });
        if (sr.website) { website = sr.website; sources.push(...sr.sources); }
        if (sr.emails.length > 0) foundEmails.push(...sr.emails);
        if (sr.phones.length > 0) foundPhones.push(...sr.phones);
      } catch (err) { console.warn(`[DeepEnrich] Serper search failed for ${entityId}:`, err); }
    } else {
      try {
        const w = await withTimeout(() => searchGoogleForWebsite(searchName, city), 8000, null);
        if (w) { website = w; sources.push("google"); }
      } catch (err) { console.warn(`[DeepEnrich] Google website search failed for ${entityId}:`, err); }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (website) {
    try {
      const rawHtml = await withTimeout(() => fetchWebsite(website!), 6000, null);
      if (rawHtml) {
        const extracted = extractContactFromHtml(rawHtml);
        foundEmails.push(...extracted.emails);
        foundPhones.push(...extracted.phones);
        if (extracted.emails.length > 0 || extracted.phones.length > 0) sources.push("website");
      }
    } catch (err) { console.warn(`[DeepEnrich] Website fetch failed for ${entityId}:`, err); }

    if (foundEmails.length === 0 || foundPhones.length === 0) {
      try {
        const contactPage = await withTimeout(() => fetchContactPages(website!), 8000, "");
        if (contactPage) {
          const ex = extractContactFromHtml(contactPage);
          foundEmails.push(...ex.emails);
          foundPhones.push(...ex.phones);
          if (ex.emails.length > 0 || ex.phones.length > 0) sources.push("contact_page");
        }
      } catch (err) { console.warn(`[DeepEnrich] Contact page failed for ${entityId}:`, err); }
    }

  }

  if (foundPhones.length === 0) {
    try {
      const yp = await withTimeout(() => scrapeYellowPages(searchName, city), 8000, { phone: null, email: null, website: null });
      if (yp.phone) { foundPhones.push(yp.phone); sources.push("yellowpages"); }
      if (yp.email && foundEmails.length === 0) { foundEmails.push(yp.email); sources.push("yellowpages"); }
      if (yp.website && !website) { website = yp.website; sources.push("yellowpages_web"); }
    } catch (err) { console.warn(`[DeepEnrich] YellowPages failed for ${entityId}:`, err); }
    await new Promise(r => setTimeout(r, 300));
  }

  if (foundPhones.length === 0 || foundEmails.length === 0) {
    if (isSerperConfigured()) {
      try {
        const sc = await withTimeout(() => searchBusinessContacts(searchName, city, entity!.principalAddress || undefined), 10000, { emails: [], phones: [], website: null, sources: [] });
        if (sc.phones.length > 0) { foundPhones.push(...sc.phones); sources.push(...sc.sources); }
        if (sc.emails.length > 0) { foundEmails.push(...sc.emails); sources.push(...sc.sources); }
        if (sc.website && !website) { website = sc.website; }
      } catch (err) { console.warn(`[DeepEnrich] Serper contacts failed for ${entityId}:`, err); }
    } else {
      try {
        const gc = await withTimeout(() => searchGoogleForContacts(searchName, city, entity!.principalAddress || undefined), 8000, { emails: [], phones: [], website: null });
        if (gc.phones.length > 0) { foundPhones.push(...gc.phones); sources.push("google_contacts"); }
        if (gc.emails.length > 0) { foundEmails.push(...gc.emails); sources.push("google_contacts"); }
        if (gc.website && !website) { website = gc.website; }
      } catch (err) { console.warn(`[DeepEnrich] Google contacts failed for ${entityId}:`, err); }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (foundPhones.length === 0) {
    try {
      const yelp = await withTimeout(() => scrapeYelpForContacts(searchName, city), 8000, { phone: null, email: null, website: null });
      if (yelp.phone) { foundPhones.push(yelp.phone); sources.push("yelp"); }
      if (yelp.email && foundEmails.length === 0) { foundEmails.push(yelp.email); sources.push("yelp"); }
    } catch (err) { console.warn(`[DeepEnrich] Yelp failed for ${entityId}:`, err); }
    await new Promise(r => setTimeout(r, 300));
  }

  foundEmails = [...new Set(foundEmails.map(e => e.toLowerCase()))];
  foundPhones = [...new Set(foundPhones.map(p => p.replace(/[^\d]/g, "")).filter(p => p.length >= 10 && p.length <= 11))];

  let vertical = entity.vertical || null;
  let score = entity.score || null;
  if (!vertical || vertical === "Other") {
    const kw = classifyByName(entity.entityName, officers);
    if (kw.vertical !== "Other") {
      vertical = kw.vertical;
      score = kw.score;
    }
  }

  const bestEmail = foundEmails[0] || null;
  const bestPhone = foundPhones[0] || null;

  const updates: Record<string, any> = {
    enrichmentStatus: "enriched",
    enrichedAt: new Date(),
    enrichmentData: {
      sources,
      emailsFound: foundEmails,
      phonesFound: foundPhones,
      officerCount: officers.length,
      enrichedAt: new Date().toISOString(),
    },
  };

  if (bestEmail) updates.email = bestEmail;
  if (bestPhone) updates.phone = bestPhone;
  if (website) updates.website = website;
  if (ownerName) updates.ownerName = ownerName;
  if (bestEmail && ownerName) updates.ownerEmail = bestEmail;
  if (bestPhone && ownerName) updates.ownerPhone = bestPhone;
  if (vertical) updates.vertical = vertical;
  if (score) updates.score = score;

  try {
    await storage.updateSunbizEntity(entityId, updates);
  } catch (err) {
    console.error(`[DeepEnrich] DB update failed for ${entityId}:`, err);
    try {
      await storage.updateSunbizEntity(entityId, { enrichmentStatus: "failed" });
    } catch {}
  }

  return { email: bestEmail, phone: bestPhone, ownerName, website, vertical };
}

let pipelineRunning = false;
export function isPipelineRunning() { return pipelineRunning; }

export async function runDailyEnrichmentPipeline(options?: {
  classifyLimit?: number;
  enrichLimit?: number;
}): Promise<{
  keywordClassified: number;
  aiClassified: number;
  deepEnriched: number;
  emailsFound: number;
  phonesFound: number;
  errors: number;
  stuckReset: number;
}> {
  if (pipelineRunning) {
    console.log(`[DailyPipeline] Already running, skipping.`);
    return { keywordClassified: 0, aiClassified: 0, deepEnriched: 0, emailsFound: 0, phonesFound: 0, errors: 0, stuckReset: 0 };
  }
  pipelineRunning = true;

  const classifyLimit = options?.classifyLimit || 5000;
  const enrichLimit = options?.enrichLimit || 1000;
  let errors = 0;
  let stuckReset = 0;

  try {
    stuckReset = await storage.resetStuckProcessingEntities();
    if (stuckReset > 0) console.log(`[DailyPipeline] Reset ${stuckReset} stuck processing entities`);
  } catch (err) { console.error(`[DailyPipeline] Reset stuck failed:`, err); }

  await storage.setSystemSetting("daily_pipeline_progress", {
    status: "running", phase: "keyword_classification",
    startedAt: new Date().toISOString(),
  });

  let kwClassified = 0;
  let aiClassified = 0;

  if (classifyLimit > 0) {
    try {
      console.log(`[DailyPipeline] Phase 1: Keyword classification...`);
      const kwResult = await fastClassifyBatch(2000);
      kwClassified = kwResult.classified;
      console.log(`[DailyPipeline] Keyword classified: ${kwResult.classified}/${kwResult.processed}`);
    } catch (err) {
      console.error(`[DailyPipeline] Phase 1 failed:`, err);
    }

    try {
      await storage.setSystemSetting("daily_pipeline_progress", {
        status: "running", phase: "ai_classification",
        keywordClassified: kwClassified,
      });
      console.log(`[DailyPipeline] Phase 2: AI batch classification (up to ${classifyLimit})...`);
      const aiResult = await runBulkAIClassification(classifyLimit);
      aiClassified = aiResult.classified;
      console.log(`[DailyPipeline] AI classified: ${aiResult.classified}/${aiResult.total}`);
    } catch (err) {
      console.error(`[DailyPipeline] Phase 2 failed:`, err);
    }
  } else {
    console.log(`[DailyPipeline] Skipping classification (classifyLimit=0)`);
  }

  console.log(`[DailyPipeline] Phase 3: Deep enrichment for up to ${enrichLimit} hot/warm entities...`);
  let toEnrich: SunbizEntity[] = [];
  try {
    toEnrich = await storage.getSunbizEntitiesNeedingEnrichment(enrichLimit);
  } catch (err) {
    console.error(`[DailyPipeline] Failed to fetch entities for enrichment:`, err);
  }

  let deepEnriched = 0;
  let emailsFound = 0;
  let phonesFound = 0;

  await storage.setSystemSetting("daily_pipeline_progress", {
    status: "running", phase: "deep_enrichment",
    target: toEnrich.length, processed: 0,
    emailsFound: 0, phonesFound: 0,
    keywordClassified: kwClassified, aiClassified,
  });

  for (const entity of toEnrich) {
    try {
      const result = await withTimeout(() => deepEnrichEntity(entity.id), 45000, { email: null, phone: null, ownerName: null, website: null, vertical: null });
      deepEnriched++;
      if (result.email) emailsFound++;
      if (result.phone) phonesFound++;

      if (deepEnriched % 50 === 0) {
        console.log(`[DailyPipeline] Deep enrichment: ${deepEnriched}/${toEnrich.length} (${emailsFound} emails, ${phonesFound} phones, ${errors} errors)`);
        await storage.setSystemSetting("daily_pipeline_progress", {
          status: "running", phase: "deep_enrichment",
          target: toEnrich.length, processed: deepEnriched,
          emailsFound, phonesFound, errors,
          lastUpdate: new Date().toISOString(),
        });
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      errors++;
      console.error(`[DailyPipeline] Deep enrich failed for ${entity.id}, moving to next:`, err);
      try {
        await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "failed" });
      } catch {}
    }
  }

  pipelineRunning = false;

  await storage.setSystemSetting("daily_pipeline_progress", {
    status: "complete",
    keywordClassified: kwClassified,
    aiClassified,
    deepEnriched,
    emailsFound,
    phonesFound,
    errors,
    stuckReset,
    completedAt: new Date().toISOString(),
  });

  console.log(`[DailyPipeline] Complete: KW=${kwClassified}, AI=${aiClassified}, Deep=${deepEnriched}, Emails=${emailsFound}, Phones=${phonesFound}, Errors=${errors}`);
  return { keywordClassified: kwClassified, aiClassified, deepEnriched, emailsFound, phonesFound, errors, stuckReset };
}

export async function runAutoDeduplication(limit: number = 500): Promise<{ checked: number; merged: number }> {
  let merged = 0;
  try {
    const dupes = await storage.getSunbizDuplicates(limit);
    for (const dupe of dupes) {
      if (dupe.ids.length < 2) continue;
      const keepId = dupe.ids[0];
      const mergeIds = dupe.ids.slice(1);
      const ok = await storage.mergeSunbizDuplicates(keepId, mergeIds);
      if (ok) merged += mergeIds.length;
    }
    return { checked: dupes.length, merged };
  } catch (err) {
    console.error(`[Dedup] Error:`, err);
    return { checked: 0, merged };
  }
}
