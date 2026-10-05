import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {createHash} from "node:crypto";
import * as schema from "@shared/schema";
import { getDbContext } from "./lib/db-context";
import { observeTransactionConnections } from "./lib/transaction-observability";

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
// Connection-level observability — pool.connect() wrapper.
//
// Tracks separately:
//   acquireWaitMs   — time waiting in the pool queue for a free connection
//   queryDurationMs — wall-clock time spent executing the query
//   checkoutDurationMs — total time the connection was out of the pool
//
// Also emits db:long_transaction when a connection is held open > 5 s
// without being released (indicates a long-running transaction).
//
// Logs are annotated with correlationId + normalizedRoute from
// AsyncLocalStorage (set by the Express correlation middleware or BullMQ
// job processors via setDbContext()).
//
// Does NOT log SQL parameter values, PII, credentials, or full SQL bodies.
// ---------------------------------------------------------------------------
const _SLOW_QUERY_MS   = parseInt(process.env.DB_SLOW_QUERY_MS   ?? "2000",  10);
const _SLOW_ACQUIRE_MS = parseInt(process.env.DB_SLOW_ACQUIRE_MS ?? "500", 10);

function _fingerprint(sql: string): string {
  // Raw SQL may contain literals even when most callers bind parameters.
  return `sha256:${createHash("sha256").update(sql.replace(/\s+/g, " ").trim()).digest("hex").slice(0,16)}`;
}

function _poolSnapshot() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

// Observe acquisition and pool release EVENTS; never wrap client.release().
// Query instrumentation is physical-connection scoped, not checkout scoped.
observeTransactionConnections(pool, {slowMs: _SLOW_QUERY_MS,
  tagSql: process.env.NODE_ENV === "production" && process.env.REPLIT_DEPLOYMENT === "1"});

// Wrap pool.query() for callers that use the shorthand (no explicit
// connect/release).  These cannot separate acquire from query time, but they
// do get correlationId / normalizedRoute.
const _origQuery = pool.query.bind(pool) as typeof pool.query;

pool.query = function observedPoolQuery(...args: any[]): any {
  const textOrConfig=args[0];
  const acquireStart  = Date.now();
  const poolAtAcquire = _poolSnapshot();
  const ctx           = getDbContext();
  const fingerprint   = typeof textOrConfig === "string"
    ? _fingerprint(textOrConfig)
    : (typeof textOrConfig?.text === "string" ? _fingerprint(textOrConfig.text) : "<config>");

  const observe=(err?:any)=>{
      const totalMs = Date.now() - acquireStart;
      if (!err && (totalMs >= _SLOW_QUERY_MS || poolAtAcquire.waiting >= 5)) {
        console.warn(JSON.stringify({
          event:            "db:slow_query",
          correlationId:    ctx?.correlationId  ?? null,
          normalizedRoute:  ctx?.normalizedRoute ?? null,
          // pool.query() does not separate acquire from query; report as totalMs
          acquireWaitMs:    null,
          queryDurationMs:  totalMs,
          checkoutDurationMs: null,
          fingerprintSql:   fingerprint,
          poolAtAcquire,
          poolAtRelease:    _poolSnapshot(),
          ts: new Date().toISOString(),
        }));
      }
      if (err && (totalMs >= _SLOW_ACQUIRE_MS || poolAtAcquire.waiting >= 5)) {
        console.warn(JSON.stringify({
          event:           "db:query_error",
          correlationId:   ctx?.correlationId  ?? null,
          normalizedRoute: ctx?.normalizedRoute ?? null,
          acquireWaitMs:   null,
          queryDurationMs: totalMs,
          fingerprintSql:  fingerprint,
          poolAtAcquire,
          errorType:       err instanceof Error ? err.constructor.name : "UnknownError",
          ts: new Date().toISOString(),
        }));
      }
  };
  const callbackIndex=typeof args[args.length-1]==="function" ? args.length-1 : -1;
  if (callbackIndex>=0) {
    const callback=args[callbackIndex];
    args[callbackIndex]=function(this:any,err:any,...results:any[]) {
      observe(err);return callback.call(this,err,...results);
    };
  }
  const result=(_origQuery as any)(...args);
  if (!result?.then) return result;
  return result.then((value:any)=>{observe();return value;},(err:any)=>{observe(err);throw err;});
};

export const db = drizzle(pool, { schema });
