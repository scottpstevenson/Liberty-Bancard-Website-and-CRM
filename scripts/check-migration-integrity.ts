#!/usr/bin/env npx tsx
/**
 * check-migration-integrity.ts
 *
 * Deployment preflight: verifies the migrations/ directory is internally
 * consistent so Replit's drizzle-kit provision step cannot hang.
 *
 * Rules enforced:
 *   1. Every .sql file in migrations/ (root only) has a matching journal entry.
 *   2. Every journal entry has a matching .sql file in migrations/ root.
 *   3. The journal `when` field is monotonically non-decreasing (warns on ties;
 *      reports duplicate timestamps explicitly).
 *   4. The two outbound launch migrations (0076, 0077) are present and additive-only.
 *   5. Guarded migrations in migrations/guarded/ are NOT present in the journal
 *      (they are applied by the startup migrator's precondition-checked path).
 *   6. No root SQL file exists that is neither in the journal NOR in KNOWN_GUARDED_TAGS
 *      (catches new unaccounted files that would break migration replay).
 *   7. Duplicate `when` timestamps are reported (they exist historically but new
 *      entries must sit strictly above the current high-water mark).
 *   8. The 0109 snapshot migration is classified as fresh-bootstrap only: it uses
 *      bare CREATE TABLE (no IF NOT EXISTS), so it must never be re-applied to an
 *      existing database. The Drizzle baseline strategy handles this correctly by
 *      recording its hash before the migrator runs on an existing DB.
 *
 * High-water enforcement:
 *   Any new journal entry whose `when` value is ≤ HIGH_WATER_WHEN is reported as
 *   a FAIL. This prevents silently-skipped entries caused by a `when` value that
 *   falls below the Drizzle migrator's cursor (see drizzle-out-of-order-journal.md).
 *   Historical entries below HIGH_WATER_WHEN are exempt from this check.
 *
 * Exits 0 on pass, 1 on any failure.
 *
 * Usage:
 *   npx tsx scripts/check-migration-integrity.ts
 */

import fs from "fs";
import path from "path";

const MIGRATIONS_ROOT = path.join(process.cwd(), "migrations");
const GUARDED_DIR     = path.join(MIGRATIONS_ROOT, "guarded");
const JOURNAL_PATH    = path.join(MIGRATIONS_ROOT, "meta", "_journal.json");

// Immutable baseline anchor — the last journal entry before BT-05 additions.
// Confirmed as: idx=152, tag=0149_statement_proposals_deal_id_unique, when=1793200000000.
// Any entry with idx > BASELINE_LAST_IDX is "post-baseline" and MUST have
// `when` strictly above HIGH_WATER_WHEN or Drizzle silently skips it.
const BASELINE_LAST_IDX = 152;
const BASELINE_LAST_TAG = "0149_statement_proposals_deal_id_unique";

// The `when` value of the baseline's last entry. Every post-baseline entry
// (idx > BASELINE_LAST_IDX) must use a strictly higher value.
const HIGH_WATER_WHEN = 1793200000000; // baseline `when` of 0149_statement_proposals_deal_id_unique

// Tags that are intentionally in migrations/guarded/, NOT in the journal.
// If you add a new guarded migration, add its tag here.
const KNOWN_GUARDED_TAGS = new Set([
  "0054_sla_task_stalling_unique_index",
]);

// Additive-only SQL patterns: these keywords indicate data-destructive operations.
const DESTRUCTIVE_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

// Tags we specifically require to exist and be additive.
const REQUIRED_ADDITIVE_TAGS = ["0076_outbound_launch_foundation", "0077_outbound_attestations"];

// The consolidated snapshot migration — uses bare CREATE TABLE (no IF NOT EXISTS).
// It is safe ONLY on a fresh database or through the baseline mechanism in db-migrate.ts.
const SNAPSHOT_TAG = "0109_fearless_starhawk";

let errors: string[] = [];
let warnings: string[] = [];
let passed = 0;

function fail(msg: string) { errors.push(`  FAIL: ${msg}`); }
function warn(msg: string) { warnings.push(`  WARN: ${msg}`); }
function pass(msg: string) { passed++; process.stdout.write(`  PASS: ${msg}\n`); }

// ── Load journal ─────────────────────────────────────────────────────────────
if (!fs.existsSync(JOURNAL_PATH)) {
  console.error("FATAL: migrations/meta/_journal.json not found.");
  process.exit(1);
}
const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};
const journalTags = new Set(journal.entries.map(e => e.tag));

// ── Rule 1: every root-level .sql file has a journal entry ──────────────────
console.log("\n[Rule 1] Root-level SQL files all present in journal:");
const rootSqlFiles = fs.readdirSync(MIGRATIONS_ROOT)
  .filter(f => f.endsWith(".sql"))
  .map(f => f.replace(/\.sql$/, ""))
  .sort();

for (const tag of rootSqlFiles) {
  if (KNOWN_GUARDED_TAGS.has(tag)) {
    fail(`${tag}.sql is in migrations/ root AND in KNOWN_GUARDED_TAGS — move it to migrations/guarded/`);
  } else if (!journalTags.has(tag)) {
    fail(`${tag}.sql exists in migrations/ root but has NO journal entry in _journal.json`);
  } else {
    pass(`${tag}`);
  }
}

// ── Rule 2: every journal entry has a root-level .sql file ──────────────────
console.log("\n[Rule 2] Journal entries all have a matching SQL file:");
for (const entry of journal.entries) {
  const sqlPath = path.join(MIGRATIONS_ROOT, `${entry.tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    fail(`Journal entry '${entry.tag}' (idx=${entry.idx}) has no matching ${entry.tag}.sql in migrations/`);
  } else {
    pass(`${entry.tag}`);
  }
}

// ── Rule 3: journal `when` is monotonically non-decreasing + duplicate report ─
console.log("\n[Rule 3] Journal `when` timestamps are non-decreasing (duplicates reported):");
let prevWhen = -1;
let prevTag  = "(start)";
let orderedOk = true;
const whenCounts = new Map<number, string[]>();
for (const e of journal.entries) {
  const bucket = whenCounts.get(e.when) ?? [];
  bucket.push(e.tag);
  whenCounts.set(e.when, bucket);
  if (e.when < prevWhen) {
    // Out-of-order timestamps are a hard failure: Drizzle's migrate() processes
    // entries in `when` order, so an out-of-order new entry is silently skipped.
    fail(`Out-of-order: idx=${e.idx} tag=${e.tag} when=${e.when} < prev '${prevTag}' when=${prevWhen}`);
    orderedOk = false;
  }
  prevWhen = e.when;
  prevTag  = e.tag;
}
// Report duplicate timestamps (historical ones are expected; warn for awareness only).
for (const [when, tags] of whenCounts) {
  if (tags.length > 1) {
    warn(`Duplicate when=${when}: [${tags.join(", ")}] — historical; new entries must use a strictly higher value`);
  }
}
if (orderedOk) {
  pass("All journal `when` timestamps are non-decreasing");
}

// ── Rule 4: required additive migrations exist and contain no destructive SQL ─
console.log("\n[Rule 4] Required additive outbound migrations present and safe:");
for (const tag of REQUIRED_ADDITIVE_TAGS) {
  if (!journalTags.has(tag)) {
    fail(`Required migration '${tag}' is missing from _journal.json`);
    continue;
  }
  const sqlPath = path.join(MIGRATIONS_ROOT, `${tag}.sql`);
  if (!fs.existsSync(sqlPath)) {
    fail(`Required migration '${tag}' has no SQL file`);
    continue;
  }
  const content = fs.readFileSync(sqlPath, "utf8");
  const hit = DESTRUCTIVE_PATTERNS.find(p => p.test(content));
  if (hit) {
    fail(`Migration '${tag}' contains destructive SQL matching pattern ${hit}`);
  } else {
    pass(`${tag} — present, additive-only`);
  }
}

// ── Rule 5: guarded/ files are NOT in the journal ───────────────────────────
console.log("\n[Rule 5] Guarded migrations are absent from journal (intentional gate):");
if (fs.existsSync(GUARDED_DIR)) {
  const guardedFiles = fs.readdirSync(GUARDED_DIR)
    .filter(f => f.endsWith(".sql"))
    .map(f => f.replace(/\.sql$/, ""));
  for (const tag of guardedFiles) {
    if (!KNOWN_GUARDED_TAGS.has(tag)) {
      fail(`migrations/guarded/${tag}.sql exists but is not listed in KNOWN_GUARDED_TAGS in this script — add it`);
    } else if (journalTags.has(tag)) {
      fail(`Guarded migration '${tag}' is also in _journal.json — it must not be in both places`);
    } else {
      pass(`${tag} is in guarded/ and absent from journal`);
    }
  }
  for (const knownTag of KNOWN_GUARDED_TAGS) {
    const filePath = path.join(GUARDED_DIR, `${knownTag}.sql`);
    if (!fs.existsSync(filePath)) {
      fail(`KNOWN_GUARDED_TAGS lists '${knownTag}' but migrations/guarded/${knownTag}.sql does not exist`);
    }
  }
} else {
  fail("migrations/guarded/ directory does not exist — create it and move guarded migrations there");
}

// ── Rule 6: no unaccounted root SQL files ────────────────────────────────────
// Rule 1 already catches root-level .sql files not in the journal. This rule
// catches files that are NEITHER in the journal NOR in KNOWN_GUARDED_TAGS —
// which would indicate an entirely untracked migration file.
console.log("\n[Rule 6] No unaccounted root SQL files (not in journal and not a known guard):");
let unaccountedCount = 0;
for (const tag of rootSqlFiles) {
  if (!journalTags.has(tag) && !KNOWN_GUARDED_TAGS.has(tag)) {
    fail(`${tag}.sql is neither in _journal.json nor in KNOWN_GUARDED_TAGS — it is completely unaccounted for`);
    unaccountedCount++;
  }
}
if (unaccountedCount === 0) {
  pass("All root SQL files are accounted for (journaled or known-guarded)");
}

// ── Rule 7: post-baseline entries must have `when` strictly above HIGH_WATER_WHEN ─
// Uses an immutable baseline anchor (BASELINE_LAST_IDX / BASELINE_LAST_TAG) to
// distinguish historical entries (grandfathered) from post-baseline entries that
// must have `when` strictly above HIGH_WATER_WHEN. A post-baseline entry with
// `when` ≤ HIGH_WATER_WHEN would be silently skipped by Drizzle's migrator cursor
// (see drizzle-out-of-order-journal.md for the full failure mode).
console.log(`\n[Rule 7] Post-baseline entries (idx > ${BASELINE_LAST_IDX}) must have \`when\` > ${HIGH_WATER_WHEN}:`);

// 1. Confirm the baseline anchor still matches the expected tag — guards against
//    history being rewritten or the constant drifting from the actual journal.
const baselineEntry = journal.entries.find(e => e.idx === BASELINE_LAST_IDX);
if (!baselineEntry) {
  fail(`Baseline anchor idx=${BASELINE_LAST_IDX} not found in journal — was history rewritten?`);
} else if (baselineEntry.tag !== BASELINE_LAST_TAG) {
  fail(
    `Baseline anchor idx=${BASELINE_LAST_IDX} has tag '${baselineEntry.tag}' but expected '${BASELINE_LAST_TAG}' — ` +
    `update BASELINE_LAST_IDX/BASELINE_LAST_TAG in this script if history was intentionally changed`
  );
} else {
  pass(`Baseline anchor confirmed: idx=${BASELINE_LAST_IDX} tag=${BASELINE_LAST_TAG} when=${baselineEntry.when}`);
}

// 2. All post-baseline entries must have `when` strictly above HIGH_WATER_WHEN.
const postBaselineEntries = journal.entries.filter(e => e.idx > BASELINE_LAST_IDX);
if (postBaselineEntries.length === 0) {
  pass(`No post-baseline entries (all entries are at or before idx=${BASELINE_LAST_IDX})`);
} else {
  for (const e of postBaselineEntries) {
    if (e.when <= HIGH_WATER_WHEN) {
      fail(
        `Post-baseline entry idx=${e.idx} tag=${e.tag} has when=${e.when} ≤ high-water=${HIGH_WATER_WHEN} — ` +
        `Drizzle would silently skip it; use a when strictly above ${HIGH_WATER_WHEN}`
      );
    } else {
      pass(`idx=${e.idx} ${e.tag}: when=${e.when} > high-water — valid`);
    }
  }
}

// ── Rule 8: 0109 snapshot migration policy classification ───────────────────
console.log("\n[Rule 8] Snapshot migration policy (0109 — fresh-bootstrap only):");
if (!journalTags.has(SNAPSHOT_TAG)) {
  fail(`Snapshot migration '${SNAPSHOT_TAG}' is missing from _journal.json`);
} else {
  const snapshotPath = path.join(MIGRATIONS_ROOT, `${SNAPSHOT_TAG}.sql`);
  if (!fs.existsSync(snapshotPath)) {
    fail(`Snapshot migration '${SNAPSHOT_TAG}' has no SQL file`);
  } else {
    const snapshotContent = fs.readFileSync(snapshotPath, "utf8");
    // 0109 uses bare CREATE TABLE (no IF NOT EXISTS) — it is a snapshot, not idempotent.
    // This is intentional: it runs only on fresh databases (or via the baseline mechanism
    // in db-migrate.ts which records it as already-applied on existing databases).
    const hasIfNotExists = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(snapshotContent);
    const tableCount = (snapshotContent.match(/CREATE\s+TABLE/gi) ?? []).length;
    if (hasIfNotExists) {
      warn(`Snapshot '${SNAPSHOT_TAG}' uses IF NOT EXISTS — it may have been partially updated; verify it is still a pure fresh-bootstrap snapshot.`);
    } else {
      pass(
        `${SNAPSHOT_TAG} classified as fresh-bootstrap-only snapshot ` +
        `(${tableCount} bare CREATE TABLE statements, no IF NOT EXISTS). ` +
        `Safe via db-migrate.ts baseline on existing databases.`
      );
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────");
if (warnings.length > 0) {
  console.log("WARNINGS:");
  warnings.forEach(w => console.log(w));
}

if (errors.length > 0) {
  console.log("\nFAILURES:");
  errors.forEach(e => console.log(e));
  console.log(`\n✗ Migration integrity check FAILED (${errors.length} error(s), ${passed} passed, ${warnings.length} warning(s))`);
  process.exit(1);
} else {
  console.log(`\n✓ Migration integrity check PASSED (${passed} checks, ${warnings.length} warning(s))`);
  process.exit(0);
}
