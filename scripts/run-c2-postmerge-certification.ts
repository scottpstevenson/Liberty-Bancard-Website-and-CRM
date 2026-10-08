import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import pg from "pg";
import { buildLocalRehearsalEnvironment, launchLocalPostgres16 } from "./local-rehearsal-core";
import { launchSfp2060DisposableRedis } from "./sfp2060-disposable-redis";
const env = buildLocalRehearsalEnvironment();
const cluster = await launchLocalPostgres16(env);
let redis: Awaited<ReturnType<typeof launchSfp2060DisposableRedis>> | undefined;
try {
  const name = `test_sfp2060_c2_repairs_${randomBytes(5).toString("hex")}`;
  const user = userInfo().username;
  const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, user, database: "postgres" });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE "${name}"`); } finally { await admin.end(); }
  redis = await launchSfp2060DisposableRedis(env);
  const url = `postgresql://${encodeURIComponent(user)}@localhost/${name}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
  Object.assign(env, { DATABASE_URL: url, TEST_DATABASE_URL: url, REDIS_URL: redis.url,
    TEST_REDIS_PREFIX: redis.prefix, SESSION_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MERCHANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    CERTIFICATION_RUN_ID: randomUUID(), BACKGROUND_JOB_PROFILE: "off",
    OPENAI_API_KEY: "sfp2060-disposable-constructor-only", AI_INTEGRATIONS_OPENAI_API_KEY: "sfp2060-disposable-constructor-only",
    EMAIL_TRANSPORT_FAILFAST: "true", SMS_TRANSPORT_FAILFAST: "true" });
  async function run(args: string[]) {
    const exit = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, args, { env, stdio: "inherit" });
      const timeout = setTimeout(() => child.kill("SIGKILL"), 240000);
      child.once("error", reject); child.once("exit", code => { clearTimeout(timeout); resolve(code ?? 1); });
    });
    if (exit !== 0) throw new Error(`Isolated certification child failed: ${args.at(-1)} (exit ${exit})`);
  }
  await run(["node_modules/tsx/dist/cli.mjs", "-e",
    'import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(()=>process.exit(1))']);
  const header = process.argv.includes("--header-before") || process.argv.includes("--header-after");
  if (!process.argv.includes("--browser-only") && !header)
    await run(["node_modules/tsx/dist/cli.mjs", "scripts/test-stage3-c2-actions.ts"]);
  await run(header
    ? ["node_modules/tsx/dist/cli.mjs", "scripts/test-c2-contact-header.ts", ...(process.argv.includes("--header-before") ? ["--before"] : [])]
    : ["node_modules/tsx/dist/cli.mjs", "scripts/test-c2-postmerge-browser.ts"]);
} finally { await redis?.stop(); await cluster.stop(); }
