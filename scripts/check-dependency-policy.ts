#!/usr/bin/env tsx
import { buildEvidence } from "./dependency-policy-evidence";

const evidence = buildEvidence(process.cwd(), true);
const errors = evidence.findings.filter((finding: { severity: string }) => finding.severity === "error");
if (errors.length) {
  throw new Error(`root dependency policy failed with ${errors.length} error(s)`);
}
console.log(
  `check-dependency-policy: PASS — ${evidence.lockfile.packageCount} packages, ` +
  `${evidence.lockfile.sourceHosts.join(", ")}`,
);