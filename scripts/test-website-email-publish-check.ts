/**
 * Post-publish check for the website email lifecycle lane (disposable database, no provider, no network).
 *
 * Proves scripts/check-website-email-publish.ts and its library:
 *  - a migrated database is reported complete: seven tables, the enrollment marker column, a Gmail ledger CHECK, and the
 *    same ledger.acceptsGmail value the real lane status route returns;
 *  - a ledger with only the narrow provider CHECK is reported missing, with the exact repair statements from migration
 *    0382, and the check never runs them; a widened CHECK is reported present again (the printed statements, run by this
 *    test only, are what widens it);
 *  - a missing table, a missing marker column and a missing ledger table are each reported, never thrown;
 *  - every statement the check issues is a SELECT, and the command-line entry point leaves the database untouched.
 * Modeled on the schema-fence scenario in scripts/certification/test-website-email-lifecycle-disposable.ts. Global
 * outbound is never touched.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

process.env.APP_URL = "https://libertybancard.com";

let checks = 0;
const ok = (v: unknown, label: string) => { assert.ok(v, label); checks++; console.log(`PASS [${String(checks).padStart(3, "0")}] ${label}`); };
const eq = (actual: unknown, expected: unknown, label: string) => { assert.deepStrictEqual(actual, expected, `${label} (got ${JSON.stringify(actual)})`); checks++; console.log(`PASS [${String(checks).padStart(3, "0")}] ${label}`); };

const h = await stage3BHttpFixture(async (app) => {
  const { registerWebsiteEmailRoutes } = await import("../server/routes/website-email");
  registerWebsiteEmailRoutes(app);
}, undefined, { backgroundProfile: "off" });
const q = async (text: string, params: unknown[] = []) => (await h.pool.query(text, params)).rows as any[];

const lib = await import("./lib/website-email-publish-check");
const { drizzle } = await import("drizzle-orm/node-postgres");
const { PgDialect } = await import("drizzle-orm/pg-core");

const migrationSql = lib.readMigrationSql();
const WIDE = `('ghl','smtp','gmail','twilio','internal','manual')`;
const NARROW = `('ghl','smtp','twilio','internal','manual')`;
const SERVER_CHECK = "communication_events_provider_check";

/** Run the check exactly as the command-line entry point does: one READ ONLY transaction on a dedicated connection. */
async function runReadOnly() {
  const client = await h.pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try { return await lib.runWebsiteEmailPublishCheck(drizzle(client)); } finally { await client.query("ROLLBACK"); }
  } finally { client.release(); }
}
const statusLedger = async () => (await h.request("admin", "GET", "/api/admin/website-email/status")).body.ledger;
const providerChecks = async () => q(`SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.communication_events'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ '[[:<:]]provider[[:>:]]' ORDER BY conname`);
function runCli() {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), "scripts/check-website-email-publish.ts"],
    { env: { ...process.env }, encoding: "utf8", timeout: 180_000 });
  return { code: result.status, out: `${result.stdout ?? ""}`, err: `${result.stderr ?? ""}` };
}

try {
  // ── Repair statements come from the migration file, in order, and the extraction refuses a changed file ─────────
  const repair = lib.extractLedgerRepairStatements(migrationSql);
  eq(repair.length, 2, "the ledger repair is exactly two statements");
  ok(repair[0].startsWith("DO $$ BEGIN") && repair[0].endsWith("END $$;"), "the first statement is the guarded CHECK swap block");
  eq(repair[1], "ALTER TABLE communication_events VALIDATE CONSTRAINT communication_events_provider_gmail_chk;", "the second statement validates the widened CHECK");
  ok(repair.every((statement) => migrationSql.includes(statement)), "each repair statement appears verbatim in migrations/0382_website_email_lifecycle.sql");
  ok(migrationSql.indexOf(repair[0]) < migrationSql.indexOf(repair[1]), "the statements keep the migration's order");
  ok(repair.every((statement) => !statement.split("\n").some((line) => line.trim().startsWith("--"))), "no comment line (which can contain a semicolon) precedes a printed statement");
  let shapeError = "";
  try { lib.extractLedgerRepairStatements(migrationSql.replace(/ALTER TABLE communication_events VALIDATE CONSTRAINT communication_events_provider_gmail_chk;/, "SELECT 1;")); } catch (e) { shapeError = (e as Error).message; }
  ok(shapeError.includes("no longer ends with"), "a migration file that no longer has the repair shape is refused instead of printing stale statements");

  // ── Healthy migrated database ────────────────────────────────────────────────────────────────────────────────
  const issued: string[] = [];
  const dialect = new PgDialect();
  const spy = { execute: (query: any) => { issued.push(dialect.sqlToQuery(query).sql); return (h.db as any).execute(query); } };
  const healthy = await lib.runWebsiteEmailPublishCheck(spy);
  eq(healthy.tables.map((t) => t.name), [...lib.WEBSITE_EMAIL_TABLES], "the report names all seven website email tables");
  eq(healthy.tables.filter((t) => t.present).length, 7, "all seven website email tables are present in a migrated database");
  eq(healthy.enrollmentMarkerColumn.present, true, "sequence_enrollments.website_admission_id is present");
  eq(healthy.ledger.gmailChecks.map((c) => c.name), ["communication_events_provider_gmail_chk"], "the widened ledger CHECK that accepts 'gmail' is present");
  eq(healthy.ledger.blockingChecks, [], "no CHECK on the provider column refuses 'gmail'");
  eq(healthy.ledger.acceptsGmail, true, "the ledger reports that it accepts Gmail");
  eq(healthy.ok, true, "a migrated database is reported complete");
  eq(healthy.repairStatements, [], "no repair statements are offered when nothing is missing");
  ok(issued.length > 0 && issued.every((text) => /^\s*SELECT\b/i.test(text)), `every statement the check issues is a SELECT (${issued.length} observed)`);
  eq(healthy.ledger.acceptsGmail, (await statusLedger()).acceptsGmail, "the report's ledger value equals the real status route's ledger.acceptsGmail");
  eq((await runReadOnly()).ok, true, "the check runs inside a READ ONLY transaction");
  const healthyText = lib.formatWebsiteEmailPublishReport(healthy);
  ok(healthyText.includes("RESULT: PASS") && !healthyText.includes("DO $$"), "the healthy report says PASS and prints no repair statements");
  const cliHealthy = runCli();
  eq(cliHealthy.code, 0, "the command-line check exits 0 on a complete database");
  ok(cliHealthy.out.includes("RESULT: PASS") && cliHealthy.out.includes("ledger.acceptsGmail: true"), "the command-line report shows PASS and the status-route value");

  // ── Narrow ledger CHECK (what a publish that skipped the CHECK change leaves behind) ─────────────────────────────
  await q(`ALTER TABLE communication_events DROP CONSTRAINT communication_events_provider_gmail_chk, ADD CONSTRAINT ${SERVER_CHECK} CHECK (provider IS NULL OR provider IN ${NARROW}) NOT VALID`);
  try {
    const narrow = await runReadOnly();
    eq(narrow.ledger.checkPresent, false, "a ledger with only the narrow provider CHECK is reported missing");
    eq(narrow.ledger.gmailChecks, [], "no CHECK accepting 'gmail' is found");
    eq(narrow.ledger.blockingChecks.map((c) => c.name), [SERVER_CHECK], "the narrow CHECK is named as the blocker");
    eq(narrow.ledger.acceptsGmail, false, "the ledger value is false while only the narrow CHECK exists");
    eq(narrow.ledger.acceptsGmail, (await statusLedger()).acceptsGmail, "the report's ledger value still equals the status route's");
    eq(narrow.ok, false, "the database is reported incomplete");
    eq(narrow.tables.every((t) => t.present) && narrow.enrollmentMarkerColumn.present, true, "tables and marker column are still reported present");
    eq(narrow.repairStatements, repair, "the exact migration repair statements are offered");
    const narrowText = lib.formatWebsiteEmailPublishReport(narrow);
    ok(narrowText.includes("RESULT: FAIL") && repair.every((statement) => narrowText.includes(statement)), "the failing report prints both repair statements verbatim");
    ok(narrowText.includes("never runs them"), "the report states that it never runs the statements");

    const cliNarrow = runCli();
    eq(cliNarrow.code, 1, "the command-line check exits 1 when the ledger CHECK is missing");
    ok(repair.every((statement) => cliNarrow.out.includes(statement)), "the command-line report prints the repair statements");
    eq((await providerChecks()).map((c) => c.conname), [SERVER_CHECK], "the check did not run the repair: the narrow CHECK is still the only provider CHECK");
    eq(await statusLedger(), { acceptsGmail: false }, "the check did not change what the status route reports");

    // Only this test runs the printed statements, to prove they are the repair for exactly this state.
    for (const statement of narrow.repairStatements) await q(statement);
    const repaired = await runReadOnly();
    eq(repaired.ledger.gmailChecks.map((c) => c.name), ["communication_events_provider_gmail_chk"], "after the printed statements run, the widened CHECK is found");
    eq(repaired.ledger.checkPresent && repaired.ok && repaired.repairStatements.length === 0, true, "a widened CHECK is reported present and the database complete");
    eq((await statusLedger()).acceptsGmail, true, "the status route reports acceptsGmail true after the repair");
  } finally {
    // Restore the migrated shape whatever happened above (idempotent: the guarded block does nothing when already widened).
    for (const statement of repair) await q(statement);
  }
  eq((await runReadOnly()).ok, true, "the disposable database is back to the complete migrated shape");

  // ── Missing structure is reported, never thrown (changes are rolled back) ────────────────────────────────────────
  async function withBrokenSchema<T>(ddl: string, fn: (report: Awaited<ReturnType<typeof lib.runWebsiteEmailPublishCheck>>) => T) {
    const client = await h.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query(ddl);
        return fn(await lib.runWebsiteEmailPublishCheck(drizzle(client)));
      } finally { await client.query("ROLLBACK"); }
    } finally { client.release(); }
  }
  await withBrokenSchema(`ALTER TABLE gmail_mailbox_reader_state RENAME TO gmail_mailbox_reader_state_gone`, (r) => {
    eq(r.tables.filter((t) => !t.present).map((t) => t.name), ["gmail_mailbox_reader_state"], "a missing website email table is named");
    eq(r.ok, false, "a missing table makes the report incomplete");
    eq(r.repairStatements, [], "no ledger repair is offered when only a table is missing");
    ok(lib.formatWebsiteEmailPublishReport(r).includes("Publish database step"), "the report points at the Publish database step for missing tables");
  });
  await withBrokenSchema(`ALTER TABLE sequence_enrollments DROP COLUMN website_admission_id`, (r) => {
    eq(r.enrollmentMarkerColumn.present, false, "a missing sequence_enrollments.website_admission_id is reported");
    eq(r.ok, false, "a missing marker column makes the report incomplete");
  });
  await withBrokenSchema(`ALTER TABLE communication_events RENAME TO communication_events_gone`, (r) => {
    eq(r.ledger.tablePresent, false, "a missing communication_events table is reported instead of thrown");
    eq(r.ok === false && r.ledger.acceptsGmail === false && r.repairStatements.length === 0, true, "the report is incomplete, the ledger does not accept Gmail, and no repair is offered for a missing table");
  });
  eq((await runReadOnly()).ok, true, "the rolled-back structural changes left the database complete");
  eq((await q(`SELECT count(*)::int AS n FROM website_email_send_receipts`))[0].n, 0, "no send receipt exists: the check never sends");
  eq(h.externalCalls(), 0, "no provider or network call was attempted");

  console.log(`\nAll ${checks} checks passed.`);
} finally {
  await h.close();
}
