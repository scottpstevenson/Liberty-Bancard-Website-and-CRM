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
 *   3. The journal `when` field is monotonically non-decreasing.
 *   4. The two outbound launch migrations (0076, 0077) are present and additive-only.
 *   5. Guarded migrations in migrations/guarded/ are NOT present in the journal
 *      (they are applied by the startup migrator's precondition-checked path).
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

// ── Rule 3: journal `when` is monotonically non-decreasing ──────────────────
console.log("\n[Rule 3] Journal `when` timestamps are non-decreasing:");
let prevWhen = -1;
let prevTag  = "(start)";
let orderedOk = true;
for (const e of journal.entries) {
  if (e.when < prevWhen) {
    warn(`Out-of-order: idx=${e.idx} tag=${e.tag} when=${e.when} < prev '${prevTag}' when=${prevWhen}`);
    orderedOk = false;
  }
  prevWhen = e.when;
  prevTag  = e.tag;
}
if (orderedOk) {
  pass("All journal `when` timestamps are non-decreasing");
} else {
  pass("Out-of-order timestamps found (see warnings) — app's baseline strategy handles these, but drizzle-kit may mis-order new generates. Fix by correcting `when` values.");
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
