#!/usr/bin/env npx tsx
/**
 * Whole pre-deploy gate with private PostgreSQL, private Redis and an owned
 * HTTP port. No inherited application credentials or shared Redis are used.
 * This launcher is offline certification, never a production migration tool.
 *
 * Default: preserve the complete mandatory pre-deploy roster, with a fresh
 * private DB clone, Redis process/namespace, and port for every roster entry.
 * The migrated DB template is never passed to a suite or application server.
 * Bounded: --only <exact-suite-script-path> applies the same private-resource
 * isolation to only that roster entry.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import {
  MANDATORY_SUITES,
  selectMandatorySuites,
  isPrivateDisposableGateEnvironment,
  shouldSkipExplicitDisposableOptIn,
  type Suite,
  type SuiteSelection,
} from "./pre-deploy";
import { buildLocalRehearsalEnvironment, launchLocalPostgres16, type LocalCluster } from "./local-rehearsal-core";
import { launchSfp2060DisposableRedis } from "./sfp2060-disposable-redis";

type DisposableRedis = Awaited<ReturnType<typeof launchSfp2060DisposableRedis>>;

const TSX_CLI = path.resolve("node_modules/tsx/dist/cli.mjs");

export function isOwnedCertificationHttpReadiness(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    body.env === "test" &&
    body.ghlTransportFailFast === true &&
    body.certificationHttpNonce === env.CERTIFICATION_HTTP_NONCE &&
    body.certificationHttpListenerAddress === "127.0.0.1" &&
    body.certificationHttpListenerPort === Number(env.PORT) &&
    body.certificationHttpReusePort === false
  );
}

async function unusedPort(excluded: ReadonlySet<number> = new Set()): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") return server.close(() => reject(new Error("NO_OWNED_PORT")));
        server.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    if (!excluded.has(port)) return port;
  }
  throw new Error("UNIQUE_OWNED_PORT_ALLOCATION_FAILED");
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
}

export function createSuiteDatabaseName(script: string, id = randomUUID()): string {
  const basename = path.basename(script).replace(/[^a-z0-9]/gi, "_").toLowerCase().slice(0, 27);
  return `test_sfp2060_${basename}_${id.replace(/-/g, "").slice(0, 12)}`;
}

export interface IsolatedSuitePlanEntry {
  suite: Suite;
  databaseName: string;
}

export function planIsolatedSuiteRuns(suites: readonly Suite[]): IsolatedSuitePlanEntry[] {
  return suites.map(suite => ({ suite, databaseName: createSuiteDatabaseName(suite.script) }));
}

export interface OwnedSuiteResources {
  server?: { stop: () => Promise<void> };
  redis?: { stop: () => Promise<void> };
  database?: { stop: () => Promise<void> };
  client?: { end: () => Promise<unknown> };
}

/** Stop every owned handle even if one teardown action itself fails. */
export async function teardownOwnedSuiteResources(resources: OwnedSuiteResources): Promise<void> {
  const failures: string[] = [];
  const actions: Array<[string, () => Promise<unknown> | undefined]> = [
    ["HTTP server", () => resources.server?.stop()],
    ["private Redis", () => resources.redis?.stop()],
    ["private suite database", () => resources.database?.stop()],
    ["PostgreSQL admin client", () => resources.client?.end()],
  ];
  for (const [label, stop] of actions) {
    try {
      await stop();
    } catch (error) {
      failures.push(`${label}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures.map(message => new Error(message)), `Disposable suite teardown failed: ${failures.join("; ")}`);
  }
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (childExited(child)) return true;
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", finish);
      child.removeListener("close", finish);
      resolve(childExited(child));
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
    child.once("close", finish);
  });
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

async function stopServerProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return; // Spawn failed before an owned process/group existed.

  if (process.platform !== "win32") {
    try {
      // Kill the whole owned group even when its leader already exited; a
      // failed startup may have left descendants holding the group open.
      process.kill(-pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + 10_000;
    while (processGroupExists(pid) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (processGroupExists(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      const forceDeadline = Date.now() + 5_000;
      while (processGroupExists(pid) && Date.now() < forceDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (processGroupExists(pid)) {
        throw new Error("Disposable app server process group remained after SIGKILL");
      }
    }
  } else if (!childExited(child)) {
    child.kill("SIGTERM");
    if (!(await waitForChildExit(child, 10_000))) {
      child.kill("SIGKILL");
      if (!(await waitForChildExit(child, 5_000))) {
        throw new Error("Disposable app server did not exit after SIGKILL");
      }
    }
  }

  if (!(await waitForChildExit(child, 2_000))) {
    throw new Error("Disposable app server leader did not exit after process-group teardown");
  }
}

interface OwnedServerSpawnOptions {
  command: string;
  args: string[];
  onChildCreated?: (child: ChildProcess) => void;
}

async function startOwnedHttpServer(
  env: NodeJS.ProcessEnv,
  options: OwnedServerSpawnOptions = {
    command: process.execPath,
    args: [TSX_CLI, "server/index.ts"],
  },
  readinessTimeoutMs = 90_000,
): Promise<{ stop: () => Promise<void> }> {
  const child = spawn(options.command, options.args, {
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  options.onChildCreated?.(child);
  let launchError: Error | undefined;
  child.once("error", error => { launchError = error; });
  const healthUrl = `${env.BASE_URL}/api/health`;
  const deadline = Date.now() + readinessTimeoutMs;
  let lastDetail = "not reachable";
  let startupPassed = false;
  let startupFailure: unknown;
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (childExited(child)) {
        throw new Error(`Disposable app server exited before readiness (${child.exitCode ?? child.signalCode}).`);
      }
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
        if (response.ok) {
          const body = await response.json() as Record<string, unknown>;
          if (isOwnedCertificationHttpReadiness(body, env)) {
            startupPassed = true;
            return { stop: () => stopServerProcess(child) };
          }
          throw new Error(
            `owned HTTP readiness contract mismatch: env=${String(body.env ?? "<missing>")} ` +
            `nonce=${body.certificationHttpNonce === env.CERTIFICATION_HTTP_NONCE ? "matched" : "mismatched"} ` +
            `address=${String(body.certificationHttpListenerAddress ?? "<missing>")} ` +
            `port=${String(body.certificationHttpListenerPort ?? "<missing>")} ` +
            `reusePort=${String(body.certificationHttpReusePort ?? "<missing>")}`,
          );
        } else {
          lastDetail = `health returned HTTP ${response.status}`;
        }
      } catch (error) {
        if ((error as Error).message.startsWith("owned HTTP readiness contract mismatch")) throw error;
        lastDetail = (error as Error).message;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Disposable app server did not reach its verified test posture: ${lastDetail}`);
  } catch (error) {
    startupFailure = error;
  } finally {
    if (!startupPassed) {
      try {
        await stopServerProcess(child);
      } catch (cleanupError) {
        throw new AggregateError(
          [startupFailure, cleanupError].filter(Boolean) as Error[],
          `Disposable app server startup failed and its owned process group could not be stopped: ${(cleanupError as Error).message}`,
        );
      }
    }
  }
  throw startupFailure instanceof Error ? startupFailure : new Error(String(startupFailure ?? "OWNED_HTTP_STARTUP_FAILED"));
}

async function createSuiteDatabase(cluster: LocalCluster, user: string, name: string): Promise<string> {
  const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, user, database: "postgres" });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end().catch(() => {});
  }
  return `postgresql://${encodeURIComponent(user)}@localhost/${name}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
}

/**
 * The migrated template is immutable: it is never used as an application or
 * test DATABASE_URL. Each suite receives its own PostgreSQL clone.
 */
async function createSuiteDatabaseFromTemplate(
  cluster: LocalCluster,
  user: string,
  name: string,
  templateName: string,
): Promise<string> {
  const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, user, database: "postgres" });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  } finally {
    await admin.end().catch(() => {});
  }
  return `postgresql://${encodeURIComponent(user)}@localhost/${name}?host=${encodeURIComponent(cluster.socket.realpath)}&port=${cluster.port}`;
}

async function dropSuiteDatabase(cluster: LocalCluster, user: string, name: string): Promise<void> {
  const admin = new pg.Client({ host: cluster.socket.realpath, port: cluster.port, user, database: "postgres" });
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await admin.end().catch(() => {});
  }
}

function buildSuiteEnvironment(options: {
  user: string;
  databaseUrl: string;
  redis: DisposableRedis;
  appPort: number;
  releaseSha: string;
}): NodeJS.ProcessEnv {
  const url = `http://127.0.0.1:${options.appPort}`;
  const env = buildLocalRehearsalEnvironment({
    PGUSER: options.user,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    EMAIL_TRANSPORT_FAILFAST: "true",
    SMS_TRANSPORT_FAILFAST: "true",
    BACKGROUND_JOB_PROFILE: "selective:sfp-campaign-staging",
    FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED: "true",
  });
  Object.assign(env, {
    DATABASE_URL: options.databaseUrl,
    TEST_DATABASE_URL: options.databaseUrl,
    REDIS_URL: options.redis.url,
    TEST_REDIS_PREFIX: options.redis.prefix,
    BASE_URL: url,
    TEST_BASE_URL: url,
    PORT: String(options.appPort),
    CERTIFICATION_HTTP_HOST: "127.0.0.1",
    CERTIFICATION_HTTP_NONCE: randomBytes(32).toString("hex"),
    RELEASE_SHA: options.releaseSha,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    MERCHANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    ADMIN_SEED_EMAIL: "admin@sfp2060.test",
    ADMIN_SEED_PASSWORD: randomBytes(32).toString("hex"),
    OPENAI_API_KEY: "sfp2060-disposable-constructor-only",
    AI_INTEGRATIONS_OPENAI_API_KEY: "sfp2060-disposable-constructor-only",
    OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
  });
  if (!isPrivateDisposableGateEnvironment(env)) {
    throw new Error("Refusing to launch a bounded pre-deploy suite without verified private DB/provider-denial/loopback invariants.");
  }
  return env;
}

async function runMigrations(env: NodeJS.ProcessEnv, description: string): Promise<void> {
  const migration = await run(
    process.execPath,
    [
      TSX_CLI,
      "-e",
      `import("./server/db-migrate").then(m=>m.runDrizzleMigrations()).then(()=>import("./server/db")).then(d=>d.pool.end()).catch(e=>{console.error(e);process.exit(1);})`,
    ],
    env,
  );
  if (migration !== 0) throw new Error(`Private migration failed for ${description} (exit ${migration}).`);
}

async function createMigratedDatabaseTemplate(cluster: LocalCluster, options: {
  user: string;
  releaseSha: string;
  usedPorts: Set<number>;
}): Promise<{ databaseName?: string; warnings: string[]; failures: string[] }> {
  const databaseName = createSuiteDatabaseName("scripts/full-roster-migrated-template.ts");
  const warnings: string[] = [];
  const failures: string[] = [];
  let redis: DisposableRedis | undefined;
  let migrated = false;
  try {
    const databaseUrl = await createSuiteDatabase(cluster, options.user, databaseName);
    redis = await launchSfp2060DisposableRedis(buildLocalRehearsalEnvironment());
    const appPort = await unusedPort(options.usedPorts);
    options.usedPorts.add(appPort);
    const env = buildSuiteEnvironment({
      user: options.user,
      databaseUrl,
      redis,
      appPort,
      releaseSha: options.releaseSha,
    });
    await runMigrations(env, "immutable full-roster database template");
    migrated = true;
    console.log(`Full-roster immutable migrated DB template prepared: ${databaseName}`);
  } catch (error) {
    warnings.push((error as Error).message);
    console.error(`Full-roster DB template optimization unavailable; suites will fall back to independent fresh migrations: ${(error as Error).message}`);
  } finally {
    if (redis) {
      try {
        await teardownOwnedSuiteResources({ redis });
      } catch (error) {
        failures.push((error as Error).message);
        console.error(error);
      }
    }
  }
  return { databaseName: migrated ? databaseName : undefined, warnings, failures };
}

export interface IsolatedSuiteOutcome {
  script: string;
  databaseName: string;
  databaseCreated: boolean;
  childExitCode: number | null;
  runnerFailures: string[];
}

export function summarizeIsolatedSuiteOutcomes(
  outcomes: readonly IsolatedSuiteOutcome[],
  sharedRunnerFailures: readonly string[] = [],
) {
  const childFailureCount = outcomes.filter(outcome => outcome.childExitCode !== null && outcome.childExitCode !== 0).length;
  const runnerFailureCount =
    outcomes.filter(outcome => outcome.runnerFailures.length > 0 || outcome.childExitCode === null).length +
    sharedRunnerFailures.length;
  const passedCount = outcomes.filter(outcome =>
    outcome.childExitCode === 0 && outcome.runnerFailures.length === 0
  ).length;
  return {
    totalCount: outcomes.length,
    passedCount,
    childFailureCount,
    runnerFailureCount,
    passed: outcomes.length > 0 && passedCount === outcomes.length && sharedRunnerFailures.length === 0,
  };
}

async function runBoundedSuite(cluster: LocalCluster, suite: Suite, options: {
  user: string;
  releaseSha: string;
  usedPorts: Set<number>;
  databaseName?: string;
  templateDatabaseName?: string;
  operatorIntent: SuiteSelection["operatorIntent"];
}): Promise<IsolatedSuiteOutcome> {
  const databaseName = options.databaseName ?? createSuiteDatabaseName(suite.script);
  let databaseCreated = false;
  let redis: DisposableRedis | undefined;
  let server: { stop: () => Promise<void> } | undefined;
  let childExitCode: number | null = null;
  const runnerFailures: string[] = [];
  try {
    const databaseUrl = options.templateDatabaseName
      ? await createSuiteDatabaseFromTemplate(cluster, options.user, databaseName, options.templateDatabaseName)
      : await createSuiteDatabase(cluster, options.user, databaseName);
    databaseCreated = true;
    redis = await launchSfp2060DisposableRedis(buildLocalRehearsalEnvironment());
    const appPort = await unusedPort(options.usedPorts);
    options.usedPorts.add(appPort);
    const env = buildSuiteEnvironment({
      user: options.user,
      databaseUrl,
      redis,
      appPort,
      releaseSha: options.releaseSha,
    });
    if (!options.templateDatabaseName) await runMigrations(env, suite.script);
    if (suite.requiresServer) server = await startOwnedHttpServer(env);
    console.log(
      `Bounded disposable suite ${suite.script}: DB=${databaseName}${options.templateDatabaseName ? " (private immutable-template clone)" : " (fresh migrated DB)"}, RedisPrefix=${redis.prefix}, owned HTTP port=${appPort}${suite.requiresServer ? " (server started)" : " (server not required)"}`,
    );
    childExitCode = await run(
      process.execPath,
      [
        TSX_CLI,
        "scripts/pre-deploy.ts",
        "--operator-intent",
        options.operatorIntent,
        "--only",
        suite.script,
      ],
      env,
    );
  } catch (error) {
    runnerFailures.push((error as Error).message);
    console.error(error);
  } finally {
    try {
      await teardownOwnedSuiteResources({
        server,
        redis,
        database: databaseCreated ? { stop: () => dropSuiteDatabase(cluster, options.user, databaseName) } : undefined,
      });
    } catch (error) {
      runnerFailures.push((error as Error).message);
      console.error(error);
    }
  }
  return { script: suite.script, databaseName, databaseCreated, childExitCode, runnerFailures };
}

async function runDisposableLauncherRegressionTests(): Promise<void> {
  const selection = selectMandatorySuites([]);
  assert.equal(selection.suites.length, MANDATORY_SUITES.length, "default selector must preserve the complete mandatory roster");
  assert.equal(selection.operatorIntent, "default-full", "unflagged default full mode must not imply auth-concurrency opt-in");
  assert.equal(
    new Set(MANDATORY_SUITES.map(suite => suite.script)).size,
    MANDATORY_SUITES.length,
    "full isolated execution requires every roster entry to have a unique exact script-path selector",
  );
  assert.throws(() => selectMandatorySuites(["--only", "scripts/not-in-roster.ts"]), /Unknown pre-deploy suite/);
  assert.deepEqual(
    selectMandatorySuites(["--only", "scripts/test-mi09-pricing-seed-integration.ts"]).suites.map(suite => suite.script),
    ["scripts/test-mi09-pricing-seed-integration.ts"],
  );
  const authSuite = MANDATORY_SUITES.find(suite => suite.explicitDisposableOptIn);
  assert.equal(authSuite?.script, "server/tests/auth-actions.integration.test.ts");
  assert.equal(shouldSkipExplicitDisposableOptIn(authSuite!, selection.operatorIntent), true);
  const explicitAuthSelection = selectMandatorySuites(["--only", authSuite!.script]);
  assert.equal(shouldSkipExplicitDisposableOptIn(authSuite!, explicitAuthSelection.operatorIntent), false);
  const internalDefaultAuthChild = selectMandatorySuites([
    "--operator-intent",
    "default-full",
    "--only",
    authSuite!.script,
  ]);
  assert.equal(shouldSkipExplicitDisposableOptIn(authSuite!, internalDefaultAuthChild.operatorIntent), true);
  const fullAuthOptIn = selectMandatorySuites(["--include-auth-concurrency"]);
  assert.equal(fullAuthOptIn.suites.length, MANDATORY_SUITES.length);
  assert.equal(fullAuthOptIn.explicit, false);
  assert.equal(fullAuthOptIn.operatorIntent, "full-auth-concurrency");
  assert.equal(shouldSkipExplicitDisposableOptIn(authSuite!, fullAuthOptIn.operatorIntent), false);
  assert.throws(
    () => selectMandatorySuites(["--include-auth-concurrency", "--only", authSuite!.script]),
    /cannot be combined/,
  );
  const defaultPlan = planIsolatedSuiteRuns(selection.suites);
  assert.equal(defaultPlan.length, MANDATORY_SUITES.length, "full mode must create one isolated resource plan per roster entry");
  assert.deepEqual(defaultPlan.map(entry => entry.suite), MANDATORY_SUITES, "full mode must keep exact roster order and membership");
  assert.equal(new Set(defaultPlan.map(entry => entry.databaseName)).size, MANDATORY_SUITES.length, "every roster entry must get a unique clean DB");
  const firstDb = createSuiteDatabaseName("scripts/test-mi09-pricing-seed-integration.ts", "10000000-0000-4000-a000-000000000001");
  const secondDb = createSuiteDatabaseName("scripts/test-mi09-pricing-seed-integration.ts", "20000000-0000-4000-a000-000000000002");
  assert.notEqual(firstDb, secondDb, "each selected suite run must have a unique private DB name");
  assert.ok(firstDb.length <= 63, "private PostgreSQL database identifiers must not exceed 63 bytes");

  const secretKeys = [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "PRODUCTION_DATABASE_URL",
    "OPENAI_API_KEY",
    "GHL_PRIVATE_INTEGRATION_TOKEN",
    "SMTP_PASS",
  ] as const;
  const originalSecrets = new Map(secretKeys.map(key => [key, process.env[key]]));
  let scrubbed: NodeJS.ProcessEnv;
  try {
    process.env.DATABASE_URL = "postgresql://production.invalid/prod";
    process.env.TEST_DATABASE_URL = "postgresql://production.invalid/prod";
    process.env.PRODUCTION_DATABASE_URL = "postgresql://production.invalid/prod";
    process.env.OPENAI_API_KEY = "inherited-provider-secret";
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "inherited-provider-secret";
    process.env.SMTP_PASS = "inherited-provider-secret";
    scrubbed = buildLocalRehearsalEnvironment();
  } finally {
    for (const [key, value] of originalSecrets) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  for (const key of secretKeys) {
    assert.equal(scrubbed![key], undefined, `inherited ${key} must not enter a disposable child environment`);
  }
  assert.equal(scrubbed!.VG_PROVIDER_DENY_MODE, "1");
  assert.equal(scrubbed!.GHL_TRANSPORT_FAILFAST, "true");

  const socketPath = path.join(os.tmpdir(), "local-rehearsal-regression", "socket");
  const privateDbUrl = (name: string) =>
    `postgresql://tester@localhost/${name}?host=${encodeURIComponent(socketPath)}&port=23456`;
  const firstEnv = buildSuiteEnvironment({
    user: "tester",
    databaseUrl: privateDbUrl(firstDb),
    redis: { url: "redis://127.0.0.1:30001", prefix: "ci_sfp2060_0123456789abcdef0123456789abcdef_", stop: async () => {} },
    appPort: 30001,
    releaseSha: "a".repeat(40),
  });
  const secondEnv = buildSuiteEnvironment({
    user: "tester",
    databaseUrl: privateDbUrl(secondDb),
    redis: { url: "redis://127.0.0.1:30002", prefix: "ci_sfp2060_1123456789abcdef0123456789abcdef_", stop: async () => {} },
    appPort: 30002,
    releaseSha: "a".repeat(40),
  });
  assert.notEqual(firstEnv.DATABASE_URL, secondEnv.DATABASE_URL, "selected suites must receive distinct private database URLs");
  assert.notEqual(firstEnv.REDIS_URL, secondEnv.REDIS_URL, "selected suites must receive distinct private Redis servers");
  assert.notEqual(firstEnv.TEST_REDIS_PREFIX, secondEnv.TEST_REDIS_PREFIX, "selected suites must receive distinct Redis prefixes");
  assert.notEqual(firstEnv.PORT, secondEnv.PORT, "selected suites must receive distinct owned HTTP ports");
  assert.equal(firstEnv.TEST_BASE_URL, firstEnv.BASE_URL, "HTTP fixtures must receive the owned test base URL");
  assert.equal(firstEnv.VG_PROVIDER_DENY_MODE, "1");
  assert.equal(firstEnv.OPENAI_API_KEY, "sfp2060-disposable-constructor-only");
  assert.equal(firstEnv.DATABASE_URL, firstEnv.TEST_DATABASE_URL);
  assert.equal(firstEnv.AUTH_ACTION_DB_TEST_OPT_IN, undefined, "ordinary suite environments must not carry the auth concurrency opt-in globally");

  const aggregate = summarizeIsolatedSuiteOutcomes([
    { script: "pass.ts", databaseName: "db_pass", databaseCreated: true, childExitCode: 0, runnerFailures: [] },
    { script: "test-fail.ts", databaseName: "db_test_fail", databaseCreated: true, childExitCode: 1, runnerFailures: [] },
    { script: "cleanup-fail.ts", databaseName: "db_cleanup_fail", databaseCreated: true, childExitCode: 0, runnerFailures: ["Redis teardown failed"] },
    { script: "setup-fail.ts", databaseName: "db_setup_fail", databaseCreated: false, childExitCode: null, runnerFailures: ["DB clone failed"] },
  ]);
  assert.equal(aggregate.totalCount, 4);
  assert.equal(aggregate.passedCount, 1, "runner cleanup failure must not erase a child's actual exit-0 status or count it as passed");
  assert.equal(aggregate.childFailureCount, 1, "child failure count must reflect suite exit codes");
  assert.equal(aggregate.runnerFailureCount, 2, "setup and teardown failures must be tracked separately");
  assert.equal(aggregate.passed, false);

  const cleanupOrder: string[] = [];
  await assert.rejects(
    teardownOwnedSuiteResources({
      server: { stop: async () => { cleanupOrder.push("server"); throw new Error("expected teardown test failure"); } },
      redis: { stop: async () => { cleanupOrder.push("redis"); } },
      database: { stop: async () => { cleanupOrder.push("database"); } },
      client: { end: async () => { cleanupOrder.push("client"); } },
    }),
    /Disposable suite teardown failed/,
  );
  assert.deepEqual(cleanupOrder, ["server", "redis", "database", "client"], "teardown must attempt every owned resource after one stop fails");

  const inertChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  await new Promise<void>((resolve, reject) => {
    inertChild.once("spawn", resolve);
    inertChild.once("error", reject);
  });
  await stopServerProcess(inertChild);
  assert.ok(inertChild.exitCode !== null || inertChild.signalCode !== null, "server stop must await the isolated process exit");
  console.log("bounded launcher selector/isolation regression tests: PASS");
}

function reportIsolatedSuiteOutcomes(
  outcomes: readonly IsolatedSuiteOutcome[],
  sharedRunnerFailures: readonly string[],
): number {
  const summary = summarizeIsolatedSuiteOutcomes(outcomes, sharedRunnerFailures);
  console.log("\n════════ Isolated pre-deploy suite batch results ════════");
  console.log(
    `  Suites: ${summary.passedCount}/${summary.totalCount} passed; ` +
    `child failures=${summary.childFailureCount}; suite setup/teardown failures=${summary.runnerFailureCount - sharedRunnerFailures.length}; ` +
    `shared launcher failures=${sharedRunnerFailures.length}`,
  );
  for (const outcome of outcomes) {
    const passed = outcome.childExitCode === 0 && outcome.runnerFailures.length === 0;
    const childStatus = outcome.childExitCode === null ? "not-started" : String(outcome.childExitCode);
    console.log(
      `  ${passed ? "✓" : "✗"} ${outcome.script}: child-exit=${childStatus}, ` +
      `DB=${outcome.databaseName}${outcome.databaseCreated ? "" : " (not created)"}`,
    );
    for (const failure of outcome.runnerFailures) console.log(`      launcher: ${failure}`);
  }
  for (const failure of sharedRunnerFailures) console.log(`  ✗ Shared launcher: ${failure}`);
  return summary.passed ? 0 : 1;
}

async function main(): Promise<void> {
  if (process.argv[2] === "--self-test") {
    await runDisposableLauncherRegressionTests();
    return;
  }
  const selection = selectMandatorySuites(process.argv.slice(2));
  const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error("INVALID_RELEASE_SHA");
  const cluster = await launchLocalPostgres16();
  let exitCode = 1;
  try {
    const user = process.env.USER || process.env.LOGNAME || os.userInfo().username;
    const plan = planIsolatedSuiteRuns(selection.suites);
    const usedPorts = new Set<number>();
    const outcomes: IsolatedSuiteOutcome[] = [];
    const sharedRunnerFailures: string[] = [];
    let templateDatabaseName: string | undefined;
    if (!selection.explicit) {
      const template = await createMigratedDatabaseTemplate(cluster, { user, releaseSha, usedPorts });
      templateDatabaseName = template.databaseName;
      sharedRunnerFailures.push(...template.failures);
      if (template.warnings.length > 0) {
        console.log("Continuing the full roster with one fresh private migration per suite because the shared template optimization was unavailable.");
      }
    }
    console.log(
      selection.explicit
        ? `SFP pre-deploy: ${plan.length} exact selected suite(s); each gets a fresh private DB/Redis/port.`
        : `SFP pre-deploy: full ${plan.length}-entry mandatory roster; each suite gets a fresh private DB clone/Redis/port.`,
    );
    for (const entry of plan) {
      console.log(`\n══ Isolated suite: ${entry.suite.script} ══`);
      try {
        const outcome = await runBoundedSuite(cluster, entry.suite, {
          user,
          releaseSha,
          usedPorts,
          databaseName: entry.databaseName,
          templateDatabaseName,
        });
        outcomes.push(outcome);
      }
      catch (error) {
        outcomes.push({
          script: entry.suite.script,
          databaseName: entry.databaseName,
          databaseCreated: false,
          childExitCode: null,
          runnerFailures: [(error as Error).message],
        });
        console.error(error);
      }
    }
    if (templateDatabaseName) {
      try {
        await dropSuiteDatabase(cluster, user, templateDatabaseName);
      } catch (error) {
        sharedRunnerFailures.push(`could not drop immutable DB template ${templateDatabaseName}: ${(error as Error).message}`);
        console.error(error);
      }
    }
    exitCode = reportIsolatedSuiteOutcomes(outcomes, sharedRunnerFailures);
  } finally {
    await cluster.stop();
  }
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});