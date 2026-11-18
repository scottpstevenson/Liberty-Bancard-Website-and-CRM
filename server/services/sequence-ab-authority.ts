import { assertPhase7FeedbackReady, phase7SenderIdentity } from "./phase7-sendgrid";
import { createHash } from "node:crypto";
import { pool } from "../db";
import { experimentDigest, approvedArms } from "./cro07-experiments";
import { phase7DesignSchema } from "../../shared/phase7-experiment";
export type AbVariant = "A" | "B";
export async function resolvePhase7StepExperiment(stepId: number) {
  const rows = (
    await pool.query(
      `SELECT * FROM cro07_experiments WHERE phase7_design->>'stepId'=$1 AND state='collecting' ORDER BY id`,
      [String(stepId)],
    )
  ).rows;
  if (rows.length > 1) throw new Error("CRO07_AMBIGUOUS_STEP_EXPERIMENT");
  return rows[0] ?? null;
}
/** Allocates canonical businesses, never an enrollment/contact or mutable field. */
export async function getOrCreateSequenceAbAssignment(input: {
  enrollmentId: number;
  stepId: number;
  splitRatio: number;
  config: unknown;
  eligibilitySnapshot: Record<string, unknown>;
}): Promise<AbVariant> {
  const id = (input.config as any)?.experimentId;
  if (!id) throw new Error("CRO07_LEGACY_UNVERIFIED");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const e = (
      await c.query(`SELECT * FROM cro07_experiments WHERE id=$1 FOR SHARE`, [
        id,
      ])
    ).rows[0];
    if (
      !e ||
      e.state !== "collecting" ||
      !e.phase7_design ||
      new Date(e.collection_ends_at).getTime() <= Date.now()
    )
      throw new Error("CRO07_NOT_COLLECTING");
    const d = phase7DesignSchema.parse(e.phase7_design);
    if (d.stepId !== input.stepId) throw new Error("CRO07_STEP_MISMATCH");
    const facts = (
      await c.query(
        `SELECT c.id,c.business_id,c.record_class,c.archived_at,q.version,s.sequence_id FROM sequence_enrollments n JOIN contacts c ON c.id=n.contact_id JOIN sequence_steps s ON s.sequence_id=n.sequence_id JOIN follow_up_sequences q ON q.id=n.sequence_id WHERE n.id=$1 AND s.id=$2 FOR SHARE OF c,q,s`,
        [input.enrollmentId, input.stepId],
      )
    ).rows[0];
    if (
      !facts?.business_id ||
      facts.record_class !== "production" ||
      facts.archived_at ||
      facts.version !== d.sequenceVersion ||
      facts.sequence_id !== d.sequenceId
    )
      throw new Error("CRO07_BUSINESS_CONTENT_IDENTITY_REQUIRED");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `phase7-business:${facts.business_id}`,
    ]);
    const competing = (
      await c.query(
        `SELECT a.id FROM cro07_subject_assignments a JOIN cro07_experiments x ON x.id=a.experiment_id WHERE a.business_id=$1 AND a.experiment_id<>$2 AND x.state='collecting' LIMIT 1`,
        [facts.business_id, id],
      )
    ).rows[0];
    if (competing) throw new Error("CRO07_BUSINESS_ALREADY_ALLOCATED");
    const bucket =
      createHash("sha256")
        .update(`${id}:${e.design_hash}:${facts.business_id}`)
        .digest()
        .readUInt32BE(0) % 10000;
    const variant: AbVariant = bucket < 5000 ? "A" : "B";
    await c.query(
      `INSERT INTO cro07_subject_assignments(experiment_id,business_id,arm,design_hash) VALUES($1,$2,$3,$4) ON CONFLICT(experiment_id,business_id) DO NOTHING`,
      [id, facts.business_id, variant, e.design_hash],
    );
    const a = (
      await c.query(
        `SELECT * FROM cro07_subject_assignments WHERE experiment_id=$1 AND business_id=$2`,
        [id, facts.business_id],
      )
    ).rows[0];
    if (a.design_hash !== e.design_hash)
      throw new Error("AB_ASSIGNMENT_SNAPSHOT_REQUIRED");
    await c.query(
      `INSERT INTO sequence_step_ab_assignments(enrollment_id,sequence_step_id,config_hash,variant,eligibility_snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(enrollment_id,sequence_step_id) DO NOTHING`,
      [
        input.enrollmentId,
        input.stepId,
        e.design_hash,
        a.arm,
        JSON.stringify({
          recordClass: "production",
          contactId: facts.id,
          businessId: facts.business_id,
          experimentId: id,
          assignmentId: a.id,
        }),
      ],
    );
    const legacy = (
      await c.query(
        `SELECT config_hash,variant,eligibility_snapshot FROM sequence_step_ab_assignments WHERE enrollment_id=$1 AND sequence_step_id=$2`,
        [input.enrollmentId, input.stepId],
      )
    ).rows[0];
    if (
      legacy.config_hash !== e.design_hash ||
      legacy.variant !== a.arm ||
      legacy.eligibility_snapshot.assignmentId !== a.id
    )
      throw new Error("AB_ASSIGNMENT_SNAPSHOT_REQUIRED");
    await c.query("COMMIT");
    return a.arm;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
/** Rechecked immediately before each transport call. It grants no dispatch permission. */
export async function bindPhase7Dispatch(input: {
  enrollmentId: number;
  stepId: number;
  idempotencyKey: string;
  subject: string;
  body: string;
}) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const a = (
      await c.query(
        `SELECT a.*,e.state,e.design_hash AS current_hash,e.phase7_design,e.collection_ends_at FROM sequence_step_ab_assignments l
   JOIN cro07_subject_assignments a ON a.id=(l.eligibility_snapshot->>'assignmentId')::uuid JOIN cro07_experiments e ON e.id=a.experiment_id
   WHERE l.enrollment_id=$1 AND l.sequence_step_id=$2 FOR SHARE OF e`,
        [input.enrollmentId, input.stepId],
      )
    ).rows[0];
    if (
      !a ||
      a.state !== "collecting" ||
      a.design_hash !== a.current_hash ||
      new Date(a.collection_ends_at).getTime() <= Date.now()
    )
      throw new Error("CRO07_DISPATCH_AUTHORITY_REVOKED");
    const d = phase7DesignSchema.parse(a.phase7_design);
    await approvedArms(c, d);
    const facts = (
      await c.query(
        `SELECT c.first_name,c.last_name,c.company_name,c.email,s.body,s.config,q.sequence_family FROM sequence_enrollments n JOIN contacts c ON c.id=n.contact_id JOIN sequence_steps s ON s.id=$2 JOIN follow_up_sequences q ON q.id=s.sequence_id WHERE n.id=$1 FOR SHARE OF c,s,q`,
        [input.enrollmentId, input.stepId],
      )
    ).rows[0];
    const {
      sfpLaunchRenderContext,
      renderSfpLaunchSubject,
      renderSfpLaunchBodyHtml,
    } = await import("./sfp-launch-render");
    const ctx = sfpLaunchRenderContext({
      firstName: facts.first_name,
      lastName: facts.last_name,
      companyName: facts.company_name,
      email: facts.email,
    });
    if (
      !String(facts.sequence_family ?? "").startsWith("sfp-v2-cold-") ||
      facts.config?.format !== "plain_text"
    )
      throw new Error("CRO07_UNSUPPORTED_TRANSPORT_CONTENT");
    if (
      input.subject !==
        renderSfpLaunchSubject(d.arms[a.arm as AbVariant].subject, ctx) ||
      input.body !== renderSfpLaunchBodyHtml(facts.body, ctx)
    )
      throw new Error("CRO07_RENDERED_CONTENT_DRIFT");
    const log = (
      await c.query(
        `SELECT id,sequence_enrollment_id FROM outbound_send_log WHERE idempotency_key=$1 FOR SHARE`,
        [input.idempotencyKey],
      )
    ).rows[0];
    if (!log || log.sequence_enrollment_id !== input.enrollmentId)
      throw new Error("CRO07_FOREIGN_ATTEMPT");
    const renderedHash = experimentDigest({
      subject: input.subject,
      body: input.body,
    });
    await c.query(
      `INSERT INTO cro07_attempt_bindings(outbound_log_id,assignment_id,rendered_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [log.id, a.id, renderedHash],
    );
    const bound = (
      await c.query(
        `SELECT * FROM cro07_attempt_bindings WHERE outbound_log_id=$1`,
        [log.id],
      )
    ).rows[0];
    if (bound.assignment_id !== a.id || bound.rendered_hash !== renderedHash)
      throw new Error("CRO07_RENDERED_CONTENT_DRIFT");
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
/** Legacy log history is linked once; definitive exposure belongs to outbound receipts, not this compatibility link. */
export async function recordSequenceAbDelivery(input: {
  enrollmentId: number;
  stepId: number;
  deliveryLogId: number;
}): Promise<void> {
  await pool.query(
    `UPDATE sequence_step_ab_assignments SET delivery_log_id=$3 WHERE enrollment_id=$1 AND sequence_step_id=$2 AND delivery_log_id IS NULL`,
    [input.enrollmentId, input.stepId, input.deliveryLogId],
  );
}
/** Replayable, non-sending projection. A failed attempt cannot produce an exposure. */
export async function projectPhase7Exposures(queryable: { query: any } = pool) {
  return queryable.query(`INSERT INTO cro07_receipt_exposures(assignment_id,outbound_log_id,provider_message_id,rendered_hash,occurred_at)
  SELECT b.assignment_id,l.id,l.provider_message_id,f.envelope_hash,l.sent_at FROM cro07_attempt_bindings b JOIN cro07_attempt_envelopes f ON f.outbound_log_id=b.outbound_log_id JOIN outbound_send_log l ON l.id=b.outbound_log_id
  JOIN cro07_subject_assignments a ON a.id=b.assignment_id JOIN cro07_experiments e ON e.id=a.experiment_id
  WHERE l.status IN ('sent','delivered','bounced','complained') AND l.provider_message_id IS NOT NULL AND l.sent_at IS NOT NULL
   AND a.design_hash=e.design_hash AND l.sent_at<e.collection_ends_at AND NOT EXISTS(SELECT 1 FROM cro07_receipt_exposures prior WHERE prior.outbound_log_id=l.id) ORDER BY l.id LIMIT 1000 ON CONFLICT DO NOTHING`);
}

/** Exact final SMTP envelope, after footer/text/header composition; no dispatch permission is granted here. */
export async function bindPhase7FinalEnvelope(input: {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
  fromHeader:string;
  replyTo?: string;
  headers: Record<string, string>;
}) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const row = (
      await c.query(
        `SELECT b.*,l.to_address,l.subject,e.state,e.collection_ends_at,e.phase7_design,e.design_hash,a.design_hash AS assigned_hash FROM outbound_send_log l JOIN cro07_attempt_bindings b ON b.outbound_log_id=l.id JOIN cro07_subject_assignments a ON a.id=b.assignment_id JOIN cro07_experiments e ON e.id=a.experiment_id WHERE l.idempotency_key=$1 FOR SHARE OF e,l`,
        [input.idempotencyKey],
      )
    ).rows[0];
    if (
      !row ||
      row.state !== "collecting" ||
      row.design_hash !== row.assigned_hash ||
      new Date(row.collection_ends_at).getTime() <= Date.now()
    )
      throw new Error("CRO07_DISPATCH_AUTHORITY_REVOKED");
    const design=phase7DesignSchema.parse(row.phase7_design);
    if(experimentDigest(design.senderIdentity)!==experimentDigest(phase7SenderIdentity()))throw new Error("CRO07_SENDER_IDENTITY_DRIFT");
    await assertPhase7FeedbackReady(c,design.senderIdentity);
    await approvedArms(c, design);
    const { resolvePolicy } = await import("./sender-policy");
    const policy = resolvePolicy("cold_outreach");
    if (
      input.to !== row.to_address ||
      input.subject !== row.subject ||
      input.from !== policy.from ||
      input.fromHeader!==`"${design.senderIdentity!.displayName}" <${policy.from}>` ||
      input.replyTo !== policy.replyTo
    )
      throw new Error("CRO07_FINAL_ENVELOPE_MISMATCH");
    const hash = experimentDigest({
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text ?? "",
      from: input.from,
      fromHeader:input.fromHeader,
      replyTo: input.replyTo,
      headers: input.headers,
    });
    await c.query(
      `INSERT INTO cro07_attempt_envelopes(outbound_log_id,envelope_hash,sender_account,reply_account)VALUES($1,$2,$3,$4)ON CONFLICT DO NOTHING`,
      [row.outbound_log_id, hash, input.from, input.replyTo],
    );
    const prior = (
      await c.query(
        `SELECT envelope_hash FROM cro07_attempt_envelopes WHERE outbound_log_id=$1`,
        [row.outbound_log_id],
      )
    ).rows[0];
    if (prior.envelope_hash !== hash)
      throw new Error("CRO07_FINAL_ENVELOPE_DRIFT");
    await c.query("COMMIT");
    return hash;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
