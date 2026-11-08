/**
 * check-website-email-publish.ts
 *
 * Post-publish check for the website email lifecycle lane (migration 0382). Reports whether the seven website email
 * tables, sequence_enrollments.website_admission_id and a communication_events CHECK that accepts 'gmail' exist in the
 * database DATABASE_URL points at, plus the value the lane status route reports as ledger.acceptsGmail.
 *
 * Read-only: one READ ONLY transaction of catalog SELECTs. No writes, no sends, no provider calls. When the ledger
 * CHECK is missing it prints the repair statements from migrations/0382_website_email_lifecycle.sql for the owner's
 * Database SQL console and never runs them.
 *
 * Usage: DATABASE_URL=<database to check> npx tsx scripts/check-website-email-publish.ts
 *   Run from the workspace shell, DATABASE_URL is the DEVELOPMENT database. To check production, point DATABASE_URL at
 *   the production connection string; the report names the database it actually connected to.
 * Exit code: 0 = everything present, 1 = something missing (report printed), 2 = the check itself could not run.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "../server/db";
import { formatWebsiteEmailPublishReport, runWebsiteEmailPublishCheck } from "./lib/website-email-publish-check";

function targetHost(): string | null {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try {
      const report = await runWebsiteEmailPublishCheck(drizzle(client));
      console.log(formatWebsiteEmailPublishReport(report, { host: targetHost() }));
      return report.ok ? 0 : 1;
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(`Website email publish check could not run: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end().catch(() => undefined);
    process.exit(2);
  });
