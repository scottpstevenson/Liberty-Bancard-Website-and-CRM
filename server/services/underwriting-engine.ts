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

/** Parse a numeric-ish string/number into a FINITE float, or null if unparseable/nonfinite. */
function parseNum(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

type Evidence = { state: "absent" } | { state: "invalid" } | { state: "ok"; value: number };

/**
 * Resolve the first PRESENT candidate. A present-but-unusable value (nonfinite,
 * unparseable, or negative) is "invalid" — never silently skipped, so it can
 * never become a perfect score. Only fully blank candidates fall through.
 */
function resolveEvidence(candidates: Array<string | number | null | undefined>): Evidence {
  for (const c of candidates) {
    if (c === null || c === undefined || (typeof c === "string" && c.trim() === "")) continue;
    const n = parseNum(c);
    if (n === null || n < 0) return { state: "invalid" };
    return { state: "ok", value: n };
  }
  return { state: "absent" };
}

export async function runUnderwritingEngine(
  input: UnderwritingInput,
): Promise<UnderwritingResult> {
  const { deal } = input;

  const rules = await storage.getUnderwritingRules();
  if (!rules) {
    // S5-24: no configured rules row — never fabricate thresholds; manual review.
    return {
      decision: "review",
      score: 50,
      reasons: ["REVIEW: Underwriting rules are not configured — cannot auto-approve"],
      rulesSnapshot: { configured: false },
    };
  }

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

  // Rule thresholds come ONLY from the configured rules. No hard-coded fallback
  // thresholds are invented: an unusable rule makes the evaluation unavailable
  // and routes the deal to manager review instead of approving.
  const minVol = parseNum(rules.minMonthlyVolume);
  const maxVol = parseNum(rules.maxMonthlyVolume);
  const rateCeiling = parseNum(rules.effectiveRateCeiling);
  const cbLimit = parseNum(rules.chargebackRateLimit);
  const cbHardLimit = parseNum(rules.chargebackRateHardLimit);
  const hardDeviationPct = parseNum(rules.volumeHardDeviationPct);

  const ruleProblems: string[] = [];
  if (minVol === null) ruleProblems.push("minMonthlyVolume");
  if (maxVol === null) ruleProblems.push("maxMonthlyVolume");
  if (rateCeiling === null) ruleProblems.push("effectiveRateCeiling");
  if (cbLimit === null) ruleProblems.push("chargebackRateLimit");
  if (cbHardLimit === null) ruleProblems.push("chargebackRateHardLimit");
  if (hardDeviationPct === null) ruleProblems.push("volumeHardDeviationPct");
  if (minVol !== null && maxVol !== null && minVol > maxVol) ruleProblems.push("minMonthlyVolume>maxMonthlyVolume");
  if (cbLimit !== null && cbHardLimit !== null && cbLimit > cbHardLimit) ruleProblems.push("chargebackRateLimit>chargebackRateHardLimit");
  if (ruleProblems.length > 0) {
    return {
      decision: "review",
      score: 50,
      reasons: [
        `REVIEW: Underwriting rules are missing, invalid or contradictory (${ruleProblems.join(", ")}) — cannot auto-approve`,
      ],
      rulesSnapshot,
    };
  }
  const minV = minVol as number;
  const maxV = maxVol as number;
  const ceiling = rateCeiling as number;
  const cbSoft = cbLimit as number;
  const cbHard = cbHardLimit as number;
  const hardDev = hardDeviationPct as number;

  // Resolve volume from inputs or deal fields
  const volumeEv = resolveEvidence([
    input.monthlyVolume,
    deal.totalVolume as any,
    (deal.dealBlueprint as any)?.monthlyVolume,
  ]);
  // Resolve effective rate
  const rateEv = resolveEvidence([
    input.effectiveRatePct,
    deal.effectiveRate as any,
    (deal.savingsProposal as any)?.currentEffectiveRate,
  ]);
  // Resolve chargeback rate
  const cbEv = resolveEvidence([
    input.chargebackRatePct,
    (deal.dealBlueprint as any)?.chargebackRate,
    (deal.savingsProposal as any)?.chargebackRate,
  ]);
  const rawVolume = volumeEv.state === "ok" ? volumeEv.value : null;
  const rawRate = rateEv.state === "ok" ? rateEv.value : null;
  const rawCb = cbEv.state === "ok" ? cbEv.value : null;

  // Required-evidence policy: every risk check the rules define needs usable
  // evidence. Absent/invalid evidence is a review reason, never a pass.
  const evidenceGaps: string[] = [];
  const noteGap = (label: string, ev: Evidence) => {
    if (ev.state === "absent") evidenceGaps.push(`${label} evidence is missing`);
    else if (ev.state === "invalid") evidenceGaps.push(`${label} evidence is invalid`);
  };
  noteGap("Monthly volume", volumeEv);
  noteGap("Effective rate", rateEv);
  noteGap("Chargeback rate", cbEv);

  // Resolve processor
  const processorName =
    input.processorName ??
    (deal.savingsProposal as any)?.currentProcessor ??
    (deal.dealBlueprint as any)?.currentProcessor ??
    null;

  // ── Volume checks ────────────────────────────────────────────────────────
  if (rawVolume !== null) {
    if (rawVolume < minV) {
      const pctBelow = ((minV - rawVolume) / minV) * 100;
      if (pctBelow > hardDev) {
        hardFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is more than ${hardDev}% below minimum $${minV.toLocaleString()}`,
        );
        score -= 35;
      } else {
        softFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is below minimum $${minV.toLocaleString()}`,
        );
        score -= 15;
      }
    } else if (rawVolume > maxV) {
      const pctAbove = ((rawVolume - maxV) / maxV) * 100;
      if (pctAbove > hardDev) {
        hardFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} is more than ${hardDev}% above maximum $${maxV.toLocaleString()} — enhanced underwriting required`,
        );
        score -= 20;
      } else {
        softFlags.push(
          `Monthly volume $${rawVolume.toLocaleString()} exceeds maximum $${maxV.toLocaleString()} — may need enhanced review`,
        );
        score -= 10;
      }
    } else {
      reasons.push(`Volume $${rawVolume.toLocaleString()}/mo is within acceptable range`);
    }
  }

  // ── Effective rate checks ────────────────────────────────────────────────
  if (rawRate !== null) {
    if (rawRate > ceiling) {
      const overage = rawRate - ceiling;
      if (overage > 1.5) {
        hardFlags.push(
          `Effective rate ${rawRate.toFixed(2)}% exceeds ceiling ${ceiling}% by more than 1.5 points — pricing review required`,
        );
        score -= 25;
      } else {
        softFlags.push(
          `Effective rate ${rawRate.toFixed(2)}% exceeds configured ceiling of ${ceiling}%`,
        );
        score -= 10;
      }
    } else {
      reasons.push(`Effective rate ${rawRate.toFixed(2)}% is within ceiling ${ceiling}%`);
    }
  }

  // ── Chargeback rate checks ───────────────────────────────────────────────
  if (rawCb !== null) {
    if (rawCb > cbHard) {
      hardFlags.push(
        `Chargeback rate ${rawCb.toFixed(2)}% exceeds hard limit ${cbHard}% — high-risk hold`,
      );
      score -= 40;
    } else if (rawCb > cbSoft) {
      softFlags.push(
        `Chargeback rate ${rawCb.toFixed(2)}% exceeds soft limit ${cbSoft}% — flagged for review`,
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
  if (blockedList.length > 0 && !(typeof processorName === "string" && processorName.trim() !== "")) {
    evidenceGaps.push("Current processor evidence is missing (blocked-processor list is configured)");
  }
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
  for (const gap of evidenceGaps) {
    softFlags.push(`${gap} — cannot auto-approve`);
    allFlagReasons.push(`${gap} — cannot auto-approve`);
    score = Math.min(score, 50);
  }

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
