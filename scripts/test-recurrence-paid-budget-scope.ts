#!/usr/bin/env npx tsx
/**
 * scripts/test-recurrence-paid-budget-scope.ts
 *
 * Corrective item 8 (Task #1971 continuation): split pilot vs recurrence
 * authorization scopes.
 *
 * Before this, activateCro08aScheduleDefinition() was gated only by
 * assertPilotLadderCompletion() (a one-time historical fact about the MI-09
 * pilot) plus each schedule's own per-occurrence unit budget. Once activated,
 * continuous_occurrence commands could spend on paid providers indefinitely:
 * neither the pilot's typed paid-provider authorization nor its
 * $50 aggregate cap (mi09-pilot-authority.ts, scoped to mi09_pilot_effect_links)
 * were ever checked for recurring execution.
 *
 * This test verifies (real Postgres, no mocking, real enforcement functions):
 *   1. A schedule definition naming a paid provider cannot activate without a
 *      live (unrevoked) recurring-paid-budget authorization.
 *   2. The recurring typed confirmation string is independently re-verified
 *      (mismatched string is denied) — mirrors the pilot's own defense-in-depth
 *      pattern.
 *   3. A definition with NO paid provider keys in its budgets (empty budgets,
 *      or only free/internal-source keys) is unaffected by this gate.
 *   4. Revoking the recurring authorization blocks future activation again.
 *   5. Paid-provider authorization is re-checked at recurring command creation,
 *      while spend summaries are no longer execution gates.
 *   6. Static assertion: the emergency-stop transaction in
 *      paid-provider-control.ts revokes the recurring authorization alongside
 *      deactivating schedules.
 *
 * No worker activation, no provider calls, no real schedule ever activates
 * against a real occurrence.
 *
 * Usage: npx tsx scripts/test-recurrence-paid-budget-scope.ts
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  authorizeRecurringPaidBudget,
  revokeRecurringPaidBudgetAuthorization,
  getRecurringPaidBudgetAuthorization,
  assertRecurringPaidAuthorityForActivation,
  CRO08A_RECURRING_BUDGET_TYPED_CONFIRMATION,
} from "../server/services/cro08a/schedule-authority";
import { MI09_PAID_BUDGET_TYPED_CONFIRMATION } from "../server/services/mi09-pilot-authority";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}
async function rejects(label: string, fn: () => Promise<unknown>, matcher: (msg: string) => boolean) {
  try {
    await fn();
    ok(label, false, "did not throw");
  } catch (err: any) {
    ok(label, matcher(String(err?.message ?? "")), `threw: ${err?.message}`);
  }
}

async function main() {
  console.log("\n=== Corrective item 8: split pilot vs recurrence authorization scopes ===\n");

  const AUTH_KEY = "cro08a_recurring_paid_budget_authorization";
  const original = rows(await db.execute(sql`SELECT value FROM system_settings WHERE key = ${AUTH_KEY}`))[0];

  try {
    // Start from a clean (no authorization) state for this test.
    await db.execute(sql`DELETE FROM system_settings WHERE key = ${AUTH_KEY}`);

    ok("no authorization exists initially", (await getRecurringPaidBudgetAuthorization()) === null);

    // ── Part 1: a budgets object naming a paid provider requires authorization ──
    await rejects(
      "activation-time gate rejects a paid-provider budget with no authorization",
      () => assertRecurringPaidAuthorityForActivation({ apollo: {} }),
      (m) => m === "CRO08A_RECURRING_PAID_AUTHORIZATION_REQUIRED",
    );

    // ── Part 2: mismatched typed confirmation is denied ─────────────────────
    await rejects(
      "authorizeRecurringPaidBudget denies a mismatched typed confirmation",
      () => authorizeRecurringPaidBudget({ authorizedBy: "test-admin", typedConfirmation: "wrong string" }),
      (m) => m === "CRO08A_RECURRING_PAID_AUTHORIZATION_DENIED:typed_confirmation_mismatch",
    );

    // ── Part 3: a definition with no paid provider keys is unaffected ──────
    let passesForFreeOnlyBudgets = false;
    try {
      await assertRecurringPaidAuthorityForActivation({});
      await assertRecurringPaidAuthorityForActivation({ internal_source: {} });
      passesForFreeOnlyBudgets = true;
    } catch { /* leave false */ }
    ok("empty budgets and free/internal-source-only budgets are unaffected by this gate", passesForFreeOnlyBudgets);

    // ── Part 4: correct typed confirmation authorizes ───────────────────────
    const auth = await authorizeRecurringPaidBudget({
      authorizedBy: "test-admin", typedConfirmation: CRO08A_RECURRING_BUDGET_TYPED_CONFIRMATION,
    });
    ok("authorizeRecurringPaidBudget records the authorization with the correct typed confirmation", auth.authorizedBy === "test-admin" && !auth.revokedAt);

    let passesOnceAuthorized = false;
    try {
      await assertRecurringPaidAuthorityForActivation({ apollo: {} });
      passesOnceAuthorized = true;
    } catch { /* leave false */ }
    ok("activation-time gate passes for a paid-provider budget once authorized", passesOnceAuthorized);

    // ── Part 5: revocation blocks activation again ──────────────────────────
    await revokeRecurringPaidBudgetAuthorization({ revokedBy: "test-admin", reason: "test revoke" });
    const revoked = await getRecurringPaidBudgetAuthorization();
    ok("revokeRecurringPaidBudgetAuthorization marks the authorization revoked", !!revoked?.revokedAt);

    await rejects(
      "activation-time gate rejects again after revocation",
      () => assertRecurringPaidAuthorityForActivation({ apollo: {} }),
      (m) => m === "CRO08A_RECURRING_PAID_AUTHORIZATION_REQUIRED",
    );
  } finally {
    await db.execute(sql`DELETE FROM system_settings WHERE key = ${AUTH_KEY}`);
    if (original) {
      await db.execute(sql`
        INSERT INTO system_settings (key, value, updated_at) VALUES (${AUTH_KEY}, ${original.value}::jsonb, NOW())
      `);
    }
    const restored = rows(await db.execute(sql`SELECT value FROM system_settings WHERE key = ${AUTH_KEY}`))[0];
    ok("recurring-budget-authorization system_settings row restored to its pre-test state", JSON.stringify(restored?.value ?? null) === JSON.stringify(original?.value ?? null));
  }

  // ── Part 6: static wiring assertions ───────────────────────────────────
  const scheduleAuthoritySource = readFileSync("server/services/cro08a/schedule-authority.ts", "utf8");
  ok(
    "activateCro08aScheduleDefinition calls assertRecurringPaidAuthorityForActivation before activating",
    /assertPilotLadderCompletion\(\);[\s\S]*?assertRecurringPaidAuthorityForActivation\(budgets\)[\s\S]*?SET active=true/.test(scheduleAuthoritySource),
  );
  const liveExecutionSource = readFileSync("server/services/cro03/live-execution.ts", "utf8");
  ok(
    "createCro03cCommand re-checks revocable paid authorization and does not gate recurring execution on spend summaries",
    /assertRecurringPaidAuthorityForActivation\(budgets\)/.test(liveExecutionSource) &&
      !/assertAggregateRecurringPaidBudgetAvailable|assertLadderBudgetHeadroom/.test(liveExecutionSource),
  );
  ok(
    "MI-09 and recurring commands use the approved policy without requiring the app pricing-snapshot row",
    /requiresCurrentPricingSnapshot\s*=\s*input\.commandType !== "pilot_phase" && input\.commandType !== "continuous_occurrence"/.test(liveExecutionSource) &&
      /if \(requiresCurrentPricingSnapshot\)\s*\{[\s\S]*?FROM mi09_pricing_schedule_snapshots/.test(liveExecutionSource),
  );
  ok(
    "operation audit still verifies approved unit amounts and persists schedule price bindings",
    /input\.maxAmountMicros !== input\.requestedUnits \* schedule\.amountMicros/.test(liveExecutionSource) &&
      /price_schedule_version,price_schedule_hash,max_reserved_units,max_reserved_amount_micros/.test(liveExecutionSource),
  );
  ok(
    "recurring execution does not enforce maxUnitsPerOccurrence as a financial ceiling",
    !/\.maxUnitsPerOccurrence/.test(liveExecutionSource) &&
      !/\.maxUnitsPerOccurrence/.test(scheduleAuthoritySource),
  );
  ok(
    "paid-authorization confirmations no longer require a $50 commitment",
    !CRO08A_RECURRING_BUDGET_TYPED_CONFIRMATION.includes("$50") &&
      !MI09_PAID_BUDGET_TYPED_CONFIRMATION.includes("$50"),
  );

  const pilotAuthoritySource = readFileSync("server/services/mi09-pilot-authority.ts", "utf8");
  ok(
    "MI-09 execution preserves Level 1 free-only and revocable paid authorization gates",
    /PILOT_EXECUTOR_LEVEL1_PAID_PROVIDER_FORBIDDEN/.test(pilotAuthoritySource) &&
      /if \(anyPaidAllowed\) await assertPaidBudgetAuthorized\(\)/.test(pilotAuthoritySource),
  );
  ok(
    "MI-09 paid spend and spendCapMicros are no longer stop conditions or provider issuance limits",
    !/failedConditions\.push\(`spend_cap/.test(pilotAuthoritySource) &&
      !/assertAggregatePaidBudgetAvailable\(\)/.test(pilotAuthoritySource.slice(
        pilotAuthoritySource.indexOf("export async function executePilotCohortPhase"),
        pilotAuthoritySource.indexOf("export interface StopConditionResult"),
      )),
  );

  const paidControlSource = readFileSync("server/services/paid-provider-control.ts", "utf8");
  ok(
    "emergencyStopPaidProviders revokes the recurring authorization in the same transaction as deactivating schedules",
    /cro08a_schedule_definitions[\s\S]*?active = TRUE[\s\S]*?cro08a_recurring_paid_budget_authorization/.test(paidControlSource),
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
