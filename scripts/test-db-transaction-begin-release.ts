import assert from "node:assert/strict";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

// A failed BEGIN inside db.transaction must release (and destroy) the checked-out client; drizzle 0.45 leaked it.
// Faults use a stub on the real pool.connect path; transaction options are also verified on private PostgreSQL.
await assertDisposableTestInfrastructure({ operation: "Transaction release and configuration", requireRedis: false });
const { db, pool } = await import("../server/db");
let checks = 0;
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++; console.log(`✓ ${label}`); };

const originalConnect = pool.connect;
function stubClient(failOn: RegExp | null, log: { queries: string[]; released: unknown[] }) {
  return {
    query: async (config: any) => {
      const text = typeof config === "string" ? config : config?.text ?? "";
      log.queries.push(text);
      if (failOn && failOn.test(text)) throw new Error("connection terminated");
      return { rows: [], rowCount: 0, fields: [] };
    },
    release: (arg?: unknown) => { log.released.push(arg ?? false); },
  };
}
async function run(failOn: RegExp | null, body: () => Promise<unknown>, config?: PgTransactionConfig) {
  const log = { queries: [] as string[], released: [] as unknown[] };
  (pool as any).connect = async () => stubClient(failOn, log);
  let error: unknown = null, result: unknown;
  try { result = await db.transaction(async () => body(), config); } catch (e) { error = e; }
  return { log, error, result };
}
try {
  const begin = await run(/^begin/i, async () => "unused");
  check(begin.error && begin.log.released.length === 1 && begin.log.released[0] === true,
    "a failed BEGIN rejects, releases the client exactly once and destroys it");
  check(!begin.log.queries.some(q => /^(commit|rollback)/i.test(q)), "no commit or rollback is sent after a failed BEGIN");

  const ok = await run(null, async () => "done");
  check(ok.result === "done" && ok.log.released.length === 1 && ok.log.released[0] === false
    && ok.log.queries.map(q => q.trim().split(/\s/)[0].toLowerCase()).join(",") === "begin,commit", "a successful transaction begins, commits and releases normally");

  const failed = await run(null, async () => { throw new Error("boom"); });
  check((failed.error as Error)?.message === "boom" && failed.log.released.length === 1 && failed.log.released[0] === false
    && failed.log.queries.map(q => q.trim().split(/\s/)[0].toLowerCase()).join(",") === "begin,rollback", "a failing body rolls back, rethrows the original error and releases");

  const options = { isolationLevel: "serializable", accessMode: "read only", deferrable: true } as const;
  const configured = await run(null, async () => "configured", options);
  check(configured.result === "configured" && configured.log.queries.join(";") === "begin;set transaction isolation level serializable read only deferrable;commit",
    "transaction options are applied through the public API before the callback");
  const empty = await run(null, async () => "empty", {});
  check(empty.result === "empty" && empty.log.queries.join(";") === "begin;commit",
    "an empty options object preserves the normal default transaction");
  let bodyCalled = false;
  const configFailure = await run(/^set transaction/i, async () => { bodyCalled = true; }, options);
  check(configFailure.error && !bodyCalled && configFailure.log.queries.at(-1) === "rollback"
    && configFailure.log.released.length === 1 && configFailure.log.released[0] === false,
    "configuration failure rolls back and releases without entering the callback");

  (pool as any).connect = originalConnect;
  const observed = await db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT current_setting('transaction_isolation') isolation,
      current_setting('transaction_read_only') read_only, current_setting('transaction_deferrable') deferrable`);
    return result.rows[0];
  }, options);
  check(observed.isolation === "serializable" && observed.read_only === "on" && observed.deferrable === "on",
    "real PostgreSQL observes serializable, read-only and deferrable options in the transaction");
  const reset = await db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT current_setting('transaction_read_only') read_only`);
    return result.rows[0];
  });
  check(reset.read_only === "off", "transaction configuration does not leak into the next checkout");
  const emptyOptions = await db.transaction(async tx => (await tx.execute(sql`SELECT 1 AS value`)).rows[0], {});
  check(emptyOptions.value === 1, "real PostgreSQL accepts an empty transaction configuration");
  console.log(`DB transaction BEGIN release: PASS (${checks} checks)`);
} finally {
  (pool as any).connect = originalConnect;
  await pool.end().catch(() => undefined);
}
