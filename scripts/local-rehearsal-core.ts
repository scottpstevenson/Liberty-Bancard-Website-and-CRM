/**
 * Local-only database rehearsal primitives.  This module intentionally has no
 * connection-string input: callers can only provide a dump and its receipt.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
const localRole = () => process.env.USER || process.env.LOGNAME || os.userInfo().username;

export const REQUIRED_RECEIPT_STATUS = "completed";
export type DumpFormat = "sql.gz" | "custom";
export interface BackupReceipt {
  status: "completed";
  databaseIdentity: { production: true; [key: string]: unknown };
  capturedAt: string;
  sizeBytes: number;
  sha256: string;
  dumpFormat: DumpFormat;
  pgDumpExitCode: 0;
  streamFinished: true;
  file: string;
}

const byteCompare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function buildLocalRehearsalEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TZ"] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  Object.assign(env, overrides);
  for (const key of Object.keys(env)) {
    if (/^(?:DATABASE_URL|PRODUCTION_DATABASE_URL|TEST_DATABASE_URL|PGHOST|PGPASSWORD|PGSERVICE)$/i.test(key)
      || /(?:_API_KEY|_TOKEN|_SECRET|PASSWORD|SMTP_|TWILIO|TELNYX|OPENAI|GHL)/i.test(key)) delete env[key];
  }
  // Set invariants *after* scrubbing. They are flags, never inherited credentials.
  Object.assign(env, { NODE_ENV: "test", VG_PROVIDER_DENY_MODE: "1", GHL_TRANSPORT_FAILFAST: "true",
    SUNBIZ_ENRICHMENT_ENABLED: "false", SERPER_GATEWAY_ENABLED: "false",
    AI_INTEGRATIONS_OPENAI_BASE_URL: "http://127.0.0.1:1/v1", NO_PROXY: "*", no_proxy: "*" });
  return env;
}

export async function sha256AndSize(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => { hash.update(chunk); sizeBytes += chunk.length; });
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { sha256: hash.digest("hex"), sizeBytes };
}

export async function validateBackupReceipt(dumpPath: string, receiptPath: string, now = new Date()): Promise<BackupReceipt> {
  const dump = await fsp.realpath(dumpPath);
  const parsed: unknown = JSON.parse(await fsp.readFile(receiptPath, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("Backup receipt must be a JSON object.");
  const r = parsed as Partial<BackupReceipt>;
  const captured = typeof r.capturedAt === "string" ? new Date(r.capturedAt) : new Date("invalid");
  if (r.status !== REQUIRED_RECEIPT_STATUS || r.databaseIdentity?.production !== true
    || Number.isNaN(captured.valueOf()) || captured > now || now.valueOf() - captured.valueOf() > 31 * 24 * 60 * 60 * 1000
    || typeof r.sizeBytes !== "number" || !Number.isSafeInteger(r.sizeBytes) || r.sizeBytes < 1
    || typeof r.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sha256)
    || (r.dumpFormat !== "sql.gz" && r.dumpFormat !== "custom")
    || r.pgDumpExitCode !== 0 || r.streamFinished !== true
    || typeof r.file !== "string" || path.basename(r.file) !== path.basename(dump)) {
    throw new Error("Backup receipt is incomplete, invalid, stale, or does not attest a completed production capture.");
  }
  const actual = await sha256AndSize(dump);
  if (actual.sizeBytes !== r.sizeBytes || actual.sha256 !== r.sha256) {
    throw new Error("Backup bytes do not match the verified receipt.");
  }
  return r as BackupReceipt;
}

export interface FileIdentity { realpath: string; dev: number; ino: number; mode: number; }
export async function fileIdentity(input: string): Promise<FileIdentity> {
  const realpath = await fsp.realpath(input);
  const stat = await fsp.stat(realpath);
  return { realpath, dev: Number(stat.dev), ino: Number(stat.ino), mode: stat.mode & 0o777 };
}
export function assertPrivateDirectory(identity: FileIdentity): void {
  if ((identity.mode & 0o077) !== 0) throw new Error(`Refusing non-private rehearsal directory: ${identity.realpath}`);
}

function command(commandName: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString().slice(0, 4096); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${commandName} failed (${code}): ${stderr.trim()}`)));
  });
}

export interface LocalCluster {
  root: string; data: FileIdentity; socket: FileIdentity; port: number; process: ChildProcess; pid: number;
  admin: LocalDatabase;
  stop(): Promise<void>;
}
export interface LocalDatabase {
  readonly database: string;
  readonly host: string;
  readonly port: number;
  readonly data: FileIdentity;
  readonly socket: FileIdentity;
}
const authorizedLocalTargets = new WeakSet<object>();
function mintLocalDatabase(data: FileIdentity, socket: FileIdentity, port: number, database: string): LocalDatabase {
  const target = Object.freeze({ database, host: socket.realpath, port, data, socket });
  authorizedLocalTargets.add(target);
  return target;
}
async function assertAuthorizedLocalTarget(target: LocalDatabase): Promise<void> {
  if (!authorizedLocalTargets.has(target)) throw new Error("Refusing database target not minted by this rehearsal launcher.");
  if (!path.isAbsolute(target.host) || target.host !== target.socket.realpath) {
    throw new Error("Refusing non-socket rehearsal database target.");
  }
  const [data, socket] = await Promise.all([fileIdentity(target.data.realpath), fileIdentity(target.socket.realpath)]);
  if (data.dev !== target.data.dev || data.ino !== target.data.ino
    || socket.dev !== target.socket.dev || socket.ino !== target.socket.ino) {
    throw new Error("Rehearsal cluster path identity changed.");
  }
  assertPrivateDirectory(data);
  assertPrivateDirectory(socket);
}
export async function withLocalClient<T>(target: LocalDatabase, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  await assertAuthorizedLocalTarget(target);
  const client = new pg.Client({ host: target.host, port: target.port, database: target.database, user: localRole() });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT current_setting('data_directory') data_directory, current_setting('unix_socket_directories') socket_directory, current_setting('listen_addresses') listen_addresses, current_setting('port') port",
    );
    const identity = rows[0];
    if (await fsp.realpath(String(identity.data_directory)) !== target.data.realpath
      || !String(identity.socket_directory).split(",").includes(target.socket.realpath)
      || String(identity.listen_addresses) !== ""
      || Number(identity.port) !== target.port) {
      throw new Error("Connected server identity does not match launcher-minted target.");
    }
    return await fn(client);
  } finally { await client.end(); }
}
async function waitUntilReady(target: LocalDatabase, deadlineMs = 15_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try { await withLocalClient(target, async client => { await client.query("SELECT 1"); }); return; }
    catch (error) { lastError = (error as Error).message; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw new Error(`Private PostgreSQL did not become ready: ${lastError}`);
}
export async function launchLocalPostgres16(): Promise<LocalCluster> {
  const version = spawnSync("initdb", ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || !/(?:initdb\s+\(PostgreSQL\)|PostgreSQL|initdb)\s+16(?:\.|\s|$)/.test(version.stdout)) {
    throw new Error("Local rehearsal requires PostgreSQL 16 initdb; no compatible private cluster launcher is available.");
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "local-rehearsal-"));
  const dataPath = path.join(root, "data"), socketPath = path.join(root, "socket");
  let child: ChildProcess | undefined;
  try {
    await fsp.chmod(root, 0o700);
    await fsp.mkdir(dataPath, { mode: 0o700 });
    await fsp.mkdir(socketPath, { mode: 0o700 });
    const env = buildLocalRehearsalEnvironment({ PGDATA: dataPath });
    await command("initdb", ["-D", dataPath, "--auth-local=trust", "--auth-host=reject", "--no-instructions"], env);
    const [data, socket] = await Promise.all([fileIdentity(dataPath), fileIdentity(socketPath)]);
    assertPrivateDirectory(data);
    assertPrivateDirectory(socket);
    const port = 20000 + randomBytes(2).readUInt16BE(0) % 30000;
    const admin = mintLocalDatabase(data, socket, port, "postgres");
    child = spawn("postgres", ["-D", dataPath, "-k", socketPath, "-p", String(port), "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700"], { env, stdio: "ignore", detached: process.platform !== "win32" });
    await waitUntilReady(admin);
    const stop = async () => {
      if (child?.pid) {
        try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch {}
        if (child.exitCode === null) await new Promise(resolve => child!.once("exit", resolve));
      }
      await fsp.rm(root, { recursive: true, force: true });
    };
    return { root, data, socket, port, process: child, pid: child.pid!, admin, stop };
  } catch (error) {
    if (child?.pid) {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch {}
      if (child.exitCode === null) await new Promise(resolve => child!.once("exit", resolve));
    }
    await fsp.rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function createLocalRehearsalDatabases(cluster: LocalCluster): Promise<{ reference: LocalDatabase; restored: LocalDatabase }> {
  const suffix = randomBytes(10).toString("hex");
  const reference = `reference_${suffix}`, restored = `restored_${suffix}`;
  await withLocalClient(cluster.admin, async client => {
    await client.query(`CREATE DATABASE "${reference}"`);
    await client.query(`CREATE DATABASE "${restored}"`);
  });
  return {
    reference: mintLocalDatabase(cluster.data, cluster.socket, cluster.port, reference),
    restored: mintLocalDatabase(cluster.data, cluster.socket, cluster.port, restored),
  };
}

export async function verifyLocalClusterIdentity(cluster: LocalCluster, database = "postgres"): Promise<void> {
  const target = database === "postgres"
    ? cluster.admin
    : mintLocalDatabase(cluster.data, cluster.socket, cluster.port, database);
  await withLocalClient(target, async client => { await client.query("SELECT 1"); });
}

export async function restoreVerifiedBackup(target: LocalDatabase, dump: string, receipt: BackupReceipt): Promise<void> {
  await assertAuthorizedLocalTarget(target);
  const env = buildLocalRehearsalEnvironment({ PGHOST: target.host, PGPORT: String(target.port), PGDATABASE: target.database, PGUSER: localRole() });
  // PGHOST is injected only for this local libpq subprocess after the general
  // allowlist is built; it is a launcher-owned Unix-socket path, never input.
  env.PGHOST = target.host; env.PGPORT = String(target.port); env.PGDATABASE = target.database; env.PGUSER = localRole();
  if (receipt.dumpFormat === "custom") return command("pg_restore", ["--no-owner", "--exit-on-error", "-d", target.database, dump], env);
  await new Promise<void>((resolve, reject) => {
    const gzip = spawn("gzip", ["-cd", dump], { env, stdio: ["ignore", "pipe", "pipe"] });
    const psql = spawn("psql", ["-X", "--set", "ON_ERROR_STOP=1"], { env, stdio: [gzip.stdout, "ignore", "pipe"] });
    let err = "", gzipCode: number | null = null, psqlCode: number | null = null, settled = false;
    const finish = () => {
      if (settled || gzipCode === null || psqlCode === null) return;
      settled = true;
      if (gzipCode === 0 && psqlCode === 0) resolve();
      else reject(new Error(`Local restore failed (gzip=${gzipCode}, psql=${psqlCode}): ${err.trim()}`));
    };
    psql.stderr.on("data", (c: Buffer) => { err += c.toString().slice(0, 4096); });
    gzip.stderr.on("data", (c: Buffer) => { err += c.toString().slice(0, 4096); });
    psql.on("error", reject); gzip.on("error", reject);
    gzip.on("exit", code => { gzipCode = code ?? -1; finish(); });
    psql.on("exit", code => { psqlCode = code ?? -1; finish(); });
  });
}

type JournalEntry = { idx: number; tag: string; when: number; version: string; breakpoints: boolean };
export interface CanonicalReferenceResult { workdir: string; entries: JournalEntry[]; hashes: Record<string, string>; catalog: Record<string, string>; journal: string; }
const canonicalEndTag = "0202_cro03c_transport_invocation_checkpoint";
function socketUrl(target: LocalDatabase): string {
  // The socket host is generated by this process and percent encoded as a URL
  // query parameter; it can never be supplied by a caller.
  return `postgresql://${encodeURIComponent(localRole())}@localhost/${encodeURIComponent(target.database)}?host=${encodeURIComponent(target.host)}&port=${target.port}`;
}
async function copyCanonicalMigrationTree(workdir: string): Promise<JournalEntry[]> {
  const source = path.resolve(process.cwd(), "migrations");
  const workspace = process.cwd();
  // tsx resolves the workspace's @shared aliases from its cwd.  These links
  // preserve that resolution without exposing the real migration directory.
  await fsp.symlink(path.join(workspace, "tsconfig.json"), path.join(workdir, "tsconfig.json"));
  await fsp.symlink(path.join(workspace, "shared"), path.join(workdir, "shared"));
  const journal = JSON.parse(await fsp.readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[]; version: string; dialect: string };
  const end = journal.entries.findIndex(entry => entry.tag === canonicalEndTag);
  if (end < 0) throw new Error(`Canonical journal endpoint ${canonicalEndTag} is absent.`);
  const entries = journal.entries.slice(0, end + 1);
  if (entries.some(entry => !Number.isSafeInteger(entry.idx) || !Number.isSafeInteger(entry.when) || !entry.tag)) throw new Error("Canonical journal contains an invalid entry.");
  const target = path.join(workdir, "migrations");
  await fsp.mkdir(path.join(target, "meta"), { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const guarded = path.join(source, "guarded", `${entry.tag}.sql`);
    const root = path.join(source, `${entry.tag}.sql`);
    const file = fs.existsSync(guarded) ? guarded : root;
    await fsp.access(file);
    await fsp.symlink(file, path.join(target, `${entry.tag}.sql`));
  }
  // db-migrate's fresh snapshot completion references this foundation file even
  // though a historically reordered journal can place it after the snapshot.
  for (const tag of ["0076_outbound_launch_foundation", "0106_deferred_ghl_enrollments"]) {
    const file = path.join(source, `${tag}.sql`);
    if (!entries.some(entry => entry.tag === tag)) await fsp.symlink(file, path.join(target, `${tag}.sql`));
  }
  await fsp.writeFile(path.join(target, "meta", "_journal.json"), `${JSON.stringify({ version: journal.version, dialect: journal.dialect, entries }, null, 2)}\n`, { mode: 0o600 });
  return entries;
}
async function runCanonicalChild(workdir: string, target: LocalDatabase): Promise<void> {
  await assertAuthorizedLocalTarget(target);
  const runner = path.resolve(process.cwd(), "node_modules", ".bin", "tsx");
  await fsp.access(runner);
  const modulePath = path.resolve(process.cwd(), "server", "db-migrate.ts");
  const env = buildLocalRehearsalEnvironment();
  // Only now is the locally constructed socket target introduced. No inherited
  // database variable crosses this boundary.
  env.DATABASE_URL = socketUrl(target);
  await new Promise<void>((resolve, reject) => {
    const dbModulePath = path.resolve(process.cwd(), "server", "db.ts");
    const childProgram = `(async()=>{try{const m=await import(${JSON.stringify(modulePath)});await m.runDrizzleMigrations();}finally{const d=await import(${JSON.stringify(dbModulePath)});await d.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1;})`;
    const child = spawn(runner, ["-e", childProgram], { cwd: workdir, env, stdio: ["ignore", "pipe", "pipe"] });
    let error = ""; child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString().slice(0, 8192); });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Canonical migration child failed (${code}): ${error.trim()}`)));
  });
}
export async function journalFingerprint(target: LocalDatabase): Promise<string> {
  return withLocalClient(target, async client => {
    const { rows } = await client.query(`SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,hash`);
    return createHash("sha256").update(normalizeCatalog(rows)).digest("hex");
  });
}
async function assertExactCanonicalJournal(
  target: LocalDatabase,
  entries: JournalEntry[],
  hashes: Record<string, string>,
): Promise<void> {
  await withLocalClient(target, async client => {
    const { rows } = await client.query(
      `SELECT hash, created_at::text AS created_at
         FROM drizzle.__drizzle_migrations
        ORDER BY created_at, hash`,
    );
    const seenHashes = new Set<string>();
    const expected = entries
      .filter(entry => {
        const hash = hashes[entry.tag];
        if (seenHashes.has(hash)) return false;
        seenHashes.add(hash);
        return true;
      })
      .map(entry => ({ hash: hashes[entry.tag], created_at: String(entry.when) }))
      .sort((a, b) => byteCompare(`${a.created_at}:${a.hash}`, `${b.created_at}:${b.hash}`));
    const actual = rows
      .map(row => ({ hash: String(row.hash), created_at: String(row.created_at) }))
      .sort((a, b) => byteCompare(`${a.created_at}:${a.hash}`, `${b.created_at}:${b.hash}`));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const actualKeys = new Set(actual.map(row => `${row.created_at}:${row.hash}`));
      const missing = entries
        .filter(entry => {
          const first = entries.find(candidate => hashes[candidate.tag] === hashes[entry.tag]);
          return !first || !actualKeys.has(`${first.when}:${hashes[first.tag]}`);
        })
        .map(entry => entry.tag);
      throw new Error(`Canonical migration ledger is not the exact 0001-0202 journal (${actual.length}/${expected.length} rows; missing=${missing.join(",")}).`);
    }
  });
}
export async function buildCanonicalReference(target: LocalDatabase): Promise<CanonicalReferenceResult> {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), "canonical-0202-"));
  await fsp.chmod(workdir, 0o700);
  try {
    const entries = await copyCanonicalMigrationTree(workdir);
    const hashes = Object.fromEntries(await Promise.all(entries.map(async entry => {
      const content = await fsp.readFile(path.join(workdir, "migrations", `${entry.tag}.sql`));
      return [entry.tag, createHash("sha256").update(content).digest("hex")];
    })));
    await runCanonicalChild(workdir, target);
    await assertExactCanonicalJournal(target, entries, hashes);
    const firstCatalog = await captureCatalog(target), firstJournal = await journalFingerprint(target);
    await runCanonicalChild(workdir, target);
    await assertExactCanonicalJournal(target, entries, hashes);
    const secondCatalog = await captureCatalog(target), secondJournal = await journalFingerprint(target);
    if (JSON.stringify(firstCatalog) !== JSON.stringify(secondCatalog) || firstJournal !== secondJournal) throw new Error("Canonical migration replay changed schema, data fingerprint, or journal.");
    return { workdir, entries, hashes, catalog: firstCatalog, journal: firstJournal };
  } catch (error) { await fsp.rm(workdir, { recursive: true, force: true }); throw error; }
}

export async function captureCatalog(target: LocalDatabase): Promise<Record<string, string>> {
  return withLocalClient(target, async client => {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const { rows } = await client.query(`SELECT category, jsonb_agg(item ORDER BY item::text) AS items FROM (
        SELECT 'columns' category, jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'default',pg_get_expr(ad.adbin,ad.adrelid),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated) item FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        UNION ALL SELECT 'constraints',jsonb_build_object('schema',n.nspname,'table',c.relname,'name',x.conname,'type',x.contype,'definition',replace(replace(pg_get_constraintdef(x.oid,true),'::character varying::text','::character varying'),']::text[]',']')) FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        UNION ALL SELECT 'indexes',jsonb_build_object('schema',n.nspname,'table',c.relname,'name',i.relname,'definition',pg_get_indexdef(i.oid)) FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
        UNION ALL SELECT 'relations',jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        UNION ALL SELECT 'partitions',jsonb_build_object('parent_schema',pn.nspname,'parent',p.relname,'child_schema',cn.nspname,'child',c.relname,'bound',pg_get_expr(c.relpartbound,c.oid)) FROM pg_inherits h JOIN pg_class p ON p.oid=h.inhparent JOIN pg_namespace pn ON pn.oid=p.relnamespace JOIN pg_class c ON c.oid=h.inhrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
        UNION ALL SELECT 'sequences',jsonb_build_object('schema',n.nspname,'name',c.relname,'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid WHERE c.relkind='S' AND n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL SELECT 'enums',jsonb_build_object('schema',n.nspname,'name',t.typname,'label',e.enumlabel,'order',e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL SELECT 'functions',jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL SELECT 'triggers',jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid,true)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL SELECT 'views',jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'definition',pg_get_viewdef(c.oid,true)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
        UNION ALL SELECT 'policies',jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) FROM pg_policies
        UNION ALL SELECT 'grants',jsonb_build_object('schema',table_schema,'name',table_name,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable) FROM information_schema.role_table_grants WHERE table_schema NOT IN ('pg_catalog','information_schema')
      ) x GROUP BY category ORDER BY category`);
      await client.query("COMMIT");
      return Object.fromEntries(rows.map(row => [String(row.category), normalizeCatalog(row.items)]));
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
}

export function normalizeCatalog(rows: Array<Record<string, unknown>>): string {
  const normalized = rows.map(row => Object.fromEntries(Object.entries(row)
    .filter(([key]) => !/^(?:oid|owner|relpages|reltuples|stats)$/i.test(key))
    .sort(([a], [b]) => byteCompare(a, b))));
  normalized.sort((a, b) => byteCompare(JSON.stringify(a), JSON.stringify(b)));
  return JSON.stringify(normalized);
}
export function deterministicCatalogDiff(reference: string, restored: string): string[] {
  if (reference === restored) return [];
  const left = new Set((JSON.parse(reference) as unknown[]).map(JSON.stringify));
  const right = new Set((JSON.parse(restored) as unknown[]).map(JSON.stringify));
  return [...left].filter(v => !right.has(v)).map(v => `missing:${v}`)
    .concat([...right].filter(v => !left.has(v)).map(v => `unexpected:${v}`)).sort(byteCompare);
}