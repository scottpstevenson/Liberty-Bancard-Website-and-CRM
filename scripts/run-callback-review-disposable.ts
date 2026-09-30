import os from "node:os";
import { spawn } from "node:child_process";
import pg from "pg";
import { launchLocalPostgres16 } from "./local-rehearsal-core";

function run(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`)));
  });
}

async function main() {
  const cluster = await launchLocalPostgres16();
  try {
    const role = process.env.USER || process.env.LOGNAME || os.userInfo().username;
    const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, database: "postgres", user: role });
    await admin.connect();
    try { await admin.query('CREATE DATABASE "callback_review_disposable"'); } finally { await admin.end(); }
    const url = `postgresql:///callback_review_disposable?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGHOST: undefined, PGPORT: undefined, PGDATABASE: undefined, PGUSER: role, PGPASSWORD: undefined, PGSERVICE: undefined,
      DATABASE_URL: url, TEST_DATABASE_URL: url, NODE_ENV: "test",
      GHL_TRANSPORT_FAILFAST: "true", EMAIL_TRANSPORT_FAILFAST: "true", SMS_TRANSPORT_FAILFAST: "true",
      SUNBIZ_ENRICHMENT_ENABLED: "false", SERPER_GATEWAY_ENABLED: "false",
      AI_INTEGRATIONS_OPENAI_API_KEY: undefined, AI_INTEGRATIONS_OPENAI_BASE_URL: undefined,
    };
    await run(["tsx", "-e", `import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(e=>{console.error(e);process.exit(1);})`], env);
    await run(["tsx", "scripts/test-callback-review-disposable.ts"], env);
  } finally {
    await cluster.stop();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });