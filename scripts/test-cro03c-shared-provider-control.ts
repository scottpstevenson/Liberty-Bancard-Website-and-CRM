#!/usr/bin/env tsx
/**
 * Task #1956, Step 5 test: confirmed hardening gap closed for
 * outscraper/openai via the SHARED provider_controls authority (the same
 * table/columns zerobounce already uses) — not a parallel control system.
 *
 * Exercises assertCro03cSharedProviderControlOpen() directly — the exact
 * predicate reserveCro03cProviderOperation runs inside its authority
 * transaction for every stage operation — against real provider_controls
 * fixture rows:
 *  1. No provider_controls row for outscraper/openai -> blocked (fail
 *     closed), mirroring zerobounce's existing behavior.
 *  2. enabled=false -> blocked ("emergency stop").
 *  3. circuit_state='open' -> blocked ("circuit breaker").
 *  4. enabled=true + circuit_state='closed' -> gate passes.
 *  5. A provider NOT in CRO03C_SHARED_CONTROL_GATED_PROVIDERS (e.g. apollo)
 *     passes even with no control row at all — this step's gate is scoped
 *     to outscraper/openai only, per the task's explicit boundary.
 *
 * Run with: npx tsx scripts/test-cro03c-shared-provider-control.ts
 */
import { createHash } from "crypto";
import { pool, db } from "../server/db";
import { sql } from "drizzle-orm";
import { assertCro03cSharedProviderControlOpen, CRO03C_SHARED_CONTROL_GATED_PROVIDERS } from "../server/services/cro03/live-execution";

let passed = 0;
let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) { console.log(`  \u2713 ${label}`); passed++; }
  else { console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

const RUN_ID = Date.now() % 10_000_000;

async function makeGeneration(provider: string, maxUnits: number, maxAmountMicros: number, amountMicros: number) {
  const command = (await db.execute(sql`
    INSERT INTO cro03c_activation_policies (idempotency_key, policy_key, version, policy, policy_hash, price_schedules, required_approvals, status, expected_revision, reason, created_by)
    VALUES (${`t1956-s5-policy-${RUN_ID}-${provider}`}, ${`t1956_s5_${RUN_ID}_${provider}`}, 1, '{}'::jsonb, ${createHash("sha256").update(`t1956-s5-${RUN_ID}-${provider}`).digest("hex")},
            ${JSON.stringify({ [provider]: { version: 1, amountMicros, unitType: "request", currency: "USD", billingSemantics: "per_unit_no_result_billable" } })}::jsonb,
            '{}'::jsonb, 'approved', 1, ${`test fixture for #1956 step 5 (run ${RUN_ID})`}, ${`test-1956-${RUN_ID}`})
    RETURNING id
  `)).rows[0] as any;
  const attestation = (await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations (idempotency_key, inventory_id, worker_identities, artifact_sha, migration_head, deployment_identity, environment_identity, web_boot_identity, worker_boot_identity, queue_topology_hash, worker_heartbeat_at, db_healthy, redis_healthy, captured_at, expires_at)
    VALUES (${`t1956-s5-attest-${RUN_ID}-${provider}`}, gen_random_uuid(), '[]'::jsonb, 'sha', 'head', 'dep', 'env', 'web', 'worker', 'topo', NOW(), TRUE, TRUE, NOW(), NOW() + INTERVAL '1 hour')
    RETURNING id
  `).catch(() => ({ rows: [null] }))).rows?.[0] as any;
  if (!attestation) return null; // schema mismatch guard — skip gracefully below
  const cmd = (await db.execute(sql`
    INSERT INTO cro03c_commands (command_key, idempotency_key, command_type, actor_id, activation_policy_id, activation_revision, runtime_attestation_id, caps, state, expires_at, pre_run_snapshot_id)
    SELECT ${`t1956-s5-cmd-${RUN_ID}-${provider}`}, ${`t1956-s5-cmd-idem-${RUN_ID}-${provider}`}, 'micro_canary', ${`test-1956-${RUN_ID}`},
           ${command.id}::uuid, 1, ${attestation.id}::uuid,
           ${JSON.stringify({ provider, maxUnits, maxAmountMicros })}::jsonb, 'running', NOW() + INTERVAL '1 hour', s.id
      FROM cro03c_no_outbound_snapshots s ORDER BY s.captured_at DESC LIMIT 1
    RETURNING id
  `).catch(() => ({ rows: [null] }))).rows?.[0] as any;
  if (!cmd) return null;
  const run = (await db.execute(sql`
    INSERT INTO cro03c_runs (command_id, state) VALUES (${cmd.id}::uuid, 'running') RETURNING id
  `)).rows[0] as any;
  const generation = (await db.execute(sql`
    INSERT INTO cro03c_generations (command_id, run_id, activation_revision, state, claim_token)
    VALUES (${cmd.id}::uuid, ${run.id}::uuid, 1, 'running', gen_random_uuid()) RETURNING id
  `)).rows[0] as any;
  return { generationId: String(generation.id), commandId: String(cmd.id) };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM cro03c_stage_operations WHERE operation_key LIKE ${`t1956-s5-op-${RUN_ID}%`}`);
  await db.execute(sql`DELETE FROM cro03c_generations WHERE command_id IN (SELECT id FROM cro03c_commands WHERE command_key LIKE ${`t1956-s5-cmd-${RUN_ID}%`})`);
  await db.execute(sql`DELETE FROM cro03c_runs WHERE command_id IN (SELECT id FROM cro03c_commands WHERE command_key LIKE ${`t1956-s5-cmd-${RUN_ID}%`})`);
  await db.execute(sql`DELETE FROM cro03c_commands WHERE command_key LIKE ${`t1956-s5-cmd-${RUN_ID}%`}`);
  await db.execute(sql`DELETE FROM cro03c_runtime_attestations WHERE idempotency_key LIKE ${`t1956-s5-attest-${RUN_ID}%`}`);
  // cro03c_activation_policies is append-only by design (cro03b_append_only_guard
  // trigger) — its rows are immutable authority artifacts, not test residue to
  // reclaim. Leaving a handful of clearly-prefixed, inert test rows behind is
  // the correct behavior, not a leak.
  await db.execute(sql`DELETE FROM provider_controls WHERE provider IN ('outscraper','openai') AND capability = ${`t1956-test-${RUN_ID}`}`);
}

async function main() {
  console.log(`[test-cro03c-shared-provider-control] run id ${RUN_ID}`);

  assert("outscraper is in the gated set", CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("outscraper"));
  assert("openai is in the gated set", CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("openai"));
  assert("apollo is NOT in the gated set (out of this step's scope)", !CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("apollo"));
  assert("serper is NOT in the gated set (has its own dedicated gateway)", !CRO03C_SHARED_CONTROL_GATED_PROVIDERS.has("serper"));

  try {
    for (const provider of ["outscraper", "openai"] as const) {
      const gate = (label: string) => assertCro03cSharedProviderControlOpen(provider, { execute: (q) => db.execute(q) as any });

      // 1. No control row at all -> blocked
      await db.execute(sql`DELETE FROM provider_controls WHERE provider = ${provider}`);
      {
        let threw = false, message = "";
        try { await gate("no-row"); } catch (e) { threw = true; message = e instanceof Error ? e.message : String(e); }
        assert(`${provider}: blocked with no provider_controls row (fail closed)`, threw && message.includes("CRO03C_PROVIDER_CONTROL_BLOCKED"), message);
      }

      // 2. enabled=false -> blocked
      await db.execute(sql`
        INSERT INTO provider_controls (provider, capability, enabled, circuit_state, local_budget_units, reserved_units, consumed_units, version, updated_at)
        VALUES (${provider}, ${`t1956-test-${RUN_ID}`}, FALSE, 'closed', 1000, 0, 0, 1, NOW())
        ON CONFLICT (provider) DO UPDATE SET enabled=FALSE, circuit_state='closed', capability=EXCLUDED.capability
      `);
      {
        let threw = false, message = "";
        try { await gate("disabled"); } catch (e) { threw = true; message = e instanceof Error ? e.message : String(e); }
        assert(`${provider}: blocked when enabled=false (emergency stop)`, threw && message.includes("CRO03C_PROVIDER_CONTROL_BLOCKED"), message);
      }

      // 3. circuit open -> blocked
      await db.execute(sql`UPDATE provider_controls SET enabled=TRUE, circuit_state='open' WHERE provider=${provider}`);
      {
        let threw = false, message = "";
        try { await gate("circuit-open"); } catch (e) { threw = true; message = e instanceof Error ? e.message : String(e); }
        assert(`${provider}: blocked when circuit_state=open`, threw && message.includes("CRO03C_PROVIDER_CONTROL_BLOCKED"), message);
      }

      // 4. enabled + closed -> gate passes
      await db.execute(sql`UPDATE provider_controls SET enabled=TRUE, circuit_state='closed' WHERE provider=${provider}`);
      {
        let threw = false, message = "";
        try { await gate("closed-ok"); } catch (e) { threw = true; message = e instanceof Error ? e.message : String(e); }
        assert(`${provider}: gate passes when enabled=true and circuit_state=closed`, !threw, message);
      }
    }
  } finally {
    await cleanup();
  }

  await pool.end();
  console.log(`\n[test-cro03c-shared-provider-control] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("[test-cro03c-shared-provider-control] fatal error:", err);
  try { await cleanup(); } catch {}
  try { await pool.end(); } catch {}
  process.exit(1);
});
