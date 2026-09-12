#!/usr/bin/env npx tsx
/**
 * scripts/seed-mi09-pricing.ts (task #1940)
 * ─────────────────────────────────────────────────────────────────────────
 * Permanent, idempotent operator command that seeds the 9 MI-09 pricing
 * artifacts and a matching pricing schedule snapshot. This is the ONLY
 * sanctioned way to populate mi09_pricing_artifacts /
 * mi09_pricing_schedule_snapshots outside the CRO-03D ceremony's own
 * authorized flow.
 *
 * Dry-run by default. Writing requires BOTH:
 *   --apply
 *   --confirm-env=<NODE_ENV>   (must match the live process.env.NODE_ENV)
 *
 * No direct SQL: all writes go through `reuseOrCreatePricingArtifact()` and
 * `createPricingScheduleSnapshot()` in server/services/mi09-pilot-authority.ts.
 * No provider I/O of any kind — this script never calls fetch, an SDK
 * client, or any external HTTP endpoint.
 *
 * Usage:
 *   npx tsx scripts/seed-mi09-pricing.ts                              (dry-run)
 *   npx tsx scripts/seed-mi09-pricing.ts --apply --confirm-env=development
 */
import {
  reuseOrCreatePricingArtifact,
  createPricingScheduleSnapshot,
} from "../server/services/mi09-pilot-authority";
import {
  MI09_PRICING_SEED_TABLE,
  MI09_PRICING_CAPTURED_BY,
  MI09_PRICING_ARTIFACT_VERSION,
  MI09_PRICING_CURRENCY,
  MI09_PRICING_ACCOUNT_BALANCE_UNITS,
} from "../server/services/cro03/mi09-pricing-seed-data";

function parseArgs(argv: readonly string[]) {
  const apply = argv.includes("--apply");
  const confirmArg = argv.find((a) => a.startsWith("--confirm-env="));
  const confirmEnv = confirmArg ? confirmArg.slice("--confirm-env=".length) : null;
  return { apply, confirmEnv };
}

async function run(): Promise<void> {
  const { apply, confirmEnv } = parseArgs(process.argv.slice(2));
  const currentEnv = process.env.NODE_ENV ?? "development";

  console.log("MI-09 Pricing Artifact Seed (task #1940)");
  console.log(`  Mode          : ${apply ? "APPLY (will write)" : "DRY-RUN (no writes)"}`);
  console.log(`  NODE_ENV      : ${currentEnv}`);
  console.log(`  Providers     : ${MI09_PRICING_SEED_TABLE.length}`);
  console.log("");

  if (apply) {
    if (!confirmEnv) {
      console.error(
        "✗ --apply requires --confirm-env=<environment> naming the CURRENT NODE_ENV explicitly.",
      );
      process.exit(1);
    }
    if (confirmEnv !== currentEnv) {
      console.error(
        `✗ --confirm-env=${confirmEnv} does not match the live NODE_ENV=${currentEnv}. Refusing to write.`,
      );
      process.exit(1);
    }
  }

  const artifactResults: { providerKey: string; id: string | null; reused: boolean | null }[] = [];

  for (const row of MI09_PRICING_SEED_TABLE) {
    if (!apply) {
      console.log(
        `  [dry-run] would seed ${row.providerKey.padEnd(16)} unitType=${row.unitType.padEnd(9)} ` +
        `amountMicros=${row.amountMicros.toString().padEnd(7)} billingSemantics=${row.billingSemantics}`,
      );
      artifactResults.push({ providerKey: row.providerKey, id: null, reused: null });
      continue;
    }
    const result = await reuseOrCreatePricingArtifact({
      providerKey: row.providerKey,
      unitType: row.unitType,
      amountMicros: row.amountMicros,
      currency: MI09_PRICING_CURRENCY,
      billingSemantics: row.billingSemantics,
      capturedBy: MI09_PRICING_CAPTURED_BY,
      accountBalanceUnits: MI09_PRICING_ACCOUNT_BALANCE_UNITS ?? undefined,
      sourceUrl: row.sourceUrl ?? undefined,
      artifactVersion: MI09_PRICING_ARTIFACT_VERSION,
    });
    console.log(
      `  ${result.reused ? "reused " : "created"} artifact id=${result.id} provider=${row.providerKey} ` +
      `unitType=${row.unitType} amountMicros=${row.amountMicros}`,
    );
    artifactResults.push({ providerKey: row.providerKey, id: result.id, reused: result.reused });
  }

  console.log("");
  if (!apply) {
    console.log("  [dry-run] would create/reuse a mi09_pricing_schedule_snapshots row from the above artifacts.");
    console.log("\nDry run complete — no rows were written. Re-run with --apply --confirm-env=<NODE_ENV> to write.");
    return;
  }

  const snapshot = await createPricingScheduleSnapshot({
    capturedBy: MI09_PRICING_CAPTURED_BY,
  });

  const snapshotStatus = snapshot.reused ? "reused" : snapshot.renewed ? "renewed" : "created";
  console.log(`  ${snapshotStatus} snapshot id=${snapshot.id}`);
  console.log(`  composite_hash : ${snapshot.compositeHash}`);
  console.log(`  artifact_ids   : ${snapshot.artifactIds.join(", ")}`);
  console.log(`  expires_at     : ${snapshot.expiresAt}`);

  console.log("\n=== MI-09 Pricing Seed Complete ===");
  for (const a of artifactResults) {
    console.log(`  ${a.providerKey.padEnd(16)} id=${a.id}  ${a.reused ? "(reused)" : "(new)"}`);
  }
  console.log(`  snapshot id=${snapshot.id}  composite_hash=${snapshot.compositeHash}  (${snapshotStatus})`);
  console.log("\nNote: linked_policy_id was NOT set — no cro03c_activation_policies row exists yet.");
  console.log("No provider transport, scheduler activation, or ceremony execution occurred.");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n✗ Fatal:", err?.message ?? err);
    process.exit(1);
  });
