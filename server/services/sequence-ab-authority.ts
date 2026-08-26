import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";

export type AbVariant = "A" | "B";

/**
 * Freezes a sequence experiment assignment before content is selected.  Legacy
 * enrollments without an approved assignment are held instead of being
 * re-derived from mutable contact data.
 */
export async function getOrCreateSequenceAbAssignment(input: {
  enrollmentId: number; stepId: number; splitRatio: number;
  config: unknown; eligibilitySnapshot: Record<string, unknown>;
}): Promise<AbVariant> {
  const configHash = crypto.createHash("sha256").update(JSON.stringify(input.config)).digest("hex");
  // Deterministic bucketing avoids random reassignment after a retry while the
  // unique key prevents a concurrent worker from creating variant B as well.
  const hash = crypto.createHash("sha256").update(`${input.enrollmentId}:${input.stepId}:${configHash}`).digest();
  const bucket = hash.readUInt32BE(0) % 10000;
  const variant: AbVariant = bucket < Math.round(Math.max(0, Math.min(100, input.splitRatio)) * 100) ? "A" : "B";
  const result = await db.execute(sql`
    INSERT INTO sequence_step_ab_assignments
      (enrollment_id, sequence_step_id, config_hash, variant, eligibility_snapshot)
    VALUES (${input.enrollmentId}, ${input.stepId}, ${configHash}, ${variant},
      ${JSON.stringify(input.eligibilitySnapshot)}::jsonb)
    ON CONFLICT (enrollment_id, sequence_step_id) DO NOTHING
    RETURNING variant
  `);
  const created = (result.rows ?? result)[0] as { variant?: AbVariant } | undefined;
  if (created?.variant) return created.variant;
  const existing = await db.execute(sql`
    SELECT variant, config_hash FROM sequence_step_ab_assignments
    WHERE enrollment_id=${input.enrollmentId} AND sequence_step_id=${input.stepId}
    LIMIT 1
  `);
  const row = (existing.rows ?? existing)[0] as { variant?: AbVariant; config_hash?: string } | undefined;
  if (!row?.variant || row.config_hash !== configHash) {
    throw new Error("AB_ASSIGNMENT_SNAPSHOT_REQUIRED");
  }
  return row.variant;
}

/** The delivery log is linked once and never repointed, freezing the exposure
 * that an evaluator may count for the approved cohort. */
export async function recordSequenceAbDelivery(input: {
  enrollmentId: number; stepId: number; deliveryLogId: number;
}): Promise<void> {
  await db.execute(sql`
    UPDATE sequence_step_ab_assignments
    SET delivery_log_id=${input.deliveryLogId}
    WHERE enrollment_id=${input.enrollmentId} AND sequence_step_id=${input.stepId}
      AND delivery_log_id IS NULL
  `);
}