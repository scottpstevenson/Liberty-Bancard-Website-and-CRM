#!/usr/bin/env tsx
/**
 * Validate the generated VG runtime register against the immutable source
 * register. This is intentionally strict: an omitted, duplicated, pending,
 * malformed, or weakly evidenced row must fail the certification.
 *
 * Usage:
 *   npx tsx scripts/validate-vg-runtime-register.ts \
 *     docs/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_<SHA8>_<DATE>.md
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_PATH =
  "attached_assets/LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER_1786901209005.md";
const EXPECTED_SOURCE_SHA256 =
  "a97f1772aa6a494ac46c13009c50adade1c7c000b7df3f5eec2e5ab90dc9e897";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ALLOWED_STATUSES = new Set([
  "PASS_CURRENT_RELEASE",
  "FAIL_CURRENT_RELEASE",
  "DEPLOYMENT_REQUIRED",
  "ACCESS_REQUIRED",
  "INCONCLUSIVE",
  "SUPERSEDED",
  "NOT_APPLICABLE",
]);
const REQUIRED_COLUMNS = [
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

const EXPECTED_IDS = [
  "RV-1548-01", "RV-1548-02", "RV-1548-03", "RV-1548-04",
  "RV-1548-05", "RV-1548-06", "RV-1548-07", "RV-1548-08",
  "RV-OUT-01", "RV-OUT-02", "RV-OUT-03", "RV-OUT-04", "RV-OUT-05",
  "RV-QUE-01", "RV-QUE-02", "RV-QUE-03", "RV-QUE-04", "RV-CI-01",
  "RV-ZB-01", "RV-ZB-02", "RV-ZB-03",
  "RV-DAT-01", "RV-DAT-02", "RV-DAT-03", "RV-DAT-04",
  "RV-ENR-01", "RV-ENR-02", "RV-ENR-03", "RV-ENR-04",
  "RV-ENR-05", "RV-ENR-06", "RV-ENR-07",
  "RV-GHL-01", "RV-GHL-02",
  "RV-UI-01", "RV-UI-02", "RV-UI-03",
  "RV-REV-01", "RV-REV-02",
];

function fail(message: string): never {
  throw new Error(`VG register validation failed: ${message}`);
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ");
}

function splitRow(line: string): string[] {
  if (!line.trim().startsWith("|")) return [];
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractIds(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*(RV-[A-Z0-9-]+)\s*\|/i)?.[1])
    .filter((id): id is string => Boolean(id));
}

function extractSourceClaims(markdown: string): Map<string, string> {
  const claims = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const cells = splitRow(line);
    if (/^RV-[A-Z0-9-]+$/i.test(cells[0] ?? "") && cells[1]) {
      claims.set(cells[0], cells[1]);
    }
  }
  return claims;
}

function assertExactIds(label: string, ids: string[]): void {
  if (ids.length !== EXPECTED_IDS.length) {
    fail(`${label} must contain exactly ${EXPECTED_IDS.length} rows; found ${ids.length}`);
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) fail(`${label} contains duplicate IDs: ${[...new Set(duplicates)].join(", ")}`);
  const missing = EXPECTED_IDS.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !EXPECTED_IDS.includes(id));
  if (missing.length > 0) fail(`${label} is missing IDs: ${missing.join(", ")}`);
  if (extra.length > 0) fail(`${label} contains unexpected IDs: ${extra.join(", ")}`);
}

function readEvidenceArtifact(value: string, id: string): string {
  const artifactPath = value.split("#", 1)[0]?.trim() ?? "";
  if (
    !artifactPath.startsWith("docs/") ||
    artifactPath.includes("..") ||
    !artifactPath.endsWith(".md")
  ) {
    fail(`${id} evidence artifact must be a workspace-relative Markdown file under docs/`);
  }
  try {
    return readFileSync(artifactPath, "utf8");
  } catch {
    fail(`${id} evidence artifact does not exist: ${artifactPath}`);
  }
}

function main(): void {
  const outputPath = process.argv[2];
  if (!outputPath) fail("provide the generated register path as the first argument");

  const source = readFileSync(SOURCE_PATH, "utf8");
  const sourceSha = createHash("sha256").update(source).digest("hex");
  if (sourceSha !== EXPECTED_SOURCE_SHA256) {
    fail(`immutable source checksum changed: expected ${EXPECTED_SOURCE_SHA256}, got ${sourceSha}`);
  }
  assertExactIds("source register", extractIds(source));
  const sourceClaims = extractSourceClaims(source);

  const output = readFileSync(outputPath, "utf8");
  if (!output.includes(`**Source SHA-256:** \`${EXPECTED_SOURCE_SHA256}\``)) {
    fail("generated register does not declare the immutable source checksum");
  }
  const testedSha = output.match(/\*\*Tested live-main SHA:\*\*\s*`([0-9a-f]{40})`/i)?.[1];
  if (!testedSha) fail("generated register does not declare one full tested live-main SHA");
  const observedSha = output.match(/\*\*Observed published SHA:\*\*\s*`([0-9a-f]{40})`/i)?.[1];
  if (!observedSha) fail("generated register does not declare one full observed published SHA");
  const basename = path.basename(outputPath);
  if (!basename.includes(testedSha.slice(0, 8)) || !/\d{4}-\d{2}-\d{2}/.test(basename)) {
    fail("generated register filename must include the tested SHA8 and an ISO date");
  }
  const lines = output.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const cells = splitRow(line).map(normalize);
    return cells.includes("rv id") && cells.includes("status");
  });
  if (headerIndex < 0) fail("generated register has no table header containing RV ID and Status");

  const headers = splitRow(lines[headerIndex]).map(normalize);
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  for (const required of REQUIRED_COLUMNS) {
    if (!columnIndex.has(required)) fail(`generated register is missing required column "${required}"`);
  }

  const rows = lines
    .slice(headerIndex + 1)
    .map(splitRow)
    .filter((cells) => /^RV-[A-Z0-9-]+$/i.test(cells[0] ?? ""));
  assertExactIds("generated register", rows.map((cells) => cells[0]));

  for (const cells of rows) {
    const id = cells[columnIndex.get("rv id")!]?.trim();
    const runtimeClaim = cells[columnIndex.get("runtime claim")!]?.trim() ?? "";
    if (runtimeClaim !== sourceClaims.get(id)) {
      fail(`${id} runtime claim does not exactly match the immutable source register`);
    }
    const status = cells[columnIndex.get("status")!]?.trim();
    if (!ALLOWED_STATUSES.has(status)) {
      fail(`${id} has invalid or pending status "${status || "<empty>"}"`);
    }
    for (const required of REQUIRED_COLUMNS.slice(2)) {
      const value = cells[columnIndex.get(required)!]?.trim() ?? "";
      if (!value || /^(?:tbd|todo|pending|unknown)$/i.test(value)) {
        fail(`${id} has missing ${required}`);
      }
    }
    const evidenceDate = cells[columnIndex.get("evidence date utc")!]?.trim() ?? "";
    const parsedEvidenceDate = new Date(evidenceDate);
    const roundTrippedDate = Number.isNaN(parsedEvidenceDate.getTime())
      ? ""
      : parsedEvidenceDate.toISOString().replace(".000Z", "Z");
    if (!DATE_PATTERN.test(evidenceDate) || roundTrippedDate !== evidenceDate) {
      fail(`${id} has invalid UTC evidence timestamp "${evidenceDate}"`);
    }
    if (!basename.includes(evidenceDate.slice(0, 10))) {
      fail(`${id} evidence date does not match the generated register filename date`);
    }
    const sha = cells[columnIndex.get("exact sha")!]?.trim() ?? "";
    if (!SHA_PATTERN.test(sha)) fail(`${id} exact SHA must be one full 40-character SHA`);
    const evidenceArtifact = cells[columnIndex.get("evidence artifact")!]?.trim() ?? "";
    const evidenceArtifactContent = readEvidenceArtifact(evidenceArtifact, id);

    if (status === "PASS_CURRENT_RELEASE") {
      const environment = cells[columnIndex.get("environment")!]?.trim() ?? "";
      const isolation = cells[columnIndex.get("isolation boundary")!]?.trim() ?? "";
      const remainingGap = cells[columnIndex.get("remaining gap")!]?.trim() ?? "";
      if (
        sha.toLowerCase() !== testedSha.toLowerCase() ||
        testedSha.toLowerCase() !== observedSha.toLowerCase()
      ) {
        fail(`${id} PASS_CURRENT_RELEASE requires row, tested, and observed deployed SHAs to match`);
      }
      const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const block = evidenceArtifactContent.match(
        new RegExp(`<!-- RV-EVIDENCE ${escapedId}\\n([\\s\\S]*?)\\n-->`),
      )?.[1];
      if (!block) fail(`${id} PASS_CURRENT_RELEASE has no machine-readable evidence block`);
      const fields = new Map(
        block
          .split(/\r?\n/)
          .map((line) => line.split(/=(.*)/s))
          .filter((parts) => parts.length >= 2)
          .map(([key, value]) => [key.trim(), value.trim()]),
      );
      if (
        fields.get("evidence_date") !== evidenceDate ||
        fields.get("exact_sha")?.toLowerCase() !== sha.toLowerCase() ||
        fields.get("environment") !== environment
      ) {
        fail(`${id} PASS_CURRENT_RELEASE evidence block does not match row identity`);
      }
      const locator = fields.get("locator") ?? "";
      const result = fields.get("result") ?? "";
      const isolationProof = fields.get("isolation") ?? "";
      if (!/^(?:command|query|endpoint|artifact):\S.{4,}$/i.test(locator)) {
        fail(`${id} PASS_CURRENT_RELEASE evidence block has no substantive locator`);
      }
      if (result.length < 20 || /^(?:pass|ok|success|tbd|todo|x)$/i.test(result)) {
        fail(`${id} PASS_CURRENT_RELEASE evidence block has no substantive redacted result`);
      }
      if (
        isolationProof.length < 20 ||
        !/(?:disposable|read-only|fake transport|no network)/i.test(isolationProof) ||
        isolationProof !== isolation
      ) {
        fail(`${id} PASS_CURRENT_RELEASE evidence block has no matching isolation proof`);
      }
      if (!/^none(?:\.)?$/i.test(remainingGap)) {
        fail(`${id} PASS_CURRENT_RELEASE must record remaining gap as none`);
      }
    }
  }

  console.log(
    `VG register structural and fail-closed validation passed: ${rows.length}/${EXPECTED_IDS.length} unique rows`,
  );
}

main();