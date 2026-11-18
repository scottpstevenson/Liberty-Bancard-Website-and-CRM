/** Copy inventory and review-only drafts. Existing eligibility and CR06/CRO07 owners remain authoritative. */
import { lintCopy, lintRules, lintLinks } from "./message-copy-lint";
import { pool } from "../db";
import { readSfpLaunchInventory } from "./sfp-launch-inventory";
import { createCr06Phase7ReviewPackage } from "./cr06-premium-campaigns";
import {
  experimentDigest,
  freezeCro07Experiment,
  type ExperimentCommand,
} from "./cro07-experiments";
import { previewStepForTransport } from "./message-final-preview";

export async function readPhase7CopyInventory() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await c.query("SET LOCAL statement_timeout='5000'");
    const result =
      await c.query(`SELECT 'sequence' AS owner,q.id::text AS asset_id,q.name,q.status,q.version,s.id::text AS step_id,s.step_order,s.action_type AS channel,s.subject,s.body,s.delay_days,s.delay_hours,q.retired_at IS NOT NULL AS retired
 FROM follow_up_sequences q JOIN sequence_steps s ON s.sequence_id=q.id
 UNION ALL SELECT 'campaign',q.id::text,q.name,q.status,q.content_revision,s.id::text,s.step_order,s.channel,s.subject,s.body_template,s.delay_days,0,false FROM campaigns q JOIN campaign_steps s ON s.campaign_id=q.id
 UNION ALL SELECT 'template',id::text,name,CASE WHEN is_active THEN 'active' ELSE 'inactive' END,content_version,id::text,1,channel,subject,body,0,0,false FROM message_templates
 UNION ALL SELECT 'workflow',w.id::text,w.name,CASE WHEN w.enabled THEN 'enabled' ELSE 'disabled' END,w.version,w.id::text||':'||a.ordinality::text,a.ordinality::int,COALESCE(a.node->>'type','unknown'),COALESCE(a.node->>'subject',a.node->'config'->>'subject',t.subject),COALESCE(a.node->>'body',a.node->>'message',a.node->'config'->>'body',a.node->'config'->>'message',t.body),0,0,w.retired_at IS NOT NULL FROM workflows w CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.actions)='array' THEN w.actions ELSE '[]'::jsonb END)WITH ORDINALITY a(node,ordinality)LEFT JOIN message_templates t ON t.id::text=COALESCE(a.node->>'templateId',a.node->'config'->>'templateId')
 ORDER BY owner,asset_id,step_order LIMIT 5001`);
    const pins = (
      await c.query(
        `SELECT id,package_key,vertical,campaign_id,sequence_id,lifecycle_state,content_hash FROM sfp_campaign_package_versions ORDER BY id LIMIT 5001`,
      )
    ).rows;
    const governed = (
      await c.query(
        `SELECT id,identity_key,artifact_kind,governance_state,version,content_hash,parent_artifact_id FROM cr06_artifacts ORDER BY id LIMIT 5001`,
      )
    ).rows;
    await c.query("COMMIT");
    return {
      asOf: new Date().toISOString(),
      complete:
        result.rows.length <= 5000 &&
        pins.length <= 5000 &&
        governed.length <= 5000,
      rows: result.rows.slice(0, 5000).map((r) => ({
        ...r,
        findings:
          r.owner === "workflow" || r.owner === "template"
            ? lintCopy(
                `${r.subject ?? ""}\n${r.body ?? ""}`,
                r.owner === "workflow" ? "workflow" : "template",
              )
            : [
                ...lintRules(`${r.subject ?? ""}\n${r.body ?? ""}`),
                ...lintLinks(`${r.subject ?? ""}\n${r.body ?? ""}`),
              ],
        reviewState: "automated_screen_only_human_context_review_required",
        contentHash: experimentDigest({
          subject: r.subject,
          body: r.body,
          delayDays: r.delay_days,
          delayHours: r.delay_hours,
        }),
        disposition: r.retired
          ? "historical_retained"
          : r.owner === "sequence" && ["paused", "draft"].includes(r.status)
            ? "review_candidate"
            : "installed_unchanged",
      })),
      pins: pins.slice(0, 5000),
      governed: governed.slice(0, 5000),
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function readPhase7Eligibility() {
  const inventory = await readSfpLaunchInventory({ fresh: true });
  const totals = new Map<string, number>();
  for (const row of inventory.byCountyAndVertical)
    totals.set(row.vertical, (totals.get(row.vertical) ?? 0) + row.businesses);
  return {
    asOf: inventory.observedAt,
    selection: "volume_based_pilot_not_conversion_winner",
    rankedVerticals: [...totals]
      .map(([vertical, eligibleBusinesses]) => ({
        vertical,
        eligibleBusinesses,
      }))
      .sort(
        (a, b) =>
          b.eligibleBusinesses - a.eligibleBusinesses ||
          a.vertical.localeCompare(b.vertical),
      ),
    inventory,
  };
}
export async function preparePhase7ReviewDraft(
  input: {
    key: string;
    vertical: string;
    sourceSequenceId: number;
    challengerSubject: string;
    followupBodies: [string, string];
  },
  command: ExperimentCommand,
) {
  const c = await pool.connect();
  let review: any;
  try {
    await c.query("BEGIN");
    const actor = (
      await c.query(`SELECT * FROM users WHERE id=$1 FOR SHARE`, [
        command.actor.id,
      ])
    ).rows[0];
    if (
      !actor ||
      actor.role !== "admin" ||
      actor.account_state !== "active" ||
      actor.auth_epoch !== command.actor.authEpoch ||
      actor.account_version !== command.actor.accountVersion
    )
      throw new Error("CRO07_ACTOR_REVOKED");
    const prior = (
      await c.query(
        "SELECT result FROM cro07_experiment_commands WHERE actor_id=$1 AND command_id=$2",
        [command.actor.id, command.commandId],
      )
    ).rows[0];
    if (prior && prior.result.key !== input.key)
      throw new Error("CRO07_COMMAND_REPLAY_CONFLICT");
    review = await createCr06Phase7ReviewPackage({
      ...input,
      client: c,
      actorId: command.actor.id,
    });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const arms: any = {};
  for (const [arm, role] of [
    ["A", "control"],
    ["B", "challenger"],
  ]) {
    const a = review.family.find((a: any) => a.document.phase7?.role === role);
    arms[arm] = {
      artifactId: a.id,
      contentHash: a.content_hash,
      subject: a.document.subject,
      bodyHash: a.document.phase7.bodyHash,
      cadenceHash: review.cadenceHash,
      senderPolicy: "cold_outreach",
    };
  }
  const design = {
    contractVersion: 1,
    sequenceId: review.source.id,
    sequenceVersion: review.source.version,
    stepId: review.steps[0].id,
    vertical: input.vertical,
    allocationUnit: "canonical_business",
    overlapPolicy: "one_collecting_experiment_per_business",
    outcomeMaturityDays: 14,
    collectionDays: 28,
    metric: "verified_qualified_reply_rate",
    denominator: "distinct_exposed_businesses",
    method: "fisher_exact_two_sided_v1",
    alpha: 0.05,
    comparisonFamilySize: 3,
    minPerArm: 6000,
    planning: {
      baselineRate: 0.02,
      minimumDetectableEffect: 0.01,
      power: 0.8,
      rationale:
        "Conservative planning allowance: 2% baseline, one percentage point absolute effect, 80% power, three-comparison family. Baseline is a planning assumption, not observed performance.",
    },
    arms,
    guardrails: [
      {
        metric: "hard_bounce",
        denominator: "distinct_attempted_businesses",
        minimumEvidence: 20,
        maxRate: 0.05,
      },
      {
        metric: "complaint",
        denominator: "distinct_attempted_businesses",
        minimumEvidence: 1,
        maxRate: 0,
      },
      {
        metric: "opt_out",
        denominator: "distinct_attempted_businesses",
        minimumEvidence: 20,
        maxRate: 0.05,
      },
    ],
  };
  const experiment = await freezeCro07Experiment(
    {
      key: input.key,
      hypothesis: "Subject-only qualified reply pilot for " + input.vertical,
      metric: design.metric,
      populationDefinition: {
        vertical: input.vertical,
        selection: "volume_based_pilot_not_conversion_winner",
        admission: "requires_existing_eligibility_release_and_approval",
      },
      allocation: { A: 0.5, B: 0.5 },
      versions: arms,
      minSampleSize: design.minPerArm,
      minDurationDays: design.collectionDays,
      confidenceRule: { method: design.method, alpha: design.alpha },
      guardrails: [],
      frozenBy: command.actor.id,
      phase7Design: design,
    },
    command,
    true,
  );
  return {
    experiment,
    program: review.program,
    approval: "review_required",
    admissionCount: 0,
    sendCount: 0,
  };
}
export async function previewPhase7Experiment(e: any) {
  if (!e?.phase7_design)
    return { available: false, reason: "LEGACY_UNVERIFIED" };
  const rows = (
    await pool.query(
      `SELECT id,parent_artifact_id,document FROM cr06_artifacts WHERE id=ANY($1::uuid[])`,
      [[e.phase7_design.arms.A.artifactId, e.phase7_design.arms.B.artifactId]],
    )
  ).rows;
  const previews: any = {};
  for (const arm of ["A", "B"]) {
    const a = rows.find((r) => r.id === e.phase7_design.arms[arm].artifactId);
    previews[arm] = a
      ? await previewStepForTransport({
          subject: a.document.subject,
          body: a.document.body ?? a.document.paragraphs.join("\n\n"),
          transport: "sfp_smtp",
        })
      : { ok: false, error: { code: "ARTIFACT_UNAVAILABLE" } };
  }
  const followups = rows[0]
    ? (
        await pool.query(
          `SELECT document FROM cr06_artifacts WHERE parent_artifact_id=$1 AND document->'phase7'->>'role' IN('touch_2','touch_3') ORDER BY document->'phase7'->>'role'`,
          [rows[0].parent_artifact_id],
        )
      ).rows
    : [];
  for (const a of followups)
    previews[a.document.phase7.role] = await previewStepForTransport({
      subject: a.document.subject,
      body: a.document.body,
      transport: "sfp_smtp",
    });
  for (const arm of ["A", "B"])
    for (const persona of ["missing_name", "missing_company"] as const) {
      const a = rows.find((r) => r.id === e.phase7_design.arms[arm].artifactId);
      if (a)
        previews[arm + " · " + persona.replace("_", " ")] =
          await previewStepForTransport({
            subject: a.document.subject,
            body: a.document.body ?? a.document.paragraphs.join("\n\n"),
            transport: "sfp_smtp",
            persona,
          });
    }
  return { available: true, previews };
}
