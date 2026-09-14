/**
 * Parity test for the canonical DBPR-family predicate (server/services/dbpr.ts).
 *
 * Confirms the TypeScript predicate (isDbprSourceSystem) and the SQL form
 * (~* 'dbpr') classify the same set of values identically, across the four
 * named DBPR families plus casing/delimiter variants, and confirms clearly
 * non-DBPR values are never misclassified.
 *
 * Run: npx tsx scripts/test-dbpr-predicate-parity.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { isDbprSourceSystem, DBPR_SQL_REGEX } from "../server/services/dbpr";
import { isDbprSourceSystem as legacyIsDbprSourceSystem } from "../server/services/cro08a/source-scope";

const DBPR_CASES: Array<{ value: string; expected: true }> = [
  { value: "dbpr_hr", expected: true },
  { value: "dbpr-abt", expected: true },
  { value: "dbpr-cos", expected: true },
  { value: "dbpr-bar", expected: true },
  { value: "DBPR_HR", expected: true },
  { value: "Dbpr-Abt", expected: true },
  { value: "DBPR-COS", expected: true },
  { value: "dbpr.bar", expected: true },
  { value: "DbPr_Hr_v2", expected: true },
  { value: "legacy_dbpr_hr_import", expected: true },
];

const NON_DBPR_CASES: Array<{ value: string; expected: false }> = [
  { value: "sunbiz_entities", expected: false },
  { value: "master_leads", expected: false },
  { value: "prospects", expected: false },
  { value: "sdr_merchants", expected: false },
  { value: "lead_discovery_results", expected: false },
  { value: "serper", expected: false },
  { value: "apollo", expected: false },
  { value: "outscraper", expected: false },
  { value: "d.b.p.r", expected: false }, // delimited letters, not the substring "dbpr"
  { value: "", expected: false },
];

async function main() {
  let failures = 0;
  const allCases = [...DBPR_CASES, ...NON_DBPR_CASES];

  for (const { value, expected } of allCases) {
    const tsResult = isDbprSourceSystem(value);
    const legacyResult = legacyIsDbprSourceSystem(value);
    if (tsResult !== expected) {
      console.error(`FAIL (TS canonical): "${value}" -> ${tsResult}, expected ${expected}`);
      failures++;
    }
    if (legacyResult !== expected) {
      console.error(`FAIL (TS legacy re-export): "${value}" -> ${legacyResult}, expected ${expected}`);
      failures++;
    }
  }

  // SQL-side parity: run every case through Postgres's ~* operator and compare
  // against the expected classification.
  const valuesSql = allCases.map((c) => sql`(${c.value}::text, ${c.expected}::boolean)`);
  const joined = sql.join(valuesSql, sql`, `);
  const result = await db.execute(sql`
    SELECT v.val, v.expected, (v.val ~* ${DBPR_SQL_REGEX}) AS sql_result
    FROM (VALUES ${joined}) AS v(val, expected)
  `);
  for (const row of (result as any).rows ?? []) {
    // node-postgres returns unknown/inferred columns as text in some drivers;
    // compare against the string form defensively rather than trusting
    // Boolean(x), which treats the string "false" as truthy.
    const sqlResult = row.sql_result === true || row.sql_result === "t" || row.sql_result === "true";
    const expected = row.expected === true || row.expected === "t" || row.expected === "true";
    if (sqlResult !== expected) {
      console.error(`FAIL (SQL): "${row.val}" -> ${sqlResult}, expected ${expected}`);
      failures++;
    }
    if (sqlResult !== isDbprSourceSystem(String(row.val))) {
      console.error(`FAIL (TS/SQL disagreement): "${row.val}" -> TS=${isDbprSourceSystem(String(row.val))}, SQL=${sqlResult}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} parity failure(s).`);
    process.exit(1);
  }
  console.log(`OK — ${allCases.length} cases, TS and SQL DBPR predicates agree.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Parity test crashed:", err);
  process.exit(1);
});
