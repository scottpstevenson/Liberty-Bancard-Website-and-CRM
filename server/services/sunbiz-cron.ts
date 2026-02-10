import { storage } from "../storage";
import { convertToProspect, processSunbizEnrichmentQueue } from "./sunbiz-enrichment";
import { estimateFromProspect, estimateFromContact, estimateFromDeal } from "./volume-estimator";
import type { SunbizEntity, Prospect, Contact, Deal } from "@shared/schema";

const BATCH_SIZE = 10;

export async function runSunbizAutoConvert(): Promise<{ converted: number; promoted: number; estimated: number }> {
  let converted = 0;
  let promoted = 0;
  let estimated = 0;

  try {
    converted = await autoConvertEnrichedEntities();
  } catch (err) {
    console.error("[Sunbiz Cron] Auto-convert error:", err);
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

  if (converted > 0 || promoted > 0 || estimated > 0) {
    console.log(`[Sunbiz Cron] Converted: ${converted}, Promoted: ${promoted}, Estimates updated: ${estimated}`);
  }

  return { converted, promoted, estimated };
}

async function autoConvertEnrichedEntities(): Promise<number> {
  const enriched = await storage.getSunbizEntitiesByStatus("enriched");

  const qualifiedEntities = enriched.filter(e =>
    !e.prospectId &&
    (e.score === "hot" || e.score === "warm") &&
    (e.email || e.phone || e.ownerEmail || e.ownerPhone)
  );

  let converted = 0;
  for (const entity of qualifiedEntities.slice(0, BATCH_SIZE)) {
    try {
      const existingProspects = await storage.getProspects();
      const alreadyExists = existingProspects.some(p =>
        (p.companyName && entity.entityName &&
          p.companyName.toLowerCase() === entity.entityName.toLowerCase()) ||
        (p.email && entity.email && p.email.toLowerCase() === entity.email.toLowerCase())
      );

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
  const prospects = await storage.getProspects();

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

  let promoted = 0;

  for (const prospect of qualified.slice(0, BATCH_SIZE)) {
    try {
      const contacts = await storage.getContacts();
      const email = prospect.ownerEmail || prospect.email || "";
      const phone = prospect.ownerPhone || prospect.phone || "";

      const alreadyExists = contacts.some(c =>
        (email && c.email.toLowerCase() === email.toLowerCase()) ||
        (prospect.companyName && c.companyName &&
          c.companyName.toLowerCase() === prospect.companyName.toLowerCase())
      );

      if (alreadyExists) {
        const existingContact = contacts.find(c =>
          (email && c.email.toLowerCase() === email.toLowerCase())
        );
        if (existingContact) {
          await storage.updateProspect(prospect.id, { contactId: existingContact.id, status: "converted" });
        }
        continue;
      }

      const firstName = prospect.ownerFirstName || prospect.companyName?.split(" ")[0] || "Owner";
      const lastName = prospect.ownerLastName || prospect.companyName?.split(" ").slice(1).join(" ") || "";

      const volumeEst = estimateFromProspect(prospect);

      const contact = await storage.createContact({
        firstName,
        lastName,
        email: email || `lead-${prospect.id}@placeholder.com`,
        phone: phone || "",
        companyName: prospect.companyName || undefined,
        vertical: prospect.vertical || undefined,
        monthlyVolume: prospect.estimatedVolume || undefined,
        estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
        estimatedResidual: volumeEst.estimatedResidual,
        volumeConfidence: volumeEst.volumeConfidence,
        status: "New",
        tags: ["sunbiz-auto", ...(prospect.tags || [])],
        notes: prospect.aiSummary || prospect.notes || undefined,
        consentEmail: true,
      });

      const deal = await storage.createDeal({
        contactId: contact.id,
        pipeline: "sales",
        stage: "New Lead",
        offerPath: "Cash Discount",
        leadSource: "sunbiz",
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
  const deals = await storage.getDeals();
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
          await storage.updateContact(contact.id, {
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
