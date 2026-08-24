/**
 * Single source of truth for the Ready-for-Outreach read predicate. It deliberately
 * does not call contactability: queue membership and per-channel send permission
 * are different operator concepts.
 */
export function readyForOutreachPredicate(options: { alias?: string; ownerEmail?: string } = {}) {
  const alias = options.alias ? `${options.alias}.` : "";
  const params: unknown[] = [];
  const conditions = [
    `${alias}archived_at IS NULL`,
    `(${alias}phone IS NOT NULL AND TRIM(${alias}phone) <> '' OR (${alias}email IS NOT NULL AND TRIM(${alias}email) <> '' AND COALESCE(${alias}email_status,'unvalidated') NOT IN ('bounced','invalid','opted_out','unsafe','unvalidated')))`,
    `(${alias}do_not_contact IS NULL OR ${alias}do_not_contact = FALSE)`,
    `${alias}outreach_queue_skipped_at IS NULL`,
    `NOT EXISTS (SELECT 1 FROM sequence_enrollments se WHERE se.contact_id = ${alias}id AND se.status IN ('active','paused'))`,
  ];
  if (options.ownerEmail) {
    params.push(options.ownerEmail);
    conditions.push(`${alias}assigned_to = $${params.length}`);
  }
  return { where: conditions.join(" AND "), params };
}