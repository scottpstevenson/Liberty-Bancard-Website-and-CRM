/**
 * scan-contactability-authority-bypass.ts — Task #1956 step 8 census guard.
 *
 * server/services/contactability.ts's evaluateContactDecisions() (plus its
 * business-level siblings evaluateBusinessEnrichmentEligibility() and
 * evaluateBusinessPromotionEligibility()) is the single authority for four
 * eligibility dimensions: data-hygiene, enrichment/provider, promotion, and
 * send. Every consumer enumerated in the task must obtain its decision from
 * there rather than re-deriving DBPR-lineage / existing-customer / promotion
 * logic locally.
 *
 * This script has two jobs:
 *
 *  1. Confirm each enumerated consumer file still contains a call into the
 *     authority (either the contact-level or business-level entry points).
 *     If a future refactor removes the call without replacing it, this
 *     fails loudly instead of silently reopening the bypass.
 *
 *  2. Flag any file OUTSIDE contactability.ts / dbpr.ts that re-implements a
 *     DBPR-lineage check by calling businessHasDbprLineageSql /
 *     businessLacksDbprLineageSql directly instead of going through the
 *     authority. A local canonical-predicate call at the ingestion/cohort
 *     SQL-filter layer (defense-in-depth, e.g. mi09-pilot-authority.ts's
 *     WHERE clause) is allowed — it composes with the authority's own
 *     post-query re-check — but net-new call sites should be reviewed.
 *
 * Run: npx tsx scripts/scan-contactability-authority-bypass.ts
 */

import { execFileSync } from "child_process";

const ROOT = process.cwd();
const SELF = "scripts/scan-contactability-authority-bypass.ts";

// file -> substring(s) that must appear somewhere in the file, proving it
// calls into the shared authority for at least one of the four dimensions.
const REQUIRED_CONSUMERS: Record<string, string[]> = {
  "server/services/mi09-pilot-authority.ts": ["evaluateBusinessEnrichmentEligibility"],
  "server/services/master-leads/pipeline-promotion.ts": ["evaluateBusinessPromotionEligibility"],
  "server/services/cr04-cohort-ready-authority.ts": ["evaluateContactability", "evaluateContactDecisions"],
  "server/services/bulk-enrollment-job.ts": ["evaluateContactability", "evaluateContactDecisions"],
  "server/services/ghl-workflow-enrollment.ts": ["evaluateContactability", "evaluateContactDecisions"],
  "server/services/campaign-engine.ts": ["evaluateContactability", "evaluateContactDecisions"],
  "server/services/sequence-worker.ts": ["evaluateContactability"],
};

// Files allowed to call the raw DBPR-lineage SQL predicates directly — either
// the canonical module itself, the shared authority that wraps them, or a
// SQL-layer cohort filter that composes with (does not replace) the authority.
const ALLOWED_DIRECT_DBPR_PREDICATE_CALLERS = new Set([
  "server/services/dbpr.ts", // definition site
  "server/services/contactability.ts", // the authority itself
  "server/services/mi09-pilot-authority.ts", // SQL-layer filter, authority re-checked after
  "server/services/master-leads/pipeline-promotion.ts", // historical; now routed via the authority — kept allowed for its own read helpers if reintroduced
  // Pre-existing reviewed call sites from Steps 1-7 (canonical DBPR predicate
  // module rollout), out of scope for the step 8 four-dimension authority —
  // these are ingestion/queue/cohort SQL-filter layers, not outreach/
  // promotion/enrichment eligibility decisions this authority governs.
  "server/services/queue-manager.ts",
  "server/services/provider-readiness-control.ts",
  "server/workers/cro08a-scheduler.worker.ts",
  // cro08a/source-scope.ts defines its OWN local isDbprSourceSystem() (a
  // different, cro08a-scoped classifier) — not a call into dbpr.ts's export.
  "server/services/cro08a/source-scope.ts",
]);

function ripgrep(pattern: string): string[] {
  try {
    const args = ["--no-heading", "--line-number", "-g", "*.ts", "-e", pattern, "server", "scripts"];
    const out = execFileSync("rg", args, { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch (err: any) {
    if (err?.status === 1) return []; // rg: no matches
    throw err;
  }
}

function fileContains(file: string, needle: string): boolean {
  try {
    const out = execFileSync("grep", ["-c", "--", needle, file], { cwd: ROOT, encoding: "utf8" });
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

function main() {
  const offenders: string[] = [];

  // 1. Every enumerated consumer must still call into the authority.
  for (const [file, anyOf] of Object.entries(REQUIRED_CONSUMERS)) {
    const found = anyOf.some((needle) => fileContains(file, needle));
    if (!found) {
      offenders.push(
        `[missing authority call] ${file} no longer calls any of: ${anyOf.join(", ")} — a bypass may have been reintroduced.`
      );
    }
  }

  // 2. Any NEW direct caller of the raw DBPR predicates outside the allowlist
  //    is a candidate reintroduction of local DBPR logic instead of the authority.
  for (const line of ripgrep("\\b(businessHasDbprLineageSql|businessLacksDbprLineageSql|isDbprSourceSystem)\\(")) {
    const file = line.split(":")[0].replace(/\\/g, "/");
    if (file === SELF) continue;
    if (ALLOWED_DIRECT_DBPR_PREDICATE_CALLERS.has(file)) continue;
    // Disposable test/parity scripts exercise the predicate directly by
    // design (they verify the predicate itself, or seed fixtures) — not
    // production eligibility decisions this authority governs.
    if (file.startsWith("scripts/test-")) continue;
    offenders.push(`[unreviewed direct DBPR predicate call] ${line}`);
  }

  const unique = [...new Set(offenders)];
  if (unique.length > 0) {
    console.error("✗ Contactability authority bypass census failed:");
    console.error("  A required consumer stopped calling the shared authority, or a new");
    console.error("  file started re-deriving DBPR-lineage logic locally instead of");
    console.error("  going through evaluateContactDecisions() / evaluateBusiness*Eligibility().");
    for (const o of unique) console.error(`  ${o}`);
    process.exit(1);
  }

  console.log("✓ Contactability authority census clean — every enumerated consumer routes through the shared engine.");
  process.exit(0);
}

main();
