#!/usr/bin/env tsx
/**
 * Task #822 — Update csv_imports record id=1 to reflect the known partial-import outcome.
 *
 * The July 6 2026 Outscraper import (id=1) ran 500/1,319 rows before the
 * server crashed / the process was killed. The record shows:
 *   status="processing", new_records=0, total_rows=1319
 *
 * We know from the DB that 500 contacts were created in the import window
 * (tags contain 'google-maps-outscraper', created_at between 01:40 and 01:47 UTC).
 *
 * This script corrects the record to reflect the actual partial outcome and
 * sets status="legacy_interrupted" so the UI can surface a useful summary.
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/update-import-id1.ts   # preview only
 *   DRY_RUN=false npx tsx scripts/update-import-id1.ts  # apply
 *
 * Requires DATABASE_URL (set automatically in Replit).
 */

import { db } from "../server/db";
import { csvImports, contacts } from "../shared/schema";
import { eq, gte, lte, sql } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN !== "false";
const IMPORT_ID = 1;

// Exact import run window — matches backfill-lead-source.ts. Do not widen.
const WINDOW_START = new Date("2026-07-06T01:40:53Z");
const WINDOW_END   = new Date("2026-07-06T01:47:04Z");

async function main() {
  console.log(`\nUpdate csv_imports id=${IMPORT_ID} to legacy_interrupted (DRY_RUN=${DRY_RUN})\n`);

  const [record] = await db.select().from(csvImports).where(eq(csvImports.id, IMPORT_ID));
  if (!record) {
    console.error(`csv_imports id=${IMPORT_ID} not found.`);
    process.exit(1);
  }

  console.log("Current record:");
  console.log(`  status        = ${record.status}`);
  console.log(`  total_rows    = ${record.totalRows}`);
  console.log(`  new_records   = ${record.newRecords}`);
  console.log(`  processed_rows = ${record.processedRows}`);
  console.log(`  source_format = ${record.sourceFormat}`);
  console.log();

  // Count contacts actually created in the import window with the correct tag.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(
      sql`${contacts.createdAt} >= ${WINDOW_START}
        AND ${contacts.createdAt} <= ${WINDOW_END}
        AND ${contacts.tags} @> ARRAY['google-maps-outscraper']::text[]`
    );

  console.log(`Contacts actually created in window: ${count}`);
  console.log();

  // Unknown buckets (duplicatesSkipped, invalidRows, skippedRows, errorsCount)
  // are explicitly nulled out — the partial run crashed before they could be
  // computed, and leaving them as 0 would misrepresent the outcome.
  // The UI getOutcomeSummary() treats these as unknown for legacy_interrupted.
  const updates = {
    status: "legacy_interrupted",
    newRecords: count,
    processedRows: count,
    // totalRows stays at 1319 (already set — file had 1319 data rows)
    duplicatesSkipped: null as number | null,
    invalidRows: null as number | null,
    skippedRows: null as number | null,
    errorsCount: null as number | null,
    staleReason: `Import crashed after processing approximately ${count} of ${record.totalRows} rows. ` +
      `Duplicate/invalid/skipped buckets are unknown (null) — they cannot be reconstructed post-crash. ` +
      `Corrected by update-import-id1 script on ${new Date().toISOString()}.`,
  };

  console.log("Proposed updates:");
  for (const [k, v] of Object.entries(updates)) {
    console.log(`  ${k} = ${v === null ? "(null — unknown)" : v}`);
  }
  console.log();

  console.log(
    "Post-apply verification will GROUP BY lead_source for the import window to confirm backfill is still needed."
  );
  console.log();

  if (DRY_RUN) {
    console.log("DRY_RUN=true — no changes written. Re-run with DRY_RUN=false to apply.");
    process.exit(0);
  }

  await db.update(csvImports).set(updates).where(eq(csvImports.id, IMPORT_ID));
  console.log(`csv_imports id=${IMPORT_ID} updated successfully.`);

  // Post-apply: show lead_source distribution in window so operator can
  // quickly confirm whether the lead_source backfill is still needed.
  const breakdown = await db
    .select({
      leadSource: contacts.leadSource,
      count: sql<number>`count(*)::int`,
    })
    .from(contacts)
    .where(
      sql`${contacts.createdAt} >= ${WINDOW_START}
        AND ${contacts.createdAt} <= ${WINDOW_END}
        AND ${contacts.tags} @> ARRAY['google-maps-outscraper']::text[]`
    )
    .groupBy(contacts.leadSource)
    .orderBy(sql`count(*) DESC`);
  console.log("\nlead_source breakdown for import window contacts:");
  for (const row of breakdown) {
    const correct = row.leadSource === "google_maps_outscraper" ? " ✓ correct" : " ✗ needs backfill";
    console.log(`  ${row.leadSource ?? "(null)"}: ${row.count}${correct}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
