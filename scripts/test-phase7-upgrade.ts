/** Fresh vs 0386-upgrade on launcher-minted socket-only PostgreSQL 16. Never accepts DATABASE_URL as a target. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  launchLocalPostgres16,
  createLocalRehearsalDatabases,
  withLocalClient,
  buildLocalRehearsalEnvironment,
  captureCatalog,
  journalFingerprint,
} from "./local-rehearsal-core";
const workspace = process.cwd(),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "phase7-upgrade-"));
let cluster: Awaited<ReturnType<typeof launchLocalPostgres16>> | undefined;
try {
  cluster = await launchLocalPostgres16();
  const dbs = await createLocalRehearsalDatabases(cluster, {
    namePrefix: "test_",
  });
  await fs.cp(
    path.join(workspace, "migrations"),
    path.join(dir, "migrations"),
    { recursive: true },
  );
  await fs.symlink(
    path.join(workspace, "tsconfig.json"),
    path.join(dir, "tsconfig.json"),
  );
  await fs.symlink(path.join(workspace, "shared"), path.join(dir, "shared"));
  const journalFile = path.join(dir, "migrations/meta/_journal.json"),
    journal = JSON.parse(await fs.readFile(journalFile, "utf8"));
  const phase7 = journal.entries.find(
    (entry: { tag: string }) => entry.tag === "0387_phase7_conversion_integrity",
  );
  assert(phase7, "Phase 7 migration must be present in the source journal");
  const baseline = {
    ...journal,
    entries: journal.entries.filter(
      (e: { when: number }) => e.when < phase7.when,
    ),
  };
  assert.equal(baseline.entries.at(-1)?.tag, "0386_partner_introduction_checks_validated");
  async function migrate(target: typeof dbs.reference) {
    await withLocalClient(target, async (c) =>
      assert.equal(
        (await c.query("SELECT inet_server_addr() AS tcp")).rows[0].tcp,
        null,
      ),
    );
    const url = `postgresql://${encodeURIComponent(os.userInfo().username)}@localhost/${target.database}?host=${encodeURIComponent(target.host)}&port=${target.port}`;
    const env = buildLocalRehearsalEnvironment();
    env.DATABASE_URL = url;
    const code = `(async()=>{const boundary=await import(${JSON.stringify(path.join(workspace, "scripts/certification-provider-deny.ts"))});boundary.applyCertificationProviderDenyBoundary({fatal:true});try{const m=await import(${JSON.stringify(path.join(workspace, "server/db-migrate.ts"))});await m.runDrizzleMigrations();}finally{const d=await import(${JSON.stringify(path.join(workspace, "server/db.ts"))});await d.pool.end();}})().catch(e=>{console.error(e);process.exitCode=1;});`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(workspace, "node_modules/tsx/dist/cli.mjs"), "-e", code],
        { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (v) => (output += v));
      child.stderr.on("data", (v) => (output += v));
      child.on("error", reject);
      child.on("exit", (status) =>
        status === 0 ? resolve() : reject(new Error(output.slice(-6000))),
      );
    });
  }
  await fs.writeFile(journalFile, JSON.stringify(baseline));
  await migrate(dbs.restored);
  await withLocalClient(dbs.restored, async (c) => {
    assert.equal(
      (await c.query("SELECT to_regclass('cro07_attempt_bindings') AS t"))
        .rows[0].t,
      null,
    );
    await c.query(
      `INSERT INTO system_settings(key,value)VALUES('phase7_upgrade_sentinel','{"retained":true}')`,
    );
  });
  await fs.writeFile(journalFile, JSON.stringify(journal));
  await migrate(dbs.restored);
  const before = await journalFingerprint(dbs.restored);
  await migrate(dbs.restored);
  assert.equal(await journalFingerprint(dbs.restored), before);
  await migrate(dbs.reference);
  const fresh = await captureCatalog(dbs.reference),
    upgrade = await captureCatalog(dbs.restored);
  assert.deepEqual(upgrade, fresh, "fresh and upgrade SQL catalogs must agree");
  await withLocalClient(dbs.restored, async (c) => {
    assert.equal(
      (
        await c.query(
          "SELECT value->>'retained' AS retained FROM system_settings WHERE key='phase7_upgrade_sentinel'",
        )
      ).rows[0].retained,
      "true",
    );
    const invalid = (
      await c.query(
        "SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace",
      )
    ).rows;
    assert.equal(invalid.length, 0, "all publish-visible checks are validated");
  });
  console.log(
    "Phase 7 upgrade PASS: fresh/0386 upgrade catalog parity, idempotent journal replay, retained business data, validated checks; private socket-only clusters.",
  );
} finally {
  await cluster?.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
