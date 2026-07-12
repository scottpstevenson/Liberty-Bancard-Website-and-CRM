/**
 * scripts/resolve-ghl-contact-id-duplicates.ts
 *
 * Pre-deploy deduplication script for migration 0066_ghl_contact_id_unique.
 *
 * This script MUST be run before migration 0066 is applied. It:
 *  1. Audits all duplicate ghl_contact_id groups in production.
 *  2. Logs a resolution manifest per group (retained contact, detached contacts).
 *  3. NULLs out ghl_contact_id on all but the earliest (lowest id) contact per group.
 *  4. Writes an audit_log entry for each detached row (action: "ghl_id_dedup_detach").
 *  5. Exits non-zero if any unexpected error occurs; exits 0 only when zero duplicates remain.
 *
 * Conservative resolution policy:
 *  - The canonical contact is the one with the LOWEST id in each duplicate group.
 *  - Detached contacts retain all other data — only ghl_contact_id is cleared.
 *  - No rows are deleted or merged. References (deals, tasks, notes) are untouched.
 *  - Re-linking detached contacts to GHL is handled by a follow-up backfill task.
 *
 * Usage:
 *   npx tsx scripts/resolve-ghl-contact-id-duplicates.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Print resolution manifest without writing any changes to the DB.
 */

import { pool } from "../server/db";
import { storage } from "../server/storage";

const DRY_RUN = process.argv.includes("--dry-run");

interface DuplicateGroup {
  ghlContactId: string;
  rowCount: number;
  contactIds: number[];
}

async function main() {
  console.log(`[GHL Dedup] Starting GHL contact ID deduplication${DRY_RUN ? " (DRY RUN)" : ""}...`);

  const client = await pool.connect();
  try {
    // Step 1: Audit — find all duplicate groups.
    const { rows: dupRows } = await client.query<{
      ghl_contact_id: string;
      row_count: string;
      contact_ids: number[];
    }>(`
      SELECT ghl_contact_id,
             COUNT(*) AS row_count,
             ARRAY_AGG(id ORDER BY id ASC) AS contact_ids
      FROM contacts
      WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> ''
      GROUP BY ghl_contact_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `);

    const groups: DuplicateGroup[] = dupRows.map(r => ({
      ghlContactId: r.ghl_contact_id,
      rowCount: Number(r.row_count),
      contactIds: r.contact_ids,
    }));

    if (groups.length === 0) {
      console.log("[GHL Dedup] No duplicate ghl_contact_id groups found. Database is clean.");
      process.exit(0);
    }

    console.log(`[GHL Dedup] Found ${groups.length} duplicate group(s) affecting ${
      groups.reduce((sum, g) => sum + g.rowCount, 0)
    } total rows.`);

    // Step 2: Print resolution manifest.
    console.log("\n=== Resolution Manifest ===");
    for (const group of groups) {
      const [retained, ...detached] = group.contactIds;
      console.log(
        `GHL ID: ${group.ghlContactId} | ${group.rowCount} rows | ` +
        `RETAIN contact #${retained} | DETACH: ${detached.join(", ")}`
      );
    }
    console.log("===========================\n");

    if (DRY_RUN) {
      console.log("[GHL Dedup] Dry run complete — no changes written.");
      process.exit(0);
    }

    // Step 3: Detach duplicate GHL IDs (NULL out on all non-canonical contacts).
    let detachedCount = 0;
    for (const group of groups) {
      const [retained, ...toDetach] = group.contactIds;
      for (const contactId of toDetach) {
        await client.query(
          `UPDATE contacts SET ghl_contact_id = NULL WHERE id = $1`,
          [contactId]
        );

        // Audit log entry per detached row.
        try {
          await storage.createAuditLog({
            action: "ghl_id_dedup_detach",
            entityType: "contact",
            entityId: contactId,
            details: {
              ghlContactId: group.ghlContactId,
              canonicalContactId: retained,
              reason: "migration_0066_dedup_resolution",
            },
          });
        } catch (auditErr: any) {
          console.warn(`[GHL Dedup] Audit log failed for contact #${contactId}: ${auditErr?.message}`);
        }
        detachedCount++;
      }
    }

    console.log(`[GHL Dedup] Detached ghl_contact_id from ${detachedCount} contact(s).`);

    // Step 4: Verify zero duplicates remain.
    const { rows: verifyRows } = await client.query<{ dup_groups: string }>(`
      SELECT COUNT(*) AS dup_groups FROM (
        SELECT ghl_contact_id FROM contacts
        WHERE ghl_contact_id IS NOT NULL AND BTRIM(ghl_contact_id) <> ''
        GROUP BY ghl_contact_id HAVING COUNT(*) > 1
      ) sub
    `);
    const remaining = Number(verifyRows[0]?.dup_groups ?? 0);

    if (remaining > 0) {
      console.error(`[GHL Dedup] ERROR: ${remaining} duplicate group(s) still remain after resolution. Investigate manually.`);
      process.exit(1);
    }

    console.log("[GHL Dedup] Verification passed — zero duplicate groups remain.");
    console.log("[GHL Dedup] Migration 0066 is now safe to apply.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: any) => {
  console.error("[GHL Dedup] Fatal error:", err?.message ?? err);
  process.exit(1);
});
