/**
 * scan-serper-raw-fetch.ts — Serper gateway compliance scan (#1600)
 *
 * Scans all .ts/.js files under server/ and scripts/ for raw Serper API
 * usage (the provider hostname or direct fetches to it). The ONLY approved
 * file is server/services/serper-gateway.ts. Any other match fails the scan
 * (exit 1) so CI/pre-deploy blocks the change.
 *
 * Run: npx tsx scripts/scan-serper-raw-fetch.ts
 */

import { execFileSync } from "child_process";

const ROOT = process.cwd();

// Built from pieces so this scanner never flags itself.
const HOST = ["google", "serper", "dev"].join("\\.");
const PATTERNS = [
  HOST, // any reference to the provider hostname
  `fetch\\(.*['"]https://${["google", "serper"].join("\\.")}`, // direct fetch to the API
];

const APPROVED_FILES = new Set([
  "server/services/serper-gateway.ts",
]);

function ripgrep(pattern: string): string[] {
  try {
    const out = execFileSync(
      "rg",
      ["--no-heading", "--line-number", "-g", "*.ts", "-g", "*.js", "-e", pattern, "server", "scripts"],
      { cwd: ROOT, encoding: "utf8" },
    );
    return out.split("\n").filter(Boolean);
  } catch (err: any) {
    // rg exits 1 when no matches found — that is a clean result.
    if (err?.status === 1) return [];
    throw err;
  }
}

function main() {
  const offenders: string[] = [];
  for (const pattern of PATTERNS) {
    for (const line of ripgrep(pattern)) {
      const file = line.split(":")[0].replace(/\\/g, "/");
      if (APPROVED_FILES.has(file)) continue;
      if (file === "scripts/scan-serper-raw-fetch.ts") continue;
      offenders.push(line);
    }
  }

  const unique = [...new Set(offenders)];
  if (unique.length > 0) {
    console.error("✗ Raw Serper API usage found outside the approved gateway file:");
    console.error("  (all Serper calls must go through server/services/serper-gateway.ts)");
    for (const line of unique) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log("✓ Serper raw-fetch scan clean — all calls flow through the canonical gateway.");
  process.exit(0);
}

main();
