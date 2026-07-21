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
  // Enough headroom for BullMQ workers (up to ~30 concurrent DB calls across all
  // queues) plus HTTP request handlers without pool starvation.
  max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
  // Release idle connections after 30 s so we don't hold DB server slots open.
  idleTimeoutMillis: 30_000,
  // If the pool is fully saturated, fail the caller within 10 s rather than
  // hanging indefinitely (which caused "Authentication timed out" in production).
  connectionTimeoutMillis: 10_000,
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
