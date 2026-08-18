#!/usr/bin/env tsx
/**
 * scripts/test-scan-tracked-files.ts — Regression tests for the file-exposure gate
 *
 * Builds a throwaway git repo in a temp dir with ONLY synthetic fixtures
 * (tiny text files with fake names — no real backups, exports, or PII),
 * then asserts blocked/allowed behavior of scripts/scan-tracked-files.ts.
 *
 * Never touches the real repository or any real sensitive file.
 */

import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { classify, scanTree } from "./scan-tracked-files";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Unit tests: classify() ────────────────────────────────────────────────────
console.log("classify():");
check("backups dir blocked", classify("backups/db-backup-x.sql.gz") === "BACKUP_DIR");
check("nested backups dir blocked", classify("data/backups/x.txt") === "BACKUP_DIR");
check(".sql.gz blocked anywhere", classify("attached_assets/x.sql.gz") === "COMPRESSED_DUMP");
check(".gz blocked", classify("logs/app.log.gz") === "COMPRESSED_DUMP");
check(".tar.gz blocked", classify("build/out.tar.gz") === "COMPRESSED_DUMP");
check(".dump blocked", classify("db.dump") === "DB_DUMP");
check(".bak blocked", classify("schema.bak") === "DB_DUMP");
check(".xlsx blocked", classify("attached_assets/leads.xlsx") === "SPREADSHEET_EXPORT");
check(".xls blocked", classify("old_leads.xls") === "SPREADSHEET_EXPORT");
check(".zip blocked", classify("attached_assets/cordata.zip") === "ARCHIVE");
check("csv outside allowlist blocked", classify("exports/contacts.csv") === "CSV_EXPORT");
check("renamed csv in root blocked", classify("contacts_renamed.csv") === "CSV_EXPORT");
check("sql outside migrations blocked", classify("scripts/dump.sql") === "RAW_SQL_OUTSIDE_MIGRATIONS");
check("migrations sql allowed", classify("migrations/0001_init.sql") === null);
check("migrations nested sql allowed", classify("migrations/guarded/x.sql") === null);
check("skill csv allowed", classify(".agents/skills/x/data/colors.csv") === null);
check("fixture csv allowed", classify("fixtures/csv-import/reconciliation_mixed.csv") === null);
check("exact-allowlisted checklist csv allowed", classify("exports/ghl-workflow-checklist.csv") === null);
check("exact-allowlisted ddl sql allowed", classify("server/add-indexes.sql") === null);
check("other exports csv still blocked", classify("exports/contacts_dump.csv") === "CSV_EXPORT");
check("other server sql still blocked", classify("server/data.sql") === "RAW_SQL_OUTSIDE_MIGRATIONS");
check("ts source allowed", classify("server/index.ts") === null);
check("png asset allowed", classify("attached_assets/logo.png") === null);
check("md doc allowed", classify("docs/history-cleanup-runbook.md") === null);
check("uppercase extension blocked", classify("Leads.XLSX") === "SPREADSHEET_EXPORT");

// ── Integration tests: scanTree() against a synthetic repo ───────────────────
console.log("scanTree() on synthetic repo:");
const tmp = mkdtempSync(join(tmpdir(), "scan-test-"));
try {
  execFileSync("git", ["init", "-q"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "test"], { cwd: tmp });

  const fixtures: Record<string, string> = {
    // allowed
    "server/index.ts": "// ok",
    "migrations/0001_init.sql": "-- synthetic",
    ".agents/skills/demo/data/ref.csv": "a,b",
    "attached_assets/logo.png": "not-a-real-png",
    // prohibited (all synthetic tiny text files)
    "backups/db-backup-synthetic.sql.gz": "synthetic",
    "attached_assets/synthetic_leads.xlsx": "synthetic",
    "exports/renamed_export.csv": "synthetic",
    "deep/nested/dir/archive.zip": "synthetic",
    "scripts/raw.sql": "-- synthetic",
  };
  for (const [rel, content] of Object.entries(fixtures)) {
    const abs = join(tmp, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  execFileSync("git", ["add", "-A", "-f"], { cwd: tmp });
  execFileSync("git", ["commit", "-qm", "fixtures"], { cwd: tmp });

  const findings = scanTree(tmp);
  const paths = findings.map((f) => f.path);

  check("finds exactly 5 prohibited files", findings.length === 5, `got ${findings.length}: ${paths.join(", ")}`);
  check("backup detected", paths.includes("backups/db-backup-synthetic.sql.gz"));
  check("xlsx detected", paths.includes("attached_assets/synthetic_leads.xlsx"));
  check("renamed csv detected", paths.includes("exports/renamed_export.csv"));
  check("nested zip detected", paths.includes("deep/nested/dir/archive.zip"));
  check("raw sql detected", paths.includes("scripts/raw.sql"));
  check("allowed files not flagged", !paths.some((p) => p.endsWith(".ts") || p.endsWith(".png") || p.startsWith("migrations/") || p.startsWith(".agents/")));
  check("output contains no file contents", !JSON.stringify(findings).includes("synthetic\n"));

  // Determinism: repeated scans identical
  const findings2 = scanTree(tmp);
  check("repeated scan is deterministic", JSON.stringify(findings) === JSON.stringify(findings2));

  // CLI exit codes
  let exitBlocked = 0;
  try {
    execFileSync("npx", ["tsx", join(process.cwd(), "scripts/scan-tracked-files.ts"), "--dir", tmp], { stdio: "pipe" });
  } catch (e: any) {
    exitBlocked = e.status;
  }
  check("CLI exits 1 on prohibited tree", exitBlocked === 1);

  // Clean tree passes
  for (const rel of Object.keys(fixtures)) {
    if (classify(rel)) execFileSync("git", ["rm", "-q", "--cached", rel], { cwd: tmp });
  }
  execFileSync("git", ["commit", "-qm", "clean"], { cwd: tmp });
  const cleanFindings = scanTree(tmp);
  check("clean tree yields zero findings", cleanFindings.length === 0);
  let exitClean = -1;
  try {
    execFileSync("npx", ["tsx", join(process.cwd(), "scripts/scan-tracked-files.ts"), "--dir", tmp], { stdio: "pipe" });
    exitClean = 0;
  } catch (e: any) {
    exitClean = e.status;
  }
  check("CLI exits 0 on clean tree", exitClean === 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
