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
 * neither the pilot's typed "AUTHORIZE $50 PAID PILOT" confirmation nor its
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
 *   5. The recurring aggregate spend cap (getAggregateRecurringPaidSpend /
 *      assertAggregateRecurringPaidBudgetAvailable) is tracked independently
 *      of the pilot's own aggregate (different system_settings key, different
 *      SQL scope: command_type='continuous_occurrence' vs
 *      mi09_pilot_effect_links membership) — verified by static source
 *      inspection, since fully fixturing a real cro03c_commands row requires
 *      the entire CRO03C authority chain (activation policy, runtime
 *      attestation, no-outbound snapshot, stage disposition), which is
 *      disproportionate for verifying this SQL scope is correctly independent
 *      (see scripts/test-pre-io-emergency-stop.ts for the precedent of using
 *      static assertion for this exact class of difficulty in this codebase).
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
      () => assertRecurringPaidAuthorityForActivation({ apollo: { maxUnitsPerOccurrence: 5 } }),
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
      await assertRecurringPaidAuthorityForActivation({ internal_source: { maxUnitsPerOccurrence: 5 } });
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
      await assertRecurringPaidAuthorityForActivation({ apollo: { maxUnitsPerOccurrence: 5 } });
      passesOnceAuthorized = true;
    } catch { /* leave false */ }
    ok("activation-time gate passes for a paid-provider budget once authorized", passesOnceAuthorized);

    // ── Part 5: revocation blocks activation again ──────────────────────────
    await revokeRecurringPaidBudgetAuthorization({ revokedBy: "test-admin", reason: "test revoke" });
    const revoked = await getRecurringPaidBudgetAuthorization();
    ok("revokeRecurringPaidBudgetAuthorization marks the authorization revoked", !!revoked?.revokedAt);

    await rejects(
      "activation-time gate rejects again after revocation",
      () => assertRecurringPaidAuthorityForActivation({ apollo: { maxUnitsPerOccurrence: 5 } }),
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
  ok(
    "getAggregateRecurringPaidSpend scopes to command_type='continuous_occurrence', independent of mi09_pilot_effect_links",
    /getAggregateRecurringPaidSpend[\s\S]*?command_type = 'continuous_occurrence'/.test(scheduleAuthoritySource) &&
    !/getAggregateRecurringPaidSpend[\s\S]{0,400}mi09_pilot_effect_links/.test(scheduleAuthoritySource),
  );

  const liveExecutionSource = readFileSync("server/services/cro03/live-execution.ts", "utf8");
  ok(
    "createCro03cCommand re-checks assertAggregateRecurringPaidBudgetAvailable for paid providers on continuous_occurrence commands",
    /CRO08A_PROVIDER_BUDGET_UNDEFINED[\s\S]*?assertAggregateRecurringPaidBudgetAvailable\(\)/.test(liveExecutionSource),
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
