#!/usr/bin/env npx tsx
/**
 * scripts/test-pre-io-emergency-stop.ts
 *
 * Corrective item 7 (Task #1971 continuation): reserveCro03ProviderOperation
 * (server/services/cro03/provider-context.ts) only checked provider_controls
 * (enabled + circuit_state) once, at reservation time. assertCro03cAuthorityBeforeIo
 * (server/services/cro03/live-execution.ts) is the real last checkpoint executed
 * immediately before every paid-provider fetch across every call site
 * (live-provider-executors.ts, live-worker.ts, live-safe-egress.ts) but never
 * re-checked provider_controls. An operator emergency stop issued after a unit
 * was reserved but before the queued work actually dispatched would not stop
 * the real network call.
 *
 * Fully fixturing assertCro03cAuthorityBeforeIo's authority chain (commands,
 * runs, generations, activation policies, runtime attestations, no-outbound
 * snapshots, stage dispositions, signed approval receipts, deployment
 * inventory) end-to-end for every gated provider is disproportionate for
 * verifying call-site wiring around an already-tested primitive
 * (assertCro03cSharedProviderControlOpen is exhaustively covered by
 * scripts/test-provider-admin-controls-parity.ts and
 * scripts/test-mi09-frozen-pricing.ts-adjacent coverage). Following this
 * codebase's own established pattern for exactly this difficulty
 * (see scripts/test-cro03c-outscraper.ts's static source assertion for the
 * analogous "assertCro03cAuthorityBeforeIo precedes the real fetch" property):
 *
 *   1. Static source assertion: assertCro03cAuthorityBeforeIo's body calls
 *      assertCro03cSharedProviderControlOpen(context.provider, ...) gated on
 *      CRO03C_SHARED_CONTROL_GATED_PROVIDERS, placed AFTER the outbound-pause
 *      re-verification and BEFORE the function returns (i.e. it is the last
 *      check before the caller proceeds to the real transport call).
 *   2. Real behavioral re-confirmation (real Postgres, real enforcement, no
 *      mocking): with a paid provider (apollo) disabled via UPDATE against its
 *      live provider_controls row (never deleted — has FK dependents),
 *      assertCro03cSharedProviderControlOpen the exact function the new
 *      call site now invokes throws CRO03C_PROVIDER_CONTROL_BLOCKED; with it
 *      re-enabled, the same call passes. This is the same failure mode a
 *      stale reservation would hit if item 7 had not closed the gap.
 *   3. A non-gated provider (internal_source) is confirmed to bypass the
 *      check entirely (CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has() is false),
 *      matching existing behavior for free/internal sources.
 *
 * No provider I/O, no worker activation.
 *
 * Usage: npx tsx scripts/test-pre-io-emergency-stop.ts
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../server/db";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.log(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

async function main() {
  console.log("\n=== Corrective item 7: pre-network-I/O emergency stop for paid-provider transports ===\n");

  // ── Part 1: static wiring assertion ─────────────────────────────────────
  const source = readFileSync("server/services/cro03/live-execution.ts", "utf8");
  const fnBody = source.match(/export async function assertCro03cAuthorityBeforeIo\([\s\S]*?\n}\n/)?.[0] ?? "";
  ok("assertCro03cAuthorityBeforeIo function body found", fnBody.length > 0);
  ok(
    "function re-checks the shared provider_controls gate for context.provider",
    /CRO03C_SHARED_CONTROL_GATED_PROVIDERS\.has\(context\.provider\)/.test(fnBody) &&
    /assertCro03cSharedProviderControlOpen\(context\.provider/.test(fnBody),
  );
  ok(
    "the new gate check is placed after the outbound-pause re-verification (last checkpoint before return)",
    /getPauseState\(\)[\s\S]*CRO03C_OUTBOUND_STATE_UNVERIFIED[\s\S]*assertCro03cSharedProviderControlOpen/.test(fnBody),
  );

  // ── Part 2: real behavioral re-confirmation for a gated provider (apollo) ──
  const { assertCro03cSharedProviderControlOpen, CRO03C_SHARED_CONTROL_GATED_PROVIDERS } =
    await import("../server/services/cro03/live-execution");

  ok("apollo is in the gated-provider set (same set the new call site consults)", CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("apollo"));
  ok("internal_source is NOT in the gated-provider set (free/internal sources bypass the check)", !CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("internal_source"));

  const original = rows(await db.execute(sql`
    SELECT enabled, circuit_state, local_budget_units FROM provider_controls WHERE provider = 'apollo'
  `))[0];
  ok("apollo has a pre-existing provider_controls row", !!original);

  try {
    // Simulate: a unit was reserved while apollo was enabled, then an operator
    // emergency-stops it before the queued work actually dispatches.
    await db.execute(sql`
      UPDATE provider_controls SET enabled = FALSE, version = version + 1, updated_at = NOW() WHERE provider = 'apollo'
    `);
    let blockedAfterStaleReservation = false;
    try {
      await assertCro03cSharedProviderControlOpen("apollo", { execute: (q: any) => db.execute(q) });
    } catch (err: any) {
      blockedAfterStaleReservation = err?.message === "CRO03C_PROVIDER_CONTROL_BLOCKED";
    }
    ok(
      "the exact pre-I/O gate now used by assertCro03cAuthorityBeforeIo blocks a stale reservation once the operator has emergency-stopped the provider",
      blockedAfterStaleReservation,
    );

    await db.execute(sql`
      UPDATE provider_controls SET enabled = TRUE, circuit_state = 'closed', version = version + 1, updated_at = NOW() WHERE provider = 'apollo'
    `);
    let passesOnceReenabled = false;
    try {
      await assertCro03cSharedProviderControlOpen("apollo", { execute: (q: any) => db.execute(q) });
      passesOnceReenabled = true;
    } catch { /* leave false */ }
    ok("the same gate passes once the provider is re-enabled", passesOnceReenabled);
  } finally {
    if (original) {
      await db.execute(sql`
        UPDATE provider_controls
           SET enabled = ${original.enabled}, circuit_state = ${original.circuit_state},
               local_budget_units = ${original.local_budget_units}, version = version + 1, updated_at = NOW()
         WHERE provider = 'apollo'
      `);
      const restored = rows(await db.execute(sql`SELECT enabled, circuit_state FROM provider_controls WHERE provider = 'apollo'`))[0];
      ok("apollo row restored to its original enabled/circuit_state", restored?.enabled === original.enabled && restored?.circuit_state === original.circuit_state);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
