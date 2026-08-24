import { storage } from "../storage";
import { convertToProspect, processSunbizEnrichmentQueue } from "./sunbiz-enrichment";
import { createContactLocalFirst, updateContactLocalFirst } from "./contact-writer";
import { estimateFromProspect, estimateFromContact, estimateFromDeal } from "./volume-estimator";
import { toProperCase } from "./sunbiz-scraper";
import type { SunbizEntity, Prospect, Contact, Deal } from "@shared/schema";

const BATCH_SIZE = 10;

export async function runSunbizAutoConvert(): Promise<{ converted: number; promoted: number; estimated: number; qualified: number; retried: number }> {
  let converted = 0;
  let promoted = 0;
  let estimated = 0;
  let qualified = 0;
  let retried = 0;

  try {
    converted = await autoConvertEnrichedEntities();
  } catch (err) {
    console.error("[Sunbiz Cron] Auto-convert error:", err);
  }

  try {
    qualified = await autoQualifyProspects();
  } catch (err) {
    console.error("[Sunbiz Cron] Auto-qualify error:", err);
  }

  try {
    promoted = await autoPromoteProspects();
  } catch (err) {
    console.error("[Sunbiz Cron] Auto-promote error:", err);
  }

  try {
    estimated = await updateVolumeEstimates();
  } catch (err) {
    console.error("[Sunbiz Cron] Volume estimate error:", err);
  }

  try {
    retried = await retryFailedEnrichments();
  } catch (err) {
    console.error("[Sunbiz Cron] Retry enrichment error:", err);
  }

  if (converted > 0 || promoted > 0 || estimated > 0 || qualified > 0 || retried > 0) {
    console.log(`[Sunbiz Cron] Converted: ${converted}, Qualified: ${qualified}, Promoted: ${promoted}, Estimates: ${estimated}, Retried: ${retried}`);
  }

  return { converted, promoted, estimated, qualified, retried };
}

async function autoConvertEnrichedEntities(): Promise<number> {
  // Fetch only BATCH_SIZE * 10 enriched records — getSunbizEntitiesByStatus without a
  // limit previously returned ALL enriched rows (potentially thousands), which combined
  // with the N+1 getProspects call inside the loop was the root cause of the
  // statement_timeout seen in production logs (2026-07-21).
  const enriched = await storage.getSunbizEntitiesByStatus("enriched", BATCH_SIZE * 10);

  const qualifiedEntities = enriched.filter(e =>
    !e.prospectId &&
    (e.score === "hot" || e.score === "warm") &&
    (e.email || e.phone || e.ownerEmail || e.ownerPhone)
  );

  if (qualifiedEntities.length === 0) return 0;

  // Load the dedup sets ONCE, before the loop.
  // Previously this query ran inside each iteration — for 10 entities that was
  // 10 × getProspects(limit:500) = 10 sequential full-table scans.
  const { data: existingProspects } = await storage.getProspects(undefined, { limit: 10_000 });
  const existingEmails = new Set(
    existingProspects.map(p => p.email?.trim().toLowerCase()).filter(Boolean) as string[]
  );
  const existingNames = new Set(
    existingProspects.map(p => p.companyName?.trim().toLowerCase()).filter(Boolean) as string[]
  );

  let converted = 0;
  for (const entity of qualifiedEntities.slice(0, BATCH_SIZE)) {
    try {
      const emailKey = entity.email?.trim().toLowerCase();
      const nameKey = entity.entityName?.trim().toLowerCase();
      const alreadyExists =
        (emailKey && existingEmails.has(emailKey)) ||
        (nameKey && existingNames.has(nameKey));

      if (alreadyExists) {
        await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "duplicate" });
        continue;
      }

      const prospectId = await convertToProspect(entity.id);
      if (prospectId) {
        const prospect = await storage.getProspect(prospectId);
        if (prospect) {
          const estimate = estimateFromProspect(prospect);
          await storage.updateProspect(prospectId, {
            estimatedResidual: estimate.estimatedResidual,
            estimatedAvgTicket: estimate.estimatedAvgTicket,
          });
        }
        converted++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Convert entity ${entity.id} failed:`, err);
    }
  }

  return converted;
}

async function autoPromoteProspects(): Promise<number> {
  const { data: prospects } = await storage.getProspects(undefined, { limit: 500 });

  const qualified = prospects.filter(p =>
    !p.contactId &&
    p.status !== "disqualified" &&
    p.status !== "do_not_contact" &&
    !p.doNotContact &&
    (p.score === "hot" || (p.score === "warm" && (p.qualificationScore === "A" || p.qualificationScore === "B"))) &&
    (p.email || p.ownerEmail) &&
    (p.phone || p.ownerPhone) &&
    p.companyName
  );

  if (qualified.length === 0) return 0;

  // Load companies ONCE before the loop — previously storage.getCompanies() was called
  // per prospect inside the loop, performing an unbounded full-table scan each iteration.
  const allCompanies = await storage.getCompanies();
  const companyByName = new Map(allCompanies.map(c => [c.legalName.toLowerCase(), c]));
  const companyByWebsite = new Map(
    allCompanies.filter(c => c.website).map(c => [c.website!.toLowerCase(), c])
  );

  let promoted = 0;

  for (const prospect of qualified.slice(0, BATCH_SIZE)) {
    try {
      const email = prospect.ownerEmail || prospect.email || "";
      const phone = prospect.ownerPhone || prospect.phone || "";

      // Indexed lookups instead of loading up to 500 contacts into memory —
      // that cap silently stopped catching duplicates once the contacts table
      // grew past it, risking duplicate cold outreach to the same person.
      const existingByEmail = email ? await storage.getContactByEmail(email) : undefined;
      const existingByCompany = !existingByEmail && prospect.companyName
        ? await storage.getContactByCompanyName(prospect.companyName)
        : undefined;
      const existingContact = existingByEmail || existingByCompany;

      if (existingContact) {
        await storage.updateProspect(prospect.id, { contactId: existingContact.id, status: "converted" });
        continue;
      }

      const firstName = toProperCase(prospect.ownerFirstName || prospect.companyName?.split(" ")[0]) || "Owner";
      const lastName = toProperCase(prospect.ownerLastName || prospect.companyName?.split(" ").slice(1).join(" ")) || "";

      const volumeEst = estimateFromProspect(prospect);

      let companyId: number | undefined;
      if (prospect.companyName) {
        const nameKey = prospect.companyName.toLowerCase();
        const siteKey = prospect.website?.toLowerCase();
        const existingCompany = companyByName.get(nameKey) ||
          (siteKey ? companyByWebsite.get(siteKey) : undefined);
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const company = await storage.createCompany({
            legalName: prospect.companyName,
            dba: prospect.dba || undefined,
            vertical: prospect.vertical || undefined,
            address: [prospect.address, prospect.city, prospect.state, prospect.zip].filter(Boolean).join(", ") || undefined,
            website: prospect.website || undefined,
            volumeRange: prospect.estimatedVolume || undefined,
            notes: prospect.aiSummary || undefined,
          });
          companyId = company.id;
        }
      }

      const contact = await createContactLocalFirst({
        firstName,
        lastName,
        email: email || "",
        phone: phone || "",
        companyName: toProperCase(prospect.companyName) || undefined,
        vertical: prospect.vertical || undefined,
        monthlyVolume: prospect.estimatedVolume || undefined,
        avgTicket: prospect.estimatedAvgTicket || undefined,
        estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
        estimatedResidual: volumeEst.estimatedResidual,
        volumeConfidence: volumeEst.volumeConfidence,
        status: "New",
        tags: ["sunbiz-auto", ...(prospect.tags || [])],
        notes: prospect.aiSummary || prospect.notes || undefined,
        leadScore: prospect.score === "hot" ? 80 : prospect.score === "warm" ? 60 : 40,
      });

      const priorityScore = prospect.score === "hot" ? 90
        : prospect.score === "warm" && (prospect.qualificationScore === "A" || prospect.qualificationScore === "B") ? 75
        : 50;

      const deal = await storage.createDeal({
        contactId: contact.id,
        companyId: companyId || undefined,
        pipeline: "sales",
        stage: "New Lead",
        offerPath: "Cash Discount",
        leadSource: "sunbiz",
        priorityScore,
        estimatedGrossProfitBps: volumeEst.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: volumeEst.estimatedGrossProfitMonthly,
        estimatedNetProfitMonthly: volumeEst.estimatedNetProfitMonthly,
        merchantTier: volumeEst.merchantTier,
        notes: `Auto-promoted from Sunbiz prospect. ${prospect.aiPitchAngle || ""}`.trim(),
      });

      await storage.updateProspect(prospect.id, {
        contactId: contact.id,
        status: "converted",
      });

      await storage.createAuditLog({
        action: "prospect_auto_promoted",
        entityType: "prospect",
        entityId: prospect.id,
        details: {
          contactId: contact.id,
          dealId: deal.id,
          score: prospect.score,
          qualificationScore: prospect.qualificationScore,
          estimatedResidual: volumeEst.estimatedResidual,
          estimatedVolume: volumeEst.estimatedProcessingVolume,
          merchantTier: volumeEst.merchantTier,
        },
      });

      promoted++;
    } catch (err) {
      console.error(`[Sunbiz Cron] Promote prospect ${prospect.id} failed:`, err);
    }
  }

  return promoted;
}

async function updateVolumeEstimates(): Promise<number> {
  const { data: deals } = await storage.getDeals({ limit: 500 });
  let updated = 0;

  const activeSalesDeals = deals.filter(d =>
    d.pipeline === "sales" &&
    d.stage !== "Closed Won" &&
    d.stage !== "Closed Lost"
  );

  for (const deal of activeSalesDeals.slice(0, 20)) {
    try {
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const estimate = estimateFromDeal(deal, contact);

      const needsUpdate =
        deal.estimatedGrossProfitBps !== estimate.estimatedGrossProfitBps ||
        deal.estimatedGrossProfitMonthly !== estimate.estimatedGrossProfitMonthly ||
        deal.merchantTier !== estimate.merchantTier;

      if (needsUpdate) {
        await storage.updateDeal(deal.id, {
          estimatedGrossProfitBps: estimate.estimatedGrossProfitBps,
          estimatedGrossProfitMonthly: estimate.estimatedGrossProfitMonthly,
          estimatedNetProfitMonthly: estimate.estimatedNetProfitMonthly,
          merchantTier: estimate.merchantTier,
        });

        if (contact) {
          await updateContactLocalFirst(contact.id, {
            estimatedProcessingVolume: estimate.estimatedProcessingVolume,
            estimatedResidual: estimate.estimatedResidual,
            volumeConfidence: estimate.volumeConfidence,
          });
        }

        updated++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Volume estimate for deal ${deal.id} failed:`, err);
    }
  }

  return updated;
}

async function autoQualifyProspects(): Promise<number> {
  const gradeRank: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const { data: prospects } = await storage.getProspects(undefined, { limit: 500 });
  let qualified = 0;

  const eligible = prospects.filter(p =>
    p.status !== "converted" &&
    p.status !== "disqualified" &&
    p.status !== "do_not_contact" &&
    !p.doNotContact &&
    (p.status === "enriched" || p.status === "qualified" || p.status === "raw")
  );

  for (const prospect of eligible.slice(0, BATCH_SIZE * 2)) {
    try {
      let points = 0;
      if (prospect.email || prospect.ownerEmail) points += 20;
      if (prospect.phone || prospect.ownerPhone) points += 15;
      if (prospect.website) points += 15;
      if (prospect.vertical) points += 10;
      if (prospect.address && prospect.city) points += 10;
      if (prospect.status === "enriched" || prospect.status === "qualified") points += 15;
      if (prospect.score === "hot") points += 15;
      else if (prospect.score === "warm") points += 10;
      else if (prospect.score === "cold") points += 5;

      let grade: string;
      if (points >= 80) grade = "A";
      else if (points >= 60) grade = "B";
      else if (points >= 40) grade = "C";
      else if (points >= 20) grade = "D";
      else grade = "F";

      const currentRank = gradeRank[prospect.qualificationScore || "F"] || 0;
      const newRank = gradeRank[grade] || 0;

      if (newRank > currentRank) {
        const updates: Record<string, any> = { qualificationScore: grade };
        if ((grade === "A" || grade === "B") && prospect.status === "enriched") {
          updates.status = "qualified";
        }
        await storage.updateProspect(prospect.id, updates);
        qualified++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Qualify prospect ${prospect.id} failed:`, err);
    }
  }

  return qualified;
}

const retriedEntityIds = new Set<number>();

async function retryFailedEnrichments(): Promise<number> {
  const failed = await storage.getSunbizEntitiesByStatus("failed");
  let retried = 0;

  const retryable = failed.filter(e =>
    !retriedEntityIds.has(e.id) &&
    (e.email || e.phone || e.ownerEmail || e.ownerPhone || e.website) &&
    e.entityName
  );

  for (const entity of retryable.slice(0, 3)) {
    try {
      retriedEntityIds.add(entity.id);
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "pending" });
      retried++;
    } catch (err) {
      console.error(`[Sunbiz Cron] Retry entity ${entity.id} failed:`, err);
    }
  }

  return retried;
}
