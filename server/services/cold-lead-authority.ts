import { pool } from "../db";
import { contactScope, type RevenueUser } from "./revenue-read-authority";
import { syntheticQaIdentitySql } from "@shared/synthetic-qa-identity";
import { getPauseState } from "./outbound-pause-authority";

/** A sourced dormant-contact census is not a consent or revenue census. */
export function coldLeadPredicate(user: RevenueUser, values: unknown[], asOf: Date): string {
  const ownership = contactScope(user, "c", values);
  values.push(asOf);
  return `${ownership} AND c.record_class='production' AND NOT ${syntheticQaIdentitySql("c")}
    AND c.archived_at IS NULL AND COALESCE(c.do_not_contact, false)=false
    AND c.status IS DISTINCT FROM 'Won'
    AND (c.lead_source IS NOT NULL OR c.utm_source IS NOT NULL OR c.referral_source IS NOT NULL)
    AND COALESCE(c.last_contacted_at,c.created_at) < $${values.length}::timestamptz - INTERVAL '45 days'
    AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.contact_id=c.id AND d.archived_at IS NULL
      AND d.stage NOT IN ('Closed Lost','Nurture / Not Now'))`;
}

export type ColdActionOutcome = {
  contactId: number; state: "held" | "blocked" | "skipped";
  enrolled: false; method: "skipped"; reason: string;
};

/** This legacy bridge does not produce enrollment receipts. Never invoke it to
 * manufacture success: a local, audited hold is not enrollment or send permission.
 * Complete-set validation and final decisions share row locks; no tags/jobs/provider I/O.
 */
export async function requestColdReengagement(user: RevenueUser, ids: number[]) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const values: unknown[] = [ids];
    const scope = contactScope(user, "c", values);
    const rows = await client.query(`SELECT c.id,c.archived_at,c.record_class,c.do_not_contact,c.email_status,
      c.status,c.tags FROM contacts c WHERE c.id=ANY($1::int[]) AND ${scope} ORDER BY c.id FOR UPDATE`, values);
    if (rows.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return { denied: true as const };
    }
    // Collection authority can come from an owned deal, not just the locked
    // contact. Freeze existing relationships too, then use a fresh statement
    // to recheck the complete set after any relationship lock wait.
    await client.query(`SELECT d.id FROM deals d WHERE d.contact_id=ANY($1::int[])
      ORDER BY d.id FOR UPDATE`, [ids]);
    const authorized = await client.query(`SELECT c.id FROM contacts c
      WHERE c.id=ANY($1::int[]) AND ${scope}`, values);
    if (authorized.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      return { denied: true as const };
    }
    const asOf = new Date();
    const eligibilityValues: unknown[] = [ids];
    const eligible = await client.query(`SELECT c.id FROM contacts c WHERE c.id=ANY($1::int[])
      AND ${coldLeadPredicate(user, eligibilityValues, asOf)}`, eligibilityValues);
    const eligibleIds = new Set(eligible.rows.map(r => r.id));
    const pause = await getPauseState();
    const outcomes: ColdActionOutcome[] = rows.rows.map(row => ({
      contactId: row.id, enrolled: false, method: "skipped",
      state: !eligibleIds.has(row.id) || row.email_status !== "valid" ? "blocked" : "held",
      reason: !eligibleIds.has(row.id) ? "cold_audience_ineligible"
        : row.email_status !== "valid" ? "email_validation_required"
        : pause.state !== "unpaused" || pause.source !== "database" ? "outbound_paused_or_unavailable"
        : "no_receipt_backed_enrollment_authority",
    }));
    for (const outcome of outcomes) {
      await client.query(`INSERT INTO audit_logs(action,entity_type,entity_id,details)
        VALUES('re_engage_request_processed','contact',$1,$2::jsonb)`,
      [outcome.contactId, JSON.stringify(outcome)]);
    }
    await client.query("COMMIT");
    return { denied: false as const, processed: true, enrolled: 0, outcomes,
      skipped: outcomes.length, errors: 0, total: ids.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}