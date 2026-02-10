import { storage } from "../storage";
import type { SunbizEntity } from "@shared/schema";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI();
}

async function fetchWebsite(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    const response = await fetch(cleanUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
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
  const baseName = companyName
    .replace(/\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|PLLC|PA|PC|GROUP|HOLDINGS|ENTERPRISES|SERVICES|SOLUTIONS|INTERNATIONAL|PARTNERS|ASSOCIATES)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  const withDash = companyName
    .replace(/\b(LLC|INC|CORP|CORPORATION|COMPANY|CO|LTD|LP|LLP|PLLC|PA|PC|GROUP|HOLDINGS|ENTERPRISES|SERVICES|SOLUTIONS|INTERNATIONAL|PARTNERS|ASSOCIATES)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  const domains: string[] = [];
  if (baseName) {
    domains.push(`${baseName}.com`);
    domains.push(`${withDash}.com`);
    if (baseName !== withDash) {
      domains.push(`${baseName}.net`);
      domains.push(`${withDash}.net`);
    }
  }
  return domains;
}

async function tryFindWebsite(companyName: string, city?: string): Promise<string | null> {
  const candidates = guessWebsiteDomain(companyName, city);
  for (const domain of candidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`https://${domain}`, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
        method: "HEAD",
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
  }

  const aiResult = await enrichWithAI(entity, websiteText, foundEmails, foundPhones);

  const officers = (entity.officers as any[]) || [];
  const ownerOfficer = officers.find((o: any) =>
    /president|ceo|owner|managing|principal|organizer|director|manager|member/i.test(o.title)
  ) || officers[0];

  const updates: Record<string, any> = {
    enrichmentStatus: "enriched",
    enrichedAt: new Date(),
  };

  if (website) updates.website = website;
  if (aiResult.email || foundEmails[0]) updates.email = aiResult.email || foundEmails[0];
  if (aiResult.phone || foundPhones[0]) updates.phone = aiResult.phone || foundPhones[0];
  if (ownerOfficer) updates.ownerName = ownerOfficer.name;
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
    companyName: entity.entityName,
    dba: entity.dba || undefined,
    website: entity.website || undefined,
    phone: entity.phone || undefined,
    email: entity.email || undefined,
    ownerFirstName: entity.ownerName?.split(" ")[0] || undefined,
    ownerLastName: entity.ownerName?.split(" ").slice(1).join(" ") || undefined,
    ownerEmail: entity.ownerEmail || undefined,
    ownerPhone: entity.ownerPhone || undefined,
    address: entity.principalAddress || undefined,
    city: entity.principalCity || undefined,
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
