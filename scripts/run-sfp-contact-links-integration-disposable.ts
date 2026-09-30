#!/usr/bin/env npx tsx
/**
 * Launch the strict contact-business system-link integration suite on a fresh
 * socket-only PostgreSQL 16 cluster, migrate that disposable database through
 * the real Drizzle runner, then destroy the complete cluster.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  buildLocalRehearsalEnvironment,
  launchLocalPostgres16,
  withLocalClient,
} from "./local-rehearsal-core";

const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;
const tsx = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function run(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, ...args], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  console.log("▶ Launching isolated PostgreSQL 16 cluster for SFP contact-link integration…");
  const cluster = await launchLocalPostgres16();
  let exitCode = 1;
  let destroyed = false;
  try {
    const databaseName = "sfp_contact_links_test_disposable";
    await withLocalClient(cluster.admin, async (admin) => {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    });
    const databaseUrl = `postgresql://${encodeURIComponent(localRole())}@localhost/${databaseName}`
      + `?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    const env = buildLocalRehearsalEnvironment({
      PGUSER: localRole(),
      NODE_ENV: "test",
    });
    // The shared sanitizer intentionally strips database URLs and provider
    // flags even from overrides. Reintroduce only this launcher's socket-only
    // target after scrubbing; child processes inherit no other DB credentials.
    env.DATABASE_URL = databaseUrl;
    env.TEST_DATABASE_URL = databaseUrl;
    env.PGUSER = localRole();
    env.PGHOST = undefined;
    env.PGPORT = undefined;
    env.PGDATABASE = undefined;
    env.PGPASSWORD = undefined;
    env.PGSERVICE = undefined;
    env.GHL_TRANSPORT_FAILFAST = "true";
    env.EMAIL_TRANSPORT_FAILFAST = "true";
    env.SMS_TRANSPORT_FAILFAST = "true";
    env.SUNBIZ_ENRICHMENT_ENABLED = "false";
    env.SUNBIZ_MATERIALIZATION_ENABLED = "false";
    env.SUNBIZ_LEGACY_PROMOTION_ENABLED = "false";
    env.SERPER_GATEWAY_ENABLED = "false";

    console.log("\n▶ Applying journal migrations to this fresh disposable database…");
    const migrateCode = await run([
      "-e",
      `import(${JSON.stringify(path.resolve("server/db-migrate.ts"))})`
        + `.then(m=>m.runDrizzleMigrations())`
        + `.then(()=>import(${JSON.stringify(path.resolve("server/db.ts"))})).then(d=>d.pool.end())`
        + `.catch(e=>{console.error(e);process.exitCode=1})`,
    ], env);
    if (migrateCode !== 0) throw new Error(`Disposable Drizzle migration run failed (${migrateCode}).`);

    console.log("\n▶ Running strict contact/business system-link integration assertions…");
    exitCode = await run(["scripts/test-sfp-contact-links-integration.ts"], env);
  } finally {
    console.log("\n▶ Destroying isolated PostgreSQL cluster…");
    await cluster.stop();
    destroyed = true;
    console.log("✓ Disposable cluster destroyed.");
  }
  if (!destroyed) throw new Error("Disposable PostgreSQL cluster was not destroyed.");
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error("✗ SFP contact-link disposable integration launcher failed:", error);
  process.exitCode = 1;
});