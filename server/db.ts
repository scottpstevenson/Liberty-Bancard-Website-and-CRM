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
  // 29 BullMQ workers can hold up to ~34 concurrent DB connections when their
  // concurrency settings are summed. The pool must be large enough to absorb
  // all workers at peak PLUS simultaneous HTTP request handlers without
  // starvation. Default raised from 20 → 50; override with DB_POOL_MAX.
  max: parseInt(process.env.DB_POOL_MAX ?? "50", 10),
  // Release idle connections after 30 s so we don't hold DB server slots open.
  idleTimeoutMillis: 30_000,
  // If the pool is fully saturated, fail the caller within 5 s (was 10 s).
  // Faster failure means callers surface a 500 quickly rather than blocking a
  // thread for 10 s, which makes the saturation cascade worse.
  connectionTimeoutMillis: 5_000,
  // Keep the underlying TCP socket alive so the OS doesn't silently drop
  // long-idle connections (common cause of ECONNRESET on the first query
  // after a quiet period).
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Allow up to 5 re-connection attempts before surfacing the error.
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

export const db = drizzle(pool, { schema });
