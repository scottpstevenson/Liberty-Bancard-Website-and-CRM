#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const TESTED_SHA = "78ae07e8c5ffb643467a93dc42b95834d65289a8";
const REGISTER =
  "docs/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_78ae07e8_2026-08-27.md";
const FIXTURE_REGISTER =
  "docs/.tmp_LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_78ae07e8_2026-08-27.md";
const FIXTURE_EVIDENCE =
  "docs/.tmp_VG_RUNTIME_EVIDENCE_PACKET_78ae07e8_2026-08-27.md";
const ISOLATION =
  "Production read-only GET and redacted deployment logs; no network mutation.";

function replaceRow(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("| RV-1548-01 |")) return line;
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
      const headers = [
        "rv id",
        "runtime claim",
        "status",
        "evidence date utc",
        "exact sha",
        "environment",
        "evidence",
        "evidence artifact",
        "isolation boundary",
        "reviewer operator",
        "remaining gap",
        "owner access requirement",
        "expiry recurrence",
        "launch criticality",
      ];
      const index = new Map(headers.map((header, position) => [header, position]));
      cells[index.get("status")!] = "PASS_CURRENT_RELEASE";
      cells[index.get("exact sha")!] = TESTED_SHA;
      cells[index.get("evidence artifact")!] = FIXTURE_EVIDENCE;
      cells[index.get("isolation boundary")!] = ISOLATION;
      cells[index.get("remaining gap")!] = "none";
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
}

function runValidator(expectSuccess: boolean): void {
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/validate-vg-runtime-register.ts", FIXTURE_REGISTER],
    { encoding: "utf8" },
  );
  if (expectSuccess && result.status !== 0) {
    throw new Error(`valid PASS fixture was rejected:\n${result.stdout}\n${result.stderr}`);
  }
  if (expectSuccess && !result.stdout.includes("39/39 unique rows")) {
    throw new Error(`validator returned unexpected output: ${result.stdout}`);
  }
  if (!expectSuccess && result.status === 0) {
    throw new Error("malformed PASS fixture was unexpectedly accepted");
  }
}

try {
  const original = readFileSync(REGISTER, "utf8");
  const fixture = replaceRow(
    original.replace(
      /\*\*Observed published SHA:\*\*\s*`[0-9a-f]{40}`/i,
      `**Observed published SHA:** \`${TESTED_SHA}\``,
    ),
  );
  writeFileSync(FIXTURE_REGISTER, fixture);
  writeFileSync(
    FIXTURE_EVIDENCE,
    `# Temporary validator fixture

<!-- RV-EVIDENCE RV-1548-01
evidence_date=2026-08-27T02:55:09Z
exact_sha=${TESTED_SHA}
environment=Published production
locator=endpoint:https://example.invalid/api/health
result=All published processes reported the exact tested SHA and healthy status.
isolation=${ISOLATION}
-->
`,
  );
  runValidator(true);
  writeFileSync(
    FIXTURE_EVIDENCE,
    readFileSync(FIXTURE_EVIDENCE, "utf8").replace(
      "result=All published processes reported the exact tested SHA and healthy status.",
      "result=ok",
    ),
  );
  runValidator(false);
  console.log("VG register validator valid and malformed PASS fixtures behaved correctly.");
} finally {
  rmSync(FIXTURE_REGISTER, { force: true });
  rmSync(FIXTURE_EVIDENCE, { force: true });
}