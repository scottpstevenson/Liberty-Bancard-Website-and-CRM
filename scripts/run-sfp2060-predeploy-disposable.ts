#!/usr/bin/env npx tsx
/**
 * Whole pre-deploy gate with private PostgreSQL, private Redis and an owned
 * HTTP port. No inherited application credentials or shared Redis are used.
 * This launcher is offline certification, never a production migration tool.
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { buildLocalRehearsalEnvironment, launchLocalPostgres16 } from "./local-rehearsal-core";
import { launchSfp2060DisposableRedis } from "./sfp2060-disposable-redis";

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return server.close(() => reject(new Error("NO_OWNED_PORT")));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function main(): Promise<void> {
  const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error("INVALID_RELEASE_SHA");
  const cluster = await launchLocalPostgres16();
  let admin: pg.Client | undefined;
  let redis: Awaited<ReturnType<typeof launchSfp2060DisposableRedis>> | undefined;
  let exitCode = 1;
  try {
    const user = process.env.USER || process.env.LOGNAME || os.userInfo().username;
    const database = `test_sfp2060_predeploy_${randomBytes(8).toString("hex")}`;
    admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, user, database: "postgres" });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    admin = undefined;

    const env = buildLocalRehearsalEnvironment({
      PGUSER: user,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      EMAIL_TRANSPORT_FAILFAST: "true",
      SMS_TRANSPORT_FAILFAST: "true",
      BACKGROUND_JOB_PROFILE: "selective:sfp-campaign-staging",
    });
    redis = await launchSfp2060DisposableRedis(env);
    const appPort = await unusedPort();

    // Restore only launcher-created credentials after the allowlist scrub.
    const dbUrl = `postgresql://${encodeURIComponent(user)}@localhost/${database}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
    Object.assign(env, {
      DATABASE_URL: dbUrl, TEST_DATABASE_URL: dbUrl,
      REDIS_URL: redis.url,
      TEST_REDIS_PREFIX: redis.prefix,
      BASE_URL: `http://127.0.0.1:${appPort}`,
      RELEASE_SHA: releaseSha,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      MERCHANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      ADMIN_SEED_EMAIL: "admin@sfp2060.test",
      ADMIN_SEED_PASSWORD: randomBytes(32).toString("hex"),
    });
    console.log(`SFP pre-deploy: private DB/Redis, owned HTTP port ${appPort}, release ${releaseSha}`);
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn("bash", ["scripts/run-pre-deploy.sh"], { env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 1));
    });
  } finally {
    await admin?.end();
    try {
      await redis?.stop();
    } finally {
      await cluster.stop();
    }
  }
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});