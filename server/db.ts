import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  allowExitOnIdle: false,
});

// Set a 30 s per-statement wall-clock limit on every new physical connection
// so runaway queries from background workers cannot block the pool indefinitely.
pool.on("connect", (client) => {
  client.query("SET statement_timeout = 30000").catch((err: Error) => {
    console.warn("[DB] Failed to set statement_timeout on new connection:", err.message);
  });
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

// ---------------------------------------------------------------------------
// Pool-pressure sampler — emits only when waitingCount > 0.
// Uses setInterval + unref() so it never prevents process exit.
// No DB call — reads in-process pool object properties only.
// ---------------------------------------------------------------------------
const _pressureTimer = setInterval(() => {
  if (pool.waitingCount > 0) {
    console.warn(JSON.stringify({
      event: "db:pool_pressure",
      waitingCount: pool.waitingCount,
      totalCount:   pool.totalCount,
      idleCount:    pool.idleCount,
      ts: new Date().toISOString(),
    }));
  }
}, 15_000);
_pressureTimer.unref();

// ---------------------------------------------------------------------------
// Connection-level observability.
// Wraps pool.query() to record: connection acquisition wait, query fingerprint
// (first 120 chars of SQL, no values), query duration, and pool state at
// acquisition/release.  Emits only when acquisition wait OR query duration
// exceeds thresholds to avoid log storms on fast queries.
//
// Does NOT log SQL parameter values, PII, credentials, or complete SQL bodies.
// ---------------------------------------------------------------------------
const _SLOW_ACQUIRE_MS = 500;   // warn if we waited > 500 ms for a connection
const _SLOW_QUERY_MS   = 2_000; // warn if the query itself took > 2 s

const _origQuery = pool.query.bind(pool) as typeof pool.query;

// @ts-expect-error — narrow override for observability wrapper
pool.query = function observedQuery(textOrConfig: any, values?: any): any {
  const acquireStart = Date.now();
  const poolAtAcquire = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
  const fingerprint = typeof textOrConfig === "string"
    ? textOrConfig.replace(/\s+/g, " ").slice(0, 120)
    : (typeof textOrConfig?.text === "string" ? textOrConfig.text.replace(/\s+/g, " ").slice(0, 120) : "<config>");

  // pg Pool.query() is fire-and-forget for connection lifecycle, so we
  // instrument the returned promise rather than wrapping pool.connect().
  const resultPromise: Promise<any> = values !== undefined
    ? _origQuery(textOrConfig, values)
    : _origQuery(textOrConfig);

  return resultPromise.then(
    (result) => {
      const now = Date.now();
      const totalMs = now - acquireStart;
      // We can't separate acquire vs query time without pool.connect(), but
      // we can flag when the total is slow.
      if (totalMs >= _SLOW_QUERY_MS || poolAtAcquire.waiting >= 5) {
        console.warn(JSON.stringify({
          event:            "db:slow_query",
          fingerprintSql:   fingerprint,
          totalMs,
          poolAtAcquire,
          poolAtRelease:    { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
          ts: new Date().toISOString(),
        }));
      }
      return result;
    },
    (err) => {
      const totalMs = Date.now() - acquireStart;
      if (totalMs >= _SLOW_ACQUIRE_MS || poolAtAcquire.waiting >= 5) {
        console.warn(JSON.stringify({
          event:          "db:query_error",
          fingerprintSql: fingerprint,
          totalMs,
          poolAtAcquire,
          errorType:      err instanceof Error ? err.constructor.name : "UnknownError",
          ts: new Date().toISOString(),
        }));
      }
      throw err;
    },
  );
};

export const db = drizzle(pool, { schema });
