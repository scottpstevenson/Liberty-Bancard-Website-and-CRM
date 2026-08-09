/**
 * reconcile-orphans.ts
 *
 * Wave R1 one-time reconciliation script. Run manually or via
 * POST /api/admin/data-health/reconcile from the admin panel.
 *
 * Operations (idempotent — safe to re-run):
 *  A. Link orphaned deals to contacts by email match
 *  B. Cancel orphaned sequence enrollments (no matching sequence)
 *  C. Backfill NULL lifecycle_state → 'PROSPECT' on active contacts
 *  D. Set next_action_at on active enrollments where NULL (defaults to 24h from now)
 *
 * All changes are logged to audit_logs. Counts are emitted to stdout.
 *
 * Exit code 0 on success (even if some operations had nothing to do).
 */

import { db } from "../server/db";
import { storage } from "../server/storage";
import { deals, contacts, sequenceEnrollments, followUpSequences } from "../shared/schema";
import { eq, isNull, inArray, and, sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");
const LOG_PREFIX = "[ReconcileOrphans]";

interface ReconcileResult {
  orphanedDealsLinked: number;
  orphanedDealsFlagged: number;
  orphanedEnrollmentsCanceled: number;
  lifecycleBackfilled: number;
  enrollmentNextActionSet: number;
}

async function reconcileOrphanedDeals(result: ReconcileResult) {
  console.log(`\n${LOG_PREFIX} ── A. Orphaned deals (contact_id IS NULL) ─────────────`);

  const orphanedDeals = await db.select({ id: deals.id, stage: deals.stage, notes: deals.notes })
    .from(deals)
    .where(isNull(deals.contactId))
    .limit(1000);

  console.log(`${LOG_PREFIX}   Found ${orphanedDeals.length} orphaned deals`);

  for (const deal of orphanedDeals) {
    // Try to find a contact via notes (often contains email) — very conservative
    // Only link if there's an exact email match we can find
    let linked = false;

    // Check if deal notes contain an email-looking string
    if (deal.notes) {
      const emailMatch = deal.notes.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
      if (emailMatch) {
        const candidateEmail = emailMatch[0].toLowerCase();
        const [candidate] = await db.select({ id: contacts.id, email: contacts.email })
          .from(contacts)
          .where(eq(sql`LOWER(email)`, candidateEmail))
          .limit(1);

        if (candidate) {
          console.log(`${LOG_PREFIX}   Deal #${deal.id} → contact #${candidate.id} (matched ${candidateEmail})`);
          if (!DRY_RUN) {
            await db.update(deals).set({ contactId: candidate.id }).where(eq(deals.id, deal.id));
            await storage.createAuditLog({
              action: "ORPHAN_DEAL_LINKED",
              entityType: "deal",
              entityId: deal.id,
              details: `Reconcile: linked orphaned deal to contact #${candidate.id} via email match (${candidateEmail})`,
            }).catch(() => {});
          }
          result.orphanedDealsLinked++;
          linked = true;
        }
      }
    }

    if (!linked) {
      console.log(`${LOG_PREFIX}   Deal #${deal.id} — no contact match found (stage=${deal.stage}), flagged for review`);
      if (!DRY_RUN) {
        // Set a flag in notes so human reviewer can find it
        const flagNote = `[ORPHAN:no-contact-match]`;
        if (!deal.notes?.includes(flagNote)) {
          await db.update(deals).set({
            notes: deal.notes ? `${flagNote} ${deal.notes}` : flagNote,
          }).where(eq(deals.id, deal.id));
        }
        await storage.createAuditLog({
          action: "ORPHAN_DEAL_FLAGGED",
          entityType: "deal",
          entityId: deal.id,
          details: `Reconcile: orphaned deal has no contact match — flagged for human review (stage=${deal.stage})`,
        }).catch(() => {});
      }
      result.orphanedDealsFlagged++;
    }
  }
}

async function reconcileOrphanedEnrollments(result: ReconcileResult) {
  console.log(`\n${LOG_PREFIX} ── B. Orphaned sequence enrollments ────────────────────`);

  // Find enrollments whose sequence_id references a non-existent sequence
  const { pool: pgPool } = await import("../server/db");
  const orphanedResult = await pgPool.query<{ id: number; contact_id: number; sequence_id: number }>(
    `SELECT se.id, se.contact_id, se.sequence_id
     FROM sequence_enrollments se
     LEFT JOIN follow_up_sequences fs ON fs.id = se.sequence_id
     WHERE se.status IN ('active','paused') AND fs.id IS NULL
     LIMIT 500`
  );

  const orphaned = orphanedResult.rows;
  console.log(`${LOG_PREFIX}   Found ${orphaned.length} orphaned active/paused enrollments`);

  if (orphaned.length > 0) {
    const ids = orphaned.map(r => r.id);

    if (!DRY_RUN) {
      await db.update(sequenceEnrollments).set({
        status: "canceled",
        completedAt: new Date(),
        metadata: sql`COALESCE(metadata, '{}'::jsonb) || '{"canceledBy":"reconcile-orphans","cancelReason":"sequence_not_found"}'::jsonb`,
      }).where(inArray(sequenceEnrollments.id, ids));

      await storage.createAuditLog({
        action: "ORPHAN_ENROLLMENTS_CANCELED",
        entityType: "sequence_enrollment",
        details: `Reconcile: canceled ${ids.length} orphaned enrollments (sequence_id not found). IDs: ${ids.slice(0, 20).join(",")}${ids.length > 20 ? "..." : ""}`,
      }).catch(() => {});
    }

    result.orphanedEnrollmentsCanceled = ids.length;
    console.log(`${LOG_PREFIX}   Canceled (or would cancel) ${ids.length} orphaned enrollments`);
  }
}

async function backfillNullLifecycleState(result: ReconcileResult) {
  console.log(`\n${LOG_PREFIX} ── C. Contacts with NULL lifecycle_state ───────────────`);

  const { pool: pgPool } = await import("../server/db");
  const nullLifecycleResult = await pgPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM contacts WHERE lifecycle_state IS NULL AND archived_at IS NULL`
  );
  const count = parseInt(nullLifecycleResult.rows[0]?.count ?? "0", 10);
  console.log(`${LOG_PREFIX}   Found ${count} contacts with NULL lifecycle_state`);

  if (count > 0) {
    if (!DRY_RUN) {
      await pgPool.query(
        `UPDATE contacts SET lifecycle_state = 'PROSPECT', updated_at = NOW()
         WHERE lifecycle_state IS NULL AND archived_at IS NULL`
      );
      await storage.createAuditLog({
        action: "LIFECYCLE_BACKFILL",
        entityType: "contact",
        details: `Reconcile: backfilled lifecycle_state='PROSPECT' on ${count} contacts with NULL lifecycle_state`,
      }).catch(() => {});
    }
    result.lifecycleBackfilled = count;
    console.log(`${LOG_PREFIX}   Backfilled (or would backfill) ${count} contacts`);
  }
}

async function fixEnrollmentsWithoutNextAction(result: ReconcileResult) {
  console.log(`\n${LOG_PREFIX} ── D. Active enrollments with NULL next_action_at ──────`);

  const { pool: pgPool } = await import("../server/db");
  const nullNextActionResult = await pgPool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM sequence_enrollments WHERE status = 'active' AND next_action_at IS NULL`
  );
  const count = parseInt(nullNextActionResult.rows[0]?.count ?? "0", 10);
  console.log(`${LOG_PREFIX}   Found ${count} active enrollments with NULL next_action_at`);

  if (count > 0) {
    if (!DRY_RUN) {
      // Default to 24 hours from now — conservative, won't spam immediately
      await pgPool.query(
        `UPDATE sequence_enrollments
         SET next_action_at = NOW() + INTERVAL '24 hours', updated_at = NOW()
         WHERE status = 'active' AND next_action_at IS NULL`
      );
      await storage.createAuditLog({
        action: "ENROLLMENT_NEXT_ACTION_BACKFILL",
        entityType: "sequence_enrollment",
        details: `Reconcile: set next_action_at=24h from now on ${count} active enrollments with NULL next_action_at`,
      }).catch(() => {});
    }
    result.enrollmentNextActionSet = count;
    console.log(`${LOG_PREFIX}   Fixed (or would fix) ${count} enrollments`);
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log(" Wave R1 — Orphan Reconciliation Script");
  if (DRY_RUN) console.log(" ⚠  DRY RUN MODE — no changes will be written");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Started at: ${new Date().toISOString()}`);

  const result: ReconcileResult = {
    orphanedDealsLinked: 0,
    orphanedDealsFlagged: 0,
    orphanedEnrollmentsCanceled: 0,
    lifecycleBackfilled: 0,
    enrollmentNextActionSet: 0,
  };

  try {
    await reconcileOrphanedDeals(result);
    await reconcileOrphanedEnrollments(result);
    await backfillNullLifecycleState(result);
    await fixEnrollmentsWithoutNextAction(result);
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Fatal error:`, err.message);
    await db.$client.end().catch(() => {});
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" Reconciliation Complete");
  console.log("═══════════════════════════════════════════════════════");
  console.log(JSON.stringify(result, null, 2));
  if (DRY_RUN) console.log("\n⚠  DRY RUN — no actual changes made. Re-run without --dry-run to apply.");
  console.log(`Finished at: ${new Date().toISOString()}`);

  await db.$client.end().catch(() => {});
  process.exit(0);
}

main();
