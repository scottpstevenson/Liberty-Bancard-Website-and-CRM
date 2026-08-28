#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";

export type AuditSummary = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  total: number;
};

export function enforceAuditJson(raw: string, exitCode: number | null): AuditSummary {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("npm audit returned malformed JSON");
  }
  const summary = parsed?.metadata?.vulnerabilities;
  if (!summary || !["critical", "high", "moderate", "low", "total"].every((key) => Number.isInteger(summary[key]) && summary[key] >= 0)) {
    throw new Error("npm audit JSON is missing a valid vulnerability summary");
  }
  if (exitCode === null || exitCode > 1 || parsed.error) {
    throw new Error("npm audit scanner failed");
  }
  if (summary.critical || summary.high) {
    throw new Error(`npm audit policy rejected ${summary.critical} critical and ${summary.high} high findings`);
  }
  return summary;
}

export function runAudit(args: string[]): AuditSummary {
  const result = spawnSync("npm", ["audit", "--json", "--registry=https://registry.npmjs.org", ...args], {
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "true" },
    maxBuffer: 16 * 1024 * 1024,
  });
  return enforceAuditJson(result.stdout, result.status);
}

if (process.argv[1]?.endsWith("dependency-audit-policy.ts")) {
  const full = runAudit([]);
  const production = runAudit(["--omit=dev"]);
  console.log(JSON.stringify({ policy: "fail on reachable critical/high", full, production }, null, 2));
}