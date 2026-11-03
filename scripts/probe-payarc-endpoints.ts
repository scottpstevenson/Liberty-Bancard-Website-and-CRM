#!/usr/bin/env npx tsx
/**
 * probe-payarc-endpoints.ts — bounded, read-only Payarc ACCESS canary (Task #1777)
 *
 * Replaces the earlier speculative scan. One run = one explicitly selected environment and one
 * documented read, sent with the matching credential class only. Output is redacted receipts
 * (status/schema/count) — never bodies, identifiers, amounts, or credential values.
 *
 * Opt-in only (never part of default suites):
 *   PAYARC_SANDBOX_LIVE=1
 *   PAYARC_PARTNER_KEY_ENVIRONMENT=sandbox|production    (non-secret declaration for PAYARC_API_KEY)
 *   PAYARC_MERCHANT_KEY_ENVIRONMENT=sandbox|production   (non-secret declaration for PAYARC_MERCHANT_API_KEY)
 *
 * Usage:
 *   PAYARC_SANDBOX_LIVE=1 npx tsx scripts/probe-payarc-endpoints.ts \
 *     --environment sandbox --operation dispute-chart --from 2026-10-01 --to 2026-10-31
 *   ... --operation batch-reports --batch-placement query --from 2026-10-01 --to 2026-10-07
 *   ... --operation batch-placement-compare --from 2026-10-01
 *   ... --operation residual-summary --bank <4-digit bank> --from 2026-09-01 --to 2026-09-30
 *   (production host reads additionally require --allow-production-read)
 *
 * Operations: identity | merchant-identity | batch-reports | batch-placement-compare |
 *   residual-summary | residual-table-summaries | residual-details | dispute-cases |
 *   dispute-chart | charges | statements | webhooks-list
 *
 * A 401/403 on a partner endpoint is reported as an ENTITLEMENT result (Payarc must enable it),
 * not a code failure. No OAuth exchange, token reveal, /residuals, Connect, upload, or webhook
 * write is ever attempted, and no other host or credential class is tried.
 */
import { CANARY_OPERATIONS, runCanary, type CanaryOperation } from "../server/services/processors/payarc-access-canary";
import type { BatchFilterPlacement, PayarcEnvironment } from "../server/services/processors/payarc-report-types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const environment = arg("--environment") as PayarcEnvironment | undefined;
  const operation = arg("--operation") as CanaryOperation | undefined;
  if ((environment !== "sandbox" && environment !== "production") || !operation || !(operation in CANARY_OPERATIONS)) {
    console.error(
      `Usage: --environment sandbox|production --operation <${Object.keys(CANARY_OPERATIONS).join("|")}> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--bank NNNN] [--batch-placement query|body] [--allow-production-read]`,
    );
    process.exit(2);
  }
  const placement = arg("--batch-placement");
  if (placement !== undefined && placement !== "query" && placement !== "body") {
    console.error("--batch-placement must be query or body");
    process.exit(2);
  }
  const receipt = await runCanary(
    {
      environment,
      operation,
      fromDate: arg("--from"),
      toDate: arg("--to"),
      bank: arg("--bank"),
      batchPlacement: placement as BatchFilterPlacement | undefined,
      allowProductionRead: process.argv.includes("--allow-production-read"),
    },
    { env: process.env },
  );
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), receipt }, null, 2));
  // Exit non-zero only for refusals/misconfiguration; an entitlement result is evidence, not a crash.
  process.exit(receipt.freshAccess === "not_attempted" ? 1 : 0);
}

main().catch((e) => {
  console.error("[payarc-canary] fatal:", e?.message ?? e);
  process.exit(1);
});
