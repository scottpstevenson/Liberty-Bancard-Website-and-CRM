/** Canonical Phase 7 experiment owner. No transport, enrollment or automatic content adoption. */
import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db";
import {
  canonicalJson,
  phase7DesignSchema,
  analyzePhase7,
  plannedMinimumPerArm,
  type Phase7Design,
} from "../../shared/phase7-experiment";
import type { WorkActor } from "./work-item-command";
import { createCr06ExperimentDraft } from "./cr06-premium-campaigns";
export interface Cro07ExperimentDesign {
  key: string;
  hypothesis: string;
  metric: string;
  populationDefinition: Record<string, unknown>;
  allocation: Record<string, number>;
  versions: Record<string, unknown>;
  minSampleSize: number;
  minDurationDays: number;
  confidenceRule: { method: string; alpha: number };
  guardrails: Array<{ metric: string; maxDegradationPct: number }>;
  contaminationExclusions?: string[];
  frozenBy: string;
  phase7Design?: unknown;
}
export interface ExperimentCommand {
  actor: WorkActor;
  expectedVersion: number;
  commandId: string;
}
export const experimentDigest = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
const fail = (code: string): never => {
  throw new Error(`CRO07_${code}`);
};
async function principal(client: any, actor: WorkActor) {
  const p = (
    await client.query(
      `SELECT id,email,role,account_state,auth_epoch,account_version FROM users WHERE id=$1 FOR SHARE`,
      [actor.id],
    )
  ).rows[0];
  if (
    !p ||
    p.role !== "admin" ||
    p.account_state !== "active" ||
    p.auth_epoch !== actor.authEpoch ||
    p.account_version !== actor.accountVersion
  )
    fail("ACTOR_REVOKED");
  return p;
}
async function audit(client: any, actor: string, id: string, action: string) {
  await client.query(
    `INSERT INTO audit_logs(action,entity_type,user_id,actor_type,details) VALUES($1,'cro07_experiment',$2,'user',$3)`,
    [action, actor, JSON.stringify({ experimentId: id })],
  );
}
export async function approvedArms(
  client: any,
  design: Phase7Design,
  draftOnly = false,
) {
  const { readPhase7SourceBinding } = await import("./phase7-content-binding");
  const sourceBinding = await readPhase7SourceBinding(
    client,
    design.sequenceId,
  );
  if (sourceBinding.vertical !== design.vertical)
    fail("VERTICAL_BINDING_MISMATCH");
  const steps = await client.query(
    `SELECT s.*,q.version,q.retired_at,q.sequence_family FROM sequence_steps s JOIN follow_up_sequences q ON q.id=s.sequence_id WHERE s.id=$1 AND q.id=$2 FOR SHARE OF s,q`,
    [design.stepId, design.sequenceId],
  );
  const step = steps.rows[0];
  if (
    !step ||
    step.retired_at ||
    step.version !== design.sequenceVersion ||
    step.action_type !== "email"
  )
    fail("CONTENT_BINDING_STALE");
  let parentId: string | undefined;
  for (const arm of Object.values(design.arms)) {
    const row = (
      await client.query(`SELECT * FROM cr06_artifacts WHERE id=$1 FOR SHARE`, [
        arm.artifactId,
      ])
    ).rows[0];
    if (row && parentId && row.parent_artifact_id !== parentId)
      fail("MIXED_CONTENT_FAMILY");
    parentId = row?.parent_artifact_id;
    if (
      !row ||
      row.artifact_kind !== "content_version" ||
      (!draftOnly &&
        (row.governance_state !== "approved_inactive" || !row.approved_at)) ||
      row.retired_at ||
      row.content_hash !== arm.contentHash ||
      row.document.subject !== arm.subject ||
      row.document.phase7?.bodyHash !== arm.bodyHash ||
      row.document.phase7?.cadenceHash !== arm.cadenceHash ||
      experimentDigest(row.document.phase7?.sourceBinding ?? null) !==
        experimentDigest(sourceBinding)
    )
      fail("APPROVED_ARM_REQUIRED");
  }
  if (!draftOnly) {
    const snapshots = (
      await client.query(
        `SELECT count(*)::int AS n FROM cr06_approval_snapshots WHERE artifact_id=ANY($1::uuid[]) AND artifact_hash=ANY($2::text[])`,
        [
          [design.arms.A.artifactId, design.arms.B.artifactId],
          [design.arms.A.contentHash, design.arms.B.contentHash],
        ],
      )
    ).rows[0];
    if (snapshots.n !== 2) fail("APPROVED_SNAPSHOT_REQUIRED");
  }
  if (experimentDigest({ body: step.body }) !== design.arms.A.bodyHash)
    fail("CONTENT_BODY_DRIFT");
  const cadence = (
    await client.query(
      `SELECT step_order,delay_days,delay_hours FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_order`,
      [design.sequenceId],
    )
  ).rows;
  if (experimentDigest(cadence) !== design.arms.A.cadenceHash)
    fail("CONTENT_CADENCE_DRIFT");
}
export async function freezeCro07Experiment(
  input: Cro07ExperimentDesign,
  command?: ExperimentCommand,
  draftOnly = false,
) {
  if (!command) fail("VERSIONED_COMMAND_REQUIRED");
  const design = phase7DesignSchema.parse(input.phase7Design);
  if (command!.expectedVersion < 1) fail("REVISION_CONFLICT");
  if (
    Object.keys(input.allocation).sort().join() !== "A,B" ||
    input.allocation.A !== 0.5 ||
    input.allocation.B !== 0.5
  )
    fail("TWO_EQUAL_ARMS_REQUIRED");
  if (design.minPerArm < plannedMinimumPerArm(design))
    fail("SAMPLE_PLAN_UNDERPOWERED");
  if (
    input.metric !== design.metric ||
    input.minSampleSize !== design.minPerArm ||
    input.minDurationDays !== design.collectionDays ||
    input.confidenceRule.method !== design.method ||
    input.confidenceRule.alpha !== design.alpha ||
    experimentDigest(input.versions) !== experimentDigest(design.arms)
  )
    fail("DESIGN_METADATA_MISMATCH");
  const semantic = {
    key: input.key,
    hypothesis: input.hypothesis,
    populationDefinition: input.populationDefinition,
    design,
  };
  const designHash = experimentDigest(semantic),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    await principal(client, command!.actor);
    const payloadHash = experimentDigest({
      op: draftOnly ? "draft" : "freeze",
      semantic,
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `cro07-command:${command!.actor.id}:${command!.commandId}`,
    ]);
    const prior = (
      await client.query(
        "SELECT * FROM cro07_experiment_commands WHERE actor_id=$1 AND command_id=$2",
        [command!.actor.id, command!.commandId],
      )
    ).rows[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash) fail("COMMAND_REPLAY_CONFLICT");
      await client.query("COMMIT");
      return { ...prior.result, replayed: true };
    }
    const finish = async (result: any) => {
      await client.query(
        `INSERT INTO cro07_experiment_commands(actor_id,command_id,experiment_id,payload_hash,result)VALUES($1,$2,$3,$4,$5)`,
        [
          command!.actor.id,
          command!.commandId,
          result.id,
          payloadHash,
          JSON.stringify(result),
        ],
      );
      await client.query("COMMIT");
      return result;
    };
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `cro07-freeze:${input.key}`,
    ]);
    const existing = (
      await client.query(`SELECT * FROM cro07_experiments WHERE key=$1`, [
        input.key,
      ])
    ).rows[0];
    if (existing) {
      if (existing.design_hash !== designHash)
        fail("EXPERIMENT_DESIGN_MISMATCH");
      if (!draftOnly && existing.state === "draft_design") {
        await approvedArms(client, design);
        const frozen = (
          await client.query(
            `UPDATE cro07_experiments SET state='frozen_design',revision=revision+1 WHERE id=$1 AND revision=$2 RETURNING *`,
            [existing.id, command!.expectedVersion],
          )
        ).rows[0];
        if (!frozen) fail("REVISION_CONFLICT");
        await audit(
          client,
          command!.actor.id,
          existing.id,
          "experiment_frozen",
        );
        return await finish(frozen);
      }
      return await finish(existing);
    }
    await approvedArms(client, design, draftOnly);
    const row = (
      await client.query(
        `INSERT INTO cro07_experiments(key,hypothesis,metric,population_definition,allocation,versions,min_sample_size,min_duration_days,confidence_rule,guardrails,contamination_exclusions,state,frozen_by,design_hash,phase7_design)
    VALUES($1,$2,$3,$4,'{"A":0.5,"B":0.5}',$5,$6,$7,$8,$9,$10,$14,$11,$12,$13) RETURNING *`,
        [
          input.key,
          input.hypothesis,
          design.metric,
          JSON.stringify(input.populationDefinition),
          JSON.stringify(design.arms),
          design.minPerArm,
          design.collectionDays,
          JSON.stringify({
            method: design.method,
            alpha: design.alpha,
            familySize: design.comparisonFamilySize,
          }),
          JSON.stringify(design.guardrails),
          JSON.stringify(input.contaminationExclusions ?? []),
          command!.actor.id,
          designHash,
          JSON.stringify(design),
          draftOnly ? "draft_design" : "frozen_design",
        ],
      )
    ).rows[0];
    for (const arm of ["A", "B"])
      await client.query(
        `INSERT INTO cro07_experiment_samples(experiment_id,arm) VALUES($1,$2)`,
        [row.id, arm],
      );
    await audit(client, command!.actor.id, row.id, "experiment_frozen");
    return await finish(row);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function mutate(
  id: string,
  command: ExperimentCommand | undefined,
  payload: unknown,
  fn: (c: any, e: any) => Promise<any>,
) {
  if (!command) fail("VERSIONED_COMMAND_REQUIRED");
  const c = await pool.connect(),
    hash = experimentDigest(payload);
  try {
    await c.query("BEGIN");
    await principal(c, command!.actor);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `cro07-command:${command!.actor.id}:${command!.commandId}`,
    ]);
    const prior = (
      await c.query(
        `SELECT * FROM cro07_experiment_commands WHERE actor_id=$1 AND command_id=$2`,
        [command!.actor.id, command!.commandId],
      )
    ).rows[0];
    if (prior) {
      if (prior.payload_hash !== hash || prior.experiment_id !== id)
        fail("COMMAND_REPLAY_CONFLICT");
      await c.query("COMMIT");
      return { ...prior.result, replayed: true };
    }
    const e = (
      await c.query(`SELECT * FROM cro07_experiments WHERE id=$1 FOR UPDATE`, [
        id,
      ])
    ).rows[0];
    if (!e) fail("EXPERIMENT_NOT_FOUND");
    if (e.revision !== command!.expectedVersion) fail("REVISION_CONFLICT");
    if (!e.phase7_design) fail("LEGACY_UNVERIFIED");
    const result = await fn(c, e);
    await audit(c, command!.actor.id, id, "experiment_command");
    await c.query(
      `INSERT INTO cro07_experiment_commands(actor_id,command_id,experiment_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)`,
      [command!.actor.id, command!.commandId, id, hash, JSON.stringify(result)],
    );
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function startCro07Experiment(
  id: string,
  command?: ExperimentCommand,
) {
  return mutate(id, command, { op: "start", id }, async (c, e) => {
    if (e.state !== "frozen_design") fail("EXPERIMENT_NOT_FROZEN");
    const d = phase7DesignSchema.parse(e.phase7_design);
    await approvedArms(c, d);
    // Admission and transport release are separate owners. This records collection intent only.
    return (
      await c.query(
        `UPDATE cro07_experiments SET state='collecting',started_at=now(),collection_ends_at=now()+$2*interval '1 day',maturity_ends_at=now()+$3*interval '1 day',revision=revision+1 WHERE id=$1 RETURNING *`,
        [id, d.collectionDays, d.collectionDays + d.outcomeMaturityDays],
      )
    ).rows[0];
  });
}
/** Retired: neither a caller-chosen key nor success boolean establishes a receipt. */
export async function recordCro07ExperimentSample(_input: {
  experimentId: string;
  arm: string;
  success: boolean;
  guardrailBreach?: boolean;
  eventKey: string;
  source: string;
}): Promise<any> {
  return fail("RECEIPT_REQUIRED");
}
export async function stopCro07Experiment(
  id: string,
  state: "cancelled" | "revoked" | "stopped_guardrail",
  command: ExperimentCommand,
) {
  return mutate(id, command, { op: "stop", id, state }, async (c, e) => {
    if (
      ![
        "draft_design",
        "frozen_design",
        "collecting",
        "ready_for_review",
      ].includes(e.state)
    )
      fail("TERMINAL_STATE");
    return (
      await c.query(
        `UPDATE cro07_experiments SET state=$2,revision=revision+1,evaluation_lease_token=NULL,evaluation_lease_expires_at=NULL WHERE id=$1 RETURNING *`,
        [id, state],
      )
    ).rows[0];
  });
}
/** One non-sending owner for manual and all scheduler callers. Lease claim and result commit are independently fenced. */
export async function evaluateCro07Experiment(
  id: string,
  command?: ExperimentCommand,
  observer?: { onLeaseClaimed?: () => Promise<void> },
) {
  const evaluationPayloadHash = experimentDigest({ op: "evaluate", id });
  if (command) {
    const auth = await pool.connect();
    try {
      await auth.query("BEGIN");
      await principal(auth, command.actor);
      const prior = (
        await auth.query(
          `SELECT * FROM cro07_experiment_commands WHERE actor_id=$1 AND command_id=$2`,
          [command.actor.id, command.commandId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.experiment_id !== id ||
          prior.payload_hash !== evaluationPayloadHash
        )
          fail("COMMAND_REPLAY_CONFLICT");
        await auth.query("COMMIT");
        return { ...prior.result, replayed: true };
      }
      await auth.query("COMMIT");
    } catch (e) {
      await auth.query("ROLLBACK");
      throw e;
    } finally {
      auth.release();
    }
  }
  const token = randomUUID();
  const claimed = (
    await pool.query(
      `UPDATE cro07_experiments SET evaluation_lease_token=$2,evaluation_lease_expires_at=now()+interval '2 minutes'
  WHERE id=$1 AND state='collecting' AND phase7_design IS NOT NULL AND (evaluation_lease_token IS NULL OR evaluation_lease_expires_at<clock_timestamp()) RETURNING revision`,
      [id, token],
    )
  ).rows[0];
  if (!claimed) return { state: "held", reason: "NOT_COLLECTING_OR_LEASED" };
  await observer?.onLeaseClaimed?.();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const e = (
      await c.query(
        `SELECT * FROM cro07_experiments WHERE id=$1 AND evaluation_lease_token=$2 AND evaluation_lease_expires_at>clock_timestamp() AND revision=$3 FOR UPDATE`,
        [id, token, claimed.revision],
      )
    ).rows[0];
    if (command) {
      await principal(c, command.actor);
      if (e?.revision !== command.expectedVersion) fail("REVISION_CONFLICT");
    }
    if (!e || e.state !== "collecting") fail("EVALUATION_LEASE_LOST");
    const finish = async (result: any) => {
      if (command) {
        await audit(c, command.actor.id, id, "experiment_evaluated");
        await c.query(
          `INSERT INTO cro07_experiment_commands(actor_id,command_id,experiment_id,payload_hash,result)VALUES($1,$2,$3,$4,$5)`,
          [
            command.actor.id,
            command.commandId,
            id,
            evaluationPayloadHash,
            JSON.stringify(result),
          ],
        );
      }
      await c.query("COMMIT");
      return result;
    };
    const { applyPhase7Guardrails } = await import("./phase7-feedback");
    const guardrail = await applyPhase7Guardrails(c, id);
    if (guardrail?.breaches.length)
      return await finish({ state: "stopped_guardrail", guardrail });
    const d = phase7DesignSchema.parse(e.phase7_design);
    const counts = (
      await c.query(
        `SELECT a.arm,count(DISTINCT a.business_id) FILTER(WHERE x.id IS NOT NULL)::int AS n,
   count(DISTINCT a.business_id) FILTER(WHERE o.kind='qualified_reply' AND o.occurred_at>=x.occurred_at AND o.occurred_at<=x.occurred_at+$3*interval '1 day')::int AS success
   FROM cro07_subject_assignments a LEFT JOIN cro07_receipt_exposures x ON x.assignment_id=a.id AND x.occurred_at<$2
   LEFT JOIN cro07_verified_outcomes o ON o.exposure_id=x.id AND o.occurred_at<=$4
   WHERE a.experiment_id=$1 AND a.design_hash=$5 GROUP BY a.arm`,
        [
          id,
          e.collection_ends_at,
          d.outcomeMaturityDays,
          e.maturity_ends_at,
          e.design_hash,
        ],
      )
    ).rows;
    const arm = (name: string) =>
      counts.find((x: any) => x.arm === name) ?? { n: 0, success: 0 };
    const A = arm("A"),
      B = arm("B");
    const telemetry = (
      await c.query(
        `SELECT status,reason FROM conversion_evidence_checkpoints WHERE source_type='phase7_feedback'`,
      )
    ).rows[0];
    const pending = Number(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM cro07_mailbox_receipts r JOIN cro07_receipt_exposures x ON x.id=r.exposure_id JOIN cro07_subject_assignments a ON a.id=x.assignment_id LEFT JOIN cro07_reply_qualifications q ON q.receipt_id=r.id WHERE a.experiment_id=$1 AND r.kind='reply' AND q.id IS NULL AND r.occurred_at <= $2`,
          [id, e.maturity_ends_at],
        )
      ).rows[0].n,
    );
    const measurementReady = telemetry?.status === "complete" && pending === 0;
    const databaseNow = (await c.query("SELECT clock_timestamp() AS at"))
      .rows[0].at;
    const mature =
      new Date(e.maturity_ends_at).getTime() <= new Date(databaseNow).getTime();
    const ready =
      mature && A.n >= d.minPerArm && B.n >= d.minPerArm && measurementReady;
    if (!ready) {
      const released = await c.query(
        `UPDATE cro07_experiments SET evaluation_lease_token=NULL,evaluation_lease_expires_at=NULL WHERE id=$1 AND evaluation_lease_token=$2 AND evaluation_lease_expires_at>clock_timestamp() AND revision=$3 RETURNING id`,
        [id, token, e.revision],
      );
      if (!released.rowCount) fail("EVALUATION_LEASE_LOST");
      return await finish({
        state: "insufficient_data",
        A,
        B,
        mature,
        measurementReady,
        pendingQualifications: pending,
        telemetryReason:
          telemetry?.reason ??
          "Verified feedback coverage has not been certified",
        minPerArm: d.minPerArm,
        maturityEndsAt: e.maturity_ends_at,
      });
    }
    const analysis = analyzePhase7(
      A.success,
      A.n,
      B.success,
      B.n,
      d.alpha,
      d.comparisonFamilySize,
    );
    const snapshot = {
      A,
      B,
      ...analysis,
      asOf: new Date().toISOString(),
      designHash: e.design_hash,
      qualification: "verified_human_qualified_only",
      denominator: d.denominator,
    };
    const inserted = (
      await c.query(
        `INSERT INTO cro07_evaluation_snapshots(experiment_id,experiment_revision,design_hash,horizon,snapshot)
   SELECT id,revision,design_hash,maturity_ends_at,$4 FROM cro07_experiments WHERE id=$1 AND evaluation_lease_token=$2 AND evaluation_lease_expires_at>clock_timestamp() AND revision=$3
   ON CONFLICT(experiment_id,design_hash,horizon) DO NOTHING RETURNING *`,
        [id, token, e.revision, JSON.stringify(snapshot)],
      )
    ).rows[0];
    if (!inserted) fail("EVALUATION_LEASE_LOST");
    const written = await c.query(
      `UPDATE cro07_experiments SET state='ready_for_review',revision=revision+1,evaluation_lease_token=NULL,evaluation_lease_expires_at=NULL WHERE id=$1 AND evaluation_lease_token=$2 AND evaluation_lease_expires_at>clock_timestamp() AND revision=$3 RETURNING id`,
      [id, token, e.revision],
    );
    if (!written.rows[0]) fail("EVALUATION_LEASE_LOST");
    return await finish({ state: "ready_for_review", evaluation: inserted });
  } catch (error) {
    await c.query("ROLLBACK");
    await pool.query(
      `UPDATE cro07_experiments SET evaluation_lease_token=NULL,evaluation_lease_expires_at=NULL WHERE id=$1 AND evaluation_lease_token=$2`,
      [id, token],
    );
    throw error;
  } finally {
    c.release();
  }
}
export async function decideCro07Experiment(input: {
  experimentId: string;
  decision: "winner_a" | "winner_b" | "inconclusive" | "stopped_guardrail";
  decidedBy: string;
  evaluationId?: string;
  command?: ExperimentCommand;
}) {
  return mutate(
    input.experimentId,
    input.command,
    {
      id: input.experimentId,
      decision: input.decision,
      evaluationId: input.evaluationId,
    },
    async (c, e) => {
      if (e.state !== "ready_for_review") fail("EXPERIMENT_NOT_DECIDABLE");
      const snap = (
        await c.query(
          `SELECT * FROM cro07_evaluation_snapshots WHERE id=$1 AND experiment_id=$2 AND design_hash=$3`,
          [input.evaluationId, input.experimentId, e.design_hash],
        )
      ).rows[0];
      if (
        !snap ||
        snap.snapshot.recommendation !== input.decision ||
        snap.experiment_revision !== e.revision - 1
      )
        fail("EVALUATION_REVISION_MISMATCH");
      const { applyPhase7Guardrails } = await import("./phase7-feedback");
      const guardrail = await applyPhase7Guardrails(c, e.id);
      if (guardrail?.breaches.length)
        return (
          await c.query("SELECT * FROM cro07_experiments WHERE id=$1", [e.id])
        ).rows[0];
      let handoff: string | null = null;
      if (input.decision.startsWith("winner_")) {
        const d = phase7DesignSchema.parse(e.phase7_design);
        const arm = input.decision === "winner_a" ? d.arms.A : d.arms.B;
        const draft = await createCr06ExperimentDraft({
          client: c,
          parentArtifactId: arm.artifactId,
          identityKey: `phase7-handoff-${e.id}`,
          actorId: input.command!.actor.id,
          subject: arm.subject,
          experimentId: e.id,
        });
        handoff = draft.id;
      }
      return (
        await c.query(
          `UPDATE cro07_experiments SET state='decided',decision=$2,decided_by=$3,decided_at=now(),new_version_handoff_key=$4,revision=revision+1 WHERE id=$1 RETURNING *`,
          [e.id, input.decision, input.command!.actor.id, handoff],
        )
      ).rows[0];
    },
  );
}
export async function getCro07Experiment(
  id: string,
  owner: string | null = null,
) {
  const e = (
    await pool.query(
      `SELECT * FROM cro07_experiments WHERE id=$1 AND ($2::text IS NULL OR frozen_by=$2)`,
      [id, owner],
    )
  ).rows[0];
  if (!e) return null;
  const [samples, runs] = await Promise.all([
    pool.query(
      `SELECT * FROM cro07_experiment_samples WHERE experiment_id=$1 ORDER BY arm`,
      [id],
    ),
    pool.query(
      `SELECT * FROM cro07_evaluation_snapshots WHERE experiment_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [id],
    ),
  ]);
  const progress = e.phase7_design
    ? (
        await pool.query(
          `SELECT a.arm,count(DISTINCT a.business_id)::int AS allocated,count(DISTINCT a.business_id) FILTER(WHERE x.id IS NOT NULL)::int AS exposed,count(DISTINCT a.business_id) FILTER(WHERE o.kind='qualified_reply')::int AS qualified FROM cro07_subject_assignments a LEFT JOIN cro07_receipt_exposures x ON x.assignment_id=a.id LEFT JOIN cro07_verified_outcomes o ON o.exposure_id=x.id WHERE a.experiment_id=$1 GROUP BY a.arm ORDER BY a.arm`,
          [id],
        )
      ).rows
    : [];
  const receipts = e.phase7_design
    ? (
        await pool.query(
          `SELECT r.id,r.provider_message_id,r.kind,r.reason,r.occurred_at,q.classification FROM cro07_mailbox_receipts r JOIN cro07_receipt_exposures x ON x.id=r.exposure_id JOIN cro07_subject_assignments a ON a.id=x.assignment_id LEFT JOIN cro07_reply_qualifications q ON q.receipt_id=r.id WHERE a.experiment_id=$1 ORDER BY r.created_at DESC,r.id LIMIT 100`,
          [id],
        )
      ).rows
    : [];
  return {
    ...e,
    samples: e.phase7_design ? progress : samples.rows,
    progress,
    receipts,
    evaluations: runs.rows,
    telemetry: (
      await pool.query(
        "SELECT status,reason,observed_at FROM conversion_evidence_checkpoints WHERE source_type='phase7_feedback'",
      )
    ).rows[0] ?? { status: "unavailable", reason: "Not certified" },
    measurementStatus: e.phase7_design ? "receipt_backed" : "legacy_unverified",
  };
}
export async function listCro07Experiments(owner: string | null = null) {
  return (
    await pool.query(
      `SELECT * FROM cro07_experiments WHERE ($1::text IS NULL OR frozen_by=$1) ORDER BY created_at DESC LIMIT 200`,
      [owner],
    )
  ).rows;
}

export async function freezePreparedPhase7Experiment(
  id: string,
  command: ExperimentCommand,
) {
  const e = await getCro07Experiment(id);
  if (!e) fail("EXPERIMENT_NOT_FOUND");
  return freezeCro07Experiment(
    {
      key: e.key,
      hypothesis: e.hypothesis,
      metric: e.metric,
      populationDefinition: e.population_definition,
      allocation: e.allocation,
      versions: e.versions,
      minSampleSize: e.min_sample_size,
      minDurationDays: e.min_duration_days,
      confidenceRule: e.confidence_rule,
      guardrails: e.guardrails,
      contaminationExclusions: e.contamination_exclusions,
      frozenBy: e.frozen_by,
      phase7Design: e.phase7_design,
    },
    command,
  );
}
