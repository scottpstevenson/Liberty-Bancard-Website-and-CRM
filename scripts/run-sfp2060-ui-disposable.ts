#!/usr/bin/env node
/**
 * Offline-only launch harness for the real SFP operator UI. It creates a fresh
 * private PostgreSQL/Redis pair, runs the normal application startup, signs in
 * through the normal password+CSRF endpoints, then keeps the resulting admin
 * session server-side in a loopback-only reverse proxy.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildLocalRehearsalEnvironment,
  createLocalRehearsalDatabases,
  launchLocalPostgres16,
  withLocalClient,
  type LocalCluster,
  type LocalDatabase,
} from "./local-rehearsal-core";
import { launchSfp2060DisposableRedis } from "./sfp2060-disposable-redis";

const UI_PATH = "/dashboard/lead-ops?tab=sfp";
const STARTUP_TIMEOUT_MS = 5 * 60_000;
const CHILD_STOP_TIMEOUT_MS = 8_000;

let cluster: LocalCluster | undefined;
let targetDatabase: LocalDatabase | undefined;
let redis: Awaited<ReturnType<typeof launchSfp2060DisposableRedis>> | undefined;
let backend: ChildProcess | undefined;
let migrationChild: ChildProcess | undefined;
let proxy: http.Server | undefined;
let privateHome: string | undefined;
let backendPort: number | undefined;
let backendFailureCode = "APPLICATION_EXITED_DURING_STARTUP";
let startupStage = "initialization";
let backendExitCode: number | null | undefined;
let backendExitSignal: NodeJS.Signals | null | undefined;
let backendStdoutObserved = false;
let backendStderrObserved = false;
let backendOutputClosed = false;
let backendFatalMarker = "none";
const backendSqlStates = new Set<string>();
const backendNodeCodes = new Set<string>();
const backendStackFrames = new Set<string>();
let proxyPort: number | undefined;
let authenticatedCookie: string | undefined;
let stopping = false;
let cleanupPromise: Promise<void> | undefined;
const activeSockets = new Set<Socket>();
let signalResolve!: () => void;
const signalReceived = new Promise<void>((resolve) => { signalResolve = resolve; });

class StopRequested extends Error {}

function handleSignal(): void {
  if (stopping) return;
  stopping = true;
  signalResolve();
  if (backend) signalChild(backend);
  if (migrationChild) signalChild(migrationChild);
}

process.on("SIGINT", handleSignal);
process.on("SIGTERM", handleSignal);

function throwIfStopping(): void {
  if (stopping) throw new StopRequested();
}

function localDatabaseUrl(database: LocalDatabase): string {
  const user = process.env.USER || process.env.LOGNAME || os.userInfo().username;
  return `postgresql://${encodeURIComponent(user)}@localhost/${encodeURIComponent(database.database)}?host=${encodeURIComponent(database.host)}&port=${database.port}`;
}

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        return server.close(() => reject(new Error("NO_OWNED_PORT")));
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function runChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  throwIfStopping();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "ignore",
      detached: process.platform !== "win32",
    });
    migrationChild = child;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (migrationChild === child) migrationChild = undefined;
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => {
      signalChild(child);
      finish(new Error("MIGRATION_TIMEOUT"));
    }, timeoutMs);
    child.once("error", () => finish(new Error("MIGRATION_SPAWN_FAILED")));
    child.once("exit", (code) => finish(code === 0 ? undefined : new Error("MIGRATION_FAILED")));
  });
  throwIfStopping();
}

function signalChild(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* The child may have exited. */ }
  }
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  signalChild(child);
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    let forceTimer: NodeJS.Timeout;
    const done = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    child.once("exit", done);
    forceTimer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { /* The child may have exited. */ }
      setTimeout(done, 1000);
    }, CHILD_STOP_TIMEOUT_MS);
  });
}

function closeProxy(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
    for (const socket of activeSockets) socket.destroy();
  });
}

function cleanup(): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await closeProxy(proxy);
    proxy = undefined;
    await stopChild(backend);
    backend = undefined;
    await stopChild(migrationChild);
    migrationChild = undefined;
    try {
      await redis?.stop();
    } finally {
      redis = undefined;
      try {
        await cluster?.stop();
      } finally {
        cluster = undefined;
        if (privateHome) {
          await rm(privateHome, { recursive: true, force: true });
          privateHome = undefined;
        }
      }
    }
  })();
  return cleanupPromise;
}

function responseBody(port: number, requestPath: string, options: {
  method?: string;
  headers?: http.OutgoingHttpHeaders;
  body?: Buffer;
  timeoutMs?: number;
} = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: options.method ?? "GET",
      headers: options.headers,
      timeout: options.timeoutMs ?? 15_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.once("timeout", () => req.destroy(new Error("HTTP_TIMEOUT")));
    req.once("error", () => reject(new Error("HTTP_REQUEST_FAILED")));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function cookiePair(setCookie: string[] | string | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith(`${name}=`));
}

async function normalAdminLogin(port: number, email: string, password: string): Promise<string> {
  const csrf = await responseBody(port, "/api/csrf-token");
  if (csrf.status !== 200) throw new Error("CSRF_BOOTSTRAP_FAILED");
  let token: unknown;
  try { token = (JSON.parse(csrf.body.toString("utf8")) as { token?: unknown }).token; }
  catch { throw new Error("CSRF_BOOTSTRAP_FAILED"); }
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
    throw new Error("CSRF_TOKEN_INVALID");
  }
  const csrfCookie = cookiePair(csrf.headers["set-cookie"], "csrf_token");
  if (!csrfCookie) throw new Error("CSRF_COOKIE_MISSING");

  const loginBody = Buffer.from(JSON.stringify({ email, password }));
  const login = await responseBody(port, "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(loginBody.length),
      cookie: csrfCookie,
      "x-csrf-token": token,
    },
    body: loginBody,
  });
  if (login.status !== 200) throw new Error("NORMAL_PASSWORD_LOGIN_FAILED");
  let loginUser: { role?: unknown; mfa_required?: unknown };
  try { loginUser = JSON.parse(login.body.toString("utf8")) as typeof loginUser; }
  catch { throw new Error("NORMAL_PASSWORD_LOGIN_INVALID_RESPONSE"); }
  if (loginUser.role !== "admin" || loginUser.mfa_required === true) {
    throw new Error("NORMAL_ADMIN_SESSION_UNAVAILABLE");
  }
  const session = cookiePair(login.headers["set-cookie"], "connect.sid");
  if (!session) throw new Error("NORMAL_LOGIN_SESSION_COOKIE_MISSING");
  const sessionCheck = await responseBody(port, "/api/auth/user", {
    headers: { cookie: session },
  });
  if (sessionCheck.status !== 200) throw new Error("NORMAL_LOGIN_SESSION_NOT_RESTORED");
  try {
    const restoredUser = JSON.parse(sessionCheck.body.toString("utf8")) as { role?: unknown };
    if (restoredUser.role !== "admin") throw new Error("NORMAL_LOGIN_SESSION_NOT_ADMIN");
  } catch (error) {
    if (error instanceof Error && error.message === "NORMAL_LOGIN_SESSION_NOT_ADMIN") throw error;
    throw new Error("NORMAL_LOGIN_SESSION_INVALID_RESPONSE");
  }
  return session;
}

function requestCookies(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("csrf_token=") && !part.includes("\n"));
}

function filteredRequestHeaders(req: IncomingMessage, proxyPortNumber: number): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...req.headers };
  const upstreamOrigin = `http://127.0.0.1:${backendPort}`;
  const proxyOrigin = `http://127.0.0.1:${proxyPortNumber}`;
  headers.host = `127.0.0.1:${backendPort}`;
  headers.connection = "close";
  headers["x-forwarded-for"] = "127.0.0.1";
  headers["x-forwarded-proto"] = "http";
  headers["x-forwarded-host"] = `127.0.0.1:${proxyPortNumber}`;
  delete headers.forwarded;
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  const origin = headers.origin;
  if (typeof origin === "string" && origin === proxyOrigin) headers.origin = upstreamOrigin;
  const referer = headers.referer;
  if (typeof referer === "string" && referer.startsWith(`${proxyOrigin}/`)) {
    headers.referer = `${upstreamOrigin}${referer.slice(proxyOrigin.length)}`;
  }
  const cookies = requestCookies(req.headers.cookie);
  if (authenticatedCookie) cookies.push(authenticatedCookie);
  if (cookies.length) headers.cookie = cookies.join("; ");
  else delete headers.cookie;
  return headers;
}

function stripSessionCookie(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const copy = { ...headers };
  const values = copy["set-cookie"];
  if (values) {
    const filtered = (Array.isArray(values) ? values : [values])
      .filter((value) => !value.startsWith("connect.sid="));
    if (filtered.length) copy["set-cookie"] = filtered;
    else delete copy["set-cookie"];
  }
  return copy;
}

function installReverseProxy(port: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (stopping) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
        res.end("Offline fixture is stopping.");
        return;
      }
      const upstream = http.request({
        hostname: "127.0.0.1",
        port,
        path: req.url || "/",
        method: req.method,
        headers: filteredRequestHeaders(req, proxyPort ?? 0),
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode ?? 502, stripSessionCookie(upstreamResponse.headers));
        upstreamResponse.pipe(res);
      });
      upstream.once("error", () => {
        if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        res.end("Offline application backend unavailable.");
      });
      req.once("aborted", () => upstream.destroy());
      req.pipe(upstream);
    });
    server.on("connection", (socket) => {
      activeSockets.add(socket);
      socket.once("close", () => activeSockets.delete(socket));
    });
    server.on("upgrade", (req, clientSocket, head) => {
      const headers = filteredRequestHeaders(req, proxyPort ?? 0);
      headers.connection = "Upgrade";
      headers.upgrade = req.headers.upgrade;
      delete headers.cookie;
      const upstream = http.request({
        hostname: "127.0.0.1",
        port,
        path: req.url || "/",
        method: req.method,
        headers,
      });
      upstream.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
        const statusText = upstreamResponse.statusMessage || "Switching Protocols";
        clientSocket.write(`HTTP/1.1 ${upstreamResponse.statusCode ?? 101} ${statusText}\r\n`);
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value === undefined) continue;
          const values = Array.isArray(value) ? value : [value];
          for (const item of values) clientSocket.write(`${name}: ${item}\r\n`);
        }
        clientSocket.write("\r\n");
        if (upstreamHead.length) clientSocket.write(upstreamHead);
        if (head.length) upstreamSocket.write(head);
        clientSocket.pipe(upstreamSocket);
        upstreamSocket.pipe(clientSocket);
        clientSocket.once("close", () => upstreamSocket.destroy());
        upstreamSocket.once("close", () => clientSocket.destroy());
      });
      upstream.once("response", (response) => {
        clientSocket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage || "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
      });
      upstream.once("error", () => clientSocket.destroy());
      upstream.end();
    });
    server.once("error", reject);
    server.listen(Number(process.env.SFP2060_PRIVATE_UI_PORT || "0"), "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        return server.close(() => reject(new Error("NO_PROXY_PORT")));
      }
      proxyPort = address.port;
      resolve({ server, port: address.port });
    });
  });
}

async function seedPausedProgram(database: LocalDatabase): Promise<void> {
  await withLocalClient(database, async (client) => {
    await client.query(
      `INSERT INTO sfp_programs
        (name, county_fips, vertical_ids, max_cohort_size, policy_version,
         taxonomy_version, schedule_config, is_active, recurring_enabled, created_by)
       VALUES
        ('south-florida-v1',
         ARRAY['12011','12086','12099'],
         ARRAY['Automotive','Healthcare','Beauty/Spa','Construction/Trades/Home Services','Fitness/Recreation'],
         100, 1, 2,
         '{"freeBatch":25,"paidBatch":10,"validationBatch":25,"campaignStaging":0}'::jsonb,
         FALSE, FALSE, 'offline-fixture')
       ON CONFLICT (name) DO NOTHING`,
    );
    const business = (await client.query(`INSERT INTO businesses
      (canonical_name,normalized_name,main_phone,record_class,city,state)
      VALUES ('Offline Roofing LLC','offline roofing','3055550132','canonical','Miami','FL') RETURNING id`)).rows[0];
    await client.query(`INSERT INTO contacts
      (first_name,last_name,email,phone,company_name,record_class,email_status)
      VALUES ('Offline','Owner','offline-roofing@gmail.com','+13055550132','Offline Roofing Inc','production','unvalidated')`);
    if (!business) throw new Error("OFFLINE_MATCH_FIXTURE_FAILED");
  });
}

async function waitForBackend(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    throwIfStopping();
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
      // ChildProcess emits "exit" before its stdout/stderr pipes are guaranteed
      // drained. Wait for "close" so the safe classifier sees the final output
      // before the failure summary is emitted.
      if (backend && !backendOutputClosed) {
        await new Promise<void>((resolve) => backend!.once("close", () => resolve()));
      }
      throw new Error(backendFailureCode);
    }
    try {
      const response = await responseBody(port, "/api/csrf-token", { timeoutMs: 2_000 });
      if (response.status === 200) return;
    } catch { /* The normal startup chain has not opened the API yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("APPLICATION_STARTUP_TIMEOUT");
}

function classifyBackendOutput(text: string): void {
  // Consume output only to recognize fixed, non-sensitive failure categories.
  // Never retain or print the application's logs: they may contain credentials,
  // URLs, SQL, or other private values.
  if (/\[vite\].*(?:error|failed)|Vite.*(?:error|failed)/i.test(text)) {
    backendFailureCode = "BACKEND_VITE_STARTUP_FAILED";
    backendFatalMarker = "VITE_CUSTOM_LOGGER_EXIT";
  } else if (/\[Process\] Uncaught exception:/i.test(text)) {
    backendFailureCode = "BACKEND_UNCAUGHT_EXCEPTION";
    backendFatalMarker = "SERVER_UNCAUGHT_EXCEPTION_EXIT";
  } else if (/\[Process\] Error shutting down queue manager:/i.test(text)) {
    backendFailureCode = "BACKEND_SHUTDOWN_FAILURE";
    backendFatalMarker = "SERVER_SHUTDOWN_QUEUE_EXIT";
  } else if (/\[Process\] Graceful shutdown exceeded/i.test(text)) {
    backendFailureCode = "BACKEND_SHUTDOWN_TIMEOUT";
    backendFatalMarker = "SERVER_SHUTDOWN_TIMEOUT_EXIT";
  } else if (/EADDRINUSE/.test(text)) backendFailureCode = "BACKEND_PORT_UNAVAILABLE";
  else if (/Cannot find module|Cannot find package/.test(text)) backendFailureCode = "BACKEND_MODULE_NOT_FOUND";
  else if (/does not provide an export|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/.test(text)) {
    backendFailureCode = "BACKEND_MODULE_LOAD_FAILED";
  }
  else if (/ReferenceError/.test(text)) backendFailureCode = "BACKEND_REFERENCE_ERROR";
  else if (/TypeError/.test(text)) backendFailureCode = "BACKEND_TYPE_ERROR";
  else if (/SyntaxError/.test(text)) backendFailureCode = "BACKEND_SYNTAX_ERROR";
  else if (/ECONNREFUSED|password authentication failed|database ["'].*["'] does not exist/i.test(text)) {
    backendFailureCode = "BACKEND_DATABASE_CONNECTION_FAILED";
  } else if (/ValidationError|Invalid environment|Missing required environment variable/i.test(text)) {
    backendFailureCode = "BACKEND_ENV_VALIDATION_FAILED";
  } else if (/Uncaught exception|Unhandled promise rejection/i.test(text)) {
    backendFailureCode = "BACKEND_UNHANDLED_EXCEPTION";
  }
}

function collectBackendDiagnostics(text: string): void {
  classifyBackendOutput(text);

  // Keep only allowlisted codes; never retain the corresponding error text.
  const nodeCodes = text.match(/\b(?:EADDRINUSE|ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ERR_INVALID_ARG_TYPE|ERR_UNKNOWN_FILE_EXTENSION|ERR_UNSUPPORTED_DIR_IMPORT|ERR_PACKAGE_PATH_NOT_EXPORTED|ERR_MODULE_NOT_FOUND)\b/g) ?? [];
  for (const code of nodeCodes) backendNodeCodes.add(code);
  const sqlStateAllowlist = new Set([
    "08001", "08004", "08006", "08P01", "23502", "23503", "23505", "23514",
    "25P02", "28P01", "3D000", "40001", "42501", "42601", "42703", "42P01",
    "42883", "53300", "57014", "57P03", "XX000",
  ]);
  const sqlStateCandidates = text.match(/\b[0-9A-Z]{5}\b/g) ?? [];
  for (const code of sqlStateCandidates) {
    if (sqlStateAllowlist.has(code)) backendSqlStates.add(code);
  }

  // Stack traces are parsed transiently. Persist only the project source file
  // basename and numeric line/column; never retain a full path or message.
  const framePattern = /((?:file:\/\/)?[^()\s]+?\.(?:[cm]?js|tsx?)):(\d+):(\d+)/g;
  for (const match of text.matchAll(framePattern)) {
    const rawPath = match[1].replace(/^file:\/\//, "");
    const resolvedPath = path.resolve(process.cwd(), rawPath);
    const relativePath = path.relative(process.cwd(), resolvedPath);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath) ||
      relativePath.split(path.sep)[0] === "node_modules"
    ) continue;
    const basename = path.basename(relativePath);
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(basename)) continue;
    const frame = `${basename}:${match[2]}:${match[3]}`;
    backendStackFrames.add(frame);
    if (basename === "vite.ts" && match[2] === "25") {
      backendFailureCode = "BACKEND_VITE_STARTUP_FAILED";
      backendFatalMarker = "VITE_CUSTOM_LOGGER_EXIT";
    }
  }
}

async function run(): Promise<void> {
  try {
    startupStage = "private-home";
    privateHome = await mkdtemp(path.join(os.tmpdir(), "sfp2060-ui-home-"));
    await chmod(privateHome, 0o700);
    const safeGitEnv = buildLocalRehearsalEnvironment();
    safeGitEnv.HOME = privateHome;
    const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      env: safeGitEnv,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(releaseSha)) throw new Error("CURRENT_GIT_SHA_UNAVAILABLE");

    startupStage = "private-postgres";
    cluster = await launchLocalPostgres16();
    throwIfStopping();
    startupStage = "private-databases";
    const databases = await createLocalRehearsalDatabases(cluster);
    targetDatabase = databases.restored;

    const migrationEnv = buildLocalRehearsalEnvironment();
    migrationEnv.HOME = privateHome;
    migrationEnv.DATABASE_URL = localDatabaseUrl(targetDatabase);
    migrationEnv.PGUSER = process.env.USER || process.env.LOGNAME || os.userInfo().username;
    const tsx = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
    startupStage = "offline-migrations";
    await runChild(tsx, ["server/db-migrate.ts"], migrationEnv, STARTUP_TIMEOUT_MS);
    startupStage = "fixture-seed";
    await seedPausedProgram(targetDatabase);

    const user = process.env.USER || process.env.LOGNAME || os.userInfo().username;
    const databaseUrl = localDatabaseUrl(targetDatabase);
    const redisEnv = buildLocalRehearsalEnvironment();
    redisEnv.HOME = privateHome;
    startupStage = "private-redis";
    redis = await launchSfp2060DisposableRedis(redisEnv);
    throwIfStopping();
    startupStage = "backend-port-allocation";
    backendPort = await unusedPort();

    startupStage = "backend-spawn";
    const env = buildLocalRehearsalEnvironment({
      NODE_ENV: "development",
      PORT: String(backendPort),
      BACKGROUND_JOB_PROFILE: "off",
      VG_PROVIDER_DENY_MODE: "1",
      GHL_TRANSPORT_FAILFAST: "true",
      EMAIL_TRANSPORT_FAILFAST: "true",
      SMS_TRANSPORT_FAILFAST: "true",
      CRO03_PROVIDER_TRANSPORT_ENABLED: "false",
      SUNBIZ_ENRICHMENT_ENABLED: "false",
      SERPER_GATEWAY_ENABLED: "false",
      APP_URL: `http://127.0.0.1:${backendPort}`,
      BASE_URL: `http://127.0.0.1:${backendPort}`,
    });
    Object.assign(env, {
      HOME: privateHome,
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      PGUSER: user,
      REDIS_URL: redis.url,
      TEST_REDIS_PREFIX: redis.prefix,
      SESSION_SECRET: randomBytes(48).toString("hex"),
      CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      MERCHANT_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      // Eagerly imported OpenAI SDK clients require a nonempty key at
      // construction time. These are synthetic values, and both explicit
      // Replit-integration and SDK-default endpoints are pinned to loopback;
      // they cannot reach an external provider. Provider deny/fail-fast and
      // background-off safeguards below remain enabled.
      AI_INTEGRATIONS_OPENAI_API_KEY: "offline-ui-fixture-inert-key",
      AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
      OPENAI_API_KEY: "offline-ui-fixture-inert-key",
      OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
      ADMIN_SEED_EMAIL: "admin@sfp2060.test",
      ADMIN_SEED_PASSWORD: randomBytes(32).toString("hex"),
      RELEASE_SHA: releaseSha,
      CURRENT_GIT_SHA: releaseSha,
      NO_PROXY: "*",
      no_proxy: "*",
    });
    // The rehearsal helper deliberately fixes test mode; the actual web
    // process should still take the ordinary Vite-backed development path.
    env.NODE_ENV = "development";

    const serverScript = path.resolve(process.cwd(), "server", "index.ts");
    backend = spawn(tsx, [serverScript], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let classifierTail = "";
    const inspectBackendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (stream === "stdout") backendStdoutObserved = true;
      else backendStderrObserved = true;
      const text = chunk.toString("utf8");
      collectBackendDiagnostics(classifierTail + text);
      classifierTail = text.slice(-512);
    };
    backend.stdout?.on("data", (chunk: Buffer) => inspectBackendOutput("stdout", chunk));
    backend.stderr?.on("data", (chunk: Buffer) => inspectBackendOutput("stderr", chunk));
    backend.once("error", () => {
      if (backendFailureCode === "APPLICATION_EXITED_DURING_STARTUP") {
        backendFailureCode = "BACKEND_SPAWN_FAILED";
      }
    });
    backend.once("exit", (code, signal) => {
      backendExitCode = code;
      backendExitSignal = signal;
    });
    backend.once("close", () => { backendOutputClosed = true; });
    throwIfStopping();
    startupStage = "backend-readiness";
    await waitForBackend(backendPort);
    throwIfStopping();

    startupStage = "admin-login";
    const adminEmail = env.ADMIN_SEED_EMAIL!;
    const adminPassword = env.ADMIN_SEED_PASSWORD!;
    authenticatedCookie = await normalAdminLogin(backendPort, adminEmail, adminPassword);
    throwIfStopping();

    startupStage = "private-proxy";
    const installedProxy = await installReverseProxy(backendPort);
    proxy = installedProxy.server;
    throwIfStopping();
    console.log(`mode=OFFLINE_FIXTURE proxyPort=${installedProxy.port} backendPort=${backendPort}`);
    console.log(`actualUIpath=${UI_PATH}`);

    await Promise.race([signalReceived, new Promise<void>(() => {})]);
  } finally {
    await cleanup();
  }
}

run().catch((error: unknown) => {
  if (!stopping) {
    const message = error instanceof Error ? error.message : "";
    const safeCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "STARTUP_FAILED";
    const exitCode = backendExitCode === undefined ? "unknown" : backendExitCode === null ? "none" : String(backendExitCode);
    const exitSignal = backendExitSignal ?? "none";
    if (
      backendExitCode !== undefined &&
      backendExitCode !== null &&
      backendExitCode !== 0 &&
      backendFailureCode === "APPLICATION_EXITED_DURING_STARTUP" &&
      (backendStdoutObserved || backendStderrObserved)
    ) {
      backendFailureCode = "BACKEND_EXIT_WITH_UNCLASSIFIED_OUTPUT";
    }
    console.error(
      `OFFLINE_FIXTURE_FAILED ${safeCode} stage=${startupStage} backendFailure=${backendFailureCode} backendFatalMarker=${backendFatalMarker} backendExitCode=${exitCode} backendSignal=${exitSignal} stdoutObserved=${backendStdoutObserved} stderrObserved=${backendStderrObserved} sqlstates=${[...backendSqlStates].join(",") || "none"} nodeCodes=${[...backendNodeCodes].join(",") || "none"} stackFrames=${[...backendStackFrames].slice(0, 8).join(",") || "none"}`,
    );
    process.exitCode = 1;
  }
}).finally(() => {
  process.off("SIGINT", handleSignal);
  process.off("SIGTERM", handleSignal);
});