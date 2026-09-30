#!/usr/bin/env npx tsx
/**
 * Run the focused Task #2056 C1/C2/C3/C6 and free/paid staging certifications
 * against a private PostgreSQL 16 cluster, then destroy the whole cluster.
 * The runner receives no inherited application/provider database credentials.
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
const scripts = [
  "scripts/test-sfp2056-c1-c2-c3-c6-contact-certification.ts",
];

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  console.log("▶ Launching private, socket-only PostgreSQL 16 certification cluster…");
  const cluster: LocalCluster = await launchLocalPostgres16();
  let exitCode = 0;
  let destroyed = false;
  try {
    const database = `sfp2056_contact_test_${process.pid}`;
    await withLocalClient(cluster.admin, async (client) => {
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
    // Only the locally generated socket URL crosses the subprocess boundary;
    // buildLocalRehearsalEnvironment intentionally strips all database URLs.
    env.DATABASE_URL = dbUrl;
    env.TEST_DATABASE_URL = dbUrl;
    // These are deterministic, local-only encryption material required by
    // canonical contact/evidence writers. They are not provider credentials;
    // the provider deny boundary still strips every real provider secret.
    env.CREDENTIAL_ENCRYPTION_KEY = "task-2056-disposable-certification-only";
    env.MERCHANT_DATA_ENCRYPTION_KEY = "task-2056-disposable-certification-only";
    // The Nix-provided npx shim expects XDG_CONFIG_HOME to be defined even
    // though it is not a credential and is intentionally absent from the
    // rehearsal core's inherited environment allowlist.
    env.XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || `${os.homedir()}/.config`;
    // Explicitly pin libpq variables to the launcher-created socket only.
    // No inherited PG*, production, provider, or transport secrets survive.
    env.PGUSER = localRole();
    console.log(`   ✓ Created disposable database ${database}`);
    const migrate = await run(
      "npx",
      ["tsx", "-e", `(async()=>{try{const m=await import("./server/db-migrate");await m.runDrizzleMigrations();}finally{const d=await import("./server/db");await d.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1})`],
      env,
    );
    if (migrate !== 0) throw new Error(`Private database migrations failed with exit ${migrate}`);
    const pricingSeed = await run("npx", ["tsx", "scripts/seed-mi09-pricing.ts", "--apply", "--confirm-env=test"], env);
    if (pricingSeed !== 0) throw new Error(`Disposable pricing prerequisite seed failed with exit ${pricingSeed}`);
    for (const script of scripts) {
      console.log(`\n══ ${script} ══`);
      const result = await run("npx", ["tsx", script], env);
      if (result !== 0) {
        exitCode = result;
        console.error(`✗ ${script} failed with exit ${result}`);
      } else {
        console.log(`✓ ${script} passed`);
      }
    }
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
      console.error("   ✗ Failed to destroy private database cluster", error);
    }
  }
  console.log(`Disposable cluster destroyed: ${destroyed ? "YES" : "NO — CERTIFICATION FAILURE"}`);
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});