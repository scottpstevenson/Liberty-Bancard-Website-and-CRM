#!/usr/bin/env tsx
/**
 * Task #1956, Step 4 test: MI-09 provider-selector server-side gate.
 *
 * Verifies:
 *  1. readSignedProviderPricing() reads live from signed-pricing.json and
 *     returns a numeric price for every paid provider MI-09 can select.
 *  2. createPilotDefinition() independently rejects a provider whose
 *     required secret is absent from this environment, even though the
 *     signed price schedule exists for it (secret and pricing are checked
 *     separately, neither substitutes for the other).
 *  3. createPilotDefinition() accepts a level-2 definition when every
 *     selected provider has both its secret and a live signed price.
 *  4. Level 1 still rejects any paid provider (pre-existing invariant,
 *     re-verified since it shares code with the new gate).
 *
 * Run with: npx tsx scripts/test-mi09-provider-selector.ts
 */
import { pool } from "../server/db";
import { readSignedProviderPricing } from "../server/services/signed-pricing-reader";
import { createPilotDefinition } from "../server/services/mi09-pilot-authority";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const RUN_ID = Date.now() % 10_000_000;

async function main() {
  console.log(`[test-mi09-provider-selector] run id ${RUN_ID}`);

  // --- 1. Live pricing read ---
  const pricing = readSignedProviderPricing();
  for (const p of ["serper", "outscraper", "openai", "apollo", "zerobounce"]) {
    assert(`signed-pricing.json prices "${p}"`, typeof pricing[p]?.amountMicros === "number" && pricing[p].amountMicros >= 0, JSON.stringify(pricing[p]));
  }

  const baseInput = {
    countyScope: [`t1956-${RUN_ID}`],
    verticalScope: ["test_vertical"],
    sourceAdapterFilter: ["test_adapter"],
    maxCohortSize: 5,
    enrichmentRecipeVersion: 1,
    stopConditionThresholds: { conflictPct: 5, apolloYieldPct: 0, zbUnknownPct: 20, spendCapMicros: 1000 },
    createdBy: `test-1956-${RUN_ID}`,
  };

  // --- 2. Missing-secret rejection ---
  const savedApolloKey = process.env.APOLLO_API_KEY;
  delete process.env.APOLLO_API_KEY;
  try {
    let threw = false;
    let message = "";
    try {
      await createPilotDefinition({ ...baseInput, level: 2, paidProvidersAllowed: { apollo: true } });
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    assert("rejects provider with missing secret even though pricing exists", threw && message.includes("provider_secret_missing"), message);
  } finally {
    if (savedApolloKey !== undefined) process.env.APOLLO_API_KEY = savedApolloKey;
  }

  // --- 3. Valid selection accepted (secret present + live price present) ---
  {
    let threw = false;
    let message = "";
    let result: any = null;
    try {
      result = await createPilotDefinition({ ...baseInput, level: 2, paidProvidersAllowed: { serper: true } });
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    assert("accepts provider with secret present and live price available", !threw && !!result?.id, message);
  }

  // --- 4. Level 1 still rejects any paid provider ---
  {
    let threw = false;
    let message = "";
    try {
      await createPilotDefinition({ ...baseInput, level: 1, paidProvidersAllowed: { serper: true } });
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    assert("level 1 still rejects any paid provider", threw && message.includes("pilot_1_must_exclude_all_paid_providers"), message);
  }

  await pool.end();
  console.log(`\n[test-mi09-provider-selector] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[test-mi09-provider-selector] fatal error:", err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
