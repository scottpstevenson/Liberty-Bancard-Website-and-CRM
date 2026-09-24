#!/usr/bin/env npx tsx
/**
 * run-sfp-certification-disposable.ts
 *
 * Runs the SFP (South Florida Prospecting) certification suites
 * (scripts/sfp-certification.ts, scripts/test-sfp2000-disposable-certification.ts)
 * against a genuinely single-purpose disposable PostgreSQL 16 cluster, then
 * destroys the ENTIRE cluster — not individual rows — once the child
 * processes have closed their connections.
 *
 * Why whole-database destruction instead of in-script row cleanup:
 *   sfp_cohort_runs/members/decisions/eligibility/snapshots are protected by
 *   the SFP_FROZEN_IMMUTABLE trigger once a cohort is frozen. A prior
 *   revision of sfp-certification.ts tried to satisfy cleanup by forcing a
 *   'voided' lifecycle transition on every cert-created run and then
 *   row-deleting its children — exercising a production lifecycle
 *   transition purely as a test-cleanup mechanism, and risking a
 *   half-cleaned frozen/voided cohort history if any step failed midway.
 *   Provisioning a disposable cluster per run and dropping the whole thing
 *   afterward removes that class of bug entirely: there is no partial state
 *   to leave behind, and nothing in the certified schema is ever touched by
 *   anything other than the certification code path itself.
 *
 * Destroy-failure handling: cluster.stop() (from local-rehearsal-core.ts)
 * terminates the private postgres process and then removes its private data
 * directory. If either step throws, that throw is NOT swallowed here — it
 * fails this script (non-zero exit) even if every certification phase
 * passed, because a disposable database that outlives its run is exactly
 * the failure this wrapper exists to prevent.
 *
 * Usage:
 *   RELEASE_SHA=$(git rev-parse HEAD) npx tsx scripts/run-sfp-certification-disposable.ts
 */
import { spawn } from "node:child_process";
import os from "node:os";
import pg from "pg";
import { launchLocalPostgres16, type LocalCluster } from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;

const SCRIPTS = [
  "scripts/sfp-certification.ts",
  "scripts/test-sfp2000-disposable-certification.ts",
];

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("▶ Launching single-purpose disposable PostgreSQL 16 cluster for SFP certification…");
  const cluster: LocalCluster = await launchLocalPostgres16();

  let overallExit = 0;
  let clusterDestroyed = false;
  try {
    const dbName = "sfp_certification_test_disposable";
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
      // Strip inherited PG* connection vars — they point at the real
      // application database's role/host and must never leak into the
      // disposable local connection string's implicit defaults.
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
    console.log("   ✓ Migrations applied");

    for (const script of SCRIPTS) {
      console.log(`\n══ Running ${script} against the disposable database ══`);
      const code = await run("npx", ["tsx", script], baseEnv);
      if (code !== 0) {
        overallExit = code;
        console.error(`✗ ${script} exited with code ${code}`);
      } else {
        console.log(`✓ ${script} passed`);
      }
    }
  } catch (error) {
    overallExit = overallExit || 1;
    console.error(error);
  } finally {
    console.log("\n▶ Destroying the disposable PostgreSQL cluster (whole cluster, not row-level cleanup)…");
    try {
      await cluster.stop();
      clusterDestroyed = true;
      console.log("   ✓ Disposable cluster destroyed — no test data or schema survives this run.");
    } catch (destroyError) {
      // A disposable database that fails to be destroyed is a real failure
      // of this suite's contract, independent of whether the certification
      // phases themselves passed — never swallow this.
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
