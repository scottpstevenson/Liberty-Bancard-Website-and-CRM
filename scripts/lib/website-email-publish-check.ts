/**
 * Post-publish schema check for the website email lifecycle lane (migration 0382).
 *
 * Read-only by construction: every statement here is a catalog SELECT, nothing is written, nothing is sent and no
 * provider is called. The ledger value comes from `readProviderLedgerReady`, the same function the lane status route
 * (`GET /api/admin/website-email/status` -> `ledger.acceptsGmail`) uses, so the two cannot disagree.
 *
 * A Publish installs new tables and columns but has skipped CHECK changes on existing tables, and the lane refuses to
 * open or send until the communication ledger accepts Gmail. When that CHECK is missing the report carries the exact
 * repair statements taken from the migration file for the owner's Database SQL console. They are never executed here.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { readProviderLedgerReady, rowsOf, type Exec } from "../../server/services/website-email-lane-store";

export const WEBSITE_EMAIL_MIGRATION_TAG = "0382_website_email_lifecycle";

export const WEBSITE_EMAIL_TABLES = [
  "website_lifecycle_config_revisions",
  "website_warm_revisions",
  "website_lifecycle_intents",
  "website_lifecycle_admissions",
  "website_email_send_receipts",
  "gmail_mailbox_reader_state",
  "website_inbound_evidence",
] as const;

export const ENROLLMENT_MARKER = { table: "sequence_enrollments", column: "website_admission_id" } as const;
export const LEDGER_TABLE = "communication_events";
export const GMAIL_LEDGER_CHECK = "communication_events_provider_gmail_chk";

export interface LedgerCheckFact {
  name: string;
  definition: string;
}

export interface WebsiteEmailPublishReport {
  ok: boolean;
  database: string;
  tables: Array<{ name: string; present: boolean }>;
  enrollmentMarkerColumn: { table: string; column: string; present: boolean };
  ledger: {
    tablePresent: boolean;
    /** CHECK constraints on communication_events that constrain the provider column and name 'gmail'. */
    gmailChecks: LedgerCheckFact[];
    /** CHECK constraints on the provider column that do NOT name 'gmail'; any one of these refuses Gmail rows. */
    blockingChecks: LedgerCheckFact[];
    /** Same value as the lane status route's ledger.acceptsGmail. */
    acceptsGmail: boolean;
    /** The widened CHECK exists, nothing narrower blocks it, and the status-route value agrees. */
    checkPresent: boolean;
  };
  /** Statements for the owner's Database SQL console; empty unless the ledger CHECK is missing. Never executed here. */
  repairStatements: string[];
}

/** Drop the comment lines and blank lines that precede a statement; the statement itself stays byte-exact. */
function stripLeadingComments(chunk: string): string {
  const lines = chunk.split("\n");
  while (lines.length > 0 && (lines[0].trim() === "" || lines[0].trim().startsWith("--"))) lines.shift();
  return lines.join("\n").trim();
}

/**
 * The communication-ledger repair is the last two statements of migration 0382 (the guarded CHECK swap and its
 * validation). They are read from the migration file, never retyped, and the extraction fails loudly if the file no
 * longer has that shape so a stale copy can never be printed.
 */
export function extractLedgerRepairStatements(migrationSql: string): string[] {
  const statements = migrationSql
    .split(/^--> statement-breakpoint[ \t]*$/m)
    .map(stripLeadingComments)
    .filter((statement) => statement.includes(GMAIL_LEDGER_CHECK));
  const [swap, validate] = statements;
  const shapeOk = statements.length === 2
    && /^DO \$\$ BEGIN\b/.test(swap) && swap.endsWith("END $$;")
    && validate === `ALTER TABLE ${LEDGER_TABLE} VALIDATE CONSTRAINT ${GMAIL_LEDGER_CHECK};`;
  if (!shapeOk) {
    throw new Error(`Migration ${WEBSITE_EMAIL_MIGRATION_TAG} no longer ends with the guarded ${GMAIL_LEDGER_CHECK} swap and its VALIDATE statement; update the publish check before trusting it.`);
  }
  return [swap, validate];
}

export function readMigrationSql(cwd: string = process.cwd()): string {
  return fs.readFileSync(path.join(cwd, "migrations", `${WEBSITE_EMAIL_MIGRATION_TAG}.sql`), "utf8");
}

async function relationPresent(exec: Exec, name: string): Promise<boolean> {
  return rowsOf(await exec.execute(sql`
    SELECT 1 AS present
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${name} AND c.relkind IN ('r', 'p')
  `)).length > 0;
}

async function columnPresent(exec: Exec, table: string, column: string): Promise<boolean> {
  return rowsOf(await exec.execute(sql`
    SELECT 1 AS present
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${table} AND a.attname = ${column}
      AND a.attnum > 0 AND NOT a.attisdropped
  `)).length > 0;
}

async function providerChecks(exec: Exec): Promise<LedgerCheckFact[]> {
  return rowsOf<{ name: string; definition: string }>(await exec.execute(sql`
    SELECT conname AS name, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.communication_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '[[:<:]]provider[[:>:]]'
    ORDER BY conname
  `)).map((row) => ({ name: String(row.name), definition: String(row.definition) }));
}

/**
 * Run the catalog checks through `exec` (a drizzle database, transaction or any `{ execute }`). The caller owns the
 * connection; the command-line entry point opens it as a READ ONLY transaction.
 */
export async function runWebsiteEmailPublishCheck(
  exec: Exec,
  options: { migrationSql?: () => string } = {},
): Promise<WebsiteEmailPublishReport> {
  const database = String(rowsOf<{ name: string }>(await exec.execute(sql`SELECT current_database() AS name`))[0]?.name ?? "unknown");
  const tables: WebsiteEmailPublishReport["tables"] = [];
  for (const name of WEBSITE_EMAIL_TABLES) tables.push({ name, present: await relationPresent(exec, name) });
  const markerPresent = await columnPresent(exec, ENROLLMENT_MARKER.table, ENROLLMENT_MARKER.column);

  const ledgerTablePresent = await relationPresent(exec, LEDGER_TABLE);
  let gmailChecks: LedgerCheckFact[] = [];
  let blockingChecks: LedgerCheckFact[] = [];
  let acceptsGmail = false;
  if (ledgerTablePresent) {
    const checks = await providerChecks(exec);
    gmailChecks = checks.filter((check) => check.definition.includes("'gmail'"));
    blockingChecks = checks.filter((check) => !check.definition.includes("'gmail'"));
    acceptsGmail = await readProviderLedgerReady(exec);
  }
  const checkPresent = ledgerTablePresent && gmailChecks.length > 0 && blockingChecks.length === 0 && acceptsGmail;

  const repairStatements = !ledgerTablePresent || checkPresent ? [] : extractLedgerRepairStatements((options.migrationSql ?? readMigrationSql)());
  return {
    ok: tables.every((table) => table.present) && markerPresent && checkPresent,
    database,
    tables,
    enrollmentMarkerColumn: { ...ENROLLMENT_MARKER, present: markerPresent },
    ledger: { tablePresent: ledgerTablePresent, gmailChecks, blockingChecks, acceptsGmail, checkPresent },
    repairStatements,
  };
}

export function formatWebsiteEmailPublishReport(report: WebsiteEmailPublishReport, target?: { host: string | null }): string {
  const mark = (present: boolean) => (present ? "  ✓" : "  ✗");
  const lines: string[] = [];
  lines.push("Website email lifecycle publish check (migration 0382) — read-only: no writes, no sends, no provider calls");
  lines.push(`Database: ${report.database}${target?.host ? ` on ${target.host}` : ""}`);
  lines.push("");
  lines.push("Tables:");
  for (const table of report.tables) lines.push(`${mark(table.present)} ${table.name}${table.present ? "" : "  MISSING"}`);
  lines.push("");
  lines.push("Enrollment marker column:");
  const marker = report.enrollmentMarkerColumn;
  lines.push(`${mark(marker.present)} ${marker.table}.${marker.column}${marker.present ? "" : "  MISSING"}`);
  lines.push("");
  lines.push(`Message ledger (${LEDGER_TABLE}):`);
  if (!report.ledger.tablePresent) {
    lines.push(`${mark(false)} table ${LEDGER_TABLE}  MISSING`);
  } else {
    for (const check of report.ledger.gmailChecks) lines.push(`${mark(true)} CHECK ${check.name} accepts 'gmail'`);
    if (report.ledger.gmailChecks.length === 0) lines.push(`${mark(false)} no CHECK on provider names 'gmail'  MISSING`);
    for (const check of report.ledger.blockingChecks) lines.push(`${mark(false)} CHECK ${check.name} refuses 'gmail': ${check.definition}`);
  }
  lines.push(`  Lane status route value ledger.acceptsGmail: ${report.ledger.acceptsGmail}`);
  lines.push("");
  lines.push(report.ok ? "RESULT: PASS — the website email tables, the enrollment marker column and the Gmail ledger CHECK are all present." : "RESULT: FAIL");

  const structuralMissing = report.tables.some((table) => !table.present) || !marker.present || !report.ledger.tablePresent;
  if (structuralMissing) {
    lines.push("");
    lines.push("Missing tables, column or ledger table: migration 0382 did not fully reach this database. Inspect or re-run the Publish database step; this script does not create them.");
  }
  if (report.repairStatements.length > 0) {
    lines.push("");
    lines.push("The ledger CHECK is missing. Paste these statements, in order, into the owner's Database SQL console for THIS database.");
    lines.push("They are copied from migrations/0382_website_email_lifecycle.sql. This script never runs them. Re-run the check afterwards.");
    for (const statement of report.repairStatements) {
      lines.push("");
      lines.push(statement);
    }
  }
  return lines.join("\n");
}
