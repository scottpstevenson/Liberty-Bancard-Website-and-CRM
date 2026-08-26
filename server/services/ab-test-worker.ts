import { storage } from "../storage";
import type { AbTestConfig, AbTestResults } from "@shared/schema";
import { db } from "../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

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
  // A single persisted lease owns every evaluator pass.  The time-bucketed key
  // makes duplicate HTTP/scheduler triggers idempotent while allowing later
  // scheduled evaluations; an expired lease is explicitly recoverable.
  const runKey = `ab-evaluation:${Math.floor(Date.now() / 300_000)}`;
  await db.execute(sql`
    INSERT INTO sequence_ab_evaluation_runs (run_key, state)
    VALUES (${runKey}, 'accepted')
    ON CONFLICT (run_key) DO NOTHING
  `);
  const claim = await db.execute(sql`
    UPDATE sequence_ab_evaluation_runs
    SET state='running', lease_token=gen_random_uuid(), lease_expires_at=now() + interval '5 minutes',
        started_at=COALESCE(started_at, now()), updated_at=now()
    WHERE run_key=${runKey}
      AND (state IN ('accepted','failed') OR (state='running' AND lease_expires_at < now()))
    RETURNING lease_token
  `);
  const lease = ((claim.rows ?? claim)[0] as { lease_token?: string } | undefined)?.lease_token;
  if (!lease) return { checked: 0, updated: 0, winnersSelected: 0 };
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
        const configHash = crypto.createHash("sha256").update(JSON.stringify({
          abConfig, subjectA: step.subject, bodyA: step.body, subjectB: step.variantBSubject, bodyB: step.variantBBody,
        })).digest("hex");

        checked++;

        // Only delivery logs immutably linked to a pre-send assignment count.
        // Mutable metadata and current contact state never establish a cohort.
        const assignedRows = await db.execute(sql`
          SELECT l.* FROM sequence_step_ab_assignments a
          JOIN email_logs l ON l.id=a.delivery_log_id
          WHERE a.sequence_step_id=${step.id} AND a.config_hash=${configHash}
            AND a.delivery_log_id IS NOT NULL
            AND a.eligibility_snapshot->>'recordClass' = 'production'
        `);
        const stepLogs = (assignedRows.rows ?? assignedRows) as Array<any>;

        const isEmailStep = step.actionType === "email";
        const isSmsStep = step.actionType === "sms";

        const abLogs = isSmsStep
          ? stepLogs.filter(l => logMeta(l)?.type === "sms")
          : stepLogs.filter(l => logMeta(l)?.type !== "sms");

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
            const decision = await db.execute(sql`
              INSERT INTO sequence_ab_winner_decisions
                (sequence_step_id, config_hash, winner, evaluation_snapshot)
              VALUES (${step.id}, ${configHash}, ${winnerSelected},
                ${JSON.stringify({ variantASent, variantBSent, aOpens, bOpens, aClicks, bClicks, aReplies, bReplies, winnerCriteria })}::jsonb)
              ON CONFLICT (sequence_step_id, config_hash) DO NOTHING
              RETURNING winner
            `);
            if ((decision.rows ?? decision).length === 0) {
              const stored = await db.execute(sql`
                SELECT winner FROM sequence_ab_winner_decisions
                WHERE sequence_step_id=${step.id} AND config_hash=${configHash}
              `);
              winnerSelected = ((stored.rows ?? stored)[0] as { winner?: string } | undefined)?.winner ?? null;
              pickedWinner = false;
            }
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
    // Queue/HTTP callers must receive a truthful failure, not a completed
    // aggregate with hidden errors.
    await db.execute(sql`
      UPDATE sequence_ab_evaluation_runs SET state='failed', error=${err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000)},
        lease_token=NULL, lease_expires_at=NULL, updated_at=now()
      WHERE run_key=${runKey} AND lease_token=${lease}::uuid
    `);
    throw err;
  }
  const result = { checked, updated, winnersSelected };
  await db.execute(sql`
    UPDATE sequence_ab_evaluation_runs SET state='completed', snapshot=${JSON.stringify(result)}::jsonb,
      completed_at=now(), lease_token=NULL, lease_expires_at=NULL, updated_at=now()
    WHERE run_key=${runKey} AND lease_token=${lease}::uuid
  `);
  return result;
}
