#!/usr/bin/env npx tsx
/**
 * run-sunbiz-full-backfill-disposable.ts
 *
 * Runs scripts/test-sunbiz-full-backfill-disposable.ts against a genuinely
 * single-purpose disposable PostgreSQL 16 cluster (never dev/prod), then
 * destroys the whole cluster once the child process closes its connections.
 *
 * Mirrors the pattern in run-sfp-certification-disposable.ts.
 *
 * Usage:
 *   npx tsx scripts/run-sunbiz-full-backfill-disposable.ts
 */
import { spawn } from "node:child_process";
import os from "node:os";
import pg from "pg";
import { launchLocalPostgres16, type LocalCluster } from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;

const SCRIPTS = ["scripts/test-sunbiz-full-backfill-disposable.ts"];

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("▶ Launching single-purpose disposable PostgreSQL 16 cluster for Sunbiz full-backfill certification…");
  const cluster: LocalCluster = await launchLocalPostgres16();

  let overallExit = 0;
  let clusterDestroyed = false;
  try {
    const dbName = "sunbiz_backfill_test_disposable";
    const admin = new pg.Client({
      host: cluster.socket.realpath,
      port: cluster.port,
      database: "postgres",
      user: localRole(),
    });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
    console.log(`   ✓ Created disposable database: ${dbName}`);

    const dbUrl = `postgresql:///${dbName}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;

    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PGUSER: localRole(),
      PGPASSWORD: undefined,
      PGHOST: undefined,
      PGPORT: undefined,
      PGDATABASE: undefined,
      PGSERVICE: undefined,
      NODE_ENV: "test",
      DATABASE_URL: dbUrl,
      TEST_DATABASE_URL: dbUrl,
      GHL_TRANSPORT_FAILFAST: "true",
      EMAIL_TRANSPORT_FAILFAST: "true",
      SMS_TRANSPORT_FAILFAST: "true",
      SUNBIZ_ENRICHMENT_ENABLED: "false",
      SUNBIZ_MATERIALIZATION_ENABLED: "false",
      SUNBIZ_LEGACY_PROMOTION_ENABLED: "false",
      SERPER_GATEWAY_ENABLED: "false",
    };

    console.log("\n▶ Running Drizzle migrations against the disposable database…");
    const migrateCode = await run(
      "npx",
      ["tsx", "-e", `import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(e=>{console.error(e);process.exit(1);})`],
      baseEnv,
    );
    if (migrateCode !== 0) {
      throw new Error(`Migrations against the disposable database failed (exit ${migrateCode}).`);
    }

    for (const script of SCRIPTS) {
      console.log(`\n══ Running ${script} against the disposable database ══`);
      const code = await run("npx", ["tsx", script], baseEnv);
      if (code !== 0) {
        overallExit = code;
        break;
      }
    }
  } finally {
    console.log("\n▶ Destroying the disposable PostgreSQL cluster (whole cluster, not row-level cleanup)…");
    await cluster.stop();
    clusterDestroyed = true;
    console.log("   ✓ Disposable PostgreSQL cluster destroyed.");
  }

  if (!clusterDestroyed) {
    console.error("   ✗ FAILED TO DESTROY the disposable PostgreSQL cluster.");
    process.exit(1);
  }
  process.exit(overallExit);
}

main().catch((err) => {
  console.error("✗ Sunbiz full-backfill disposable certification wrapper failed:", err);
  process.exit(1);
});
