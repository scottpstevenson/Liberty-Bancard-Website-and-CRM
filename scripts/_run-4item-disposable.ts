import os from "node:os";
import { spawn } from "node:child_process";
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
  console.log("▶ Launching disposable PostgreSQL 16 cluster…");
  const cluster = await launchLocalPostgres16();
  let overallExit = 0;
  try {
    const dbName = "sfp4item_test_disposable";
    const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, database: "postgres", user: localRole() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();
    const dbUrl = `postgresql:///${dbName}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PGUSER: localRole(), PGPASSWORD: undefined, PGHOST: undefined, PGPORT: undefined, PGDATABASE: undefined, PGSERVICE: undefined,
      NODE_ENV: "test", DATABASE_URL: dbUrl, TEST_DATABASE_URL: dbUrl,
      GHL_TRANSPORT_FAILFAST: "true", EMAIL_TRANSPORT_FAILFAST: "true", SMS_TRANSPORT_FAILFAST: "true",
      SUNBIZ_ENRICHMENT_ENABLED: "false", SERPER_GATEWAY_ENABLED: "false",
    };
    console.log("▶ Running migrations…");
    const migrateCode = await run("npx", ["tsx", "-e", `import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(e=>{console.error(e);process.exit(1);})`], baseEnv);
    if (migrateCode !== 0) throw new Error(`Migrations failed (exit ${migrateCode})`);
    console.log("▶ Running test-sfp-4item-certification.ts…");
    const code = await run("npx", ["tsx", "scripts/test-sfp-4item-certification.ts"], baseEnv);
    overallExit = code;
  } catch (e) {
    overallExit = 1;
    console.error(e);
  } finally {
    console.log("▶ Destroying disposable cluster…");
    try { await cluster.stop(); console.log("   ✓ destroyed"); } catch (e) { console.error("FAILED TO DESTROY", e); overallExit = 1; }
  }
  process.exit(overallExit);
}
main();
