/**
 * Contact Deletion Service (#1784)
 *
 * Provides governed permanent deletion of test/demo/synthetic contacts.
 * All deletion decisions are explicit: no guessing, no cascade on protected data.
 *
 * FK Classification (derived from live information_schema at HEAD):
 *
 * PROTECTED — block deletion if ANY row exists for the contact:
 *   merchant_mids, merchant_applications, merchant_profiles, merchant_residuals,
 *   chargebacks, statement_proposals, statement_requests, statement_reviews,
 *   statement_upload_commands, consent_audit_logs, outbound_send_log,
 *   communication_events, outbound_messages, cr04_cohort_members,
 *   cr06_attribution_events, cr06_delivery_intents, cr06_feedback_receipts,
 *   cr06_prepared_enrollments, contact_merge_operations, contact_merge_redirects,
 *   contact_identity_observations, contact_business_link_decisions,
 *   cro03_batch_memberships, cro03b_projection_receipts, cro03b_recipe_items,
 *   cro03b_terminal_hook_requests, cro03b_finalization_receipts,
 *   cro03c_finalization_receipts, cro03c_initial_subjects, cro03c_projection_receipts,
 *   cro03c_terminal_hooks, cro03c_validation_authorizations,
 *   cro07_feedback_receipts, cro07_reply_work,
 *   commercial_relationship_reviews, inbound_requests, import_row_dispositions,
 *   contact_source_events, mid_daily_stats, merchant_mid_access_receipts,
 *   merchant_health_scores, rfis (contact_id), rate_review_requests, save_cases,
 *   ma_events, merchant_referrals (referred_contact_id), sdr_lead_state, prospects,
 *   email_logs (contact_id only — outbound evidence)
 *
 * PROTECTED VIA DEAL — block if contact has a deal with protected children:
 *   merchant_applications, merchant_mids, merchant_residuals, chargebacks,
 *   statement_*, underwriting_conditions, underwriting_decisions, rfis (deal_id)
 *
 * PENDING JOB — block if active sequence enrollment exists
 *
 * EXCLUSIVELY DISPOSABLE — deleted with the contact, in dependency order:
 *   ai_corrections, ai_decision_log (contact-level), calendar_events,
 *   call_logs, campaign_preview_members, co_branded_proposals (contact-level),
 *   contact_ai_cache, contact_business_link_candidates, contact_companies,
 *   contact_lead_scoring_jobs, contact_lifecycle_history, contact_nba,
 *   contact_provider_projections, commercial_relationship_candidates,
 *   cr04_channel_decisions, cr04_enrollment_intents, documents (contact-level),
 *   eligibility_snapshots, enrichment_runs, equipment_orders (contact-level),
 *   equipment_shipments (contact-level), ghl_activity_log (contact-level),
 *   health_alerts, inbox_items, lead_sources, live_chats, nba_recommendation_history,
 *   nps_responses, outbound_send_log (ONLY when all are known-safe; see note),
 *   promotional_enrollment_jobs, referrals, review_requests, sequence_enrollments
 *   (non-active), sync_conflicts, tasks, testimonial_submissions, tickets,
 *   validation_intents, deal-level FK children before deals.
 *
 * Kill line: record_class is never written here.
 */

import { pool } from "../db";

export interface DependencyBlock {
  contactId: number;
  reason: string;
  details: string;
}

export interface InventoryResult {
  eligible: number[];
  blocked: DependencyBlock[];
}

export interface DeleteBatchResult {
  deleted: number;
  failed: Array<{ contactId: number; error: string }>;
}

// ── Inventory ────────────────────────────────────────────────────────────────

/**
 * For each contactId, check all protected FK tables.
 * Returns which contacts are eligible (test/demo/synthetic, no protected rows)
 * and which are blocked (wrong class or any protected relationship).
 *
 * Does NOT enforce class — callers must pre-filter to eligible classes.
 * This function only checks for protected relationships.
 */
export async function inventoryDependencies(
  contactIds: number[]
): Promise<InventoryResult> {
  if (contactIds.length === 0) return { eligible: [], blocked: [] };

  const client = await pool.connect();
  try {
    // Single comprehensive query: for each contact, find first blocking reason.
    // Returns one row per blocked contact with reason + details.
    const result = await client.query<{ contact_id: number; reason: string; details: string }>(`
      WITH cids AS (SELECT unnest($1::int[]) AS cid),
      blocks AS (
        -- Protected: merchant MIDs (real financial accounts)
        SELECT c.cid, 'merchant_mid' AS reason, 'Contact has real MID(s) linked' AS details
        FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_mids mm WHERE mm.contact_id = c.cid)
        UNION ALL
        -- Protected: merchant applications (processor applications)
        SELECT c.cid, 'merchant_application', 'Contact has a processor application'
        FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_applications ma WHERE ma.contact_id = c.cid)
        UNION ALL
        -- Protected: merchant profiles
        SELECT c.cid, 'merchant_profile', 'Contact has a merchant profile'
        FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_profiles mp WHERE mp.contact_id = c.cid)
        UNION ALL
        -- Protected: residuals (financial records)
        SELECT c.cid, 'merchant_residual', 'Contact has residual/financial records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_residuals mr WHERE mr.contact_id = c.cid)
        UNION ALL
        -- Protected: chargebacks
        SELECT c.cid, 'chargeback', 'Contact has chargeback records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM chargebacks cb WHERE cb.contact_id = c.cid)
        UNION ALL
        -- Protected: statement records (financial)
        SELECT c.cid, 'statement_record', 'Contact has statement proposals, requests, or reviews'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM statement_proposals sp WHERE sp.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM statement_requests sr WHERE sr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM statement_reviews sv WHERE sv.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM statement_upload_commands suc WHERE suc.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: consent audit logs (must survive per policy)
        SELECT c.cid, 'consent_audit_log', 'Contact has consent/suppression history that must be preserved'
        FROM cids c WHERE EXISTS (SELECT 1 FROM consent_audit_logs cal WHERE cal.contact_id = c.cid)
        UNION ALL
        -- Protected: outbound send evidence
        SELECT c.cid, 'outbound_evidence', 'Contact has outbound send log or outbound messages'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM outbound_send_log osl WHERE osl.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM outbound_messages om WHERE om.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM email_logs el WHERE el.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: communication events (outbound evidence)
        SELECT c.cid, 'communication_events', 'Contact has communication event records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM communication_events ce WHERE ce.contact_id = c.cid)
        UNION ALL
        -- Protected: outbound cohort membership
        SELECT c.cid, 'outbound_cohort', 'Contact is in an outbound cohort (cr04)'
        FROM cids c WHERE EXISTS (SELECT 1 FROM cr04_cohort_members cm WHERE cm.contact_id = c.cid)
        UNION ALL
        -- Protected: cr06 delivery attribution evidence
        SELECT c.cid, 'delivery_attribution', 'Contact has cr06 delivery attribution records'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM cr06_attribution_events ae WHERE ae.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cr06_delivery_intents di WHERE di.recipient_contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cr06_feedback_receipts fr WHERE fr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cr06_prepared_enrollments pe WHERE pe.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: identity merge history
        SELECT c.cid, 'merge_history', 'Contact has identity merge records'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM contact_merge_operations cmo WHERE cmo.survivor_contact_id = c.cid OR cmo.deprecated_contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM contact_merge_redirects cmr WHERE cmr.survivor_contact_id = c.cid OR cmr.deprecated_contact_id = c.cid)
        )
        UNION ALL
        -- Protected: identity observations
        SELECT c.cid, 'identity_observations', 'Contact has identity observation records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM contact_identity_observations cio WHERE cio.contact_id = c.cid)
        UNION ALL
        -- Protected: business link decisions
        SELECT c.cid, 'business_link_decision', 'Contact has business link decisions'
        FROM cids c WHERE EXISTS (SELECT 1 FROM contact_business_link_decisions cbd WHERE cbd.contact_id = c.cid)
        UNION ALL
        -- Protected: payment processor (cro03) batch membership + all CRO03B/CRO03C receipts
        SELECT c.cid, 'processor_batch', 'Contact is in a payment processor batch (cro03/cro03b/cro03c)'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM cro03_batch_memberships bm WHERE bm.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03b_projection_receipts pr WHERE pr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03b_recipe_items ri WHERE ri.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03b_terminal_hook_requests thr WHERE thr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03b_finalization_receipts bfr WHERE bfr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03c_finalization_receipts cfr WHERE cfr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03c_initial_subjects cis WHERE cis.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03c_projection_receipts cpr WHERE cpr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03c_terminal_hooks cth WHERE cth.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro03c_validation_authorizations cva WHERE cva.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: CRO07 delivery feedback / reply work
        SELECT c.cid, 'cro07_delivery', 'Contact has CRO07 delivery or reply records'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM cro07_feedback_receipts cfr WHERE cfr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM cro07_reply_work crw WHERE crw.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: commercial relationship reviews
        SELECT c.cid, 'commercial_relationship_review', 'Contact has commercial relationship reviews'
        FROM cids c WHERE EXISTS (SELECT 1 FROM commercial_relationship_reviews crr WHERE crr.contact_id = c.cid)
        UNION ALL
        -- Protected: inbound requests
        SELECT c.cid, 'inbound_request', 'Contact has inbound request history'
        FROM cids c WHERE EXISTS (SELECT 1 FROM inbound_requests ir WHERE ir.contact_id = c.cid)
        UNION ALL
        -- Protected: provenance (import + source events)
        SELECT c.cid, 'provenance', 'Contact has import provenance records'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM import_row_dispositions ird WHERE ird.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM contact_source_events cse WHERE cse.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: financial stats
        SELECT c.cid, 'financial_stats', 'Contact has MID daily stats records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM mid_daily_stats mds WHERE mds.contact_id = c.cid)
        UNION ALL
        -- Protected: access receipts and health scores
        SELECT c.cid, 'merchant_access_health', 'Contact has merchant health or MID access records'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM merchant_mid_access_receipts mar WHERE mar.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM merchant_health_scores mhs WHERE mhs.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: rate reviews and RFIs
        SELECT c.cid, 'financial_request', 'Contact has rate review requests or RFIs'
        FROM cids c WHERE (
          EXISTS (SELECT 1 FROM rate_review_requests rrr WHERE rrr.contact_id = c.cid)
          OR EXISTS (SELECT 1 FROM rfis r WHERE r.contact_id = c.cid)
        )
        UNION ALL
        -- Protected: save cases
        SELECT c.cid, 'save_case', 'Contact has open save case records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM save_cases sc WHERE sc.contact_id = c.cid)
        UNION ALL
        -- Protected: multi-attribution events
        SELECT c.cid, 'attribution', 'Contact has multi-attribution event records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM ma_events mae WHERE mae.counterparty_contact_id = c.cid)
        UNION ALL
        -- Protected: referrals where this contact was referred
        SELECT c.cid, 'merchant_referral', 'Contact appears in merchant referral records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_referrals mr WHERE mr.referred_contact_id = c.cid)
        UNION ALL
        -- Protected: SDR lead state (shared with outbound SDR system)
        SELECT c.cid, 'sdr_lead_state', 'Contact has SDR lead state records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM sdr_lead_state sls WHERE sls.contact_id = c.cid)
        UNION ALL
        -- Protected: prospects (linked to real boarding pipeline)
        SELECT c.cid, 'prospect', 'Contact has prospect records'
        FROM cids c WHERE EXISTS (SELECT 1 FROM prospects p WHERE p.contact_id = c.cid)
        UNION ALL
        -- Protected via deal: deals with protected child tables
        SELECT c.cid, 'protected_deal_dependency', 'Contact has a deal linked to real financial records (MID, application, residual, chargeback, or statement)'
        FROM cids c WHERE EXISTS (
          SELECT 1 FROM deals d WHERE d.contact_id = c.cid AND (
            EXISTS (SELECT 1 FROM merchant_applications ma WHERE ma.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM merchant_mids mm WHERE mm.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM merchant_residuals mr WHERE mr.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM chargebacks cb WHERE cb.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM statement_proposals sp WHERE sp.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM statement_requests sr WHERE sr.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM statement_reviews sv WHERE sv.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM statement_upload_commands suc WHERE suc.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM underwriting_conditions uc WHERE uc.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM underwriting_decisions ud WHERE ud.deal_id = d.id)
            OR EXISTS (SELECT 1 FROM rfis r WHERE r.deal_id = d.id)
          )
        )
      ),
      -- Pending job: active sequence enrollment (BullMQ writeback risk)
      pending_jobs AS (
        SELECT c.cid, 'pending_job' AS reason, 'Contact has an active sequence enrollment that may writeback' AS details
        FROM cids c WHERE EXISTS (
          SELECT 1 FROM sequence_enrollments se
          WHERE se.contact_id = c.cid AND se.status IN ('active', 'pending')
        )
      ),
      all_blocks AS (
        SELECT * FROM blocks
        UNION ALL
        SELECT * FROM pending_jobs
      ),
      -- Take only the first blocking reason per contact
      first_block AS (
        SELECT DISTINCT ON (cid) cid AS contact_id, reason, details
        FROM all_blocks
        ORDER BY cid, reason
      )
      SELECT * FROM first_block
    `, [contactIds]);

    const blockedSet = new Set<number>();
    const blocked: DependencyBlock[] = result.rows.map((row) => {
      blockedSet.add(row.contact_id);
      return { contactId: row.contact_id, reason: row.reason, details: row.details };
    });

    const eligible = contactIds.filter((id) => !blockedSet.has(id));
    return { eligible, blocked };
  } finally {
    client.release();
  }
}

// ── Pending-job coordination ──────────────────────────────────────────────────

/**
 * Check for active/pending sequence enrollments that could writeback
 * to a contact after deletion. Returns contacts safe to delete and those blocked.
 *
 * Already covered by inventoryDependencies, exposed separately for the preview endpoint.
 */
export async function coordinatePendingJobs(
  contactIds: number[]
): Promise<{ safe: number[]; blocked: DependencyBlock[] }> {
  if (contactIds.length === 0) return { safe: [], blocked: [] };

  const client = await pool.connect();
  try {
    const result = await client.query<{ contact_id: number }>(
      `SELECT DISTINCT contact_id FROM sequence_enrollments
       WHERE contact_id = ANY($1::int[]) AND status IN ('active', 'pending')`,
      [contactIds]
    );
    const blockedIds = new Set(result.rows.map((r) => r.contact_id));
    const blocked: DependencyBlock[] = result.rows.map((r) => ({
      contactId: r.contact_id,
      reason: "pending_job",
      details: "Contact has an active sequence enrollment that may writeback after deletion",
    }));
    const safe = contactIds.filter((id) => !blockedIds.has(id));
    return { safe, blocked };
  } finally {
    client.release();
  }
}

// ── Cascade delete ────────────────────────────────────────────────────────────

/**
 * Delete a batch of contacts (≤100) and all exclusively disposable FK children.
 * Runs in a single transaction with SELECT ... FOR UPDATE.
 *
 * After locking, re-runs full dependency validation inside the transaction
 * to catch any protected rows created after the pre-transaction inventory.
 * Any contact that fails re-validation is moved to the failed list rather
 * than rolling back the entire batch.
 *
 * Kill line: record_class is never written here.
 */
export async function executeDeleteBatch(
  eligibleIds: number[],
  operationId: string
): Promise<DeleteBatchResult> {
  if (eligibleIds.length === 0) return { deleted: 0, failed: [] };
  if (eligibleIds.length > 100) throw new Error("executeDeleteBatch: batch size must be ≤100");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the contact rows to prevent concurrent writes during deletion
    const lockResult = await client.query<{ id: number; record_class: string }>(
      `SELECT id, record_class FROM contacts WHERE id = ANY($1::int[]) FOR UPDATE`,
      [eligibleIds]
    );

    const failed: Array<{ contactId: number; error: string }> = [];

    // Re-validate class inside the transaction (class may have been changed since preview)
    const classOk: number[] = [];
    for (const row of lockResult.rows) {
      if (!["test", "demo", "synthetic"].includes(row.record_class)) {
        failed.push({ contactId: row.id, error: `class_changed:${row.record_class}` });
      } else {
        classOk.push(row.id);
      }
    }

    // Re-run full dependency inventory inside the transaction for all class-ok contacts.
    // This catches protected rows created AFTER the pre-transaction snapshot.
    let stillEligible: number[] = classOk;
    if (classOk.length > 0) {
      // Inline dependency re-check (same logic as inventoryDependencies, runs within locked tx)
      const recheck = await client.query<{ contact_id: number; reason: string }>(`
        WITH cids AS (SELECT unnest($1::int[]) AS cid),
        blocks AS (
          SELECT c.cid, 'merchant_mid' AS reason FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_mids WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'merchant_application' FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_applications WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'merchant_profile' FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_profiles WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'merchant_residual' FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_residuals WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'chargeback' FROM cids c WHERE EXISTS (SELECT 1 FROM chargebacks WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'statement_record' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM statement_proposals WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM statement_requests WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM statement_reviews WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM statement_upload_commands WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'consent_audit_log' FROM cids c WHERE EXISTS (SELECT 1 FROM consent_audit_logs WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'outbound_evidence' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM outbound_send_log WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM outbound_messages WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM email_logs WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'communication_events' FROM cids c WHERE EXISTS (SELECT 1 FROM communication_events WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'outbound_cohort' FROM cids c WHERE EXISTS (SELECT 1 FROM cr04_cohort_members WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'delivery_attribution' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM cr06_attribution_events WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cr06_delivery_intents WHERE recipient_contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cr06_feedback_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cr06_prepared_enrollments WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'merge_history' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM contact_merge_operations WHERE survivor_contact_id = c.cid OR deprecated_contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM contact_merge_redirects WHERE survivor_contact_id = c.cid OR deprecated_contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'identity_observations' FROM cids c WHERE EXISTS (SELECT 1 FROM contact_identity_observations WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'business_link_decision' FROM cids c WHERE EXISTS (SELECT 1 FROM contact_business_link_decisions WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'processor_batch' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM cro03_batch_memberships WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03b_projection_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03b_recipe_items WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03b_terminal_hook_requests WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03b_finalization_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03c_finalization_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03c_initial_subjects WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03c_projection_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03c_terminal_hooks WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro03c_validation_authorizations WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'cro07_delivery' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM cro07_feedback_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM cro07_reply_work WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'commercial_relationship_review' FROM cids c WHERE EXISTS (SELECT 1 FROM commercial_relationship_reviews WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'inbound_request' FROM cids c WHERE EXISTS (SELECT 1 FROM inbound_requests WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'provenance' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM import_row_dispositions WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM contact_source_events WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'financial_stats' FROM cids c WHERE EXISTS (SELECT 1 FROM mid_daily_stats WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'merchant_access_health' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM merchant_mid_access_receipts WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM merchant_health_scores WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'financial_request' FROM cids c WHERE (
            EXISTS (SELECT 1 FROM rate_review_requests WHERE contact_id = c.cid)
            OR EXISTS (SELECT 1 FROM rfis WHERE contact_id = c.cid)
          )
          UNION ALL SELECT c.cid, 'save_case' FROM cids c WHERE EXISTS (SELECT 1 FROM save_cases WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'attribution' FROM cids c WHERE EXISTS (SELECT 1 FROM ma_events WHERE counterparty_contact_id = c.cid)
          UNION ALL SELECT c.cid, 'merchant_referral' FROM cids c WHERE EXISTS (SELECT 1 FROM merchant_referrals WHERE referred_contact_id = c.cid)
          UNION ALL SELECT c.cid, 'sdr_lead_state' FROM cids c WHERE EXISTS (SELECT 1 FROM sdr_lead_state WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'prospect' FROM cids c WHERE EXISTS (SELECT 1 FROM prospects WHERE contact_id = c.cid)
          UNION ALL SELECT c.cid, 'pending_job' FROM cids c WHERE EXISTS (
            SELECT 1 FROM sequence_enrollments WHERE contact_id = c.cid AND status IN ('active', 'pending')
          )
          UNION ALL SELECT c.cid, 'protected_deal_dependency' FROM cids c WHERE EXISTS (
            SELECT 1 FROM deals d WHERE d.contact_id = c.cid AND (
              EXISTS (SELECT 1 FROM merchant_applications WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM merchant_mids WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM merchant_residuals WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM chargebacks WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM statement_proposals WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM statement_requests WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM statement_reviews WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM statement_upload_commands WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM underwriting_conditions WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM underwriting_decisions WHERE deal_id = d.id)
              OR EXISTS (SELECT 1 FROM rfis WHERE deal_id = d.id)
            )
          )
        ),
        first_block AS (
          SELECT DISTINCT ON (cid) cid AS contact_id, reason
          FROM blocks ORDER BY cid, reason
        )
        SELECT * FROM first_block
      `, [classOk]);

      const recheckBlocked = new Set<number>();
      for (const row of recheck.rows) {
        recheckBlocked.add(row.contact_id);
        failed.push({ contactId: row.contact_id, error: `recheck_blocked:${row.reason}` });
      }
      stillEligible = classOk.filter((id) => !recheckBlocked.has(id));
    }

    if (stillEligible.length > 0) {
      // ── Step 1: Delete disposable deal FK children, then deals ──────────
      const dealResult = await client.query<{ id: number }>(
        `SELECT d.id FROM deals d
         WHERE d.contact_id = ANY($1::int[])
           AND NOT EXISTS (SELECT 1 FROM merchant_applications WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM merchant_mids WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM merchant_residuals WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM chargebacks WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM statement_proposals WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM statement_requests WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM statement_reviews WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM statement_upload_commands WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM underwriting_conditions WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM underwriting_decisions WHERE deal_id = d.id)
           AND NOT EXISTS (SELECT 1 FROM rfis WHERE deal_id = d.id)`,
        [stillEligible]
      );
      const disposableDealIds = dealResult.rows.map((r) => r.id);

      if (disposableDealIds.length > 0) {
        // Delete deal-level FK children (disposable ones only)
        await client.query(`DELETE FROM agent_merchants WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM ai_decision_log WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM calendar_events WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM call_logs WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM co_branded_proposals WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM deal_boarding_outbox WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM deal_competitors WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM deal_stage_effect_intents WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM documents WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM eligibility_snapshots WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM email_logs WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM enrichment_runs WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM equipment_orders WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM equipment_shipments WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM ghl_activity_log WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM health_alerts WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM inbox_items WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM merchant_onboarding_stages WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM onboarding_checklist_items WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM onboarding_steps WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM residual_import_rows WHERE matched_deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM review_requests WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM save_cases WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM sequence_enrollments WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM tasks WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM testimonial_submissions WHERE deal_id = ANY($1::int[])`, [disposableDealIds]);
        // Self-referential: child deals first
        await client.query(`UPDATE deals SET sales_deal_id = NULL WHERE sales_deal_id = ANY($1::int[])`, [disposableDealIds]);
        await client.query(`DELETE FROM deals WHERE id = ANY($1::int[])`, [disposableDealIds]);
      }

      // ── Step 2: Delete contact-level FK children (disposable) ────────────
      const ids = stillEligible;

      // Null out conversion_contact_id references in prospects (not blocked, just a soft ref)
      await client.query(`UPDATE prospects SET conversion_contact_id = NULL WHERE conversion_contact_id = ANY($1::int[])`, [ids]);

      // Disposable contact-level children
      await client.query(`DELETE FROM ai_corrections WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM ai_decision_log WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM campaign_preview_members WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM co_branded_proposals WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_ai_cache WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_business_link_candidates WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_companies WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_lead_scoring_jobs WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_lifecycle_history WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_nba WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM contact_provider_projections WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM commercial_relationship_candidates WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM cr04_channel_decisions WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM cr04_enrollment_intents WHERE contact_id = ANY($1::int[])`, [ids]);
      // documents directly linked to contact (no deal_id) — safe to delete for test/demo/synthetic
      await client.query(`DELETE FROM documents WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM eligibility_snapshots WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM enrichment_runs WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM equipment_orders WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM equipment_shipments WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM ghl_activity_log WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM health_alerts WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM inbox_items WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM lead_sources WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM live_chats WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM nba_recommendation_history WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM nps_responses WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM promotional_enrollment_jobs WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM referrals WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM review_requests WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM sync_conflicts WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM tasks WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM testimonial_submissions WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM tickets WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM validation_intents WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM calendar_events WHERE contact_id = ANY($1::int[])`, [ids]);
      await client.query(`DELETE FROM call_logs WHERE contact_id = ANY($1::int[])`, [ids]);
      // Sequence enrollments: non-active only (active ones are already blocked by inventory)
      await client.query(
        `DELETE FROM sequence_enrollments WHERE contact_id = ANY($1::int[]) AND status NOT IN ('active', 'pending')`,
        [ids]
      );
      // Self-referential: NULL out parent_contact_id for any children
      await client.query(`UPDATE contacts SET parent_contact_id = NULL WHERE parent_contact_id = ANY($1::int[])`, [ids]);

      // ── Step 3: Delete the contacts themselves ───────────────────────────
      await client.query(`DELETE FROM contacts WHERE id = ANY($1::int[])`, [ids]);
    }

    // Update operation progress
    await client.query(
      `UPDATE bulk_delete_operations
       SET updated_at = now(),
           result_json = COALESCE(result_json, '{}'::jsonb) || $2::jsonb
       WHERE id = $1::uuid`,
      [operationId, JSON.stringify({ lastBatchDeleted: stillEligible.length, lastBatchFailed: failed.length })]
    );

    await client.query("COMMIT");
    return { deleted: stillEligible.length, failed };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
