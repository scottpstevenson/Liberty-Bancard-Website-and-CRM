/** Fresh vs 0393-upgrade on launcher-minted socket-only PostgreSQL 16. Never accepts DATABASE_URL as a target. */
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
} from "../local-rehearsal-core";
const workspace = process.cwd(),
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "phase8-upgrade-"));
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
    (entry: { tag: string }) => entry.tag === "0394_phase8_period_ownership",
  );
  assert(phase7, "Phase 8 migration must be present in the source journal");
  const baseline = {
    ...journal,
    entries: journal.entries.filter(
      (e: { when: number }) => e.when < phase7.when,
    ),
  };
  assert.equal(baseline.entries.at(-1)?.tag, "0393_team_intake_email_alerts");
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
      (await c.query("SELECT to_regclass('scheduled_period_receipts') AS t"))
        .rows[0].t,
      null,
    );
    await c.query("INSERT INTO sending_identities(label,domain,email_address,is_active,warmup_status,daily_limit,sent_today) VALUES('Upgrade fixture','example.test','upgrade-phase8@example.test',true,'warm',10,7)");
    await c.query("INSERT INTO outbound_pause_control(id,state,epoch) VALUES(1,'paused',4) ON CONFLICT(id) DO UPDATE SET state='paused',epoch=4");
    await c.query("INSERT INTO outscraper_budget_policy(id,limit_micros) VALUES(true,50000000) ON CONFLICT(id) DO NOTHING");
    await c.query(
      `INSERT INTO system_settings(key,value)VALUES('phase8_upgrade_sentinel','{"retained":true}')`,
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
          "SELECT value->>'retained' AS retained FROM system_settings WHERE key='phase8_upgrade_sentinel'",
        )
      ).rows[0].retained,
      "true",
    );
    const identity=(await c.query("SELECT sent_today,counter_date::text FROM sending_identities WHERE email_address='upgrade-phase8@example.test'")).rows[0];
    assert.equal(identity.sent_today,7,'upgrade preserves consumed allowance');
    assert.equal(identity.counter_date,(await c.query("SELECT (now() AT TIME ZONE 'America/New_York')::date::text AS today")).rows[0].today);
    assert.deepEqual((await c.query('SELECT state,epoch::int FROM outbound_pause_control WHERE id=1')).rows[0],{state:'paused',epoch:4});
    assert.equal((await c.query('SELECT limit_micros FROM outscraper_budget_policy')).rows[0].limit_micros,50000000);
    await assert.rejects(c.query("INSERT INTO scheduled_period_receipts(job_key,period_key) VALUES('not-an-owner','2026-11-19')"));
    const invalid = (
      await c.query(
        "SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace",
      )
    ).rows;
    assert.equal(invalid.length, 0, "all publish-visible checks are validated");
  });
  console.log(
    "Phase 8 upgrade PASS: fresh/0393 upgrade catalog parity, idempotent journal replay, retained business data, validated checks; private socket-only clusters.",
  );
} finally {
  await cluster?.stop();
  await fs.rm(dir, { recursive: true, force: true });
}
