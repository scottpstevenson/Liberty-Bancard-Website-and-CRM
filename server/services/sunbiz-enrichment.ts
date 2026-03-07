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

function guessWebsiteDomain(companyName: string, city?: string): string[] {
  const suffixRegex = /\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|PLLC|PA|PC|GROUP|HOLDINGS|ENTERPRISES|SERVICES|SOLUTIONS|INTERNATIONAL|PARTNERS|ASSOCIATES|OF\s+FLORIDA|OF\s+FL)\b/gi;

  const baseName = companyName
    .replace(suffixRegex, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  const withDash = companyName
    .replace(suffixRegex, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  const words = companyName
    .replace(suffixRegex, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 1);

  const initials = words.map(w => w[0]).join("");

  const domains: string[] = [];
  if (baseName && baseName.length > 2) {
    domains.push(`${baseName}.com`);
    domains.push(`${withDash}.com`);
    domains.push(`${baseName}.net`);
    domains.push(`${withDash}.net`);
    domains.push(`${baseName}.org`);
    domains.push(`${baseName}.biz`);
    if (city) {
      const cleanCity = city.toLowerCase().replace(/[^a-z]/g, "");
      domains.push(`${baseName}${cleanCity}.com`);
      domains.push(`${baseName}fl.com`);
    }
    if (initials.length >= 2 && initials.length <= 5) {
      domains.push(`${initials}.com`);
    }
    if (words.length >= 2) {
      domains.push(`${words[0]}${words[1]}.com`);
    }
  }
  return [...new Set(domains)];
}

async function tryFindWebsite(companyName: string, city?: string): Promise<string | null> {
  const candidates = guessWebsiteDomain(companyName, city);
  for (const domain of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`https://${domain}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
        method: "HEAD",
        redirect: "manual",
      });
      clearTimeout(timeout);
      if (response.ok || response.status === 301 || response.status === 302) {
        return domain;
      }
    } catch {
      continue;
    }
  }
  return null;
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

async function enrichWithAI(entity: SunbizEntity, websiteText: string | null, foundEmails: string[], foundPhones: string[]): Promise<AIEnrichResult> {
  const officers = (entity.officers as any[]) || [];
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
- Registered Agent: ${entity.registeredAgentName || "N/A"}
- Officers: ${officers.map((o: any) => `${o.title}: ${o.name}`).join(", ") || "N/A"}
- Owner/Key Person: ${ownerOfficer ? `${ownerOfficer.name} (${ownerOfficer.title})` : "N/A"}

Found on website:
- Emails: ${foundEmails.length > 0 ? foundEmails.join(", ") : "None found"}
- Phones: ${foundPhones.length > 0 ? foundPhones.join(", ") : "None found"}

${websiteText ? `Website Content (excerpt):\n${websiteText.slice(0, 2000)}` : "No website content available."}

Provide JSON:
{
  "bestEmail": "the best email to reach the owner/decision maker (pick from found emails or infer from company domain if possible, or null)",
  "bestPhone": "the best phone number (pick from found phones or null)",
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
    return {
      ownerName: result.ownerName || undefined,
      ownerEmail: result.bestEmail || undefined,
      ownerPhone: result.bestPhone || undefined,
      email: result.bestEmail || (foundEmails[0] || undefined),
      phone: result.bestPhone || (foundPhones[0] || undefined),
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

  if (!website) {
    website = await tryFindWebsite(entity.entityName, entity.principalCity || undefined);
  }

  if (website) {
    const rawHtml = await fetchWebsite(website);
    if (rawHtml) {
      websiteText = rawHtml;
      const extracted = extractContactFromHtml(rawHtml);
      foundEmails = extracted.emails;
      foundPhones = extracted.phones;
    }

    if (foundEmails.length === 0 || foundPhones.length === 0) {
      const contactPageText = await fetchContactPages(website);
      if (contactPageText) {
        const contactExtracted = extractContactFromHtml(contactPageText);
        if (contactExtracted.emails.length > 0) {
          foundEmails = [...new Set([...foundEmails, ...contactExtracted.emails])];
        }
        if (contactExtracted.phones.length > 0) {
          foundPhones = [...new Set([...foundPhones, ...contactExtracted.phones])];
        }
        if (websiteText) {
          websiteText += " " + contactPageText.slice(0, 2000);
        } else {
          websiteText = contactPageText;
        }
      }
    }
  }

  const aiResult = await enrichWithAI(entity, websiteText, foundEmails, foundPhones);

  const aiFailed = aiResult.aiSummary === "AI enrichment failed";

  const officers = (entity.officers as any[]) || [];
  const ownerOfficer = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title)
  ) || officers[0];

  const updates: Record<string, any> = {
    enrichmentStatus: aiFailed ? "pending" : "enriched",
    enrichedAt: aiFailed ? undefined : new Date(),
  };

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
