/**
 * CRO-07 governed growth loop.
 *
 * Experiments are frozen at design time (hypothesis, metric, population,
 * allocation, versions, minimum sample/duration, confidence rule,
 * guardrails, contamination/exclusions). Sample counters are the only thing
 * that changes while "collecting". A winner produces a
 * newVersionHandoffKey for a fresh CR-06 draft/version — it NEVER edits
 * approved CR-06 content directly, and publication/deployment remains a
 * separate, out-of-scope, human-run CR-06 action.
 */

import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db";

export interface Cro07ExperimentDesign {
  key: string;
  hypothesis: string;
  metric: string;
  populationDefinition: Record<string, unknown>;
  allocation: Record<string, number>; // arm -> weight
  versions: Record<string, unknown>; // arm -> version descriptor
  minSampleSize: number;
  minDurationDays: number;
  confidenceRule: { method: string; alpha: number };
  guardrails: Array<{ metric: string; maxDegradationPct: number }>;
  contaminationExclusions?: string[];
  frozenBy: string;
}

function stableHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function freezeCro07Experiment(design: Cro07ExperimentDesign) {
  const designHash = stableHash(design);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serializes concurrent freeze calls for the same key so the
    // insert-then-check-arms sequence below can't race with another
    // freeze of the same key.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`cro07-experiment-freeze:${design.key}`]);

    const inserted = await client.query(
      `INSERT INTO cro07_experiments (
        key, hypothesis, metric, population_definition, allocation, versions,
        min_sample_size, min_duration_days, confidence_rule, guardrails, contamination_exclusions,
        state, frozen_by, design_hash
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'frozen_design',$12,$13)
      ON CONFLICT (key) DO NOTHING
      RETURNING *`,
      [
        design.key, design.hypothesis, design.metric, JSON.stringify(design.populationDefinition),
        JSON.stringify(design.allocation), JSON.stringify(design.versions), design.minSampleSize, design.minDurationDays,
        JSON.stringify(design.confidenceRule), JSON.stringify(design.guardrails), JSON.stringify(design.contaminationExclusions ?? []),
        design.frozenBy, designHash,
      ],
    );

    if (inserted.rows[0]) {
      // Genuinely new design — this is the only path allowed to create arm
      // rows, since it is the only path that has verified (via the INSERT)
      // that no frozen design already exists under this key. The arm
      // inserts happen in the SAME transaction as the experiment insert, so
      // a crash/failure between them leaves nothing committed at all
      // (never a permanently-incomplete frozen design with missing arms
      // that no replay could ever repair, since an identical replay
      // deliberately does not (re)create arms).
      const experiment = inserted.rows[0];
      for (const arm of Object.keys(design.allocation)) {
        await client.query(
          `INSERT INTO cro07_experiment_samples (experiment_id, arm) VALUES ($1, $2) ON CONFLICT (experiment_id, arm) DO NOTHING`,
          [experiment.id, arm],
        );
      }
      await client.query("COMMIT");
      return experiment;
    }

    // A design already exists under this key. Freezing is a one-time act —
    // a resubmission under the same key MUST be byte-identical to what was
    // actually frozen (proven via design_hash) or it is rejected outright.
    // Silently accepting a changed allocation/population/versions here would
    // let a second admin call add arms or otherwise mutate the experiment's
    // analysis structure after design freeze, without a new experiment or
    // approval — exactly the invariant "frozen design" is supposed to
    // guarantee. It is NEVER acceptable to insert additional
    // cro07_experiment_samples rows on this path.
    const existing = (await client.query(`SELECT * FROM cro07_experiments WHERE key = $1`, [design.key])).rows[0];
    if (!existing) throw new Error("CRO07_EXPERIMENT_NOT_FOUND");
    if (existing.design_hash !== designHash) {
      throw new Error("CRO07_EXPERIMENT_DESIGN_MISMATCH");
    }
    await client.query("COMMIT");
    return existing;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function startCro07Experiment(experimentId: string) {
  const result = await pool.query(
    `UPDATE cro07_experiments SET state = 'collecting', started_at = NOW() WHERE id = $1 AND state = 'frozen_design' RETURNING *`,
    [experimentId],
  );
  if (!result.rows[0]) throw new Error("CRO07_EXPERIMENT_NOT_FROZEN");
  return result.rows[0];
}

/**
 * Atomic per-arm sample increment. Guardrail breach counts are tracked
 * separately from exposures.
 *
 * `eventKey` MUST identify one real, attributable exposure/outcome (e.g. a
 * `cro07_attempt` id, a `cro07_feedback_receipts` id, or another durable
 * event's id) — never a caller-chosen free-text label. It is deduplicated
 * against `cro07_experiment_events` (a real row is inserted first, and the
 * aggregate is only incremented when that insert is new) so a replayed or
 * fabricated call can never inflate the counters twice. `source` identifies
 * the trusted internal writer (e.g. "cro07_attribution", "cro07_feedback")
 * — this function is intentionally NOT exposed as an open write surface for
 * arbitrary agent-supplied counts.
 */
export async function recordCro07ExperimentSample(input: {
  experimentId: string; arm: string; success: boolean; guardrailBreach?: boolean; eventKey: string; source: string;
}) {
  // Event insert, aggregate increment, and guardrail-state update all run in
  // ONE transaction. A partial failure (e.g. a transient DB error between
  // the event insert and the aggregate UPDATE) must roll back the whole
  // thing — otherwise the event row could commit alone, permanently taking
  // the "replayed" branch on every retry while the aggregate counters (and
  // any guardrail auto-stop they'd have triggered) never actually apply,
  // silently undercounting the experiment.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const experiment = await client.query(`SELECT * FROM cro07_experiments WHERE id = $1 FOR UPDATE`, [input.experimentId]);
    if (!experiment.rows[0]) throw new Error("CRO07_EXPERIMENT_NOT_FOUND");
    if (experiment.rows[0].state !== "collecting") throw new Error("CRO07_EXPERIMENT_NOT_COLLECTING");
    if (!Object.prototype.hasOwnProperty.call(experiment.rows[0].allocation, input.arm)) throw new Error("CRO07_UNKNOWN_ARM");

    const eventInsert = await client.query(
      `INSERT INTO cro07_experiment_events (experiment_id, arm, event_key, success, guardrail_breach, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (experiment_id, event_key) DO NOTHING
       RETURNING *`,
      [input.experimentId, input.arm, input.eventKey, input.success, input.guardrailBreach ?? false, input.source],
    );

    if (!eventInsert.rows[0]) {
      // Already-recorded event identity — replayed, never double-counted.
      // The aggregate row it originally applied to is guaranteed consistent
      // because that earlier call committed both the event and the
      // aggregate update atomically in this same transaction shape.
      const existing = await client.query(
        `SELECT * FROM cro07_experiment_samples WHERE experiment_id = $1 AND arm = $2`,
        [input.experimentId, input.arm],
      );
      await client.query("COMMIT");
      return { ...existing.rows[0], replayed: true };
    }

    const updated = await client.query(
      `UPDATE cro07_experiment_samples
       SET exposure_count = exposure_count + 1,
           success_count = success_count + CASE WHEN $3 THEN 1 ELSE 0 END,
           guardrail_breach_count = guardrail_breach_count + CASE WHEN $4 THEN 1 ELSE 0 END,
           updated_at = NOW()
       WHERE experiment_id = $1 AND arm = $2
       RETURNING *`,
      [input.experimentId, input.arm, input.success, input.guardrailBreach ?? false],
    );
    if (!updated.rows[0]) throw new Error("CRO07_UNKNOWN_ARM");

    // Guardrail auto-stop: if any arm's breach rate exceeds 20% after at
    // least 20 exposures, the experiment is stopped for human review rather
    // than continuing to collect potentially harmful data. This state
    // transition is part of the same atomic unit as the counters that
    // trigger it — never a separate follow-up write that could apply to
    // stale counts.
    const row = updated.rows[0];
    if (row.exposure_count >= 20 && row.guardrail_breach_count / row.exposure_count > 0.2) {
      await client.query(
        `UPDATE cro07_experiments SET state = 'stopped_guardrail' WHERE id = $1 AND state = 'collecting'`,
        [input.experimentId],
      );
    }
    await client.query("COMMIT");
    return { ...row, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Human-approval-gated decision. Requires the design's minimum sample size
 * and duration to have been met; never auto-publishes a winner. Returns a
 * newVersionHandoffKey the caller can hand to a NEW CR-06 draft workflow —
 * it is a plain opaque key, not a write into any cr06_* table.
 */
export async function decideCro07Experiment(input: { experimentId: string; decision: "winner_a" | "winner_b" | "inconclusive" | "stopped_guardrail"; decidedBy: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Row-lock the experiment for the duration of this decision so two
    // concurrent decide calls can never both pass the eligibility checks
    // below and each independently mint a different winner/handoff key for
    // the same experiment — the second call blocks here until the first
    // commits, then re-reads a state that is no longer decidable.
    const experimentRow = await client.query(`SELECT * FROM cro07_experiments WHERE id = $1 FOR UPDATE`, [input.experimentId]);
    const experiment = experimentRow.rows[0];
    if (!experiment) throw new Error("CRO07_EXPERIMENT_NOT_FOUND");
    if (!["collecting", "stopped_guardrail"].includes(experiment.state)) throw new Error("CRO07_EXPERIMENT_NOT_DECIDABLE");

    if (input.decision !== "stopped_guardrail" && experiment.state !== "stopped_guardrail") {
      const samples = await client.query(`SELECT * FROM cro07_experiment_samples WHERE experiment_id = $1`, [input.experimentId]);
      const totalExposures = samples.rows.reduce((sum: number, r: any) => sum + Number(r.exposure_count), 0);
      if (totalExposures < experiment.min_sample_size) throw new Error("CRO07_INSUFFICIENT_SAMPLE");
      const startedAt = experiment.started_at ? new Date(experiment.started_at) : null;
      const elapsedDays = startedAt ? (Date.now() - startedAt.getTime()) / (24 * 60 * 60 * 1000) : 0;
      if (elapsedDays < experiment.min_duration_days) throw new Error("CRO07_MIN_DURATION_NOT_MET");
    }

    const newVersionHandoffKey = input.decision.startsWith("winner_") ? `cro07-winner-${randomUUID()}` : null;
    // Compare-and-set: the WHERE clause re-asserts the same eligible-state
    // condition already checked above under the row lock, so this can only
    // ever transition an experiment exactly once out of an undecided state.
    const updated = await client.query(
      `UPDATE cro07_experiments
       SET state = 'decided', decision = $2, decided_by = $3, decided_at = NOW(), new_version_handoff_key = $4
       WHERE id = $1 AND state IN ('collecting','stopped_guardrail')
       RETURNING *`,
      [input.experimentId, input.decision, input.decidedBy, newVersionHandoffKey],
    );
    if (!updated.rows[0]) throw new Error("CRO07_EXPERIMENT_NOT_DECIDABLE");
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getCro07Experiment(experimentId: string) {
  const [experiment, samples] = await Promise.all([
    pool.query(`SELECT * FROM cro07_experiments WHERE id = $1`, [experimentId]),
    pool.query(`SELECT * FROM cro07_experiment_samples WHERE experiment_id = $1 ORDER BY arm`, [experimentId]),
  ]);
  if (!experiment.rows[0]) return null;
  return { ...experiment.rows[0], samples: samples.rows };
}

export async function listCro07Experiments() {
  const result = await pool.query(`SELECT * FROM cro07_experiments ORDER BY created_at DESC LIMIT 200`);
  return result.rows;
}
