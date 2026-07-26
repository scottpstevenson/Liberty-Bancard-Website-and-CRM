/**
 * Task #1134 — Rollback: Restore sequence email copy from snapshot
 *
 * Usage:
 *   npx tsx scripts/rollback-sequence-copy.ts <snapshot-file>
 *
 * Example:
 *   npx tsx scripts/rollback-sequence-copy.ts docs/copy-snapshots/batch-all-2026-07-26T15-12-09-610Z.json
 *
 * Restores subject and body for every step in the snapshot file.
 * Only updates rows where the current value differs from the snapshot.
 */

import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import fs from "fs";

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    console.error("Usage: npx tsx scripts/rollback-sequence-copy.ts <snapshot-file>");
    process.exit(1);
  }

  if (!fs.existsSync(snapshotPath)) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    process.exit(1);
  }

  const snapshot: Array<{
    stepId: number;
    seqName: string;
    stepOrder: number;
    subject: string | null;
    body: string | null;
    variantBBody: string | null;
  }> = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

  console.log(`\n🔄 Rolling back ${snapshot.length} steps from:\n   ${snapshotPath}\n`);

  let restored = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of snapshot) {
    try {
      // Fetch current values
      const current = await db.execute(sql`
        SELECT subject, body, variant_b_body
        FROM sequence_steps WHERE id = ${row.stepId}
      `);
      if (current.rows.length === 0) {
        console.warn(`  ⚠ Step ${row.stepId} not found — skipping`);
        skipped++;
        continue;
      }
      const cur = current.rows[0] as any;
      if (cur.subject === row.subject && cur.body === row.body && cur.variant_b_body === row.variantBBody) {
        skipped++;
        continue;
      }

      await db.execute(sql`
        UPDATE sequence_steps
        SET subject = ${row.subject}, body = ${row.body}, variant_b_body = ${row.variantBBody}
        WHERE id = ${row.stepId}
      `);
      restored++;
      console.log(`  ✓ Restored step ${row.stepId} | "${row.seqName}" step=${row.stepOrder}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ Step ${row.stepId} ERROR:`, (err as Error).message);
    }
  }

  console.log(`\n📊 Rollback results:`);
  console.log(`   Restored: ${restored}`);
  console.log(`   Skipped (unchanged): ${skipped}`);
  console.log(`   Errors:  ${errors}`);

  if (errors > 0) process.exit(1);
  console.log("\n✅ Rollback complete.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
