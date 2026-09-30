#!/usr/bin/env npx tsx
/**
 * Run the extended validation-handoff certification against a private,
 * socket-only PostgreSQL 16 cluster. Provider credentials are stripped,
 * transport is denied, and the entire cluster is destroyed afterward.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import {
  buildLocalRehearsalEnvironment,
  launchLocalPostgres16,
  withLocalClient,
  type LocalCluster,
} from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;
const targetScript = "scripts/test-sfp-validation-handoff-repair-certification.ts";

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  console.log("▶ Launching private, socket-only PostgreSQL 16 validation-handoff certification cluster…");
  const cluster: LocalCluster = await launchLocalPostgres16();
  let exitCode = 0;
  let destroyed = false;
  try {
    const database = `sfp_handoff_test_${process.pid}`;
    await withLocalClient(cluster.admin, async client => {
      await client.query(`CREATE DATABASE "${database}"`);
    });
    const dbUrl = `postgresql://${encodeURIComponent(localRole())}@localhost/${database}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    const env = buildLocalRehearsalEnvironment({
      NODE_ENV: "test",
      VG_PROVIDER_DENY_MODE: "1",
      GHL_TRANSPORT_FAILFAST: "true",
      EMAIL_TRANSPORT_FAILFAST: "true",
      SMS_TRANSPORT_FAILFAST: "true",
      SUNBIZ_ENRICHMENT_ENABLED: "false",
      SERPER_GATEWAY_ENABLED: "false",
      ZEROBOUNCE_API_KEY: "",
      APOLLO_API_KEY: "",
      OUTSCRAPER_API_KEY: "",
      SERPER_API_KEY: "",
    });
    env.DATABASE_URL = dbUrl;
    env.TEST_DATABASE_URL = dbUrl;
    env.CREDENTIAL_ENCRYPTION_KEY = "sfp-validation-handoff-disposable-only";
    env.MERCHANT_DATA_ENCRYPTION_KEY = "sfp-validation-handoff-disposable-only";
    env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || `${os.homedir()}/.config`;
    env.PGUSER = localRole();

    console.log(`   ✓ Created disposable database ${database}`);
    const migrate = await run(
      "npx",
      ["tsx", "-e", `(async()=>{try{const m=await import("./server/db-migrate");await m.runDrizzleMigrations();}finally{const d=await import("./server/db");await d.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1})`],
      env,
    );
    if (migrate !== 0) throw new Error(`Private database migrations failed with exit ${migrate}`);
    const pricingSeed = await run(
      "npx",
      ["tsx", "scripts/seed-mi09-pricing.ts", "--apply", "--confirm-env=test"],
      env,
    );
    if (pricingSeed !== 0) throw new Error(`Disposable pricing prerequisite seed failed with exit ${pricingSeed}`);

    console.log(`\n══ ${targetScript} ══`);
    exitCode = await run("npx", ["tsx", targetScript], env);
    if (exitCode !== 0) console.error(`✗ ${targetScript} failed with exit ${exitCode}`);
    else console.log(`✓ ${targetScript} passed`);
  } catch (error) {
    exitCode = exitCode || 1;
    console.error(error);
  } finally {
    console.log("\n▶ Destroying the private PostgreSQL cluster…");
    try {
      await cluster.stop();
      destroyed = true;
      console.log("   ✓ Cluster data directory removed");
    } catch (error) {
      exitCode = 1;
      console.error("   ✗ Failed to destroy the private database cluster", error);
    }
  }
  console.log(`Disposable cluster destroyed: ${destroyed ? "YES" : "NO — CERTIFICATION FAILURE"}`);
  process.exit(exitCode);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});