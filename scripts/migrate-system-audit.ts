import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'system_audit_runs' AND column_name = 'overall_score'
  `);
  if (result.rows.length > 0) {
    console.log("system_audit_runs already has canonical schema (overall_score column present) — skipping");
    return;
  }

  console.log("Applying system_audit_runs canonical schema (migration 0073)...");
  await db.execute(sql`DROP TABLE IF EXISTS system_audit_runs`);
  await db.execute(sql`
    CREATE TABLE system_audit_runs (
      id serial PRIMARY KEY NOT NULL,
      triggered_by text NOT NULL DEFAULT 'schedule',
      ran_at timestamp with time zone NOT NULL DEFAULT now(),
      overall_score integer NOT NULL DEFAULT 0,
      probe_results jsonb,
      claude_narrative text,
      slack_status text NOT NULL DEFAULT 'skipped',
      created_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS system_audit_runs_ran_at_idx ON system_audit_runs (ran_at DESC)`);
  console.log("system_audit_runs canonical schema applied successfully.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
