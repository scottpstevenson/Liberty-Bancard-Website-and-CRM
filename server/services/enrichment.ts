import { storage } from "../storage";
import { db } from "../db";
import { enrichmentRuns, businesses } from "@shared/schema";
import type { Prospect } from "@shared/schema";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { isSerperConfigured, searchBusiness, searchBusinessEmail } from "./serper";
import { ingestBusinessFromContact } from "./sdr/dedupe";
import { detectProcessors } from "./sdr/processor-detector";
import { detectAds } from "./sdr/ad-detector";
import { updateContactLocalFirst } from "./contact-writer";
import { enqueueReadinessRecalculation } from "./contact-readiness";
import { logAiCall } from "./ai-audit-logger";
import { scoreDecisionMaker } from "./bounce-feedback";
import { recordDecisionMakerCandidate } from "./commercial-relationship-authority";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
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

  const enrichMessages = [{ role: "user" as const, content: prompt }];
  try {
    const { completion: response, flagged: enrichFlagged, reviewQueueId: enrichReviewId } = await logAiCall(
      { triggerType: "enrichment", actorType: "system", rawPrompt: JSON.stringify(enrichMessages) },
      () => getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        messages: enrichMessages,
        response_format: { type: "json_object" },
      })
    );

    if (enrichFlagged) {
      console.warn(`[AI Governance] Enrichment classification flagged (reviewQueueId=${enrichReviewId}) — deferring AI-derived data persistence pending review`);
      return { score: "cold", scoreReason: `AI classification deferred for review (reviewQueueId=${enrichReviewId})` };
    }

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

export function computeDecisionMakerConfidence(title: string): { isDecisionMaker: boolean; confidence: number } {
  const t = title.toLowerCase();
  if (/\b(owner|ceo|chief executive|president|principal)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 95 };
  }
  if (/\b(managing member|managing partner|partner)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 80 };
  }
  if (/\b(director|vp|vice president)\b/.test(t)) {
    return { isDecisionMaker: true, confidence: 60 };
  }
  if (/\bmanager\b/.test(t)) {
    return { isDecisionMaker: false, confidence: 40 };
  }
  return { isDecisionMaker: false, confidence: 0 };
}

export async function applyDecisionMakerDetection(contactId: number, title: string): Promise<void> {
  try {
    const contact = await storage.getContact(contactId);
    if (!contact?.businessId) return;
    const { confidence } = computeDecisionMakerConfidence(title);
    await recordDecisionMakerCandidate({
      contactId, businessId: contact.businessId, source: "title_heuristic", sourceVersion: "v1", confidence,
    });
  } catch {}
}

export async function enrichProspect(prospectId: number): Promise<Prospect | null> {
  const prospect = await storage.getProspect(prospectId);
  if (!prospect) return null;

  let websiteText: string | null = null;
  let domain = prospect.website;
  let foundEmail = prospect.email || null;
  let foundPhone = prospect.phone || null;

  if (!domain && prospect.email) {
    domain = inferDomainFromEmail(prospect.email) || null;
  }

  if (isSerperConfigured() && (!domain || !foundEmail || !foundPhone)) {
    const companyName = prospect.companyName || "";
    if (companyName) {
      const serperResult = await searchBusiness(companyName, prospect.city || undefined, prospect.state || "FL");
      if (serperResult.website && !domain) {
        domain = serperResult.website;
      }
      if (serperResult.emails.length > 0 && !foundEmail) {
        foundEmail = serperResult.emails[0];
      }
      if (serperResult.phones.length > 0 && !foundPhone) {
        foundPhone = serperResult.phones[0];
      }

      if (!foundEmail && domain) {
        const emailResult = await searchBusinessEmail(companyName, domain, prospect.city || undefined);
        if (emailResult.emails.length > 0) {
          foundEmail = emailResult.emails[0];
        }
      }
    }
  }

  if (domain) {
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    websiteText = await scrapeWebsiteInfo(cleanDomain);
    if (!prospect.website) {
      await storage.updateProspect(prospectId, { website: cleanDomain });
    }
  }

  const result = await enrichWithAI(prospect, websiteText);

  const updates: Record<string, any> = {
    enrichedAt: new Date(),
    score: result.score,
    status: "enriched",
  };

  if (foundEmail && !prospect.email) updates.email = foundEmail;
  if (foundPhone && !prospect.phone) updates.phone = foundPhone;
  if (domain && !prospect.website) updates.website = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (result.vertical) updates.vertical = result.vertical;
  if (result.estimatedRevenue) updates.estimatedRevenue = result.estimatedRevenue;
  if (result.scoreReason) updates.notes = `${prospect.notes || ""}\n[AI Score: ${result.score}] ${result.scoreReason}`.trim();
  if (result.painPoints && result.painPoints.length > 0) {
    updates.tags = [...(prospect.tags || []), ...result.painPoints.map((p: string) => `pain_${p.toLowerCase().replace(/\s+/g, "_")}`)];
  }

  const updated = await storage.updateProspect(prospectId, updates);

  if (updated?.contactId) {
    try {
      const contact = await storage.getContact(updated.contactId);
      if (contact?.businessId) {
        detectProcessors(contact.businessId).catch(err =>
          console.error(`[Enrichment] Processor detection failed for business ${contact.businessId}:`, err)
        );
        detectAds(contact.businessId).catch(err =>
          console.error(`[Enrichment] Ad detection failed for business ${contact.businessId}:`, err)
        );
      }
      if (contact && contact.title) {
        await applyDecisionMakerDetection(contact.id, contact.title);
      }
    } catch {}
  }

  return updated || prospect;
}

export async function runEnrichmentJob(jobId: number): Promise<void> {
  const job = await storage.updateEnrichmentJob(jobId, { status: "running", startedAt: new Date() });
  if (!job) return;

  const [enrichRun] = await db.insert(enrichmentRuns).values({
    provider: "internal",
    jobType: "website_lookup",
    status: "processing",
    startedAt: new Date(),
    inputPayload: { jobId, totalRecords: 0 },
  }).returning();

  const prospectsResult = await storage.getProspects(job.listId!);
  const prospects = (prospectsResult as any).data ?? prospectsResult;
  const unenriched = (prospects as any[]).filter(p => !p.enrichedAt && p.status !== "do_not_contact");

  await db.update(enrichmentRuns).set({ inputPayload: { jobId, totalRecords: unenriched.length } }).where(eq(enrichmentRuns.id, enrichRun.id));

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

  await db.update(enrichmentRuns).set({
    status: failed > 0 ? "partial" : "success",
    completedAt: new Date(),
    outputPayload: { processed, failed, total: unenriched.length },
    errorMessage: failed > 0 ? `${failed} prospects failed enrichment` : null,
  }).where(eq(enrichmentRuns.id, enrichRun.id));

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

let contactEnrichRunning = false;
export function isContactEnrichRunning() { return contactEnrichRunning; }

export async function enrichContactBatch(
  contactIds: number[],
  options?: { batchSize?: number }
): Promise<{ processed: number; emailsFound: number; phonesFound: number; websitesFound: number; errors: number }> {
  if (contactEnrichRunning) {
    console.warn("[ContactEnrich] Already running, skipping.");
    return { processed: 0, emailsFound: 0, phonesFound: 0, websitesFound: 0, errors: 0 };
  }
  contactEnrichRunning = true;
  const batchSize = options?.batchSize || 10;
  let processed = 0;
  let emailsFound = 0;
  let phonesFound = 0;
  let websitesFound = 0;
  let errors = 0;

  const progressKey = "contact_enrich_batch_progress";

  try {
    const [enrichRun] = await db.insert(enrichmentRuns).values({
      provider: "serper",
      jobType: "email_lookup",
      status: "processing",
      startedAt: new Date(),
      inputPayload: { totalRecords: contactIds.length, contactIds: contactIds.slice(0, 10) },
    }).returning();

    await storage.setSystemSetting(progressKey, {
      status: "running",
      total: contactIds.length,
      processed: 0,
      emailsFound: 0,
      phonesFound: 0,
      websitesFound: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      enrichmentRunId: enrichRun.id,
    });

    for (let i = 0; i < contactIds.length; i += batchSize) {
      const batch = contactIds.slice(i, i + batchSize);

      for (const contactId of batch) {
        try {
          const contact = await storage.getContact(contactId);
          if (!contact) { errors++; continue; }

          const companyName = contact.companyName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
          if (!companyName) { errors++; continue; }

          const needsEmail = !contact.email;
          const needsPhone = !contact.phone;
          const needsWebsite = !contact.website;
          const needsSerper = needsEmail || needsPhone || needsWebsite;

          const updates: Record<string, any> = {};

          if (needsSerper) {
            if (!isSerperConfigured()) {
              errors++;
              continue;
            }

            const serperResult = await searchBusiness(companyName, contact.city || undefined, contact.state || "FL");

            if (serperResult.website && needsWebsite) {
              updates.website = serperResult.website;
              websitesFound++;
            }
            if (serperResult.emails.length > 0 && needsEmail) {
              updates.email = serperResult.emails[0];
              emailsFound++;
            }
            if (serperResult.phones.length > 0 && needsPhone) {
              updates.phone = serperResult.phones[0];
              phonesFound++;
            }

            if (needsEmail && !updates.email && serperResult.website) {
              const emailResult = await searchBusinessEmail(companyName, serperResult.website, contact.city || undefined);
              if (emailResult.emails.length > 0) {
                updates.email = emailResult.emails[0];
                emailsFound++;
              }
            }
          }

          const currentTitle = contact.title ?? null;
          if (currentTitle && contact.businessId) {
            const dm = scoreDecisionMaker(currentTitle);
            await recordDecisionMakerCandidate({
              contactId, businessId: contact.businessId, source: "title_heuristic",
              sourceVersion: "bounce-feedback-v1", confidence: dm.confidence,
            });
          }

          if (Object.keys(updates).length > 0) {
            if (updates.email || updates.phone) {
              // Keep this in the canonical writer transaction so active
              // CRO-03B recipe contacts cannot be mutated by a legacy worker.
              updates.outreachQueueSkippedAt = null;
            }
            await updateContactLocalFirst(contactId, updates);
            enqueueReadinessRecalculation(contactId).catch(() => {});
          } else {
            processed++;
            continue;
          }

          try {
            await db.insert(enrichmentRuns).values({
              provider: "serper",
              jobType: "email_lookup",
              status: "success",
              contactId,
              businessId: contact.businessId || null,
              startedAt: new Date(),
              completedAt: new Date(),
              outputPayload: updates,
            });
          } catch (_) {}

          processed++;
        } catch (err) {
          console.error(`[ContactEnrich] Error enriching contact ${contactId}:`, err);
          errors++;
        }

        await new Promise(r => setTimeout(r, 200));
      }

      await storage.setSystemSetting(progressKey, {
        status: "running",
        total: contactIds.length,
        processed,
        emailsFound,
        phonesFound,
        websitesFound,
        errors,
        completed: processed + errors,
        lastUpdate: new Date().toISOString(),
      });
    }

    await storage.setSystemSetting(progressKey, {
      status: "complete",
      total: contactIds.length,
      processed,
      emailsFound,
      phonesFound,
      websitesFound,
      errors,
      completed: processed + errors,
      completedAt: new Date().toISOString(),
    });

    await db.update(enrichmentRuns).set({
      status: errors > 0 ? "partial" : "success",
      completedAt: new Date(),
      outputPayload: { processed, errors, emailsFound, phonesFound, websitesFound },
      errorMessage: errors > 0 ? `${errors} contacts failed enrichment` : null,
    }).where(eq(enrichmentRuns.id, enrichRun.id));

    for (const cid of contactIds) {
      ingestBusinessFromContact(cid, "serper", `contact_enrich_batch`).catch(() => {});
    }
  } catch (fatalErr) {
    console.error("[ContactEnrich] Fatal error in batch enrichment:", fatalErr);
    await storage.setSystemSetting(progressKey, {
      status: "failed",
      total: contactIds.length,
      processed,
      emailsFound,
      phonesFound,
      websitesFound,
      errors,
      error: String(fatalErr),
      failedAt: new Date().toISOString(),
    }).catch(() => {});
  } finally {
    contactEnrichRunning = false;
  }

  return { processed, emailsFound, phonesFound, websitesFound, errors };
}
