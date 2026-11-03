/**
 * Stage 4D schema repair rehearsal — disposable database only.
 *
 * Reproduces the production-shaped defect (status check lacking no_show), runs the repair packet files verbatim, records
 * the locks and timeouts, proves the lock_timeout fails fast without a partial change, and proves the rollback keeps real
 * no_show rows. It also replays the migration files 0378 and 0379 verbatim over the production-shaped state, because the
 * migration metadata for 0376-0379 is not recorded in production and the normal runner would apply them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

await assertDisposableTestInfrastructure({ operation: "Stage 4D appointment constraint repair rehearsal" });
const { pool } = await import("../../server/db");

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [CR-${String(checks).padStart(2, "0")}] ${message}`); };
const dir = new URL("../../docs/certification/stage4-d/schema-repair/", import.meta.url);
const sqlFile = (name: string) => readFileSync(new URL(name, dir), "utf8");
const migration = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
const OLD = `CHECK (status IN ('booked', 'rescheduled', 'updated', 'showed', 'canceled'))`;
const def = async () => (await pool.query(`SELECT convalidated, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid='ghl_appointment_state'::regclass AND conname='ghl_appointment_state_status_chk'`)).rows[0] as { convalidated: boolean; d: string } | undefined;
const insert = (id: string, status: string) => pool.query(`INSERT INTO ghl_appointment_state(appointment_id, ghl_contact_id, status, last_event_at) VALUES ($1,'cert_contact',$2,now())`, [id, status]);
const rejects = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch (e: any) { return /check constraint|violates/i.test(String(e?.message)); } };
const setOld = async () => {
  await pool.query(`DELETE FROM ghl_appointment_state WHERE ghl_contact_id='cert_contact'`);
  await pool.query(`ALTER TABLE ghl_appointment_state DROP CONSTRAINT IF EXISTS ghl_appointment_state_status_chk`);
  await pool.query(`ALTER TABLE ghl_appointment_state ADD CONSTRAINT ghl_appointment_state_status_chk ${OLD}`);
};
const run = (sql: string) => pool.query(sql);

// 1. Production-shaped defect.
await setOld();
check(/canceled/.test((await def())!.d) && !/no_show/.test((await def())!.d), "production-shaped state: the installed constraint lacks no_show");
check(await rejects(() => insert("cert-ns-0", "no_show")), "negative control: a provider no_show write is rejected by the installed constraint");

// 2. Packet step 1 with recorded locks/timeouts (a second connection observes the lock held inside the transaction).
const observer = await pool.connect();
const tx = await pool.connect();
try {
  await tx.query("BEGIN");
  await tx.query("SET LOCAL lock_timeout = '5s'"); await tx.query("SET LOCAL statement_timeout = '30s'");
  const t0 = Date.now();
  await tx.query(`ALTER TABLE ghl_appointment_state DROP CONSTRAINT IF EXISTS ghl_appointment_state_status_chk`);
  await tx.query(`ALTER TABLE ghl_appointment_state ADD CONSTRAINT ghl_appointment_state_status_chk CHECK (status IN ('booked','rescheduled','updated','showed','canceled','no_show')) NOT VALID`);
  const modes = (await observer.query(`SELECT mode FROM pg_locks WHERE relation='ghl_appointment_state'::regclass AND granted AND pid = $1`, [(await tx.query("SELECT pg_backend_pid() AS p")).rows[0].p])).rows.map((r: any) => r.mode);
  console.log(`  recorded: locks held inside step 1 = ${JSON.stringify(modes)}; elapsed ${Date.now() - t0}ms; lock_timeout 5s; statement_timeout 30s`);
  check(modes.includes("AccessExclusiveLock"), "step 1 takes ACCESS EXCLUSIVE for the catalog change only (recorded)");
  await tx.query("ROLLBACK");
} finally { tx.release(); observer.release(); }
check((/canceled/.test((await def())!.d) && !/no_show/.test((await def())!.d)), "an abandoned step 1 leaves the installed constraint unchanged");

// 3. lock_timeout: a conflicting reader makes step 1 fail fast and change nothing.
{
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN"); await blocker.query("SELECT 1 FROM ghl_appointment_state LIMIT 1");
    const t0 = Date.now();
    let failed = "";
    try { await pool.query(sqlFile("01-forward.sql").replace("'5s'", "'500ms'")); } catch (e: any) { failed = String(e?.message); await pool.query("ROLLBACK").catch(() => undefined); }
    check(/lock timeout/i.test(failed) && Date.now() - t0 < 4000, `step 1 fails fast on lock contention (${Date.now() - t0}ms) instead of queueing writers behind it`);
  } finally { await blocker.query("ROLLBACK").catch(() => undefined); blocker.release(); }
  check((/canceled/.test((await def())!.d) && !/no_show/.test((await def())!.d)), "a lock-timeout failure leaves no partial change");
}

// 4. Packet files verbatim.
await run(sqlFile("01-forward.sql"));
check((await def())!.convalidated === false && /no_show/.test((await def())!.d), "step 1 installs the no_show constraint as NOT VALID");
await insert("cert-ns-1", "no_show");
check(await rejects(() => insert("cert-bad", "bogus_status")), "the repaired constraint still rejects an unknown status");
await run(sqlFile("02-validate.sql"));
check((await def())!.convalidated === true, "step 2 validates the constraint, including the real no_show row");
await run(sqlFile("04-verify.sql"));

// 5. Rollback preserves real no_show rows; with none it restores the previous contract.
await run(sqlFile("03-rollback.sql"));
check(/no_show/.test((await def())!.d) && (await pool.query(`SELECT 1 FROM ghl_appointment_state WHERE appointment_id='cert-ns-1' AND status='no_show'`)).rows.length === 1,
  "rollback with a real no_show row keeps the repaired constraint and the row (nothing deleted or rewritten)");
await pool.query(`DELETE FROM ghl_appointment_state WHERE appointment_id='cert-ns-1'`);
await run(sqlFile("03-rollback.sql"));
check(!/no_show/.test((await def())!.d), "rollback with no no_show rows restores the previous constraint");
await run(sqlFile("01-forward.sql")); await run(sqlFile("02-validate.sql"));
check(/no_show/.test((await def())!.d) && (await def())!.convalidated, "the repair can be re-applied after a rollback");

// 6. Normal-runner alternative: replay 0378 and 0379 verbatim over the production-shaped state (objects already exist).
await setOld();
for (const name of ["0378_stage4c2_appointment_followup_authority.sql", "0379_stage4c2_correction_pass.sql"]) for (const statement of migration(name)) await pool.query(statement);
check(/no_show/.test((await def())!.d) && (await def())!.convalidated, "replaying migrations 0378 and 0379 over the production-shaped state is idempotent and installs no_show");
await insert("cert-ns-2", "no_show");
check(true, "a provider no_show write is accepted after the repair");
const idx = (await pool.query(`SELECT indexdef FROM pg_indexes WHERE indexname='ghl_appointment_state_open_idx'`)).rows[0]?.indexdef as string;
check(/no_show/.test(idx), "the open-appointment index predicate excludes no_show");

await pool.query(`DELETE FROM ghl_appointment_state WHERE ghl_contact_id='cert_contact'`);
console.log(`\nStage 4D constraint repair rehearsal: ${checks} checks passed.`);
await pool.end();
