import { db } from "../../db";
import { sdrLeadState, sdrMerchants, businesses, deals, contacts } from "@shared/schema";
import type { SdrLeadState } from "@shared/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";

export interface MerchantProfile {
  verticalDistribution: Record<string, number>;
  avgReviewCount: number;
  avgLocationCount: number;
  avgRating: number;
  topCities: Record<string, number>;
  topStates: Record<string, number>;
  websitePresenceRate: number;
  emailPresenceRate: number;
  phonePresenceRate: number;
  avgFitScore: number;
  avgRevenueScore: number;
  totalClosedWon: number;
}

export interface LookalikeScore {
  merchantId: number;
  leadStateId: number;
  similarityScore: number;
  matchFactors: Record<string, number>;
  boost: number;
}

let cachedProfile: MerchantProfile | null = null;
let profileCachedAt: number = 0;
const PROFILE_CACHE_TTL = 60 * 60 * 1000;

export async function buildClosedWonProfile(): Promise<MerchantProfile> {
  if (cachedProfile && Date.now() - profileCachedAt < PROFILE_CACHE_TTL) {
    return cachedProfile;
  }

  try {
    const wonDeals = await db.select({
      contactId: deals.contactId,
      stage: deals.stage,
    }).from(deals).where(eq(deals.stage, "Closed Won"));

    const wonContactIds = wonDeals.map(d => d.contactId).filter(Boolean) as number[];

    const wonLeads = await db.select().from(sdrLeadState).where(
      sql`${sdrLeadState.currentStage} IN ('CLOSED_WON', 'BOARDED')`
    );

    const allLeads = [...wonLeads];

    if (wonContactIds.length > 0) {
      const contactLeads = await db.select().from(sdrLeadState).where(
        sql`${sdrLeadState.contactId} IN (${sql.join(wonContactIds.map(id => sql`${id}`), sql`, `)})`
      );
      for (const cl of contactLeads) {
        if (!allLeads.find(l => l.id === cl.id)) {
          allLeads.push(cl);
        }
      }
    }

    const verticalDistribution: Record<string, number> = {};
    const cityDistribution: Record<string, number> = {};
    const stateDistribution: Record<string, number> = {};
    let totalReviews = 0;
    let totalLocations = 0;
    let totalRating = 0;
    let ratingCount = 0;
    let totalFitScore = 0;
    let totalRevenueScore = 0;
    let withWebsite = 0;
    let withEmail = 0;
    let withPhone = 0;

    for (const lead of allLeads) {
      if (lead.vertical) {
        verticalDistribution[lead.vertical] = (verticalDistribution[lead.vertical] || 0) + 1;
      }
      if (lead.city) {
        cityDistribution[lead.city] = (cityDistribution[lead.city] || 0) + 1;
      }
      if (lead.state) {
        stateDistribution[lead.state] = (stateDistribution[lead.state] || 0) + 1;
      }
      totalLocations += lead.locationCount || 1;
      totalFitScore += lead.fitScore || 0;
      totalRevenueScore += lead.revenueScore || 0;
      if (lead.website) withWebsite++;
      if (lead.email) withEmail++;
      if (lead.phone) withPhone++;

      if (lead.merchantId) {
        const merchant = await db.select().from(sdrMerchants).where(eq(sdrMerchants.id, lead.merchantId)).limit(1);
        if (merchant[0]?.businessId) {
          const biz = await db.select().from(businesses).where(eq(businesses.id, merchant[0].businessId)).limit(1);
          if (biz[0]) {
            totalReviews += biz[0].reviewCount || 0;
            if (biz[0].rating) {
              totalRating += biz[0].rating;
              ratingCount++;
            }
          }
        }
      }
    }

    const count = allLeads.length || 1;

    const profile: MerchantProfile = {
      verticalDistribution,
      avgReviewCount: Math.round(totalReviews / count),
      avgLocationCount: Math.round((totalLocations / count) * 10) / 10,
      avgRating: ratingCount > 0 ? Math.round((totalRating / ratingCount) * 10) / 10 : 0,
      topCities: Object.fromEntries(
        Object.entries(cityDistribution).sort((a, b) => b[1] - a[1]).slice(0, 10)
      ),
      topStates: Object.fromEntries(
        Object.entries(stateDistribution).sort((a, b) => b[1] - a[1]).slice(0, 5)
      ),
      websitePresenceRate: Math.round((withWebsite / count) * 100),
      emailPresenceRate: Math.round((withEmail / count) * 100),
      phonePresenceRate: Math.round((withPhone / count) * 100),
      avgFitScore: Math.round(totalFitScore / count),
      avgRevenueScore: Math.round(totalRevenueScore / count),
      totalClosedWon: allLeads.length,
    };

    cachedProfile = profile;
    profileCachedAt = Date.now();

    console.log(`[Lookalike] Built profile from ${allLeads.length} closed-won merchants`);
    return profile;
  } catch (err) {
    console.error("[Lookalike] Error building profile:", err);
    return {
      verticalDistribution: {},
      avgReviewCount: 0,
      avgLocationCount: 1,
      avgRating: 0,
      topCities: {},
      topStates: {},
      websitePresenceRate: 0,
      emailPresenceRate: 0,
      phonePresenceRate: 0,
      avgFitScore: 0,
      avgRevenueScore: 0,
      totalClosedWon: 0,
    };
  }
}

export function scoreSimilarity(lead: SdrLeadState, profile: MerchantProfile): LookalikeScore {
  const factors: Record<string, number> = {};
  let total = 0;

  if (profile.totalClosedWon === 0) {
    return {
      merchantId: lead.merchantId || 0,
      leadStateId: lead.id,
      similarityScore: 0,
      matchFactors: {},
      boost: 0,
    };
  }

  const totalVerticals = Object.values(profile.verticalDistribution).reduce((s, v) => s + v, 0) || 1;
  if (lead.vertical && profile.verticalDistribution[lead.vertical]) {
    const verticalPct = profile.verticalDistribution[lead.vertical] / totalVerticals;
    factors.vertical_match = Math.round(verticalPct * 30);
    total += factors.vertical_match;
  }

  if (lead.state && profile.topStates[lead.state]) {
    factors.state_match = 10;
    total += 10;
  }

  if (lead.city && profile.topCities[lead.city]) {
    factors.city_match = 5;
    total += 5;
  }

  if (lead.website) {
    factors.has_website = Math.round((profile.websitePresenceRate / 100) * 10);
    total += factors.has_website;
  }

  if (lead.email) {
    factors.has_email = Math.round((profile.emailPresenceRate / 100) * 10);
    total += factors.has_email;
  }

  if (lead.phone) {
    factors.has_phone = Math.round((profile.phonePresenceRate / 100) * 5);
    total += factors.has_phone;
  }

  if ((lead.locationCount || 1) >= profile.avgLocationCount) {
    factors.location_match = 5;
    total += 5;
  }

  if (lead.fitScore && profile.avgFitScore > 0) {
    const fitRatio = Math.min(lead.fitScore / profile.avgFitScore, 1.5);
    factors.fit_score_similarity = Math.round(fitRatio * 15);
    total += factors.fit_score_similarity;
  }

  if (lead.revenueScore && profile.avgRevenueScore > 0) {
    const revRatio = Math.min(lead.revenueScore / profile.avgRevenueScore, 1.5);
    factors.revenue_similarity = Math.round(revRatio * 10);
    total += factors.revenue_similarity;
  }

  const similarityScore = Math.min(total, 100);
  const boost = Math.round((similarityScore / 100) * 20);

  return {
    merchantId: lead.merchantId || 0,
    leadStateId: lead.id,
    similarityScore,
    matchFactors: factors,
    boost,
  };
}

export async function applyLookalikeBoosts(): Promise<{ processed: number; boosted: number }> {
  const profile = await buildClosedWonProfile();

  if (profile.totalClosedWon < 3) {
    console.log("[Lookalike] Not enough closed-won merchants to build model (need >= 3)");
    return { processed: 0, boosted: 0 };
  }

  const activeLeads = await db.select().from(sdrLeadState).where(
    sql`${sdrLeadState.currentStage} NOT IN ('CLOSED_WON', 'CLOSED_LOST', 'BOARDED', 'DNC')`
  );

  let boosted = 0;

  for (const lead of activeLeads) {
    const result = scoreSimilarity(lead, profile);

    if (result.boost > 0) {
      const currentPriority = lead.priorityScore || 0;
      const breakdown = typeof lead.scoreBreakdown === 'object' && lead.scoreBreakdown ? lead.scoreBreakdown as Record<string, any> : {};
      const previousBoost = breakdown.lookalikeBoost || 0;
      const basePriority = currentPriority - previousBoost;
      const newPriority = Math.min(basePriority + result.boost, 100);

      if (newPriority !== currentPriority || result.boost !== previousBoost) {
        await db.update(sdrLeadState).set({
          priorityScore: newPriority,
          scoreBreakdown: {
            ...breakdown,
            lookalikeBoost: result.boost,
            lookalikeScore: result.similarityScore,
            lookalikeFactors: result.matchFactors,
          },
          lastScoredAt: new Date(),
        }).where(eq(sdrLeadState.id, lead.id));

        boosted++;
      }
    }
  }

  console.log(`[Lookalike] Processed ${activeLeads.length} leads, boosted ${boosted}`);
  return { processed: activeLeads.length, boosted };
}

export async function getLookalikeProfile(): Promise<MerchantProfile> {
  return buildClosedWonProfile();
}

export async function getTopLookalikes(limit: number = 20): Promise<LookalikeScore[]> {
  const profile = await buildClosedWonProfile();

  if (profile.totalClosedWon < 3) {
    return [];
  }

  const activeLeads = await db.select().from(sdrLeadState).where(
    sql`${sdrLeadState.currentStage} NOT IN ('CLOSED_WON', 'CLOSED_LOST', 'BOARDED', 'DNC')`
  );

  const scored = activeLeads.map(lead => scoreSimilarity(lead, profile));
  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  return scored.slice(0, limit);
}
