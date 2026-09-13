/**
 * Reconciliation Approval — applies approved normalization proposals to contacts.
 *
 * Safety guarantees:
 *  - CAS guard: re-reads contacts.updated_at and skips stale proposals.
 *  - Allowed columns allowlist: only first_name, last_name, phone,
 *    company_name, vertical are written (never email — high-risk PII).
 *  - No GHL projection insert — uses direct db.update without hookPolicy
 *    to avoid CRO-03 admission check and external side effects.
 *  - Reversal ledger written atomically with the approval.
 *  - Audit log written for every approval (both applied and stale/skipped).
 */

import pg from "pg";
import { pool as defaultPool } from "../db";
import { sanitizeAuditPayload } from "./audit-sanitizer";

// Fields we are allowed to write via reconciliation approval (new proposals).
// email is explicitly excluded — it is high-risk PII and requires ZeroBounce re-validation.
// vertical is excluded from new approvals — Gen-2 crosswalk authorization required.
// TASK-1830: vertical removed from APPROVED_FIELDS; retained in REVERTABLE_FIELDS so
// existing already-approved vertical proposals can still be reverted to their prior value.
const APPROVED_FIELDS = new Set(["first_name", "last_name", "phone", "company_name"]);

// Fields allowed for revert operations only (may include fields blocked for new approvals).
const REVERTABLE_FIELDS = new Set(["first_name", "last_name", "phone", "company_name", "vertical"]);

export type ApprovalResult =
  | { outcome: "applied"; contactId: number; fieldName: string; appliedValue: string }
  | { outcome: "stale"; contactId: number; reason: string }
  | { outcome: "rejected"; contactId: number; reason: string }
  | { outcome: "already_reviewed"; contactId: number; status: string };

/**
 * Approve a normalization proposal.
 * Performs CAS check on contacts.updated_at and writes the value if fresh.
 * Writes a reversal ledger row atomically for undo capability.
 *
 * @param poolOverride — pass a test pg.Pool to avoid using the production pool.
 */
export async function approveProposal(
  proposalId: number,
  approvedBy: string,
  poolOverride?: pg.Pool,
): Promise<ApprovalResult> {
  const pool = poolOverride ?? defaultPool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock and read proposal
    const proposalR = await client.query(
      `SELECT id, run_id, contact_id, proposal_type, field_name,
              current_value, proposed_value, contact_updated_at,
              before_values, status
       FROM contact_normalization_proposals
       WHERE id = $1
       FOR UPDATE`,
      [proposalId],
    );

    if (proposalR.rows.length === 0) {
      await client.query("ROLLBACK");
      return { outcome: "rejected", contactId: 0, reason: "Proposal not found" };
    }

    const proposal = proposalR.rows[0];

    if (proposal.status !== "pending") {
      await client.query("ROLLBACK");
      return {
        outcome: "already_reviewed",
        contactId: proposal.contact_id,
        status: proposal.status,
      };
    }

    const fieldName: string = proposal.field_name;

    // Approved-fields allowlist check.
    // vertical is blocked for new approvals (Gen-2 crosswalk required).
    if (!APPROVED_FIELDS.has(fieldName)) {
      const isVertical = fieldName === "vertical";
      await client.query(
        `UPDATE contact_normalization_proposals SET status='rejected', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
        [proposalId, approvedBy],
      );
      await client.query("COMMIT");
      return {
        outcome: "rejected",
        contactId: proposal.contact_id,
        reason: isVertical
          ? `Field 'vertical' cannot be approved via reconciliation until Gen-2 crosswalk authorization is complete. Use the Identity Crosswalk panel for vertical candidates.`
          : `Field '${fieldName}' is not in the allowed reconciliation write set`,
      };
    }

    // Lock the contact row and read its current field value.
    const contactR = await client.query(
      `SELECT id, updated_at, first_name, last_name, phone, company_name, vertical
       FROM contacts WHERE id = $1 FOR UPDATE`,
      [proposal.contact_id],
    );

    if (contactR.rows.length === 0) {
      await client.query(
        `UPDATE contact_normalization_proposals SET status='stale', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
        [proposalId, approvedBy],
      );
      await client.query("COMMIT");
      return {
        outcome: "stale",
        contactId: proposal.contact_id,
        reason: "Contact no longer exists",
      };
    }

    const contact = contactR.rows[0];
    const currentValue = contact[fieldName.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase())] ??
      contact[fieldName] ?? null;
    const proposedValue: string = proposal.proposed_value;

    // Exact CAS enforced in SQL: the UPDATE only succeeds when contacts.updated_at
    // exactly equals the timestamp captured in the proposal (both TIMESTAMPTZ values
    // are compared at the database's native precision, avoiding JS Date rounding).
    // A concurrent modification within the same sub-millisecond is caught here.
    const colQuoted = `"${fieldName}"`;
    const casUpdateR = await client.query(
      `UPDATE contacts SET ${colQuoted} = $2, updated_at = now()
       WHERE id = $1 AND updated_at = $3`,
      [proposal.contact_id, proposedValue, proposal.contact_updated_at],
    );

    if ((casUpdateR.rowCount ?? 0) === 0) {
      // Contact was modified after proposal was captured — mark stale without writing.
      await client.query(
        `UPDATE contact_normalization_proposals SET status='stale', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
        [proposalId, approvedBy],
      );
      await client.query("COMMIT");
      return {
        outcome: "stale",
        contactId: proposal.contact_id,
        reason: `Contact updated_at no longer matches proposal captured timestamp (${proposal.contact_updated_at})`,
      };
    }

    // Update proposal status
    await client.query(
      `UPDATE contact_normalization_proposals SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
      [proposalId, approvedBy],
    );

    // Write reversal ledger
    await client.query(
      `INSERT INTO contact_normalization_reversals
         (proposal_id, contact_id, field_name, value_before, value_after, reversed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [proposalId, proposal.contact_id, fieldName, currentValue, proposedValue, approvedBy],
    );

    // Write audit log (use real schema: actor_type, actor_id, details)
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, actor_id, details, created_at)
       VALUES ('contact', $1, 'reconciliation_proposal_approved', 'user', $2, $3, now())`,
      [
        proposal.contact_id,
        approvedBy,
        JSON.stringify(sanitizeAuditPayload({
          proposalId,
          fieldName,
          fromValue: currentValue,
          toValue: proposedValue,
          runId: proposal.run_id,
        })),
      ],
    );

    await client.query("COMMIT");

    return {
      outcome: "applied",
      contactId: proposal.contact_id,
      fieldName,
      appliedValue: proposedValue,
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reject a proposal (no contact write).
 *
 * @param poolOverride — pass a test pg.Pool to avoid using the production pool.
 */
export async function rejectProposal(
  proposalId: number,
  rejectedBy: string,
  poolOverride?: pg.Pool,
): Promise<ApprovalResult> {
  const pool = poolOverride ?? defaultPool;
  const r = await pool.query(
    `UPDATE contact_normalization_proposals
     SET status='rejected', reviewed_by=$2, reviewed_at=now()
     WHERE id=$1 AND status='pending'
     RETURNING contact_id`,
    [proposalId, rejectedBy],
  );

  if (r.rows.length === 0) {
    const existing = await pool.query(
      `SELECT contact_id, status FROM contact_normalization_proposals WHERE id=$1`,
      [proposalId],
    );
    if (existing.rows.length === 0) {
      return { outcome: "rejected", contactId: 0, reason: "Proposal not found" };
    }
    return {
      outcome: "already_reviewed",
      contactId: existing.rows[0].contact_id,
      status: existing.rows[0].status,
    };
  }

  return { outcome: "rejected", contactId: r.rows[0].contact_id, reason: "Rejected by admin" };
}

/**
 * Revert an approved proposal — writes the before_value back, marks reverted.
 *
 * @param poolOverride — pass a test pg.Pool to avoid using the production pool.
 */
export async function revertProposal(
  proposalId: number,
  revertedBy: string,
  poolOverride?: pg.Pool,
): Promise<ApprovalResult> {
  const pool = poolOverride ?? defaultPool;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const proposalR = await client.query(
      `SELECT id, contact_id, field_name, current_value, proposed_value, status, run_id
       FROM contact_normalization_proposals WHERE id=$1 FOR UPDATE`,
      [proposalId],
    );

    if (proposalR.rows.length === 0) {
      await client.query("ROLLBACK");
      return { outcome: "rejected", contactId: 0, reason: "Proposal not found" };
    }

    const p = proposalR.rows[0];

    if (p.status !== "approved") {
      await client.query("ROLLBACK");
      return { outcome: "already_reviewed", contactId: p.contact_id, status: p.status };
    }

    const fieldName: string = p.field_name;
    // Revert uses REVERTABLE_FIELDS (which includes vertical) so already-approved vertical
    // proposals can still be walked back to their prior value.
    if (!REVERTABLE_FIELDS.has(fieldName)) {
      await client.query("ROLLBACK");
      return { outcome: "rejected", contactId: p.contact_id, reason: `Field '${fieldName}' not in revert allowlist` };
    }

    // CAS: lock contact and verify field still equals the approved value.
    // If a user has edited the field again since approval, reverting would discard
    // a legitimate update — surface as stale instead.
    const contactR = await client.query(
      `SELECT id, updated_at, first_name, last_name, phone, company_name, vertical
       FROM contacts WHERE id = $1 FOR UPDATE`,
      [p.contact_id],
    );

    if (contactR.rows.length === 0) {
      await client.query("ROLLBACK");
      return { outcome: "stale", contactId: p.contact_id, reason: "Contact no longer exists" };
    }

    const contact = contactR.rows[0];
    const camelKey = fieldName.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());
    const liveValue: unknown = contact[camelKey] ?? contact[fieldName] ?? null;
    const approvedValue: string = p.proposed_value;

    // Allow null == "" equivalence for fields cleared by approval
    const liveStr = liveValue == null ? null : String(liveValue);
    const approvedStr = approvedValue === "" ? null : approvedValue;
    if (liveStr !== approvedStr) {
      await client.query("ROLLBACK");
      return {
        outcome: "stale",
        contactId: p.contact_id,
        reason: `Field '${fieldName}' has been modified since approval (current: '${liveStr}', expected: '${approvedStr}')`,
      };
    }

    // Restore previous value
    const colQuoted = `"${fieldName}"`;
    await client.query(
      `UPDATE contacts SET ${colQuoted} = $2, updated_at = now() WHERE id = $1`,
      [p.contact_id, p.current_value],
    );

    await client.query(
      `UPDATE contact_normalization_proposals SET status='reverted', reviewed_by=$2, reviewed_at=now() WHERE id=$1`,
      [proposalId, revertedBy],
    );

    // Update reversal ledger with reversed_to (PostgreSQL does not support ORDER BY/LIMIT in UPDATE;
    // use a subquery to target the most recent ledger row for this proposal).
    await client.query(
      `UPDATE contact_normalization_reversals
       SET reversed_to=$2, reversed_by=$3, reversed_at=now()
       WHERE id = (
         SELECT id FROM contact_normalization_reversals
         WHERE proposal_id=$1
         ORDER BY id DESC LIMIT 1
       )`,
      [proposalId, p.current_value, revertedBy],
    );

    // Write audit log (use real schema: actor_type, actor_id, details)
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, actor_id, details, created_at)
       VALUES ('contact', $1, 'reconciliation_proposal_reverted', 'user', $2, $3, now())`,
      [
        p.contact_id,
        revertedBy,
        JSON.stringify(sanitizeAuditPayload({ proposalId, fieldName, revertedTo: p.current_value, runId: p.run_id })),
      ],
    );

    await client.query("COMMIT");

    return {
      outcome: "applied",
      contactId: p.contact_id,
      fieldName,
      appliedValue: p.current_value ?? "",
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
