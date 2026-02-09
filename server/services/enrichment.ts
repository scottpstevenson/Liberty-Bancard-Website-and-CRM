import { storage } from "../storage";
import type { Prospect } from "@shared/schema";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI();
}

interface EnrichmentResult {
  website?: string;
  vertical?: string;
  estimatedRevenue?: string;
  ownerName?: string;
  ownerEmail?: string;
  businessDescription?: string;
  painPoints?: string[];
  score: "hot" | "warm" | "cold" | "unqualified";
  scoreReason?: string;
}

async function scrapeWebsiteInfo(domain: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`https://${domain}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LibertyBancardBot/1.0)" },
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
    return text;
  } catch {
    return null;
  }
}

function inferDomainFromEmail(email: string): string | null {
  if (!email) return null;
  const domain = email.split("@")[1];
  if (!domain) return null;
  const freeDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "mail.com", "protonmail.com"];
  if (freeDomains.includes(domain.toLowerCase())) return null;
  return domain;
}

async function enrichWithAI(prospect: Prospect, websiteText: string | null): Promise<EnrichmentResult> {
  const prompt = `You are a B2B sales intelligence analyst for Liberty Bancard, a merchant payment processing company. Analyze this business prospect and provide enrichment data.

Business Info:
- Company: ${prospect.companyName || "Unknown"}
- Email: ${prospect.email || "N/A"}
- Phone: ${prospect.phone || "N/A"}
- Location: ${prospect.city || ""} ${prospect.state || ""}
- Current Vertical: ${prospect.vertical || "Unknown"}
${websiteText ? `\nWebsite Content (excerpt):\n${websiteText}` : ""}

Provide JSON with these fields:
{
  "vertical": "best matching industry vertical (Restaurant, Retail, Professional Services, Healthcare, Auto, Salon/Spa, E-commerce, Other)",
  "estimatedRevenue": "estimated annual revenue range (Under $500K, $500K-$1M, $1M-$5M, $5M-$10M, $10M+)",
  "businessDescription": "one sentence description of what the business does",
  "painPoints": ["list of 2-3 likely payment processing pain points based on their business type"],
  "score": "hot/warm/cold/unqualified - based on likelihood they'd benefit from payment processing optimization",
  "scoreReason": "brief reason for the score"
}

Scoring criteria:
- HOT: High-volume business (restaurant, retail, healthcare) with clear payment processing needs
- WARM: Medium-volume or service business that likely processes cards
- COLD: Low volume or unclear needs but could be a fit
- UNQUALIFIED: Non-profit, government, or business unlikely to need merchant services`;

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
      vertical: result.vertical || undefined,
      estimatedRevenue: result.estimatedRevenue || undefined,
      businessDescription: result.businessDescription || undefined,
      painPoints: result.painPoints || [],
      score: ["hot", "warm", "cold", "unqualified"].includes(result.score) ? result.score : "cold",
      scoreReason: result.scoreReason || undefined,
    };
  } catch (err) {
    console.error("AI enrichment failed:", err);
    return { score: "cold", scoreReason: "AI enrichment failed" };
  }
}

export async function enrichProspect(prospectId: number): Promise<Prospect | null> {
  const prospect = await storage.getProspect(prospectId);
  if (!prospect) return null;

  let websiteText: string | null = null;
  let domain = prospect.website;

  if (!domain && prospect.email) {
    domain = inferDomainFromEmail(prospect.email) || null;
  }

  if (domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    websiteText = await scrapeWebsiteInfo(cleanDomain);
    if (!prospect.website && domain) {
      await storage.updateProspect(prospectId, { website: cleanDomain });
    }
  }

  const result = await enrichWithAI(prospect, websiteText);

  const updates: Record<string, any> = {
    enrichedAt: new Date(),
    score: result.score,
    status: "enriched",
  };

  if (result.vertical) updates.vertical = result.vertical;
  if (result.estimatedRevenue) updates.estimatedRevenue = result.estimatedRevenue;
  if (result.scoreReason) updates.notes = `${prospect.notes || ""}\n[AI Score: ${result.score}] ${result.scoreReason}`.trim();
  if (result.painPoints && result.painPoints.length > 0) {
    updates.tags = [...(prospect.tags || []), ...result.painPoints.map((p: string) => `pain_${p.toLowerCase().replace(/\s+/g, "_")}`)];
  }

  const updated = await storage.updateProspect(prospectId, updates);
  return updated || prospect;
}

export async function runEnrichmentJob(jobId: number): Promise<void> {
  const job = await storage.updateEnrichmentJob(jobId, { status: "running", startedAt: new Date() });
  if (!job) return;

  const prospects = await storage.getProspects(job.listId!);
  const unenriched = prospects.filter(p => !p.enrichedAt && p.status !== "do_not_contact");

  let processed = 0;
  let failed = 0;

  for (const prospect of unenriched) {
    try {
      await enrichProspect(prospect.id);
      processed++;
    } catch (err) {
      console.error(`Enrichment failed for prospect ${prospect.id}:`, err);
      failed++;
    }

    await storage.updateEnrichmentJob(jobId, {
      processedCount: processed + failed,
      completedAt: undefined,
    });

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await storage.updateEnrichmentJob(jobId, {
    status: failed > 0 ? "completed_with_errors" : "completed",
    processedCount: processed + failed,
    completedAt: new Date(),
    errorLog: failed > 0 ? `${failed} prospects failed enrichment` : undefined,
  });
}

export async function processEnrichmentQueue(): Promise<void> {
  const pendingJobs = await storage.getPendingEnrichmentJobs(1);
  if (pendingJobs.length === 0) return;

  const job = pendingJobs[0];
  await runEnrichmentJob(job.id);
}
