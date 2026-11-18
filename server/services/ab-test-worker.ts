/** Compatibility entrance: all manual/SLA callers enter the same non-sending, per-experiment fenced owner.
 * Legacy sequence_ab_evaluation_runs / lease_token history is retained; mutable step results are never written.
 */
import { projectPhase7Exposures } from "./sequence-ab-authority";
import { reconcilePhase7ConversionEvidence } from "./phase7-evidence-reconciliation";
import { pool } from "../db";
import { evaluateCro07Experiment } from "./cro07-experiments";
export interface AbTestCheckResult {
  checked: number;
  updated: number;
  winnersSelected: number;
}
export async function checkAbTestWinners(): Promise<AbTestCheckResult> {
  await projectPhase7Exposures();
  await reconcilePhase7ConversionEvidence();
  const cursor =
    (
      await pool.query(
        "SELECT cursor_value FROM conversion_evidence_checkpoints WHERE source_type='phase7_evaluator_cursor'",
      )
    ).rows[0]?.cursor_value ?? "";
  let experiments = await pool.query(
    `SELECT id FROM cro07_experiments WHERE state='collecting' AND phase7_design IS NOT NULL AND id::text>$1 ORDER BY id LIMIT 100`,
    [cursor],
  );
  if (!experiments.rows.length && cursor)
    experiments = await pool.query(
      `SELECT id FROM cro07_experiments WHERE state='collecting' AND phase7_design IS NOT NULL ORDER BY id LIMIT 100`,
    );
  let updated = 0;
  for (const e of experiments.rows) {
    const result = await evaluateCro07Experiment(e.id);
    if (result.state === "ready_for_review") updated++;
  }
  if (experiments.rows.length)
    await pool.query(
      `INSERT INTO conversion_evidence_checkpoints(source_type,cursor_value,status,reason,observed_at)VALUES('phase7_evaluator_cursor',$1,'partial','Bounded evaluator continuation cursor; not conversion coverage',now())ON CONFLICT(source_type)DO UPDATE SET cursor_value=excluded.cursor_value,observed_at=excluded.observed_at`,
      [experiments.rows.at(-1).id],
    );
  return { checked: experiments.rows.length, updated, winnersSelected: 0 };
}
