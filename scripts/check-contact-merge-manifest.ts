#!/usr/bin/env npx tsx
/**
 * Validates the code-owned BT-07 disposition manifest. The comparison is
 * intentionally one-way: every live FK to contacts must appear in source code;
 * unknown future references fail closed before an operator can merge records.
 */
import fs from "fs";
import path from "path";
import pg from "pg";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

const manifestSource = fs.readFileSync(path.join(process.cwd(), "server/services/contact-merge.ts"), "utf8");
const schemaSource = fs.readFileSync(path.join(process.cwd(), "shared/schema.ts"), "utf8");
const failures: string[] = [];
// Derive every schema FK that targets contacts from the canonical TypeScript
// schema rather than maintaining a small hand-curated allowlist. This catches
// new relationship tables before they can silently escape merge disposition.
const tableStarts = [...schemaSource.matchAll(/(?:export\s+const\s+\w+\s*=\s*)?pgTable\("([^"]+)"/g)];
for (let index = 0; index < tableStarts.length; index++) {
  const table = tableStarts[index][1];
  const start = tableStarts[index].index ?? 0;
  const end = index + 1 < tableStarts.length ? (tableStarts[index + 1].index ?? schemaSource.length) : schemaSource.length;
  const body = schemaSource.slice(start, end);
  for (const match of body.matchAll(/(?:integer|uuid|text)\("([^"]+)"\)[^\n]*\.references\(\(\)\s*=>\s*contacts\.id/g)) {
    const column = match[1];
    if (!manifestSource.includes(`"${table}"`) || !manifestSource.includes(`"${column}"`)) {
      failures.push(`schema FK missing from disposition manifest: ${table}.${column}`);
    }
  }
}
// Non-FK contact pointers and durable payload boundaries have no catalog
// constraint to discover, so each must be explicitly classified and its live
// processing boundary must invoke the dedicated resolver.
const REQUIRED_NON_FK_AND_PAYLOADS = [
  ["outbound_send_log", "contact_id"],
  ["zerobounce_validation_attempts", "contact_id"],
  ["abandoned-statement-worker.ts", "resolveLiveContactRedirect"],
  ["sequence-worker.ts", "resolveLiveContactId"],
  ["queue-manager.ts", "resolveLiveContactId"],
] as const;
for (const [fileOrTable, required] of REQUIRED_NON_FK_AND_PAYLOADS) {
  const source = fileOrTable.endsWith(".ts")
    ? fs.readFileSync(path.join(process.cwd(), "server/services", fileOrTable), "utf8")
    : manifestSource;
  if (!source.includes(required)) failures.push(`unclassified non-FK pointer or live payload boundary: ${fileOrTable}.${required}`);
}
if (/FROM\s+\$\{|UPDATE\s+\$\{|sql\.raw\([^)]*table_name/i.test(manifestSource)) {
  failures.push("manifest service appears to construct SQL from a database-provided table name");
}

async function main() {
  // This is a deterministic integration guard, not a best-effort source scan:
  // merge execution is forbidden unless the migrated catalog is also checked.
  await assertDisposableTestInfrastructure({ operation: "contact-merge-manifest" });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
      const result = await pool.query(`
        SELECT c.relname AS table_name, a.attname AS column_name
        FROM pg_constraint fk
        JOIN pg_class c ON c.oid = fk.conrelid
        JOIN pg_class target ON target.oid = fk.confrelid
        JOIN unnest(fk.conkey) WITH ORDINALITY AS keys(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = keys.attnum
        WHERE fk.contype = 'f' AND target.relname = 'contacts'
      `);
      for (const row of result.rows) {
        if (!manifestSource.includes(`"${row.table_name}"`) || !manifestSource.includes(`"${row.column_name}"`)) {
          failures.push(`unclassified live contacts FK: ${row.table_name}.${row.column_name}`);
        }
      }
      // A manifest typo can make a preview fail even when all database FKs are
      // represented. Parse every explicit source-owned table/column pair and
      // verify it exists in the live catalog.
      const declared = [...manifestSource.matchAll(/table:\s*"([^"]+)",\s*column:\s*"([^"]+)"/g)];
      for (const [, tableName, columnName] of declared) {
        const column = await pool.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
        `, [tableName, columnName]);
        if (!column.rows[0]) failures.push(`manifest declares missing pointer: ${tableName}.${columnName}`);
      }
  } finally {
    await pool.end();
  }
  if (failures.length) {
    console.error("Contact merge manifest check failed:");
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("✓ Contact merge disposition manifest covers required pointers and live FK catalog");
}
main().catch((error) => { console.error(error); process.exit(1); });