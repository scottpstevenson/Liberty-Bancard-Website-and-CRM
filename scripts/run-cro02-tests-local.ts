#!/usr/bin/env npx tsx
/**
 * One-off local harness: launches a disposable private PostgreSQL 16 cluster
 * (reusing the local-rehearsal launcher primitives), creates a database whose
 * name is unambiguously a test database, points DATABASE_URL/TEST_DATABASE_URL
 * at it, then runs the given CRO-02 test scripts as child processes against
 * it. Always tears the cluster down, even on failure.
 *
 * Usage: npx tsx scripts/run-cro02-tests-local.ts <script1> [script2 ...]
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import pg from "pg";
import { launchLocalPostgres16 } from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const scripts = process.argv.slice(2);
  if (scripts.length === 0) throw new Error("Usage: run-cro02-tests-local.ts <script1> [script2 ...]");

  console.log("▶ Launching disposable local PostgreSQL 16 cluster…");
  const cluster = await launchLocalPostgres16();
  let overallExit = 0;
  try {
    const dbName = `test_cro02_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, database: "postgres", user: localRole() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
    console.log(`   ✓ Created disposable database: ${dbName}`);

    const dbUrl = `postgresql:///${dbName}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;

    for (const script of scripts) {
      console.log(`\n══ Running ${script} against disposable local cluster ══`);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // Strip any inherited PG* connection vars — they point at the real
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
      const code = await run("npx", ["tsx", script], env);
      if (code !== 0) {
        overallExit = code;
        console.error(`✗ ${script} exited with code ${code}`);
      } else {
        console.log(`✓ ${script} passed`);
      }
    }
  } finally {
    console.log("\n▶ Tearing down disposable local PostgreSQL cluster…");
    await cluster.stop();
    console.log("   ✓ Cluster stopped and workspace cleaned up.");
  }
  process.exit(overallExit);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
