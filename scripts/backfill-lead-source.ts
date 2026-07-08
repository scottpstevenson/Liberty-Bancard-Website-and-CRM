#!/usr/bin/env tsx
/**
 * Task #822 — Backfill lead_source for Outscraper contacts imported 2026-07-06
 *
 * Root cause: The `source` column in the Outscraper CSV was mapped to
 * `leadSource` via genericColumnMap["source"] = "leadSource", so the
 * provenance URL / scraper-origin string in that column overwrote the
 * canonical enum value (`google_maps_outscraper`). The fix is in the importer
 * (forcedLeadSource for known-provider formats), but historical contacts must
 * be corrected manually via this script.
 *
 * Target window: contacts created during the affected import run on 2026-07-06
 * between 01:40:53 and 01:47:04 UTC. These contacts have the
 * "google-maps-outscraper" tag (added by the importer) and a lead_source that
 * is NOT "google_maps_outscraper".
 *
 * Usage:
 *   DRY_RUN=true npx tsx scripts/backfill-lead-source.ts   # preview only
 *   DRY_RUN=false npx tsx scripts/backfill-lead-source.ts  # apply fix
 *
 * Requires DATABASE_URL in environment (automatically set in Replit).
 */

import { db } from "../server/db";
import { contacts } from "../shared/schema";
import { and, gte, lte, ne, sql, eq } from "drizzle-orm";

const DRY_RUN = process.env.DRY_RUN !== "false";

// The exact import window (UTC) — bounded to the known import run timestamps.
// DO NOT widen this range without re-verifying the affected contact set.
const WINDOW_START = new Date("2026-07-06T01:40:53Z");
const WINDOW_END   = new Date("2026-07-06T01:47:04Z");

async function main() {
  console.log(`\nOutscraper lead_source backfill (DRY_RUN=${DRY_RUN})\n`);
  console.log(`Window: ${WINDOW_START.toISOString()} → ${WINDOW_END.toISOString()}`);
  console.log("Target: contacts with 'google-maps-outscraper' tag AND lead_source != 'google_maps_outscraper'\n");

  // Find affected contacts: created in the window, tagged google-maps-outscraper,
  // lead_source is not already correct.
  const affected = await db
    .select({ id: contacts.id, leadSource: contacts.leadSource, createdAt: contacts.createdAt })
    .from(contacts)
    .where(
      and(
        gte(contacts.createdAt, WINDOW_START),
        lte(contacts.createdAt, WINDOW_END),
        ne(contacts.leadSource, "google_maps_outscraper"),
        sql`${contacts.tags} @> ARRAY['google-maps-outscraper']::text[]`,
      )
    )
    .orderBy(contacts.createdAt);

  console.log(`Found ${affected.length} affected contact(s).\n`);

  if (affected.length === 0) {
    console.log("Nothing to fix. Exiting.");
    process.exit(0);
  }

  // Show sample
  const sample = affected.slice(0, 5);
  console.log("Sample (up to 5):");
  for (const c of sample) {
    console.log(`  id=${c.id}  lead_source="${c.leadSource}"  created_at=${new Date(c.createdAt!).toISOString()}`);
  }
  if (affected.length > 5) {
    console.log(`  ... and ${affected.length - 5} more`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("DRY_RUN=true — no changes written. Re-run with DRY_RUN=false to apply.");
    process.exit(0);
  }

  // Apply fix in a single UPDATE with an IN clause.
  const ids = affected.map((c) => c.id);

  // Drizzle doesn't support inArray in an update WHERE easily without importing
  // inArray from drizzle-orm — do it via raw sql for safety.
  const result = await db
    .update(contacts)
    .set({ leadSource: "google_maps_outscraper" })
    .where(sql`${contacts.id} = ANY(${ids})`);

  // Drizzle's update().returning() is the reliable way to count; fall back to
  // the affected count since we know it from the SELECT.
  console.log(`Updated ${ids.length} contact(s) → lead_source = 'google_maps_outscraper'.`);

  // Verify
  const stillWrong = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        gte(contacts.createdAt, WINDOW_START),
        lte(contacts.createdAt, WINDOW_END),
        ne(contacts.leadSource, "google_maps_outscraper"),
        sql`${contacts.tags} @> ARRAY['google-maps-outscraper']::text[]`,
      )
    );

  if (stillWrong.length === 0) {
    console.log("\nVerification passed — all targeted contacts now have correct lead_source.");
  } else {
    console.error(`\nVerification FAILED — ${stillWrong.length} contact(s) still have incorrect lead_source:`);
    for (const c of stillWrong) console.error(`  id=${c.id}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Script crashed:", err);
  process.exit(1);
});
