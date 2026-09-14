/**
 * scripts/check-bounded-schema-drift.ts
 *
 * Task #1955 — bounded schema-verification/diff tooling.
 *
 * Scope is deliberately narrow, per the task: only the tables this task
 * touched or reasoned about — businesses, deals, contacts,
 * cro03_source_subjects. Read-only: compares the live database's
 * information_schema against the Drizzle table definitions in
 * shared/schema.ts and reports any drift (missing/extra column, type
 * mismatch, nullability mismatch). Never issues DDL.
 *
 * Usage: npx tsx scripts/check-bounded-schema-drift.ts [--json]
 * Exit code 0 = no drift found. Exit code 1 = drift found (see report).
 */
import { pool } from "../server/db";
import {
  contacts,
  cro03SourceSubjects,
  deals,
  businesses,
} from "../shared/schema";
import { getTableColumns, getTableName } from "drizzle-orm";

const JSON_OUT = process.argv.includes("--json");

const TABLES = [contacts, cro03SourceSubjects, deals, businesses];

// Map Drizzle's internal SQL type strings to the family of Postgres
// information_schema.data_type strings that should be considered equivalent
// (Drizzle and Postgres describe some types differently even when correct).
function typesCompatible(drizzleSqlType: string, pgDataType: string): boolean {
  const d = drizzleSqlType.toLowerCase();
  const p = pgDataType.toLowerCase();
  if (d === p) return true;
  // information_schema.columns.data_type reports any array column as the
  // literal string "ARRAY" (the element type lives in a separate column
  // this tool doesn't query); Drizzle reports e.g. "text[]". Treat any
  // Drizzle array type paired with pg's "ARRAY" as compatible rather than
  // flagging every array column as a false-positive type mismatch.
  if (d.endsWith("[]") && p === "array") return true;
  const equivalences: [RegExp, RegExp][] = [
    [/^varchar/, /character varying/],
    [/^text/, /text/],
    [/^integer|^serial/, /integer/],
    [/^boolean/, /boolean/],
    [/^timestamp with time zone/, /timestamp with time zone/],
    [/^timestamp/, /timestamp without time zone|timestamp with time zone/],
    [/^jsonb/, /jsonb/],
    [/^real/, /real/],
    [/^uuid/, /uuid/],
    [/^double precision/, /double precision/],
    [/^numeric/, /numeric/],
  ];
  return equivalences.some(([dr, pr]) => dr.test(d) && pr.test(p));
}

async function checkTable(table: any) {
  const tableName = getTableName(table);
  const columns = getTableColumns(table);

  const liveColsResult = await pool.query(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  const liveCols = new Map(
    liveColsResult.rows.map((r: any) => [r.column_name, { dataType: r.data_type, nullable: r.is_nullable === "YES" }]),
  );

  const drizzleColNames = new Set<string>();
  const findings: string[] = [];

  for (const [_key, col] of Object.entries(columns) as [string, any][]) {
    const colName = col.name;
    drizzleColNames.add(colName);
    const live = liveCols.get(colName);
    if (!live) {
      findings.push(`MISSING IN DB: schema.ts declares "${colName}" but the live table has no such column.`);
      continue;
    }
    if (!typesCompatible(col.getSQLType(), live.dataType)) {
      findings.push(
        `TYPE MISMATCH: "${colName}" — schema.ts says ${col.getSQLType()}, live DB says ${live.dataType}.`,
      );
    }
    const drizzleNullable = !col.notNull;
    if (drizzleNullable !== live.nullable) {
      findings.push(
        `NULLABILITY MISMATCH: "${colName}" — schema.ts says notNull=${!drizzleNullable}, live DB says nullable=${live.nullable}.`,
      );
    }
  }

  for (const liveColName of liveCols.keys()) {
    if (!drizzleColNames.has(liveColName)) {
      findings.push(`EXTRA IN DB: live table has column "${liveColName}" with no matching field in schema.ts.`);
    }
  }

  return { tableName, findings };
}

async function main() {
  const results = [];
  let totalFindings = 0;
  for (const table of TABLES) {
    const result = await checkTable(table);
    results.push(result);
    totalFindings += result.findings.length;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ scope: TABLES.map((t) => getTableName(t)), totalFindings, results }, null, 2));
  } else {
    console.log(`\n[check-bounded-schema-drift] scope: ${TABLES.map((t) => getTableName(t)).join(", ")}`);
    for (const r of results) {
      if (r.findings.length === 0) {
        console.log(`  ${r.tableName}: OK (no drift)`);
      } else {
        console.log(`  ${r.tableName}: ${r.findings.length} finding(s)`);
        for (const f of r.findings) console.log(`    - ${f}`);
      }
    }
  }

  process.exit(totalFindings > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[check-bounded-schema-drift] FAILED:", err);
  process.exit(1);
});
