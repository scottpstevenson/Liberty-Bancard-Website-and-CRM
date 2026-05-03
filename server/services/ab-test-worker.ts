import { storage } from "../storage";
import type { AbTestConfig, AbTestResults } from "@shared/schema";

export interface AbTestCheckResult {
  checked: number;
  updated: number;
  winnersSelected: number;
}

function logMeta(l: { metadata: unknown }): Record<string, unknown> | null {
  return l.metadata as Record<string, unknown> | null;
}

function isStatisticallySignificant(
  successes1: number,
  n1: number,
  successes2: number,
  n2: number
): boolean {
  if (n1 < 5 || n2 < 5 || successes1 + successes2 === 0) return false;
  const p1 = successes1 / n1;
  const p2 = successes2 / n2;
  const pPooled = (successes1 + successes2) / (n1 + n2);
  if (pPooled === 0 || pPooled === 1) return false;
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) return false;
  return Math.abs((p1 - p2) / se) >= 1.96;
}

export async function checkAbTestWinners(): Promise<AbTestCheckResult> {
  let checked = 0;
  let updated = 0;
  let winnersSelected = 0;

  try {
    const sequences = await storage.getFollowUpSequences();

    for (const seq of sequences) {
      const steps = await storage.getSequenceSteps(seq.id);

      for (const step of steps) {
        const abConfig = step.abTestConfig as AbTestConfig | null;
        const abEnabled = !!(step.variantBSubject || step.variantBBody);
        if (!abConfig || !abEnabled) continue;

        const existing = (step.abTestResults as Partial<AbTestResults> | null) ?? {};
        if (existing.winnerSelected) continue;

        checked++;

        const stepLogs = await storage.getEmailLogsByStepId(step.id);

        const isEmailStep = step.actionType === "email";
        const isSmsStep = step.actionType === "sms";

        const abLogs = isSmsStep
          ? stepLogs.filter(l => logMeta(l)?.type === "sms" && logMeta(l)?.abVariant)
          : stepLogs.filter(l => logMeta(l)?.abVariant);

        const variantASent = abLogs.filter(
          l => logMeta(l)?.abVariant === "A" && l.status === "sent"
        ).length;
        const variantBSent = abLogs.filter(
          l => logMeta(l)?.abVariant === "B" && l.status === "sent"
        ).length;

        const aOpens = isEmailStep
          ? abLogs.filter(l => logMeta(l)?.abVariant === "A" && l.openedAt != null).length
          : 0;
        const bOpens = isEmailStep
          ? abLogs.filter(l => logMeta(l)?.abVariant === "B" && l.openedAt != null).length
          : 0;

        const aClicks = isEmailStep
          ? abLogs.filter(l => logMeta(l)?.abVariant === "A" && l.clickedAt != null).length
          : 0;
        const bClicks = isEmailStep
          ? abLogs.filter(l => logMeta(l)?.abVariant === "B" && l.clickedAt != null).length
          : 0;

        const aReplies = abLogs.filter(
          l => logMeta(l)?.abVariant === "A" && l.repliedAt != null
        ).length;
        const bReplies = abLogs.filter(
          l => logMeta(l)?.abVariant === "B" && l.repliedAt != null
        ).length;

        const totalSent = variantASent + variantBSent;
        const minSampleSize = abConfig.minSampleSize ?? 100;
        const winnerCriteria = abConfig.winnerCriteria ?? "open_rate";

        const dataChanged =
          variantASent !== (existing.variantASent ?? 0) ||
          variantBSent !== (existing.variantBSent ?? 0) ||
          aOpens !== (existing.aOpens ?? 0) ||
          bOpens !== (existing.bOpens ?? 0) ||
          aClicks !== (existing.aClicks ?? 0) ||
          bClicks !== (existing.bClicks ?? 0) ||
          aReplies !== (existing.aReplies ?? 0) ||
          bReplies !== (existing.bReplies ?? 0);

        let winnerSelected: string | null = null;
        let winnerAt: string | null = existing.winnerAt ?? null;
        let statSig = false;
        let pickedWinner = false;

        if (totalSent >= minSampleSize) {
          let successA: number;
          let successB: number;
          if (winnerCriteria === "reply_rate") {
            successA = aReplies;
            successB = bReplies;
          } else if (winnerCriteria === "click_rate") {
            successA = aClicks;
            successB = bClicks;
          } else {
            successA = aOpens;
            successB = bOpens;
          }

          statSig = isStatisticallySignificant(successA, variantASent, successB, variantBSent);
          if (statSig) {
            const rateA = variantASent > 0 ? successA / variantASent : 0;
            const rateB = variantBSent > 0 ? successB / variantBSent : 0;
            winnerSelected = rateA >= rateB ? "A" : "B";
            winnerAt = winnerAt ?? new Date().toISOString();
            pickedWinner = true;
            winnersSelected++;
          }
        }

        if (dataChanged || pickedWinner) {
          const results: AbTestResults = {
            variantASent,
            variantBSent,
            aOpens,
            bOpens,
            aClicks,
            bClicks,
            aReplies,
            bReplies,
            winnerSelected,
            winnerAt,
            startedAt: existing.startedAt ?? (totalSent > 0 ? new Date().toISOString() : null),
            statisticallySignificant: statSig,
          };
          await storage.updateSequenceStepAbTestResults(step.id, results);
          updated++;

          if (pickedWinner) {
            const successA = winnerCriteria === "reply_rate" ? aReplies : winnerCriteria === "click_rate" ? aClicks : aOpens;
            const successB = winnerCriteria === "reply_rate" ? bReplies : winnerCriteria === "click_rate" ? bClicks : bOpens;
            const rateAStr = variantASent > 0 ? ((successA / variantASent) * 100).toFixed(1) : "0";
            const rateBStr = variantBSent > 0 ? ((successB / variantBSent) * 100).toFixed(1) : "0";
            console.log(
              `[AB Test Worker] Winner: step ${step.id} (${seq.name}) → Variant ${winnerSelected}` +
              ` (${winnerCriteria}: A=${rateAStr}% vs B=${rateBStr}%, n=${totalSent}, statistically significant)`
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[AB Test Worker] Error checking A/B test winners:", err);
  }

  return { checked, updated, winnersSelected };
}
