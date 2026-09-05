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

// Background pool-pressure sampler — emits only when waitingCount > 0.
// Uses setInterval + unref() so it never prevents process exit.
// No DB call — reads in-process pool object properties only.
const _pressureTimer = setInterval(() => {
  if (pool.waitingCount > 0) {
    console.warn(JSON.stringify({
      event: "db:pool_pressure",
      waitingCount: pool.waitingCount,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      ts: new Date().toISOString(),
    }));
  }
}, 15_000);
_pressureTimer.unref();

export const db = drizzle(pool, { schema });
