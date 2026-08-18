#!/usr/bin/env tsx
/**
 * scripts/scan-tracked-files.ts — Repository file-exposure gate (BT-01)
 *
 * Fails (exit 1) when `git ls-files` contains any prohibited path:
 *   - anything under backups/                          (reason: BACKUP_DIR)
 *   - *.sql.gz / *.gz / *.tgz                          (reason: COMPRESSED_DUMP)
 *   - *.dump / *.bak                                   (reason: DB_DUMP)
 *   - *.sql outside migrations/                        (reason: RAW_SQL_OUTSIDE_MIGRATIONS)
 *   - *.xlsx / *.xls                                   (reason: SPREADSHEET_EXPORT)
 *   - *.zip                                            (reason: ARCHIVE)
 *   - *.csv outside allowlisted skill/data dirs        (reason: CSV_EXPORT)
 *
 * Prints only file paths and reason codes — never file contents.
 * Deterministic: output is sorted; repeated runs on the same tree are identical.
 * Read-only: never deletes or modifies any file.
 *
 * Usage: npx tsx scripts/scan-tracked-files.ts [--dir <repoRoot>]
 */

import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { resolve } from "path";

// Directory prefixes whose CSV files are approved (static reference data or
// synthetic test fixtures, not exports). fixtures/ contains only synthetic
// records ("Reconcile Fixture Alpha LLC", 555 phones) used by import tests.
const CSV_ALLOWLIST_PREFIXES = [".agents/", ".local/", "fixtures/"];

// SQL is only allowed inside the migrations tree
const SQL_ALLOWLIST_PREFIXES = ["migrations/"];

// Explicit approved file paths (reviewed individually — contain no PII/dump data)
const EXACT_ALLOWLIST = new Set([
  "exports/ghl-workflow-checklist.csv", // GHL setup checklist doc, not a data export
  "server/add-indexes.sql", // DDL index script, no data
]);

interface Finding {
  path: string;
  reason: string;
}

export function classify(path: string): string | null {
  if (EXACT_ALLOWLIST.has(path)) return null;
  const lower = path.toLowerCase();
  if (lower.startsWith("backups/") || lower.includes("/backups/")) return "BACKUP_DIR";
  if (lower.endsWith(".sql.gz")) return "COMPRESSED_DUMP";
  if (lower.endsWith(".gz") || lower.endsWith(".tgz")) return "COMPRESSED_DUMP";
  if (lower.endsWith(".dump") || lower.endsWith(".bak")) return "DB_DUMP";
  if (lower.endsWith(".sql")) {
    if (SQL_ALLOWLIST_PREFIXES.some((p) => lower.startsWith(p))) return null;
    return "RAW_SQL_OUTSIDE_MIGRATIONS";
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "SPREADSHEET_EXPORT";
  if (lower.endsWith(".zip")) return "ARCHIVE";
  if (lower.endsWith(".csv")) {
    if (CSV_ALLOWLIST_PREFIXES.some((p) => lower.startsWith(p))) return null;
    return "CSV_EXPORT";
  }
  return null;
}

export function scanTree(repoDir: string): Finding[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoDir,
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8");
  const files = raw.split("\0").filter(Boolean);
  const findings: Finding[] = [];
  for (const path of files) {
    const reason = classify(path);
    if (reason) findings.push({ path, reason });
  }
  findings.sort((a, b) => a.path.localeCompare(b.path));
  return findings;
}

function main() {
  const dirIdx = process.argv.indexOf("--dir");
  const repoDir = dirIdx !== -1 ? process.argv[dirIdx + 1] : process.cwd();

  const findings = scanTree(repoDir);

  if (findings.length === 0) {
    console.log("scan-tracked-files: PASS — no prohibited tracked files found");
    process.exit(0);
  }

  console.error(`scan-tracked-files: FAIL — ${findings.length} prohibited tracked file(s):`);
  for (const f of findings) {
    console.error(`  [${f.reason}] ${f.path}`);
  }
  console.error(
    "\nRemove with `git rm --cached <path>` and ensure the pattern is in .gitignore.",
  );
  process.exit(1);
}

// Run only when executed directly (exact entrypoint match; never on import)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
