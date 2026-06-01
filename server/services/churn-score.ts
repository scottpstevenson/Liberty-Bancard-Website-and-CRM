import { storage } from "../storage";
import { db } from "../db";
import {
  tickets, npsResponses, sequenceEnrollments, midDailyStats, contacts, deals, merchantProfiles,
  agents, agentMerchants,
  type MerchantHealthScore,
} from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { createPreferenceAwareNotification } from "./digest-service";

export type ChurnSignalBreakdown = {
  volumeTrend: number;
  chargebackTrend: number;
  ticketVelocity: number;
  nps: number;
  portalActivity: number;
  outreachResponse: number;
};

export type ChurnScoreResult = {
  contactId: number;
  churnScore: number;
  riskTier: "Low" | "Medium" | "High" | "Critical";
  breakdown: ChurnSignalBreakdown;
  signals: string[];
};

export function classifyTier(score: number): "Low" | "Medium" | "High" | "Critical" {
  if (score > 85) return "Critical";
  if (score > 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

async function getWeightsMap(): Promise<Record<string, number>> {
  try {
    const weights = await storage.getChurnScoreWeights();
    const map: Record<string, number> = {};
    for (const w of weights) {
      map[w.signalKey] = w.weight;
    }
    return map;
  } catch {
    return {
      volume_trend: 1.5,
      chargeback_trend: 1.5,
      ticket_velocity: 1.0,
      nps_score: 1.0,
      portal_activity: 0.75,
      outreach_response: 0.75,
    };
  }
}

export async function computeChurnScore(contactId: number): Promise<ChurnScoreResult> {
  const weights = await getWeightsMap();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const breakdown: ChurnSignalBreakdown = {
    volumeTrend: 0,
    chargebackTrend: 0,
    ticketVelocity: 0,
    nps: 0,
    portalActivity: 0,
    outreachResponse: 0,
  };
  const signals: string[] = [];

  // --- Signal 1: Volume trend (declining = higher risk) ---
  try {
    const dealsForContact = await storage.getDealsByContact(contactId);
    const activeDeal = dealsForContact.find(d => d.mid);
    const mid = activeDeal?.mid || null;
    if (mid) {
      const recentStats = await db
        .select()
        .from(midDailyStats)
        .where(and(eq(midDailyStats.mid, mid), gte(midDailyStats.date, thirtyDaysAgo.toISOString().split("T")[0])));
      const prevStats = await db
        .select()
        .from(midDailyStats)
        .where(and(
          eq(midDailyStats.mid, mid),
          gte(midDailyStats.date, sixtyDaysAgo.toISOString().split("T")[0]),
        ));
      const prevOnly = prevStats.filter(s => s.date < thirtyDaysAgo.toISOString().split("T")[0]);
      const recentVol = recentStats.reduce((s, r) => s + (Number(r.volume) || 0), 0);
      const prevVol = prevOnly.reduce((s, r) => s + (Number(r.volume) || 0), 0);

      if (prevVol > 0 && recentVol < prevVol) {
        const declinePct = ((prevVol - recentVol) / prevVol) * 100;
        if (declinePct >= 50) {
          breakdown.volumeTrend = 30;
          signals.push("Volume declined >50% vs prior month");
        } else if (declinePct >= 25) {
          breakdown.volumeTrend = 20;
          signals.push("Volume declined 25-50% vs prior month");
        } else if (declinePct >= 10) {
          breakdown.volumeTrend = 10;
          signals.push("Volume declined 10-25% vs prior month");
        }
      }
    }
  } catch {}

  // --- Signal 2: Chargeback ratio trend (rising = higher risk) ---
  try {
    const dealsForContact = await storage.getDealsByContact(contactId);
    const activeDeal = dealsForContact.find(d => d.mid);
    const mid = activeDeal?.mid || null;
    if (mid) {
      const recent = await db
        .select()
        .from(midDailyStats)
        .where(and(eq(midDailyStats.mid, mid), gte(midDailyStats.date, thirtyDaysAgo.toISOString().split("T")[0])));
      const prev = await db
        .select()
        .from(midDailyStats)
        .where(and(eq(midDailyStats.mid, mid), gte(midDailyStats.date, sixtyDaysAgo.toISOString().split("T")[0])));
      const prevOnly = prev.filter(s => s.date < thirtyDaysAgo.toISOString().split("T")[0]);
      const recentCb = recent.reduce((s, r) => s + (r.chargebackCount || 0), 0);
      const recentTx = recent.reduce((s, r) => s + (r.txCount || 0), 0);
      const prevCb = prevOnly.reduce((s, r) => s + (r.chargebackCount || 0), 0);
      const prevTx = prevOnly.reduce((s, r) => s + (r.txCount || 0), 0);
      const recentRatio = recentTx > 0 ? recentCb / recentTx : 0;
      const prevRatio = prevTx > 0 ? prevCb / prevTx : 0;
      if (recentRatio > 0.01) {
        breakdown.chargebackTrend = 25;
        signals.push("Chargeback ratio >1% (critical threshold)");
      } else if (recentRatio > 0.005) {
        breakdown.chargebackTrend = 15;
        signals.push("Chargeback ratio >0.5% (warning threshold)");
      } else if (prevRatio > 0 && recentRatio > prevRatio * 1.5) {
        breakdown.chargebackTrend = 10;
        signals.push("Chargeback ratio rising vs prior month");
      }
    }
  } catch {}

  // --- Signal 3: Support ticket velocity (rising = higher risk) ---
  try {
    const recentTickets = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.contactId, contactId), gte(tickets.createdAt, thirtyDaysAgo)));
    const prevTickets = await db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.contactId, contactId), gte(tickets.createdAt, sixtyDaysAgo)));
    const recentCount = recentTickets.length;
    const prevCount = prevTickets.filter(t => !recentTickets.find(r => r.id === t.id)).length;
    if (recentCount >= 4) {
      breakdown.ticketVelocity = 20;
      signals.push(`High ticket volume: ${recentCount} tickets in 30 days`);
    } else if (recentCount >= 2 && recentCount > prevCount) {
      breakdown.ticketVelocity = 12;
      signals.push("Ticket velocity increasing vs prior month");
    } else if (recentCount >= 2) {
      breakdown.ticketVelocity = 6;
      signals.push(`${recentCount} tickets in last 30 days`);
    }
  } catch {}

  // --- Signal 4: NPS score (low = higher risk) ---
  try {
    const npsRows = await db
      .select()
      .from(npsResponses)
      .where(eq(npsResponses.contactId, contactId))
      .orderBy(desc(npsResponses.submittedAt))
      .limit(1);
    if (npsRows.length > 0 && npsRows[0].score !== null) {
      const score = npsRows[0].score!;
      if (score <= 3) {
        breakdown.nps = 25;
        signals.push(`Critical NPS: ${score}/10`);
      } else if (score <= 6) {
        breakdown.nps = 15;
        signals.push(`Low NPS: ${score}/10 (detractor)`);
      } else if (score <= 7) {
        breakdown.nps = 5;
        signals.push(`Passive NPS: ${score}/10`);
      }
    }
  } catch {}

  // --- Signal 5: Portal activity (days since last profile activity via updatedAt) ---
  // merchantProfiles.updatedAt is bumped on any merchant portal interaction
  // (statement uploads, profile updates, document submissions).
  // A long gap indicates low engagement and elevated churn risk.
  try {
    const profile = await db
      .select({ updatedAt: merchantProfiles.updatedAt, createdAt: merchantProfiles.createdAt })
      .from(merchantProfiles)
      .where(eq(merchantProfiles.contactId, contactId))
      .limit(1);
    if (profile.length === 0) {
      // No merchant profile → never activated the portal
      breakdown.portalActivity = 15;
      signals.push("No merchant portal profile found");
    } else {
      const lastActivity = profile[0].updatedAt || profile[0].createdAt;
      if (!lastActivity) {
        breakdown.portalActivity = 10;
        signals.push("No portal activity timestamp available");
      } else {
        const daysSince = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince >= 90) {
          breakdown.portalActivity = 20;
          signals.push(`${daysSince} days since last portal activity`);
        } else if (daysSince >= 45) {
          breakdown.portalActivity = 12;
          signals.push(`${daysSince} days since last portal activity`);
        } else if (daysSince >= 21) {
          breakdown.portalActivity = 5;
          signals.push(`${daysSince} days since last portal activity`);
        }
      }
    }
  } catch {}

  // --- Signal 6: Outreach response rate (no response = higher risk) ---
  try {
    const enrollments = await db
      .select()
      .from(sequenceEnrollments)
      .where(and(eq(sequenceEnrollments.contactId, contactId), gte(sequenceEnrollments.startedAt, ninetyDaysAgo)));
    if (enrollments.length > 0) {
      const noResponse = enrollments.filter(e => e.status === "active" || e.status === "completed").length;
      const replied = enrollments.filter(e => e.status === "replied").length;
      if (replied === 0 && noResponse >= 3) {
        breakdown.outreachResponse = 15;
        signals.push("No response to outreach in 90 days");
      } else if (replied === 0 && noResponse >= 2) {
        breakdown.outreachResponse = 8;
        signals.push("No response to last 2+ outreach attempts");
      }
    }
  } catch {}

  // --- Compute weighted score (dynamic — uses configured weights for both numerator and denominator) ---
  const w_vol  = weights.volume_trend   || 1.5;
  const w_cb   = weights.chargeback_trend || 1.5;
  const w_tick = weights.ticket_velocity || 1.0;
  const w_nps  = weights.nps_score      || 1.0;
  const w_port = weights.portal_activity || 0.75;
  const w_out  = weights.outreach_response || 0.75;

  const rawScore =
    breakdown.volumeTrend      * w_vol  +
    breakdown.chargebackTrend  * w_cb   +
    breakdown.ticketVelocity   * w_tick +
    breakdown.nps              * w_nps  +
    breakdown.portalActivity   * w_port +
    breakdown.outreachResponse * w_out;

  // Denominator mirrors the numerator structure — max component value × actual weight
  const maxPossibleRaw = 30 * w_vol + 25 * w_cb + 20 * w_tick + 25 * w_nps + 20 * w_port + 15 * w_out;
  const churnScore = maxPossibleRaw > 0 ? Math.min(100, Math.round((rawScore / maxPossibleRaw) * 100)) : 0;
  const riskTier = classifyTier(churnScore);

  return {
    contactId,
    churnScore,
    riskTier,
    breakdown,
    signals,
  };
}

/**
 * Resolve the assigned agent's userId for a contact.
 * Looks up deals → agentMerchants → agents → userId (string user ID).
 */
async function resolveAssignedAgentUserId(contactId: number): Promise<string | null> {
  try {
    const dealsForContact = await storage.getDealsByContact(contactId);
    for (const deal of dealsForContact) {
      const agentAssignments = await storage.getAgentMerchantsByDeal(deal.id);
      if (agentAssignments.length === 0) continue;
      const agentRecord = await storage.getAgent(agentAssignments[0].agentId);
      if (agentRecord?.userId) return agentRecord.userId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function computeAndPersistChurnScore(contactId: number): Promise<MerchantHealthScore> {
  const result = await computeChurnScore(contactId);

  const existing = await storage.getMerchantHealthScoreByContact(contactId);
  const overrideScore = existing?.overrideScore ?? null;
  const finalScore = overrideScore !== null ? overrideScore : result.churnScore;
  const finalTier = classifyTier(finalScore);

  const score = await storage.upsertMerchantHealthScore({
    contactId,
    churnScore: result.churnScore,
    riskTier: finalTier,
    volumeTrendScore: result.breakdown.volumeTrend,
    chargebackTrendScore: result.breakdown.chargebackTrend,
    ticketVelocityScore: result.breakdown.ticketVelocity,
    npsScore: result.breakdown.nps,
    portalActivityScore: result.breakdown.portalActivity,
    outreachResponseScore: result.breakdown.outreachResponse,
    overrideScore: existing?.overrideScore ?? null,
    overrideNote: existing?.overrideNote ?? null,
    overriddenAt: existing?.overriddenAt ?? null,
    overriddenBy: existing?.overriddenBy ?? null,
    retentionCampaignTriggered: existing?.retentionCampaignTriggered ?? false,
    agentNotified: existing?.agentNotified ?? false,
  });

  // Propagate risk tier to the contact record
  try {
    await storage.updateContact(contactId, { churnRiskTier: finalTier });
  } catch {}

  return score;
}

export async function runNightlyChurnScoring(): Promise<{ processed: number; highRisk: number; critical: number; errors: number }> {
  let processed = 0;
  let highRisk = 0;
  let critical = 0;
  let errors = 0;

  try {
    // Paginate to ensure all merchants are processed regardless of total count
    const pageSize = 200;
    let offset = 0;
    const seenContactIds = new Set<number>();

    while (true) {
      const { data: pageDeal, total } = await storage.getDeals({ limit: pageSize, offset });
      if (pageDeal.length === 0) break;

      for (const deal of pageDeal) {
        if (!deal.contactId) continue;
        if (seenContactIds.has(deal.contactId)) continue;
        // Only score active merchant deals (onboarding pipeline or Closed Won)
        if (deal.pipeline !== "onboarding" && deal.stage !== "Closed Won") continue;
        seenContactIds.add(deal.contactId);
      }

      offset += pageSize;
      if (offset >= total) break;
    }

    const uniqueContactIds = [...seenContactIds];

    for (const contactId of uniqueContactIds) {
      try {
        const score = await computeAndPersistChurnScore(contactId);
        processed++;

        const effectiveScore = score.overrideScore !== null ? score.overrideScore : score.churnScore;
        const tier = classifyTier(effectiveScore);

        if (tier === "Critical") critical++;
        if (tier === "High") highRisk++;

        // Trigger retention via health alert engine (High/Critical, not already triggered)
        if ((tier === "High" || tier === "Critical") && !score.retentionCampaignTriggered) {
          await triggerRetentionForChurnRisk(contactId, score.id, tier);
        }

        // Notify assigned agent for High/Critical (if not already notified)
        if ((tier === "High" || tier === "Critical") && !score.agentNotified) {
          await notifyAgentForChurnRisk(contactId, tier, score.id);
        }
      } catch (err) {
        console.error(`[ChurnScore] Failed for contact ${contactId}:`, err);
        errors++;
      }
    }

    console.log(`[ChurnScore] Nightly run: ${processed} merchants scored, ${highRisk} high risk, ${critical} critical, ${errors} errors`);
  } catch (err) {
    console.error("[ChurnScore] Nightly run error:", err);
  }

  return { processed, highRisk, critical, errors };
}

/**
 * Wire into the existing retention campaign engine:
 * Creates a health alert for the merchant so checkRetentionCampaigns()
 * picks it up and generates the configured retention task/outreach.
 */
async function triggerRetentionForChurnRisk(contactId: number, scoreId: number, tier: string): Promise<void> {
  try {
    const contact = await storage.getContact(contactId);
    if (!contact) return;

    const name = contact.companyName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || `Contact #${contactId}`;

    // Map tier to an alert type that retention campaign configs are keyed on
    const alertType = tier === "Critical" ? "volume_decline" : "chargeback_spike";
    const severity = tier === "Critical" ? "critical" : "warning";

    // Check if an active churn-risk health alert already exists for this contact
    const existingAlerts = await storage.getActiveHealthAlerts();
    const alreadyAlerted = existingAlerts.some(
      a => a.contactId === contactId && a.alertType === alertType && a.status === "active"
    );
    if (alreadyAlerted) {
      await storage.updateMerchantHealthScore(scoreId, { retentionCampaignTriggered: true });
      return;
    }

    // Create the health alert — checkRetentionCampaigns() will process it on next cycle
    await storage.createHealthAlert({
      contactId,
      alertType,
      severity,
      title: `[Churn Risk - ${tier}] ${name}`,
      description: `AI churn model flagged ${name} as ${tier} risk. Retention action required.`,
      metric: "churn_score",
      currentValue: tier,
      status: "active",
    });

    await storage.updateMerchantHealthScore(scoreId, { retentionCampaignTriggered: true });
    console.log(`[ChurnScore] Health alert created for contact ${contactId} (${tier} churn risk)`);
  } catch (err) {
    console.error(`[ChurnScore] Retention trigger error for contact ${contactId}:`, err);
  }
}

/**
 * Notify the assigned agent for this merchant.
 * Resolves the agent via agentMerchants → agents → userId and sets recipientId
 * so the notification is targeted and respects that agent's notification preferences.
 */
async function notifyAgentForChurnRisk(contactId: number, tier: string, scoreId: number): Promise<void> {
  try {
    const contact = await storage.getContact(contactId);
    if (!contact) return;

    const name = contact.companyName || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || `Contact #${contactId}`;

    // Resolve assigned agent userId
    const agentUserId = await resolveAssignedAgentUserId(contactId);

    await createPreferenceAwareNotification({
      channel: "internal",
      title: `${tier} Churn Risk: ${name}`,
      message: `${name} has been flagged as ${tier} churn risk by the AI scoring model. Immediate retention action required.`,
      type: tier === "Critical" ? "urgent" : "warning",
      ...(agentUserId ? { recipientId: agentUserId } : {}),
      metadata: { contactId, tier, eventType: "churn_risk_alert" } as any,
    }, "churn_risk_alert");

    await storage.updateMerchantHealthScore(scoreId, { agentNotified: true });
    console.log(`[ChurnScore] Agent notification sent for contact ${contactId} (${tier}), agent userId: ${agentUserId || "broadcast"}`);
  } catch (err) {
    console.error(`[ChurnScore] Agent notification error for contact ${contactId}:`, err);
  }
}
