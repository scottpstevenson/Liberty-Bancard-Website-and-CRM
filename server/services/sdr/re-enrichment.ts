import { db } from "../../db";
import { businesses, sdrLeadState, sdrMerchants, sdrLeadEvents } from "@shared/schema";
import type { Business, SdrLeadState } from "@shared/schema";
import { eq, sql, lte, and, isNotNull } from "drizzle-orm";
import { scoreLeadFull } from "./scoring";

const RE_ENRICHMENT_INTERVAL_DAYS = 60;
const RE_ENRICHMENT_BATCH_SIZE = 50;

let reEnrichInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export interface ReEnrichmentResult {
  businessId: number;
  businessName: string;
  changes: string[];
  scoreChanged: boolean;
  previousPriority: number;
  newPriority: number;
}

export interface ReEnrichmentSummary {
  totalChecked: number;
  totalUpdated: number;
  totalRequalified: number;
  results: ReEnrichmentResult[];
}

export function isReEnrichmentRunning(): boolean {
  return isRunning;
}

async function findStaleBusinesses(limit: number = RE_ENRICHMENT_BATCH_SIZE): Promise<Business[]> {
  const cutoffDate = new Date(Date.now() - RE_ENRICHMENT_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  const stale = await db.select().from(businesses).where(
    sql`(${businesses.lastEnrichedAt} IS NULL OR ${businesses.lastEnrichedAt} < ${cutoffDate})
        AND ${businesses.status} NOT IN ('suppressed', 'archived')`
  ).limit(limit);

  return stale;
}

async function reEnrichBusiness(business: Business): Promise<ReEnrichmentResult> {
  const changes: string[] = [];
  const result: ReEnrichmentResult = {
    businessId: business.id,
    businessName: business.canonicalName,
    changes: [],
    scoreChanged: false,
    previousPriority: 0,
    newPriority: 0,
  };

  try {
    const merchants = await db.select().from(sdrMerchants).where(eq(sdrMerchants.businessId, business.id));
    const merchant = merchants[0];

    if (!merchant) {
      await db.update(businesses).set({ lastEnrichedAt: new Date(), updatedAt: new Date() }).where(eq(businesses.id, business.id));
      return result;
    }

    const leads = await db.select().from(sdrLeadState).where(eq(sdrLeadState.merchantId, merchant.id));
    const lead = leads[0];

    if (!lead) {
      await db.update(businesses).set({ lastEnrichedAt: new Date(), updatedAt: new Date() }).where(eq(businesses.id, business.id));
      return result;
    }

    result.previousPriority = lead.priorityScore || 0;

    const updates: Record<string, any> = {};
    const businessUpdates: Record<string, any> = {};

    if (!lead.email && merchant.mainEmail) {
      updates.email = merchant.mainEmail;
      changes.push("new_email_from_merchant");
    }

    if (!lead.phone && merchant.mainPhone) {
      updates.phone = merchant.mainPhone;
      changes.push("new_phone_from_merchant");
    }

    if (!lead.website && merchant.website) {
      updates.website = merchant.website;
      changes.push("new_website_from_merchant");
    }

    if (business.reviewCount !== null && lead.enrichmentData) {
      const prevReviews = (lead.enrichmentData as any)?.reviewCount || 0;
      if (business.reviewCount > prevReviews + 5) {
        changes.push(`review_count_increased:${prevReviews}->${business.reviewCount}`);
        businessUpdates.reviewCount = business.reviewCount;
      }
    }

    if (business.locationCountEstimate && business.locationCountEstimate > (lead.locationCount || 1)) {
      updates.locationCount = business.locationCountEstimate;
      changes.push(`location_count_increased:${lead.locationCount || 1}->${business.locationCountEstimate}`);
    }

    if (Object.keys(updates).length > 0 || changes.length > 0) {
      const enrichmentData = {
        ...(typeof lead.enrichmentData === 'object' && lead.enrichmentData ? lead.enrichmentData : {}),
        lastReEnrichedAt: new Date().toISOString(),
        reEnrichmentChanges: changes,
        reviewCount: business.reviewCount,
      };

      await db.update(sdrLeadState).set({
        ...updates,
        enrichmentData,
        updatedAt: new Date(),
      }).where(eq(sdrLeadState.id, lead.id));

      try {
        const refreshedLeads = await db.select().from(sdrLeadState).where(eq(sdrLeadState.id, lead.id)).limit(1);
        const refreshedLead = refreshedLeads[0] || lead;
        const scoreResult = await scoreLeadFull(refreshedLead);
        const newPriority = scoreResult.priorityScore;

        await db.update(sdrLeadState).set({
          fitScore: scoreResult.fitScore,
          revenueScore: scoreResult.revenueScore,
          reachabilityScore: scoreResult.reachabilityScore,
          priorityScore: newPriority,
          priorityBucket: scoreResult.priorityBucket,
          lastScoredAt: new Date(),
        }).where(eq(sdrLeadState.id, lead.id));

        result.newPriority = newPriority;
        result.scoreChanged = newPriority !== result.previousPriority;

        if (result.scoreChanged && newPriority > result.previousPriority) {
          const previousStage = lead.currentStage;
          if (previousStage === 'NURTURE' && scoreResult.priorityBucket !== 'nurture') {
            await db.update(sdrLeadState).set({
              currentStage: 'QUALIFIED',
              stage: 'QUALIFIED',
              statusReason: 're-enrichment requalified',
            }).where(eq(sdrLeadState.id, lead.id));

            changes.push('requalified_from_nurture');
          }
        }
      } catch (scoreErr) {
        console.warn(`[ReEnrich] Score recalc failed for lead ${lead.id}:`, scoreErr);
        result.newPriority = result.previousPriority;
      }

      await db.insert(sdrLeadEvents).values({
        merchantId: merchant.id,
        leadStateId: lead.id,
        eventType: "re_enrichment",
        actionType: "system",
        actorType: "system",
        decisionReason: `Re-enrichment found changes: ${changes.join(', ')}`,
        payloadJson: { changes, previousPriority: result.previousPriority, newPriority: result.newPriority },
      });
    } else {
      result.newPriority = result.previousPriority;
    }

    await db.update(businesses).set({
      lastEnrichedAt: new Date(),
      updatedAt: new Date(),
      ...businessUpdates,
    }).where(eq(businesses.id, business.id));

    result.changes = changes;
    return result;
  } catch (err) {
    console.error(`[ReEnrich] Error processing business ${business.id}:`, err);
    result.changes = [`error: ${err instanceof Error ? err.message : String(err)}`];
    return result;
  }
}

export async function runReEnrichmentCycle(): Promise<ReEnrichmentSummary> {
  const { acquireJobLock, releaseJobLock, startJobLockHeartbeat } = await import("../job-registry");
  const lease = await acquireJobLock("sdr-re-enrichment");
  if (lease.status !== "acquired") {
    console.warn(`[ReEnrich] Lease ${lease.status}; refusing cross-replica run`);
    return { totalChecked: 0, totalUpdated: 0, totalRequalified: 0, results: [] };
  }
  const heartbeat = startJobLockHeartbeat("sdr-re-enrichment", lease.lockToken);
  if (isRunning) {
    console.log("[ReEnrich] Already running, skipping");
    heartbeat.stop();
    await releaseJobLock("sdr-re-enrichment", true, undefined, lease.lockToken);
    return { totalChecked: 0, totalUpdated: 0, totalRequalified: 0, results: [] };
  }

  isRunning = true;
  console.log("[ReEnrich] Starting re-enrichment cycle...");

  try {
    const staleBusinesses = await findStaleBusinesses();
    const results: ReEnrichmentResult[] = [];
    let totalUpdated = 0;
    let totalRequalified = 0;

    for (const business of staleBusinesses) {
      heartbeat.assertOwned();
      const result = await reEnrichBusiness(business);
      results.push(result);

      if (result.changes.length > 0) {
        totalUpdated++;
      }
      if (result.changes.includes('requalified_from_nurture')) {
        totalRequalified++;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const summary: ReEnrichmentSummary = {
      totalChecked: staleBusinesses.length,
      totalUpdated,
      totalRequalified,
      results,
    };

    console.log(`[ReEnrich] Cycle complete: checked=${staleBusinesses.length}, updated=${totalUpdated}, requalified=${totalRequalified}`);
    return summary;
  } finally {
    isRunning = false;
    heartbeat.stop();
    await releaseJobLock("sdr-re-enrichment", true, undefined, lease.lockToken);
  }
}

export function startReEnrichmentWorker(): void {
  if (reEnrichInterval) {
    console.log("[ReEnrich Worker] Already running");
    return;
  }

  console.log("[ReEnrich Worker] Started - runs weekly (every 7 days)");
  reEnrichInterval = setInterval(async () => {
    try {
      await runReEnrichmentCycle();
    } catch (err) {
      console.error("[ReEnrich Worker] Error:", err);
    }
  }, 7 * 24 * 60 * 60 * 1000);

  setTimeout(() => {
    runReEnrichmentCycle().catch(err => console.error("[ReEnrich Worker] Initial run error:", err));
  }, 5 * 60 * 1000);
}

export function stopReEnrichmentWorker(): void {
  if (reEnrichInterval) {
    clearInterval(reEnrichInterval);
    reEnrichInterval = null;
    console.log("[ReEnrich Worker] Stopped");
  }
}

export async function getReEnrichmentStats(): Promise<{
  staleCount: number;
  lastRunAt: string | null;
  nextRunEstimate: string;
}> {
  const cutoffDate = new Date(Date.now() - RE_ENRICHMENT_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  const staleResult = await db.select({ count: sql<number>`count(*)` }).from(businesses).where(
    sql`(${businesses.lastEnrichedAt} IS NULL OR ${businesses.lastEnrichedAt} < ${cutoffDate})
        AND ${businesses.status} NOT IN ('suppressed', 'archived')`
  );

  const lastEvent = await db.select({
    eventAt: sdrLeadEvents.eventAt,
  }).from(sdrLeadEvents).where(eq(sdrLeadEvents.eventType, "re_enrichment")).orderBy(sql`${sdrLeadEvents.eventAt} DESC`).limit(1);

  return {
    staleCount: staleResult[0]?.count || 0,
    lastRunAt: lastEvent[0]?.eventAt?.toISOString() || null,
    nextRunEstimate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}
