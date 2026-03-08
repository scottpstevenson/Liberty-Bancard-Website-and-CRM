import { storage } from "../storage";
import type { SunbizEntity } from "@shared/schema";
import OpenAI from "openai";
import { toProperCase } from "./sunbiz-scraper";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
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
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
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
    if (combined.length > 6000) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`https://${cleanDomain}${path}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        redirect: "follow",
      });
      clearTimeout(timeout);
      if (response.ok) {
        const html = await response.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000);
        if (text.length > 50) combined += ` [${path}] ${text}`;
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
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
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

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

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
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!website) {
    console.log(`[Enrich] Step 2: Google website search`);
    website = await searchGoogleForWebsite(entity.entityName, city);
    if (website) {
      sources.push("google_website");
      console.log(`[Enrich]   → Found website: ${website}`);
    }
    await new Promise(r => setTimeout(r, 1500));
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
    await new Promise(r => setTimeout(r, 1500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 5: Yelp search`);
    const yelp = await scrapeYelpForContacts(entity.entityName, city);
    if (yelp.phone) { foundPhones.push(yelp.phone); sources.push("yelp"); console.log(`[Enrich]   → Yelp phone: ${yelp.phone}`); }
    if (yelp.email) { foundEmails.push(yelp.email); sources.push("yelp"); console.log(`[Enrich]   → Yelp email: ${yelp.email}`); }
    if (yelp.website && !website) { website = yelp.website; sources.push("yelp_website"); }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (foundPhones.length === 0) {
    console.log(`[Enrich] Step 6: YellowPages search`);
    const yp = await scrapeYellowPages(entity.entityName, city);
    if (yp.phone) { foundPhones.push(yp.phone); sources.push("yellowpages"); console.log(`[Enrich]   → YP phone: ${yp.phone}`); }
    if (yp.email) { foundEmails.push(yp.email); sources.push("yellowpages"); }
    if (yp.website && !website) { website = yp.website; sources.push("yellowpages_website"); }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 7: LinkedIn search`);
    const li = await scrapeLinkedInPage(entity.entityName, city);
    if (li.phone) { foundPhones.push(li.phone); sources.push("linkedin"); }
    if (li.email) { foundEmails.push(li.email); sources.push("linkedin"); }
    if (li.website && !website) { website = li.website; sources.push("linkedin_website"); }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (foundPhones.length === 0) {
    console.log(`[Enrich] Step 8: BBB search`);
    const bbb = await scrapeBBB(entity.entityName, city);
    if (bbb.phone) { foundPhones.push(bbb.phone); sources.push("bbb"); console.log(`[Enrich]   → BBB phone: ${bbb.phone}`); }
    if (bbb.website && !website) { website = bbb.website; sources.push("bbb_website"); }
    await new Promise(r => setTimeout(r, 1500));
  }

  if (foundEmails.length === 0 || foundPhones.length === 0) {
    console.log(`[Enrich] Step 9: Google direct contact search`);
    const gc = await searchGoogleForContacts(entity.entityName, city, address);
    if (gc.emails.length > 0) { foundEmails.push(...gc.emails); sources.push("google_contacts"); }
    if (gc.phones.length > 0) { foundPhones.push(...gc.phones); sources.push("google_contacts"); }
    if (gc.website && !website) { website = gc.website; sources.push("google_contacts_website"); }
    await new Promise(r => setTimeout(r, 1500));
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
    await new Promise(r => setTimeout(r, 1500));
  }

  if (website && foundEmails.length === 0 && foundPhones.length === 0) {
    const rawHtml = await fetchWebsite(website);
    if (rawHtml) {
      const extracted = extractContactFromHtml(rawHtml);
      foundEmails.push(...extracted.emails);
      foundPhones.push(...extracted.phones);
    }
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

const VERTICAL_KEYWORDS: Record<string, string[]> = {
  "Restaurant": ["restaurant", "grill", "pizza", "sushi", "cafe", "bistro", "diner", "taco", "burrito", "bbq", "bakery", "catering", "food truck", "steakhouse", "seafood", "wings", "sandwich", "deli", "donut", "cupcake", "ice cream", "frozen yogurt", "juice bar", "smoothie", "coffee shop", "brewpub", "taproom", "bar & grill", "cantina", "trattoria", "ramen", "pho", "thai", "chinese", "indian", "japanese", "mexican", "italian", "mediterranean", "bagel"],
  "Retail": ["store", "shop", "boutique", "mart", "outlet", "wholesale", "retail", "gallery", "market", "emporium", "supermarket", "convenience", "gift shop", "antique", "thrift", "consignment", "furniture store", "hardware", "pet store", "toy store", "book store", "clothing", "apparel", "shoes", "jewelry store", "florist", "flower shop", "wine shop", "liquor store", "smoke shop", "vape"],
  "Healthcare": ["medical", "dental", "clinic", "doctor", "physician", "healthcare", "health care", "therapy", "chiropractic", "chiropractor", "dermatology", "dermatologist", "optometry", "ophthalmology", "pediatric", "orthopedic", "cardiology", "neurology", "urgent care", "pharmacy", "physical therapy", "mental health", "counseling", "psychiatry", "veterinary", "vet clinic", "animal hospital", "wellness center", "medspa", "med spa", "aesthetic", "cosmetic surgery", "plastic surgery", "orthodont"],
  "Salon/Spa": ["salon", "barbershop", "barber", "spa", "nails", "nail salon", "beauty", "hair", "lashes", "waxing", "tanning", "skincare", "makeup", "tattoo", "piercing", "massage"],
  "Auto": ["auto", "automotive", "car wash", "tire", "mechanic", "body shop", "collision", "transmission", "brake", "muffler", "oil change", "lube", "detailing", "auto repair", "car dealer", "used car", "truck", "motorcycle", "marine", "boat"],
  "Construction": ["construction", "roofing", "plumbing", "plumber", "electric", "electrician", "hvac", "air conditioning", "heating", "cooling", "painting", "painter", "flooring", "carpet", "tile", "concrete", "masonry", "framing", "drywall", "demolition", "excavation", "paving", "landscaping", "lawn", "tree service", "pool", "fence", "remodeling", "renovation", "general contractor", "handyman", "pest control", "cleaning service", "janitorial", "pressure washing"],
  "Real Estate": ["real estate", "realty", "property", "properties", "mortgage", "title", "escrow", "appraisal", "brokerage"],
  "Legal": ["law firm", "attorney", "lawyer", "legal", "law office", "law group", "paralegal", "notary"],
  "Accounting": ["accounting", "accountant", "cpa", "bookkeeping", "tax service", "tax prep", "payroll"],
  "Professional Services": ["consulting", "consultant", "advisory", "management", "marketing", "advertising", "design", "architect", "engineering", "staffing", "recruiting", "insurance", "financial", "investment", "wealth management"],
  "E-commerce": ["online", "e-commerce", "ecommerce", "digital", "web store", "marketplace"],
};

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
        const score = ["Restaurant", "Retail", "Healthcare", "Salon/Spa", "Auto"].includes(vertical) ? "hot" : "warm";
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
  const batch = await storage.getSunbizEntitiesByStatus("pending", batchSize);

  let processed = 0;
  let classified = 0;

  for (const entity of batch) {
    try {
      const officers = (entity.officers as any[]) || [];
      const result = classifyByName(entity.entityName, officers);

      await storage.updateSunbizEntity(entity.id, {
        enrichmentStatus: "enriched",
        enrichedAt: new Date(),
        vertical: result.vertical,
        score: result.score,
        ownerName: result.ownerName || undefined,
        aiSummary: result.aiSummary,
      });

      processed++;
      if (result.vertical !== "Other") classified++;
    } catch (err) {
      console.error(`[FastClassify] Failed for entity ${entity.id}:`, err);
    }
  }

  return { processed, classified };
}

export async function runBulkFastClassification(): Promise<{ total: number; classified: number; rounds: number }> {
  let total = 0;
  let totalClassified = 0;
  let rounds = 0;

  const countResult = await storage.getSunbizEntitiesByStatus("pending", 1);
  const totalPending = countResult.length > 0 ? await storage.getSunbizEntityCount() : 0;
  console.log(`[BulkClassify] Starting fast classification (estimated ${totalPending} pending entities)...`);

  while (true) {
    const { processed, classified } = await fastClassifyBatch(1000);
    if (processed === 0) break;

    total += processed;
    totalClassified += classified;
    rounds++;

    if (rounds % 10 === 0) {
      console.log(`[BulkClassify] Progress: ${total}/${totalPending} processed, ${totalClassified} classified to vertical`);
      await storage.setSystemSetting("bulk_classify_progress", {
        status: "running",
        total: totalPending,
        processed: total,
        classified: totalClassified,
        rounds,
        lastUpdate: new Date().toISOString(),
      });
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  await storage.setSystemSetting("bulk_classify_progress", {
    status: "complete",
    total: totalPending,
    processed: total,
    classified: totalClassified,
    rounds,
    completedAt: new Date().toISOString(),
  });

  console.log(`[BulkClassify] Complete: ${total} processed, ${totalClassified} classified in ${rounds} rounds`);
  return { total, classified: totalClassified, rounds };
}

export async function processSunbizEnrichmentQueue(limit: number = 5): Promise<number> {
  const pending = await storage.getSunbizEntitiesByStatus("pending");
  const toProcess = pending.slice(0, limit);
  let processed = 0;

  for (const entity of toProcess) {
    try {
      await enrichSunbizEntity(entity.id);
      processed++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`Sunbiz enrichment failed for entity ${entity.id}:`, err);
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "failed" });
    }
  }

  return processed;
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
