#!/usr/bin/env npx tsx
/**
 * check-migration-seed-registration.ts (Task #1750)
 *
 * Deployment preflight / CI static check: production is provisioned by
 * Replit Publish syncing schema.ts, which creates tables but NEVER executes
 * a migration file's imperative INSERT/UPDATE statements (see
 * .agents/memory/production-schema-ownership.md). Any migration that bakes
 * in seed/config/backfill data as a plain top-level INSERT/UPDATE therefore
 * silently never lands in production unless something else — a dedicated
 * convergence target in server/services/production-seed-convergence.ts —
 * repeats that write at app startup.
 *
 * This script:
 *   1. Scans every root migrations/*.sql file for top-level INSERT/UPDATE
 *      statements (statements inside CREATE FUNCTION/$$...$$ bodies are
 *      trigger definitions, not migration-time writes, and are excluded).
 *   2. For each (migration file, target table) pair found, requires either:
 *        a. the table is one of production-seed-convergence.ts's
 *           SEED_TARGETS (an active, owned convergence path exists), OR
 *        b. the exact (file, table) pair is in KNOWN_EXEMPT_SEEDS below,
 *           with a written classification + reason (historical one-time
 *           migration whose data window has closed, or a write that is not
 *           itself production-required config).
 *   3. FAILS if a migration/table pair is neither registered nor exempt —
 *      this is the guardrail against the next occurrence of this bug class.
 *
 * New migrations with seed/config data MUST add a convergence target to
 * production-seed-convergence.ts, not just an entry here. Only add to
 * KNOWN_EXEMPT_SEEDS for writes that are genuinely not production-required
 * config (e.g. a one-time backfill of already-existing legacy row data that
 * predates this remediation and does not gate any current fail-closed path).
 *
 * Exits 0 on pass, 1 on any unregistered/unexempted seed write found.
 *
 * Usage:
 *   npx tsx scripts/check-migration-seed-registration.ts
 */

import fs from "fs";
import path from "path";
import { SEED_TARGETS } from "../server/services/production-seed-convergence";

const MIGRATIONS_ROOT = path.join(process.cwd(), "migrations");

/**
 * Migrations that predate Task #1750 and whose top-level INSERT/UPDATE is
 * exempt from requiring a live convergence target, with a written
 * classification + reason per Task #1750 done-criteria #2.
 *   - historical_one_time: a point-in-time repair/backfill of data as it
 *     existed then; replaying it against current data would be meaningless
 *     or actively wrong, and nothing reads it as "required config" today.
 *   - not_config_seed: the write is operational bookkeeping (e.g. clearing
 *     test fixture IDs, resetting a password hash) rather than data any
 *     runtime code depends on being present to function correctly.
 */
const KNOWN_EXEMPT_SEEDS: Record<string, { table: string; classification: "historical_one_time" | "not_config_seed"; reason: string }[]> = {
  "0005_shallow_stepford_cuckoos.sql": [
    { table: "deals", classification: "historical_one_time", reason: "one-time contact-dedupe backfill reassigning deals from a duplicate contact row to the surviving primary before the contacts_email_unique_idx constraint added later in this migration; not applicable to contacts created after this migration's window." },
    { table: "tickets", classification: "historical_one_time", reason: "same one-time contact-dedupe reassignment as the deals row above, for tickets." },
    { table: "tasks", classification: "historical_one_time", reason: "same one-time contact-dedupe reassignment as the deals row above, for tasks." },
    { table: "documents", classification: "historical_one_time", reason: "same one-time contact-dedupe reassignment as the deals row above, for documents." },
    { table: "contacts", classification: "historical_one_time", reason: "one-time archival of duplicate contact rows discovered by this migration's dedupe scan; not applicable to contacts created after this migration's window." },
  ],
  "0012_verbal_commit_pipeline_stage.sql": [{ table: "pipeline_stages", classification: "historical_one_time", reason: "one-time pipeline stage row insert/rename for a specific historical pipeline configuration; current pipeline_stages content is operator-managed at runtime, not migration-seeded." }],
  "0027_underwriting_rules.sql": [{ table: "underwriting_rules", classification: "historical_one_time", reason: "initial underwriting rule set from the original feature launch; rules are now managed via the admin UI, not re-seeded on every deploy." }],
  "0055_add_data_completeness_score.sql": [{ table: "contacts", classification: "historical_one_time", reason: "one-time UPDATE backfilling a computed score column added in this migration for rows that existed at the time; the score is recomputed by application code going forward." }],
  "0056_campaign_previews.sql": [{ table: "campaign_previews", classification: "historical_one_time", reason: "one-time cleanup UPDATE of pre-existing preview rows' status column; campaign_previews rows are otherwise entirely runtime-created." }],
  "0066_ghl_contact_id_unique.sql": [{ table: "contacts", classification: "historical_one_time", reason: "one-time dedupe UPDATE clearing conflicting ghl_contact_id values before adding a uniqueness constraint; not applicable to rows created after this migration's window." }],
  "0074_fix_ghl_identity_conflicts.sql": [{ table: "contacts", classification: "historical_one_time", reason: "one-time repair of a specific historical GHL identity-conflict incident; blindly replaying it against current contact data would risk corrupting unrelated present-day state (see .agents/memory/production-schema-ownership.md unsafe-to-auto-recreate guidance)." }, { table: "audit_logs", classification: "not_config_seed", reason: "audit trail entry documenting the 0074 repair itself, not config any runtime path depends on." }],
  "0075_admin_password_reset.sql": [{ table: "users", classification: "not_config_seed", reason: "one-time admin password reset tied to a specific incident; ongoing admin credential management is handled by seedAdminUser at startup (see .agents/memory/admin-password-sync.md), not this migration." }],
  "0092_sequence_outbound_channels.sql": [{ table: "follow_up_sequences", classification: "historical_one_time", reason: "one-time backfill of a new outbound-channel column for sequences that existed at the time; new sequences set this at creation." }],
  "0093_clear_test_ghl_ids.sql": [{ table: "contacts", classification: "not_config_seed", reason: "one-time cleanup clearing test-fixture GHL IDs out of that environment's data; not production config." }],
  "0105_executive_kpi_tables.sql": [{ table: "executive_goals", classification: "historical_one_time", reason: "initial executive goal targets from feature launch; goals are operator-edited via the admin UI afterward, not re-seeded." }],
  "0106_executive_goals.sql": [{ table: "executive_goals", classification: "historical_one_time", reason: "follow-up adjustment to the same launch-time goal seed as 0105; superseded by ongoing operator edits." }],
  "0111_residual_txn_cost.sql": [{ table: "merchant_residuals", classification: "historical_one_time", reason: "one-time backfill of a new cost column for residual rows that existed at the time; new imports compute this at write time." }],
  "0138_post_enrichment_intent_fields.sql": [{ table: "post_enrichment_enrollment_intents", classification: "historical_one_time", reason: "one-time backfill of new intent columns for rows that existed at the time." }],
  "0140_serper_control.sql": [{ table: "serper_control", classification: "historical_one_time", reason: "predates the canonical Serper gateway singleton pattern (.agents/memory/serper-gateway.md); superseded by 0174's provider_controls row, which IS a registered target family." }],
  "0141_serper_merchant_cooldown.sql": [{ table: "sdr_merchants", classification: "historical_one_time", reason: "one-time UPDATE resetting cooldown state for merchants that existed at the time." }],
  "0148_statement_upload_command_ownership.sql": [{ table: "statement_upload_commands", classification: "historical_one_time", reason: "one-time backfill of a new ownership column for commands that existed at the time." }],
  "0160_seed_zerobounce_provider_control.sql": [{ table: "provider_controls", classification: "historical_one_time", reason: "superseded by later provider_controls rows (0174, 0177) covering the same singleton-per-provider pattern; the ZeroBounce validation safety net (.agents/memory/zerobounce-validation-safety.md) fails closed independent of this row's presence." }],
  "0164_bt12_effect_receipts_and_threshold_backfill.sql": [{ table: "residual_imports", classification: "historical_one_time", reason: "one-time backfill of a new threshold column for imports that existed at the time." }],
  "0174_cro03_durable_enrichment_factory.sql": [{ table: "provider_controls", classification: "historical_one_time", reason: "one-time provider_controls row for the CRO-03 enrichment factory's original launch configuration; provider_controls rows going forward are operator/service managed, not re-seeded." }],
  "0177_cro03_source_staging_evidence.sql": [{ table: "provider_controls", classification: "not_config_seed", reason: "this migration's UPDATE of provider_controls (as opposed to its cro03_staging_recipes INSERT, which IS a registered target) only adjusts an existing row's flag and is not itself required seed data." }],
  "0175_cro03_frozen_subject_plans.sql": [
    { table: "cro03_enrichment_batches", classification: "historical_one_time", reason: "one-time repair backfilling a command_fingerprint/count columns for batch rows that existed at the time; transient job state, not config." },
    { table: "cro03_batch_memberships", classification: "historical_one_time", reason: "one-time repair marking pre-existing memberships without frozen evidence as superseded; transient job state tied to that specific migration window." },
    { table: "cro03_enrichment_items", classification: "historical_one_time", reason: "one-time repair terminating pre-existing enrichment items lacking frozen evidence; transient job state, not config." },
  ],
  "0187_cro03a_candidate_qualification.sql": [{ table: "audit_logs", classification: "not_config_seed", reason: "append-only audit trail entry for the policy activation; not itself config any runtime path depends on. The cro03a_policy_bootstrap convergence target (server/services/cro03a-policy-initializer.ts) independently re-writes this same idempotent audit row." }],
  "0186_cr06_scoped_reservation_contract.sql": [{ table: "cr06_preparation_reservations", classification: "historical_one_time", reason: "one-time backfill of new reservation-scope columns for rows that existed at the time." }],
  "0199_cro03c_opaque_stage_inputs.sql": [{ table: "cro03c_stage_dispositions", classification: "historical_one_time", reason: "one-time backfill of a new disposition column for stage rows that existed at the time." }],
  "0016_referral_converted_at.sql": [{ table: "referrals", classification: "historical_one_time", reason: "one-time UPDATE approximating converted_at from updated_at for referrals that existed at the time this column was added; new referrals set converted_at at write time." }],
  "0024_terminal_economics.sql": [{ table: "equipment_models", classification: "historical_one_time", reason: "initial equipment catalog seed from feature launch; equipment_models rows are operator-managed via the admin UI afterward, not re-seeded on every deploy." }],
  "0065_provenance_schema.sql": [{ table: "contacts", classification: "historical_one_time", reason: "one-time UPDATE defaulting primary_source_category/primary_source_type to legacy_unknown/historical_backfill for contacts that existed before the intake provenance system (.agents/memory/intake-provenance.md); new contacts get real provenance at write time via writeContact()." }],
  "0152_identity_observation_no_plaintext.sql": [{ table: "contact_identity_observations", classification: "not_config_seed", reason: "one-time privacy redaction of plaintext normalized_value on rows created during the initial migration window; not config any runtime path depends on being present." }],
};

function stripFunctionBodies(sqlText: string): string {
  // Removes $$...$$ / $tag$...$tag$ delimited plpgsql bodies that belong to a
  // CREATE FUNCTION definition (always written `... AS $$ ... $$`) so
  // trigger/function definitions are not mistaken for migration-time
  // INSERT/UPDATE statements. Anonymous `DO $$ ... $$` blocks are
  // deliberately NOT stripped here — Postgres's DO statement syntax never
  // has "AS" before its body delimiter, so this regex leaves them intact,
  // and several migrations (e.g. 0170's CRO-02 purpose-policy loop) seed
  // real production-required rows from inside exactly such a block.
  return sqlText.replace(/\bAS\s*\$[a-zA-Z_]*\$[\s\S]*?\$[a-zA-Z_]*\$/gi, " ");
}

/**
 * Best-effort extraction of the literal `(VALUES (...), (...), ...) AS
 * alias(col1, col2, ...)` derived-table rows used by a `FOR item IN SELECT *
 * FROM (VALUES ...) AS expected(...) LOOP` seed pattern (e.g. migration
 * 0170's CRO-02 purpose-policy loop), keyed by alias column name. Returns
 * null if no such construct is found.
 */
function extractLoopDerivedTableRows(sqlText: string): { aliasColumns: string[]; rows: string[][] } | null {
  const m = sqlText.match(/FOR\s+\w+\s+IN\s+SELECT\s+\*\s+FROM\s*\(\s*VALUES\s*([\s\S]*?)\)\s*AS\s+\w+\s*\(([^)]*)\)/i);
  if (!m) return null;
  const aliasColumns = m[2].split(",").map((c) => c.trim().toLowerCase());
  const tupleText = m[1];
  const rowsOut: string[][] = [];
  for (const rowMatch of tupleText.matchAll(/\(([^()]*)\)/g)) {
    const parts = rowMatch[1].split(",").map((v) => v.trim().replace(/^'(.*)'$/, "$1"));
    rowsOut.push(parts);
  }
  if (rowsOut.length === 0) return null;
  return { aliasColumns, rows: rowsOut };
}

function findSeedWrites(sqlText: string): { table: string; kind: "INSERT" | "UPDATE"; insertClause?: string; loopSourceText?: string }[] {
  const stripped = stripFunctionBodies(sqlText);
  const found: { table: string; kind: "INSERT" | "UPDATE"; insertClause?: string; loopSourceText?: string }[] = [];
  // Table identifiers may or may not be double-quoted (`INSERT INTO "referrals"`
  // vs `INSERT INTO cro03_staging_recipes`) — both forms appear across this
  // repo's migrations, so both must be matched or a write silently escapes
  // detection entirely (found neither registered nor exempt, but also never
  // flagged as a failure). The capture group strips the quotes either way.
  for (const m of stripped.matchAll(/INSERT\s+INTO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([^)]*)\)\s*(?:SELECT[\s\S]*?(?=;)|VALUES\s*\(([^;]*?)\)\s*(?:ON CONFLICT[^;]*)?)/gi)) {
    // If this INSERT's own VALUES(...) references a loop variable
    // (`item.col`, `expected.col`, etc.) rather than only literals, pass the
    // whole surrounding source so a caller checking seedKeys can resolve
    // those references against a preceding `FOR ... IN SELECT * FROM
    // (VALUES ...) AS alias(...)` derived table in the same file.
    const referencesLoopVar = /\b\w+\.\w+\b/.test(m[3] ?? "");
    found.push({ table: m[1].toLowerCase(), kind: "INSERT", insertClause: m[0], loopSourceText: referencesLoopVar ? stripped : undefined });
  }
  for (const m of stripped.matchAll(/\bUPDATE\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+SET/gi)) {
    found.push({ table: m[1].toLowerCase(), kind: "UPDATE" });
  }
  // De-dupe by table+kind — one migration touching the same table twice only
  // needs one registration/exemption entry, but keep the first insertClause
  // seen for key-value extraction.
  const seen = new Map<string, { table: string; kind: "INSERT" | "UPDATE"; insertClause?: string; loopSourceText?: string }>();
  for (const f of found) {
    const key = `${f.kind}:${f.table}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/**
 * For an INSERT whose VALUES(...) references a `FOR item IN SELECT * FROM
 * (VALUES ...) AS alias(cols) LOOP` derived table (see
 * extractLoopDerivedTableRows), resolve each requested key column to its
 * actual set of literal values across every loop row. Returns null if the
 * INSERT's value expression for any requested key column can be resolved
 * neither as a literal nor as a loop-variable reference into the derived
 * table (a shape this parser does not understand — callers must not treat
 * that as a pass).
 */
function extractLoopInsertKeyTuples(insertClause: string, loopSourceText: string, keyColumns: string[]): string[][] | null {
  const m = insertClause.match(/INSERT\s+INTO\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?\s*\(([^)]*)\)\s*VALUES\s*\(([^;]*?)\)\s*(?:ON CONFLICT[^;]*)?$/i);
  if (!m) return null;
  const insertColumns = m[1].split(",").map((c) => c.trim().toLowerCase());
  const insertValues = m[2].split(",").map((v) => v.trim());
  if (insertColumns.length !== insertValues.length) return null;
  const derived = extractLoopDerivedTableRows(loopSourceText);
  if (!derived) return null;

  // Per requested key column: either a literal in the INSERT's own VALUES
  // list, or a `<loopVar>.<aliasCol>` reference resolved per derived-table row.
  const perColumnResolvers: ((rowIndex: number) => string | null)[] = [];
  for (const keyCol of keyColumns) {
    const idx = insertColumns.indexOf(keyCol);
    if (idx === -1) return null; // this INSERT doesn't even set the key column — not this target's shape
    const rawValue = insertValues[idx];
    const varRefMatch = rawValue.match(/^\w+\.(\w+)$/);
    if (varRefMatch) {
      const aliasCol = varRefMatch[1].toLowerCase();
      const aliasIdx = derived.aliasColumns.indexOf(aliasCol);
      if (aliasIdx === -1) return null;
      perColumnResolvers.push((rowIndex) => derived.rows[rowIndex]?.[aliasIdx] ?? null);
    } else {
      const literal = rawValue.replace(/::\w+$/, "").replace(/^'(.*)'$/, "$1").trim();
      perColumnResolvers.push(() => literal);
    }
  }
  const tuples: string[][] = [];
  for (let i = 0; i < derived.rows.length; i++) {
    const tuple = perColumnResolvers.map((resolve) => resolve(i));
    if (tuple.some((v) => v === null)) return null;
    tuples.push(tuple as string[]);
  }
  return tuples;
}

/**
 * Best-effort extraction of literal column=>value pairs from an `INSERT INTO
 * table(col1, col2, ...) VALUES (val1, val2, ...)` statement, used to check
 * a registered target's `seedKeys` (see production-seed-convergence.ts). Only
 * handles literal VALUES(...) inserts with simple scalar literals (numbers,
 * quoted strings) — INSERT...SELECT backfills are historical_backfill-style
 * writes without a pinned literal key and are not checked this way.
 */
function extractInsertColumnValues(insertClause: string): Map<string, string> | null {
  const m = insertClause.match(/INSERT\s+INTO\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?\s*\(([^)]*)\)\s*VALUES\s*\(([^;]*?)\)\s*(?:ON CONFLICT[^;]*)?$/i);
  if (!m) return null;
  const columns = m[1].split(",").map((c) => c.trim().toLowerCase());
  // Split top-level commas only (values may contain nested casts like
  // '...'::jsonb but no nested parens/commas in the literals we care about).
  const values = m[2].split(",").map((v) => v.trim());
  if (columns.length !== values.length) return null;
  const map = new Map<string, string>();
  columns.forEach((c, i) => {
    let v = values[i];
    v = v.replace(/::\w+$/, "").trim(); // strip trailing type cast
    v = v.replace(/^'(.*)'$/, "$1"); // unquote string literal
    map.set(c, v);
  });
  return map;
}

function main(): number {
  const targetsByTable = new Map<string, typeof SEED_TARGETS[number][]>();
  for (const t of SEED_TARGETS) {
    for (const tb of t.tables) {
      const key = tb.toLowerCase();
      targetsByTable.set(key, [...(targetsByTable.get(key) ?? []), t]);
    }
  }
  const files = fs.readdirSync(MIGRATIONS_ROOT).filter((f) => f.endsWith(".sql")).sort();

  const failures: string[] = [];
  const passed: string[] = [];

  for (const file of files) {
    const text = fs.readFileSync(path.join(MIGRATIONS_ROOT, file), "utf8");
    const writes = findSeedWrites(text);
    if (writes.length === 0) continue;

    const exempt = KNOWN_EXEMPT_SEEDS[file] ?? [];
    const exemptTables = new Set(exempt.map((e) => e.table));

    for (const write of writes) {
      const registeredTargets = targetsByTable.get(write.table);
      if (registeredTargets) {
        // Registered table. For INSERTs with a pinned seedKeys registration
        // (immutable_revision_seed targets), also require the migration's
        // actual literal key-column values to be ones this module's
        // converge function is coded to handle — a table-level match alone
        // is not enough to catch a later migration seeding a NEW,
        // unhandled version/key row into an already-registered table.
        const keyedTargets = registeredTargets.filter((t) => t.seedKeys);
        if (write.kind === "INSERT" && write.insertClause && keyedTargets.length > 0) {
          // If the INSERT's own VALUES(...) referenced a loop variable (e.g.
          // `item.purpose`), that reference is not itself a literal — check
          // the loop-derived-table path FIRST, or extractInsertColumnValues
          // below would treat "item.purpose" as if it were literally the
          // string value "item.purpose" and always fail the key-match check.
          const literalValues = write.loopSourceText ? null : extractInsertColumnValues(write.insertClause);
          if (literalValues) {
            const matchesAnyRegisteredKey = keyedTargets.some((t) => {
              const sk = t.seedKeys!;
              if (!sk.columns.every((c) => literalValues.has(c))) return true; // key columns not in this literal INSERT's column list — not this target's shape, don't false-fail
              const actual = sk.columns.map((c) => literalValues.get(c));
              return sk.values.some((registered) => registered.every((v, i) => v === actual[i]));
            });
            if (!matchesAnyRegisteredKey) {
              failures.push(
                `${file}: INSERT INTO ${write.table} seeds a key value not covered by any registered ` +
                `seedKeys in server/services/production-seed-convergence.ts (checked: ${keyedTargets.map((t) => t.id).join(", ")}). ` +
                `A new immutable_revision_seed version/key must be added to that target's convergence logic ` +
                `and registered in its seedKeys before this migration can ship, or production will silently ` +
                `never converge this new row.`,
              );
              continue;
            }
          } else if (write.loopSourceText) {
            // Not a plain literal VALUES(...) INSERT — this migration's write
            // came from a `FOR item IN SELECT * FROM (VALUES ...) AS
            // alias(...) LOOP` multi-row seed pattern (e.g. 0170's CRO-02
            // purpose policies). Resolve each registered target's key
            // columns against the loop's own derived-table literal rows so a
            // future migration adding a new row to that same loop, or a new
            // purpose/version outside the registered set, is still caught.
            for (const t of keyedTargets) {
              const sk = t.seedKeys!;
              const tuples = extractLoopInsertKeyTuples(write.insertClause, write.loopSourceText, sk.columns);
              if (!tuples) {
                failures.push(
                  `${file}: INSERT INTO ${write.table} seeds rows via a pattern this static checker cannot ` +
                  `parse (not a plain literal VALUES(...) insert, and not a recognized ` +
                  `\`FOR item IN SELECT * FROM (VALUES ...) AS alias(...)\` loop). Registered seedKeys for ` +
                  `${t.id} cannot be verified against this migration — rewrite the seed as one of those two ` +
                  `forms, or extend extractLoopInsertKeyTuples in scripts/check-migration-seed-registration.ts ` +
                  `to understand this shape, before this migration can ship undetected.`,
                );
                continue;
              }
              const unmatched = tuples.filter((actual) => !sk.values.some((registered) => registered.every((v, i) => v === actual[i])));
              if (unmatched.length > 0) {
                failures.push(
                  `${file}: INSERT INTO ${write.table} loop seeds key value(s) ${JSON.stringify(unmatched)} not ` +
                  `covered by ${t.id}'s registered seedKeys in server/services/production-seed-convergence.ts. ` +
                  `A new immutable_revision_seed version/key must be added to that target's convergence logic ` +
                  `and registered in its seedKeys before this migration can ship, or production will silently ` +
                  `never converge this new row.`,
                );
              }
            }
          }
        }
        passed.push(`${file}: ${write.kind} ${write.table} — registered convergence target`);
        continue;
      }
      if (exemptTables.has(write.table)) {
        const entry = exempt.find((e) => e.table === write.table)!;
        passed.push(`${file}: ${write.kind} ${write.table} — exempt (${entry.classification}: ${entry.reason})`);
        continue;
      }
      failures.push(
        `${file}: ${write.kind} INTO/SET ${write.table} has no registered convergence target in ` +
        `server/services/production-seed-convergence.ts and no exemption entry in ` +
        `scripts/check-migration-seed-registration.ts's KNOWN_EXEMPT_SEEDS. If this write seeds ` +
        `production-required config, add a convergence target. If it is a one-time historical ` +
        `backfill or non-config write, add a classified exemption entry with a reason.`,
      );
    }
  }

  console.log(`[check-migration-seed-registration] Scanned ${files.length} migration files.`);
  console.log(`[check-migration-seed-registration] ${passed.length} seed write(s) accounted for.`);
  for (const p of passed) console.log(`  OK   ${p}`);
  if (failures.length > 0) {
    console.error(`\n[check-migration-seed-registration] FAIL — ${failures.length} unregistered seed write(s):`);
    for (const f of failures) console.error(`  FAIL ${f}`);
    return 1;
  }
  console.log("\n[check-migration-seed-registration] PASS — every migration seed/backfill write is registered or exempted.");
  return 0;
}

process.exit(main());
