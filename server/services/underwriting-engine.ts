/**
 * Underwriting Rules Engine
 *
 * Evaluates a deal against configurable risk thresholds after statement
 * analysis completes. Returns one of three decisions:
 *   - "approve"  — all rules pass → auto-advance to Proposal Sent
 *   - "review"   — soft flags → queue for manager review
 *   - "hold"     — hard flags → hold in Review In Progress + alert admin
 *
 * Never auto-rejects. Holds always preserve human review.
 */

import { storage } from "../storage";
import type { Deal } from "@shared/schema";

export interface UnderwritingInput {
  deal: Deal;
  /** Optional extracted values from statement analysis / deal blueprint */
  effectiveRatePct?: number | null;
  chargebackRatePct?: number | null;
  monthlyVolume?: number | null;
  processorName?: string | null;
}

export interface UnderwritingResult {
  decision: "approve" | "review" | "hold";
  score: number;
  reasons: string[];
  rulesSnapshot: Record<string, unknown>;
}

/** Parse a numeric-ish string/number into a float, or null if unparseable. */
function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? null : n;
}

export async function runUnderwritingEngine(
  input: UnderwritingInput,
): Promise<UnderwritingResult> {
  const { deal } = input;

  const rules = await storage.getUnderwritingRules();

  const rulesSnapshot: Record<string, unknown> = {
    minMonthlyVolume: rules.minMonthlyVolume,
    maxMonthlyVolume: rules.maxMonthlyVolume,
    effectiveRateCeiling: rules.effectiveRateCeiling,
    chargebackRateLimit: rules.chargebackRateLimit,
    chargebackRateHardLimit: rules.chargebackRateHardLimit,
    volumeHardDeviationPct: rules.volumeHardDeviationPct,
    blockedProcessors: rules.blockedProcessors,
    autoApproveEnabled: rules.autoApproveEnabled,
  };

  if (!rules.autoApproveEnabled) {
    return {
      decision: "review",
      score: 50,
      reasons: ["Auto-approve is disabled — all deals sent to manager review"],
      rulesSnapshot,
    };
  }

  const reasons: string[] = [];
  const softFlags: string[] = [];
  const hardFlags: string[] = [];
  let score = 100;

  const minVol = parseNum(rules.minMonthlyVolume) ?? 5000;
  const maxVol = parseNum(rules.maxMonthlyVolume) ?? 500000;
  const rateCeiling = parseNum(rules.effectiveRateCeiling) ?? 3.5;
  const cbLimit = parseNum(rules.chargebackRateLimit) ?? 1.0;
  const cbHardLimit = parseNum(rules.chargebackRateHardLimit) ?? 2.0;
  const hardDeviationPct = parseNum(rules.volumeHardDeviationPct) ?? 50;

  // Resolve volume from inputs or deal fields
  const rawVolume =
    input.monthlyVolume ??
    parseNum(deal.totalVolume) ??
    parseNum((deal.dealBlueprint as any)?.monthlyVolume) ??
    null;

  // Resolve effective rate
  const rawRate =
    input.effectiveRatePct ??
    parseNum(deal.effectiveRate) ??
    parseNum((deal.savingsProposal as any)?.currentEffectiveRate) ??
    null;

  // Resolve chargeback rate
  const rawCb =
    input.chargebackRatePct ??
    parseNum((deal.dealBlueprint as any)?.chargebackRate) ??
    parseNum((deal.savingsProposal as any)?.chargebackRate) ??
    null;

  // Resolve processor
  const processorName =
    input.processorName ??
    (deal.savingsProposal as any)?.currentProcessor ??
    (deal.dealBlueprint as any)?.currentProcessor ??
    null;

  // ── Volume checks ────────────────────────────────────────────────────────
  if (rawVolume !== null) {
    if (rawVolume < minVol) {
      const pctBelow = ((minVol - rawVolume) / minVol) * 100;
      if (pctBelow > hardDeviationPct) {
        hardFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is more than ${hardDeviationPct}% below minimum $${minVol.toLocaleString()}`,
        );
        score -= 35;
      } else {
        softFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is below minimum $${minVol.toLocaleString()}`,
        );
        score -= 15;
      }
    } else if (rawVolume > maxVol) {
      const pctAbove = ((rawVolume - maxVol) / maxVol) * 100;
      if (pctAbove > hardDeviationPct) {
        hardFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is more than ${hardDeviationPct}% above maximum $${maxVol.toLocaleString()} — enhanced underwriting required`,
        );
        score -= 20;
      } else {
        softFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} exceeds maximum $${maxVol.toLocaleString()} — may need enhanced review`,
        );
        score -= 10;
      }
    } else {
      reasons.push(`Volume $${rawVolume.toLocaleString()}/mo is within acceptable range`);
    }
  }

  // ── Effective rate checks ────────────────────────────────────────────────
  if (rawRate !== null) {
    if (rawRate > rateCeiling) {
      const overage = rawRate - rateCeiling;
      if (overage > 1.5) {
        hardFlags.push(
          `Effective rate ${rawRate.toFixed(2)}% exceeds ceiling ${rateCeiling}% by more than 1.5 points — pricing review required`,
        );
        score -= 25;
      } else {
        softFlags.push(
          `Effective rate ${rawRate.toFixed(2)}% exceeds configured ceiling of ${rateCeiling}%`,
        );
        score -= 10;
      }
    } else {
      reasons.push(`Effective rate ${rawRate.toFixed(2)}% is within ceiling ${rateCeiling}%`);
    }
  }

  // ── Chargeback rate checks ───────────────────────────────────────────────
  if (rawCb !== null) {
    if (rawCb > cbHardLimit) {
      hardFlags.push(
        `Chargeback rate ${rawCb.toFixed(2)}% exceeds hard limit ${cbHardLimit}% — high-risk hold`,
      );
      score -= 40;
    } else if (rawCb > cbLimit) {
      softFlags.push(
        `Chargeback rate ${rawCb.toFixed(2)}% exceeds soft limit ${cbLimit}% — flagged for review`,
      );
      score -= 20;
    } else {
      reasons.push(`Chargeback rate ${rawCb.toFixed(2)}% is within limit`);
    }
  }

  // ── Processor checks ─────────────────────────────────────────────────────
  const blockedList: string[] = Array.isArray(rules.blockedProcessors)
    ? rules.blockedProcessors
    : [];
  if (processorName && blockedList.length > 0) {
    const pLower = processorName.toLowerCase();
    const blocked = blockedList.find(b => pLower.includes(b.toLowerCase()));
    if (blocked) {
      hardFlags.push(
        `Processor "${processorName}" is on the blocked processor list`,
      );
      score -= 30;
    }
  }

  // ── Determine decision ───────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score));

  let decision: "approve" | "review" | "hold";
  const allFlagReasons = [...softFlags, ...hardFlags];

  if (hardFlags.length > 0) {
    decision = "hold";
    allFlagReasons.unshift("HOLD: Hard risk flags detected");
  } else if (softFlags.length > 0) {
    decision = "review";
    allFlagReasons.unshift("REVIEW: Soft risk flags require manager review");
  } else {
    decision = "approve";
    reasons.unshift("All underwriting checks passed — auto-approved");
  }

  return {
    decision,
    score,
    reasons: decision === "approve" ? reasons : allFlagReasons,
    rulesSnapshot,
  };
}
