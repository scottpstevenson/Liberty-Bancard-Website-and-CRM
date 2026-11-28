import { sql } from "drizzle-orm";
import { pool } from "../db";
import { prepareCanonicalRecipient } from "./canonical-recipient-preparation";
import { getPauseState } from "./outbound-pause-authority";
import { readHeldRecipientForReview } from "./sfp-launch-inventory";
import { readReleaseReviewMessage, readReleaseReviewRecipients } from "./sfp-release-review";

export class HeldRefreshRequiresPause extends Error {}

interface HeldMembership {
  intent_id: string;
  contact_id: number;
  sequence_id: number;
  program_id: string;
  email_hash: string;
  current_package: boolean;
}

/** Refresh an existing preparation in place and read back the same enrollment's current email. */
export async function refreshHeldSfpRecipient(enrollmentId: number, actorId: string) {
  const pause = await getPauseState();
  if (pause.source !== "database" || pause.state !== "paused") throw new HeldRefreshRequiresPause();
  const empty = (reason: string, refreshed = false) => ({
    enrollmentId, refreshed, reviewRecipient: null, subject: null, reason,
  });
  const { rows: [target] } = await pool.query<HeldMembership>(`
    SELECT i.id::text AS intent_id,i.contact_id,i.sequence_id,i.program_id::text,i.normalized_email_hash AS email_hash,
      (pkg.id::text=i.preparation_snapshot->>'packageVersionId'
        AND pkg.content_hash=i.preparation_snapshot->>'contentHash') IS TRUE AS current_package
    FROM sequence_enrollments e
    JOIN cr04_enrollment_intents i ON i.enrollment_id=e.id AND i.contact_id=e.contact_id AND i.sequence_id=e.sequence_id
      AND e.metadata->>'canonicalPreparationId'=i.id::text
    JOIN sfp_campaign_package_versions pkg ON pkg.sequence_id=e.sequence_id AND pkg.lifecycle_state='current'
    WHERE e.id=$1 AND e.status='paused' AND e.current_step=0 AND e.next_action_at IS NULL
      AND NOT (COALESCE(e.metadata,'{}'::jsonb) ? 'canonicalRelease')
      AND i.preparation_state='ready_held' AND i.program_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM outbound_send_log l WHERE l.sequence_enrollment_id=e.id)
  `, [enrollmentId]);
  if (!target) return empty("Enrollment is missing, already started or lacks an owned held SFP preparation.");

  if (!target.current_package) {
    const result = await prepareCanonicalRecipient({
      contactId: target.contact_id, sequenceId: target.sequence_id, programId: target.program_id,
      actor: { role: "admin", actorId, email: null }, source: "operator_held_package_refresh",
      refreshHeld: { enrollmentId, intentId: target.intent_id, emailHash: target.email_hash },
      beforeWrite: async tx => {
        const locked = await tx.execute(sql`SELECT state FROM outbound_pause_control ORDER BY id LIMIT 1 FOR SHARE`);
        if (locked.rows[0]?.state !== "paused") throw new HeldRefreshRequiresPause();
      },
    });
    if (result.enrollmentId !== enrollmentId) return empty(result.reasonCode);
  }

  const refreshed = !target.current_package;
  // A preview failure after a committed refresh must remain distinguishable from a failure to refresh.
  try {
    const { recipient, reason } = await readHeldRecipientForReview(target.intent_id, enrollmentId);
    if (!recipient) return empty(reason ?? "Current binding is unavailable.", refreshed);
    const [reviewRecipient] = await readReleaseReviewRecipients([recipient]);
    const preview = await readReleaseReviewMessage({ ...reviewRecipient, copy: "current" });
    if (!preview.final) return empty(preview.error?.detail ?? "Published email could not be rendered.", refreshed);
    return { enrollmentId, refreshed, reviewRecipient, subject: preview.final.subject, reason: null };
  } catch {
    return empty("Could not verify the current email. Retry this enrollment to read it again.", refreshed);
  }
}
