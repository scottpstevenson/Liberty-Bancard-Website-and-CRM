#!/usr/bin/env tsx
/**
 * BT-12 isolated integration gate.  This intentionally refuses to run unless
 * the process is explicitly pointed at a disposable TEST_DATABASE_URL; it never
 * falls back to the developer or production database and constructs no provider
 * transport.  It validates migration availability, durable ledger constraints,
 * and exact-money policy using the production helpers.
 */
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required; no DATABASE_URL fallback is permitted.");
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("DATABASE_URL must explicitly equal TEST_DATABASE_URL before this integration suite starts.");
  }
  await assertDisposableTestInfrastructure({ operation: "BT-12 revenue reconciliation", requireRedis: false });
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  const { parseCurrencyToMinor, minorToCurrency, applyPercentToMinor } = await import("../server/services/money");

  const required = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN
      ('deal_stage_effect_intents','deal_stage_effect_receipts','sequence_step_ab_assignments',
       'sequence_ab_evaluation_runs','sequence_ab_winner_decisions','chargeback_submission_commands')
  `);
  if ((required.rows ?? required).length !== 6) throw new Error("BT-12 durable ledgers are not migrated in TEST_DATABASE_URL.");
  const threshold = await db.execute(sql`
    SELECT data_type, numeric_precision, numeric_scale, is_nullable
    FROM information_schema.columns
    WHERE table_name='residual_imports' AND column_name='variance_threshold_amt_decimal'
  `);
  const col = (threshold.rows ?? threshold)[0] as any;
  if (!col || col.data_type !== "numeric" || Number(col.numeric_scale) !== 2 || col.is_nullable !== "NO") {
    throw new Error("exact residual threshold migration is incomplete.");
  }
  if (minorToCurrency(parseCurrencyToMinor("0.10") + parseCurrencyToMinor("0.20")) !== "0.30") throw new Error("exact 0.10 + 0.20 failed");
  if (minorToCurrency(applyPercentToMinor(parseCurrencyToMinor("-10.00"), "12.5")) !== "-1.25") throw new Error("exact negative commission failed");
  for (const invalid of ["12abc", "1e2", "0.001"]) {
    let rejected = false; try { parseCurrencyToMinor(invalid); } catch { rejected = true; }
    if (!rejected) throw new Error(`malformed money accepted: ${invalid}`);
  }
  console.log("BT-12 integration infrastructure, durable ledger, migration, and exact-money checks passed.");
}
main().catch((error) => { console.error(error); process.exit(1); });