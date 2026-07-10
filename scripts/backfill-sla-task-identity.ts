/**
 * Phase 2: Backfill SLA task identity columns + deduplicate conflicts.
 *
 * Step A — Stamp source/automationKey on legacy rows whose title matches
 *           the canonical stalling-deal pattern, cross-verified against
 *           the deal_id embedded in the title.
 *
 * Step B — After stamping, find any deal_id that has more than one
 *           active+incomplete SLA stalling task (same deal_id, source='sla',
 *           automation_key='stalling-deal-follow-up', completed_at IS NULL,
 *           deleted_at IS NULL).  For each conflict group: keep the most
 *           recently created task, soft-delete the rest.  For GHL-backed
 *           tasks (ghl_task_id IS NOT NULL) the GHL-side task is deleted
 *           first via the API before the local soft-delete, so the two
 *           systems remain consistent.
 *
 * USAGE:
 *   npx tsx scripts/backfill-sla-task-identity.ts --dry-run   # inspect only
 *   npx tsx scripts/backfill-sla-task-identity.ts              # apply backfill
 *
 * PREREQUISITE: Run this BEFORE applying migration 0054 (the partial unique
 *               index). The index will fail to create if conflicts remain.
 *
 * POST-RUN VERIFICATION:
 *   -- Must return 0 before applying migration 0054:
 *   SELECT COUNT(*) FROM tasks
 *   WHERE title ~ '^Follow up on stalling Deal #[0-9]+$'
 *     AND source IS NULL AND deleted_at IS NULL AND completed_at IS NULL;
 *
 *   -- Must return 0 before applying migration 0054:
 *   SELECT deal_id, COUNT(*) FROM tasks
 *   WHERE source = 'sla' AND automation_key = 'stalling-deal-follow-up'
 *     AND deleted_at IS NULL AND completed_at IS NULL AND deal_id IS NOT NULL
 *   GROUP BY deal_id HAVING COUNT(*) > 1;
 */

import { db } from "../server/db";
import { tasks, contacts } from "@shared/schema";
import { isNull, sql, and, eq, not } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const TITLE_REGEX = /^Follow up on stalling Deal #(\d+)$/;

// ── GHL task deletion ─────────────────────────────────────────────────────────

type GhlDeleteResult =
  | { status: "deleted" }
  | { status: "unresolvable"; reason: string };

/**
 * Delete a task from GHL using the canonical ghlContactId (GHL UUID) from the
 * contacts table, then return a typed result. The local `contactId` integer is
 * used only to look up the contact — it must NEVER be sent to GHL directly.
 *
 * Returns { status: "unresolvable" } (never throws) when:
 *   - GHL is not configured (no API key)
 *   - The contact record has no ghlContactId
 * The caller is responsible for adding unresolvable rows to the error report
 * and skipping the local soft-delete.
 *
 * Throws on any non-2xx, non-404 GHL response or network error so the caller
 * hard-fails rather than soft-deleting locally with an unconfirmed GHL state.
 */
async function deleteGhlTask(localContactId: number, ghlTaskId: string): Promise<GhlDeleteResult> {
  const apiKey = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  if (!apiKey) {
    return { status: "unresolvable", reason: "GHL_API_KEY not set — configure GHL credentials before running backfill" };
  }

  // Resolve ghlContactId from the contacts table (canonical GHL UUID).
  const contactRows = await db
    .select({ ghlContactId: contacts.ghlContactId })
    .from(contacts)
    .where(eq(contacts.id, localContactId))
    .limit(1);
  const ghlContactId = contactRows[0]?.ghlContactId ?? null;

  if (!ghlContactId) {
    return {
      status: "unresolvable",
      reason: `contact #${localContactId} has no ghlContactId — task cannot be confirmed deleted in GHL`,
    };
  }

  // Use the GHL UUID (ghlContactId) — NOT the local integer — in the API path.
  const url = `${GHL_API_BASE}/contacts/${ghlContactId}/tasks/${ghlTaskId}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}`, Version: "2021-07-28" },
    });
  } catch (err: any) {
    throw new Error(`[GHL] Network error deleting GHL task ${ghlTaskId} (contact GHL UUID ${ghlContactId}): ${err.message}`);
  }

  if (res.ok || res.status === 404) {
    const note = res.status === 404 ? " (already absent in GHL)" : "";
    console.log(`  [GHL] Confirmed deleted GHL task ${ghlTaskId} on contact ${ghlContactId} (HTTP ${res.status}${note})`);
    return { status: "deleted" };
  }
  // Non-2xx, non-404: hard-fail so we don't create a cross-system divergence.
  const body = await res.text().catch(() => "");
  throw new Error(`[GHL] Failed to delete GHL task ${ghlTaskId}: HTTP ${res.status} — ${body.slice(0, 300)}`);
}

// ── Soft-delete a task locally ────────────────────────────────────────────────

async function softDeleteTask(id: number, reason: string): Promise<void> {
  await db
    .update(tasks)
    .set({ deletedAt: new Date() } as any)
    .where(sql`id = ${id}`);
  console.log(`  Soft-deleted task #${id} (${reason})`);
}

// ── Step A: stamp identity columns ────────────────────────────────────────────

async function stepA(): Promise<{ stamped: number; mismatches: number }> {
  console.log("\n[Backfill] Step A — stamping source/automationKey on legacy rows...");

  const allRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dealId: tasks.dealId,
      source: tasks.source,
      automationKey: tasks.automationKey,
      deletedAt: tasks.deletedAt,
      completedAt: tasks.completedAt,
      ghlTaskId: tasks.ghlTaskId,
    })
    .from(tasks)
    .where(isNull(tasks.source));

  const candidates = allRows.filter(r => TITLE_REGEX.test(r.title ?? ""));

  if (candidates.length === 0) {
    console.log("  No legacy stalling-deal tasks found (source IS NULL). Nothing to stamp.");
    return { stamped: 0, mismatches: 0 };
  }

  console.log(`  Found ${candidates.length} candidate rows`);

  let stamped = 0;
  let mismatches = 0;

  for (const row of candidates) {
    const match = TITLE_REGEX.exec(row.title ?? "");
    if (!match) continue;
    const titleDealId = parseInt(match[1], 10);

    if (row.dealId !== null && row.dealId !== titleDealId) {
      console.warn(`  MISMATCH task #${row.id}: title says deal ${titleDealId}, deal_id=${row.dealId} — SKIPPING`);
      mismatches++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would stamp task #${row.id} "${row.title}" deal_id=${row.dealId} deleted=${!!row.deletedAt} completed=${!!row.completedAt} ghlTaskId=${row.ghlTaskId ?? "none"}`);
    } else {
      await db
        .update(tasks)
        .set({ source: "sla", automationKey: "stalling-deal-follow-up" } as any)
        .where(sql`id = ${row.id}`);
      stamped++;
      console.log(`  Stamped task #${row.id} (deal_id=${row.dealId})`);
    }
  }

  console.log(`  Step A complete: ${stamped} stamped, ${mismatches} mismatches skipped.`);
  if (mismatches > 0) {
    console.warn(`  WARNING: ${mismatches} rows had title/deal_id mismatches. Review manually before applying migration 0054.`);
  }
  return { stamped, mismatches };
}

// ── Step B: resolve duplicates ────────────────────────────────────────────────

async function stepB(): Promise<{ groups: number; deleted: number; unresolved: number }> {
  console.log("\n[Backfill] Step B — finding and resolving active+incomplete SLA task conflicts...");

  // Find all deal_ids with more than one active+incomplete SLA stalling task.
  const conflictRows = await db.execute(sql`
    SELECT deal_id, COUNT(*) as cnt
    FROM tasks
    WHERE source = 'sla'
      AND automation_key = 'stalling-deal-follow-up'
      AND deleted_at IS NULL
      AND completed_at IS NULL
      AND deal_id IS NOT NULL
    GROUP BY deal_id
    HAVING COUNT(*) > 1
  `);
  const conflicts = ((conflictRows as any).rows ?? conflictRows) as Array<{ deal_id: number; cnt: number }>;

  if (conflicts.length === 0) {
    console.log("  No duplicate active+incomplete SLA tasks found. Step B is a no-op.");
    return { groups: 0, deleted: 0 };
  }

  console.log(`  Found ${conflicts.length} deal(s) with duplicate active+incomplete SLA tasks.`);

  let totalDeleted = 0;
  // Rows with ghl_task_id but no contact_id: we cannot confirm GHL deletion,
  // so we must NOT soft-delete locally. These are collected and reported so
  // the operator can resolve them manually before applying migration 0054.
  const unresolved: Array<{ id: number; dealId: number | null; ghlTaskId: string; reason: string }> = [];

  for (const { deal_id } of conflicts) {
    // Fetch all active+incomplete SLA tasks for this deal, sorted by creation (newest first).
    const group = await db
      .select({
        id: tasks.id,
        dealId: tasks.dealId,
        contactId: tasks.contactId,
        ghlTaskId: tasks.ghlTaskId,
        createdAt: tasks.createdAt,
        title: tasks.title,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.dealId, deal_id),
          eq(tasks.source as any, "sla"),
          eq(tasks.automationKey as any, "stalling-deal-follow-up"),
          isNull(tasks.deletedAt),
          isNull(tasks.completedAt),
        )
      )
      .orderBy(sql`created_at DESC`);

    if (group.length < 2) continue;

    const [keep, ...evict] = group;
    console.log(`\n  Deal #${deal_id}: keeping task #${keep.id} (newest), evicting ${evict.length} duplicate(s).`);

    for (const dup of evict) {
      if (DRY_RUN) {
        const canResolve = !dup.ghlTaskId || dup.contactId !== null;
        const note = dup.ghlTaskId
          ? (dup.contactId !== null ? `ghlTaskId=${dup.ghlTaskId}` : `GHL-backed but contactId=null — UNRESOLVABLE`)
          : "no ghlTaskId";
        console.log(`  [DRY-RUN] Would${canResolve ? "" : " NOT"} soft-delete task #${dup.id} (${note})`);
      } else {
        if (dup.ghlTaskId) {
          if (dup.contactId === null) {
            // Cannot confirm GHL deletion: no contact FK to look up ghlContactId.
            // Skip both GHL and local soft-delete to avoid cross-system divergence.
            console.warn(`  UNRESOLVABLE: task #${dup.id} ghl_task_id=${dup.ghlTaskId} has no contactId. Cannot resolve ghlContactId. Skipping local soft-delete.`);
            unresolved.push({ id: dup.id, dealId: dup.dealId, ghlTaskId: dup.ghlTaskId, reason: "contactId=null" });
            continue;
          }
          // GHL-backed: look up ghlContactId and confirm remote deletion first.
          // deleteGhlTask() resolves ghlContactId from contacts table; returns
          // "unresolvable" when no ghlContactId is found (never uses local integer as GHL id).
          console.log(`  Task #${dup.id} has GHL task ID ${dup.ghlTaskId} — resolving ghlContactId and deleting from GHL first (awaited)...`);
          const result = await deleteGhlTask(dup.contactId, dup.ghlTaskId); // throws on API error
          if (result.status === "unresolvable") {
            // Contact record lacks a ghlContactId: cannot confirm remote deletion.
            // Skip local soft-delete; operator must resolve manually.
            console.warn(`  UNRESOLVABLE: task #${dup.id} — ${result.reason}. Skipping local soft-delete.`);
            unresolved.push({ id: dup.id, dealId: dup.dealId, ghlTaskId: dup.ghlTaskId, reason: result.reason });
            continue;
          }
        }
        // Local soft-delete only after GHL deletion is confirmed (or no ghlTaskId).
        await softDeleteTask(dup.id, `duplicate SLA stalling task for deal #${deal_id}`);
        totalDeleted++;
      }
    }
  }

  console.log(`\n  Step B complete: ${conflicts.length} conflict group(s) processed, ${totalDeleted} task(s) soft-deleted.`);
  if (unresolved.length > 0) {
    console.error(`\n  BLOCKED: ${unresolved.length} GHL-backed duplicate(s) could not be resolved (contactId missing):`);
    for (const r of unresolved) {
      console.error(`    task #${r.id} deal_id=${r.dealId} ghl_task_id=${r.ghlTaskId}`);
    }
    console.error("  Resolve these rows manually in GHL and/or link a contactId before applying migration 0054.");
  }
  return { groups: conflicts.length, deleted: totalDeleted, unresolved: unresolved.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[Backfill] Starting SLA task identity backfill + dedup (dry-run=${DRY_RUN})`);

  const { stamped, mismatches } = await stepA();
  const { groups, deleted, unresolved } = await stepB();

  console.log(`\n[Backfill] Summary:`);
  console.log(`  Step A — rows stamped:         ${DRY_RUN ? "(dry-run)" : stamped}`);
  console.log(`  Step A — mismatches skipped:   ${mismatches}`);
  console.log(`  Step B — conflict groups:      ${groups}`);
  console.log(`  Step B — tasks soft-deleted:   ${DRY_RUN ? "(dry-run)" : deleted}`);
  console.log(`  Step B — unresolvable (GHL):   ${DRY_RUN ? "(dry-run)" : unresolved}`);

  if (DRY_RUN) {
    console.log(`\n[Backfill][DRY-RUN] No changes written. Remove --dry-run to apply.`);
  } else {
    console.log(`\n[Backfill] Done. Now verify readiness for migration 0054 with:`);
    console.log(`  -- Must return 0:`);
    console.log(`  SELECT COUNT(*) FROM tasks`);
    console.log(`  WHERE title ~ '^Follow up on stalling Deal #[0-9]+$'`);
    console.log(`    AND source IS NULL AND deleted_at IS NULL AND completed_at IS NULL;`);
    console.log(`\n  -- Must return 0:`);
    console.log(`  SELECT deal_id, COUNT(*) FROM tasks`);
    console.log(`  WHERE source = 'sla' AND automation_key = 'stalling-deal-follow-up'`);
    console.log(`    AND deleted_at IS NULL AND completed_at IS NULL AND deal_id IS NOT NULL`);
    console.log(`  GROUP BY deal_id HAVING COUNT(*) > 1;`);
    console.log(`\n  Then run: npx tsx scripts/verify-phase3-index.ts (after migration 0054).`);
  }

  const hasBlockers = mismatches > 0 || unresolved > 0;
  if (hasBlockers) {
    if (mismatches > 0) console.warn(`\n[Backfill] WARNING: ${mismatches} mismatch row(s) remain — review manually before applying migration 0054.`);
    if (unresolved > 0) console.error(`\n[Backfill] BLOCKED: ${unresolved} GHL-backed duplicate(s) require manual resolution before migration 0054 can be applied safely.`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
