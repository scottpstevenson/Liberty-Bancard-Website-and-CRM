#!/usr/bin/env npx tsx
/**
 * Validates the code-owned BT-07 disposition manifest. Every live FK and each
 * required non-FK contact pointer must map to an exact source-owned table and
 * column; unknown or missing references fail closed before a merge.
 */
import fs from "fs";
import path from "path";
import pg from "pg";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

const manifestSource = fs.readFileSync(path.join(process.cwd(), "server/services/contact-merge.ts"), "utf8");
const schemaSource = fs.readFileSync(path.join(process.cwd(), "shared/schema.ts"), "utf8");
const failures: string[] = [];
// Non-FK contact pointers and durable payload boundaries have no catalog
// constraint to discover, so each must be explicitly classified and its live
// processing boundary must invoke the dedicated resolver.
const REQUIRED_NON_FK_POINTERS = [
  { key: "outbound_send_log", table: "outbound_send_log", column: "contact_id", disposition: "immutable_retain" },
  { key: "zerobounce_attempts", table: "zerobounce_attempts", column: "contact_id", disposition: "manual_block" },
] as const;
const REQUIRED_LIVE_PAYLOADS = [
  ["abandoned-statement-worker.ts", "resolveLiveContactRedirect"],
  ["sequence-worker.ts", "resolveLiveContactRedirect"],
  ["queue-manager.ts", "resolveLiveContactId"],
] as const;

function explicitManifestDeclarations(source: string) {
  return [...source.matchAll(
    /\{\s*key:\s*"([^"]+)",\s*table:\s*"([^"]+)",\s*column:\s*"([^"]+)"[^}]*,\s*disposition:\s*"([^"]+)",?\s*\}/g,
  )].map(([, key, table, column, disposition]) => ({ key, table, column, disposition }));
}

function missingDeclaredPairs(declaredPairs: Iterable<string>, availablePairs: Set<string>) {
  return [...declaredPairs].filter((pair) => !availablePairs.has(pair));
}

function missingRequiredNonFkDeclarations(
  entries: ReturnType<typeof explicitManifestDeclarations>,
  required: readonly { key: string; table: string; column: string; disposition: string }[],
) {
  return required.filter((expected) => !entries.some((entry) =>
    entry.key === expected.key &&
    entry.table === expected.table &&
    entry.column === expected.column &&
    entry.disposition === expected.disposition
  ));
}

// These contact-linked subjects require exact source-owned manual blocks.
// The ZeroBounce attempt pointer has no FK, but uses the same durable preview
// and execution block path as the FK-backed evidence rows.
const SAFE_BLOCK_POINTER_FIXTURES = [
  ["zerobounce_attempts", "zerobounce_attempts", "contact_id", "MANUAL_BLOCK_ZEROBOUNCE_ATTEMPTS"],
  ["cro03b_recipe_items", "cro03b_recipe_items", "contact_id", "MANUAL_BLOCK_CRO03B_RECIPE_ITEMS"],
  ["cro03b_projection_receipts", "cro03b_projection_receipts", "contact_id", "MANUAL_BLOCK_CRO03B_PROJECTION_RECEIPTS"],
  ["cro03b_finalization_receipts", "cro03b_finalization_receipts", "contact_id", "MANUAL_BLOCK_CRO03B_FINALIZATION_RECEIPTS"],
  ["cro03b_terminal_hook_requests", "cro03b_terminal_hook_requests", "contact_id", "MANUAL_BLOCK_CRO03B_TERMINAL_HOOK_REQUESTS"],
  ["cro03c_initial_subjects", "cro03c_initial_subjects", "contact_id", "MANUAL_BLOCK_CRO03C_INITIAL_SUBJECTS"],
  ["cro03c_projection_receipts", "cro03c_projection_receipts", "contact_id", "MANUAL_BLOCK_CRO03C_PROJECTION_RECEIPTS"],
  ["cro03c_finalization_receipts", "cro03c_finalization_receipts", "contact_id", "MANUAL_BLOCK_CRO03C_FINALIZATION_RECEIPTS"],
  ["cro03c_terminal_hooks", "cro03c_terminal_hooks", "contact_id", "MANUAL_BLOCK_CRO03C_TERMINAL_HOOKS"],
  ["cro03c_validation_authorizations", "cro03c_validation_authorizations", "contact_id", "MANUAL_BLOCK_CRO03C_VALIDATION_AUTHORIZATIONS"],
  ["cr06_prepared_enrollments", "cr06_prepared_enrollments", "contact_id", "MANUAL_BLOCK_CR06_PREPARED_ENROLLMENTS"],
  ["cr06_delivery_intents_recipient", "cr06_delivery_intents", "recipient_contact_id", "MANUAL_BLOCK_CR06_DELIVERY_INTENTS_RECIPIENT"],
  ["cr06_attribution_events", "cr06_attribution_events", "contact_id", "MANUAL_BLOCK_CR06_ATTRIBUTION_EVENTS"],
  ["cr06_feedback_receipts", "cr06_feedback_receipts", "contact_id", "MANUAL_BLOCK_CR06_FEEDBACK_RECEIPTS"],
  ["cro07_feedback_receipts", "cro07_feedback_receipts", "contact_id", "MANUAL_BLOCK_CRO07_FEEDBACK_RECEIPTS"],
  ["cro07_reply_work", "cro07_reply_work", "contact_id", "MANUAL_BLOCK_CRO07_REPLY_WORK"],
  ["inbound_requests", "inbound_requests", "contact_id", "MANUAL_BLOCK_INBOUND_REQUESTS"],
  ["contact_business_system_link_evidence", "contact_business_system_link_evidence", "contact_id", "MANUAL_BLOCK_CONTACT_BUSINESS_SYSTEM_LINK_EVIDENCE"],
  ["merchant_mid_access_receipts", "merchant_mid_access_receipts", "contact_id", "MANUAL_BLOCK_MERCHANT_MID_ACCESS_RECEIPTS"],
  ["contact_vertical_candidates", "contact_vertical_candidates", "contact_id", "MANUAL_BLOCK_CONTACT_VERTICAL_CANDIDATES"],
  ["call_assist_sessions", "call_assist_sessions", "contact_id", "MANUAL_BLOCK_CALL_ASSIST_SESSIONS"],
  ["field_route_stops", "field_route_stops", "contact_id", "MANUAL_BLOCK_FIELD_ROUTE_STOPS"],
  ["field_visits", "field_visits", "contact_id", "MANUAL_BLOCK_FIELD_VISITS"],
  ["free_discovery_candidates_contact", "free_discovery_candidates", "contact_id", "MANUAL_BLOCK_FREE_DISCOVERY_CANDIDATES_CONTACT"],
  ["sfp_outreach_eligibility_contact", "sfp_outreach_eligibility", "contact_id", "MANUAL_BLOCK_SFP_OUTREACH_ELIGIBILITY_CONTACT"],
  ["sfp_campaign_staging_intents_contact", "sfp_campaign_staging_intents", "contact_id", "MANUAL_BLOCK_SFP_CAMPAIGN_STAGING_INTENTS_CONTACT"],
  ["sfp_ready_held_enrollments", "sfp_ready_held_enrollments", "contact_id", "MANUAL_BLOCK_SFP_READY_HELD_ENROLLMENTS"],
  ["master_leads_promoted_contact", "master_leads", "promoted_contact_id", "MANUAL_BLOCK_MASTER_LEADS_PROMOTED_CONTACT"],
] as const;

const declaredPairs = new Set<string>();
for (const [, tableName, columnName] of manifestSource.matchAll(/table:\s*"([^"]+)",\s*column:\s*"([^"]+)"/g)) {
  declaredPairs.add(`${tableName}.${columnName}`);
}
// The broad transfer set is source-owned as a literal table list and shares
// only the contact_id column. Expand it into exact table/column pairs here.
const transferTablesBlock = manifestSource.match(
  /\.\.\.\[([\s\S]*?)\]\.map\(table => \(\{ key: table, table, column: "contact_id", disposition: "transfer" as const \}\)\)/,
)?.[1];
if (!transferTablesBlock) failures.push("source-owned contact transfer table list is missing or malformed");
for (const [, tableName] of transferTablesBlock?.matchAll(/"([^"]+)"/g) ?? []) {
  declaredPairs.add(`${tableName}.contact_id`);
}

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
    if (!declaredPairs.has(`${table}.${column}`)) {
      failures.push(`schema FK missing from disposition manifest: ${table}.${column}`);
    }
  }
}

const declarations = explicitManifestDeclarations(manifestSource);
const manualBlockDeclarations = new Map<string, { key: string; disposition: string }>();
for (const declaration of declarations) {
  if (declaration.disposition === "manual_block") {
    manualBlockDeclarations.set(`${declaration.table}.${declaration.column}`, declaration);
  }
}
for (const [key, tableName, columnName, expectedPreviewConflict] of SAFE_BLOCK_POINTER_FIXTURES) {
  const declaration = manualBlockDeclarations.get(`${tableName}.${columnName}`);
  if (!declaration || declaration.key !== key || declaration.disposition !== "manual_block") {
    failures.push(`safe-block fixture missing exact manual_block disposition: ${tableName}.${columnName} (key ${key})`);
  }
  if (expectedPreviewConflict !== `MANUAL_BLOCK_${key.toUpperCase()}`) {
    failures.push(`safe-block fixture has an invalid expected preview/execution conflict code: ${tableName}.${columnName}`);
  }
}
if (!manifestSource.includes("conflicts.push(manualBlockConflictCode(entry))")
  || !manifestSource.includes("const manualBlockConflictCode = (entry: ManifestEntry) => `MANUAL_BLOCK_${entry.key.toUpperCase()}`;")) {
  failures.push("manual-block fixtures do not produce the expected preview conflict code");
}
if (!manifestSource.includes("MANUAL_BLOCK_CONFLICT_CODES.has(error.code)")
  || !manifestSource.includes(".map(manualBlockConflictCode)")) {
  failures.push("manual-block preview conflicts are not durably persisted by merge execution");
}

for (const expected of missingRequiredNonFkDeclarations(declarations, REQUIRED_NON_FK_POINTERS)) {
  failures.push(
    `unclassified non-FK pointer: ${expected.table}.${expected.column} must be ${expected.disposition} under key ${expected.key}`,
  );
}
for (const [file, required] of REQUIRED_LIVE_PAYLOADS) {
  const source = fs.readFileSync(path.join(process.cwd(), "server/services", file), "utf8");
  if (!source.includes(required)) failures.push(`unclassified live payload boundary: ${file}.${required}`);
}
if (/FROM\s+\$\{|UPDATE\s+\$\{|sql\.raw\([^)]*table_name/i.test(manifestSource)) {
  failures.push("manifest service appears to construct SQL from a database-provided table name");
}

// Regression guard: a different table's generic `contact_id` must not satisfy
// an exact non-FK requirement for the ZeroBounce attempts table.
const unrelatedContactPointerOnly = explicitManifestDeclarations(
  '{ key: "outbound_send_log", table: "outbound_send_log", column: "contact_id", disposition: "immutable_retain" }',
);
const missingZeroBounceDeclaration = missingRequiredNonFkDeclarations(
  unrelatedContactPointerOnly,
  REQUIRED_NON_FK_POINTERS.filter((entry) => entry.key === "zerobounce_attempts"),
);
if (!missingZeroBounceDeclaration.some((entry) =>
  entry.table === "zerobounce_attempts" && entry.column === "contact_id"
)) {
  failures.push("missing-table-pair negative regression: unrelated contact_id satisfied the ZeroBounce attempts disposition");
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
        if (!declaredPairs.has(`${row.table_name}.${row.column_name}`)) {
          failures.push(`unclassified live contacts FK: ${row.table_name}.${row.column_name}`);
        }
      }
      // Verify all exact source-owned pairs against the catalog, including
      // non-FK pointers, and exercise the missing-pair path with an absent
      // fixture name so unrelated columns can never satisfy it.
      const columns = await pool.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
      `);
      const availablePairs = new Set<string>(
        columns.rows.map((row) => `${row.table_name}.${row.column_name}`),
      );
      for (const pair of missingDeclaredPairs(declaredPairs, availablePairs)) {
        failures.push(`manifest declares missing pointer: ${pair}`);
      }
      const missingPairNegative = "__contact_merge_missing_pointer_probe.contact_id";
      if (!missingDeclaredPairs([missingPairNegative], availablePairs).includes(missingPairNegative)) {
        failures.push("missing-table-pair negative regression: an absent exact table/column pair was not rejected");
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