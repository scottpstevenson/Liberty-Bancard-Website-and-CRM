#!/usr/bin/env npx tsx
/**
 * Runs scripts/test-sfp-serper-pilot-control-certification.ts against a
 * genuinely single-purpose disposable PostgreSQL 16 cluster, then destroys
 * the whole cluster. See run-sfp-certification-disposable.ts for the
 * rationale (frozen-cohort triggers make row-level cleanup unsafe).
 */
import { spawn } from "node:child_process";
import os from "node:os";
import pg from "pg";
import { launchLocalPostgres16, type LocalCluster } from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("▶ Launching single-purpose disposable PostgreSQL 16 cluster…");
  const cluster: LocalCluster = await launchLocalPostgres16();
  let overallExit = 0;
  let clusterDestroyed = false;
  try {
    const dbName = "sfp_serper_pilot_test_disposable";
    const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, database: "postgres", user: localRole() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
    console.log(`   ✓ Created disposable database: ${dbName}`);

    const dbUrl = `postgresql:///${dbName}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PGUSER: localRole(), PGPASSWORD: undefined, PGHOST: undefined, PGPORT: undefined, PGDATABASE: undefined, PGSERVICE: undefined,
      NODE_ENV: "test", DATABASE_URL: dbUrl, TEST_DATABASE_URL: dbUrl,
      GHL_TRANSPORT_FAILFAST: "true", EMAIL_TRANSPORT_FAILFAST: "true", SMS_TRANSPORT_FAILFAST: "true",
      SUNBIZ_ENRICHMENT_ENABLED: "false", SERPER_GATEWAY_ENABLED: "false",
    };

    console.log("\n▶ Running Drizzle migrations against the disposable database…");
    const migrateCode = await run("npx", ["tsx", "-e",
      `import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(e=>{console.error(e);process.exit(1);})`,
    ], baseEnv);
    if (migrateCode !== 0) throw new Error(`Migrations failed (exit ${migrateCode}).`);
    console.log("   ✓ Migrations applied");

    console.log("\n══ Running scripts/test-sfp-serper-pilot-control-certification.ts ══");
    const code = await run("npx", ["tsx", "scripts/test-sfp-serper-pilot-control-certification.ts"], baseEnv);
    overallExit = code;
    console.log(code === 0 ? "✓ certification passed" : `✗ certification exited with code ${code}`);
  } catch (error) {
    overallExit = overallExit || 1;
    console.error(error);
  } finally {
    console.log("\n▶ Destroying the disposable PostgreSQL cluster…");
    try {
      await cluster.stop();
      clusterDestroyed = true;
      console.log("   ✓ Disposable cluster destroyed.");
    } catch (destroyError) {
      console.error("   ✗ FAILED TO DESTROY the disposable PostgreSQL cluster:", destroyError);
      overallExit = 1;
    }
  }
  console.log(`\nDisposable database destroyed: ${clusterDestroyed ? "YES" : "NO — TREATED AS FAILURE"}`);
  process.exit(overallExit);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
