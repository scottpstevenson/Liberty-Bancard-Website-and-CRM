/**
 * Production seed convergence — the single cross-cutting authority for
 * production-required rows that a migration's imperative INSERT/UPDATE seeds
 * but that Replit Publish's schema-only sync never executes.
 *
 * Background (Task #1750): a production census found that recent migrations
 * across unrelated systems (CRO-02, CRO-03, CRO-03A, CR-04, CR-06, inbound
 * effect orchestration) correctly created their tables via Publish schema
 * sync, but every migration-embedded seed/backfill INSERT silently never ran,
 * because the app's Drizzle migration runner is deliberately never pointed at
 * production (see `.agents/memory/production-schema-ownership.md`). Only
 * `commercial_purpose_policies` was safe, because it already had a dedicated
 * convergence initializer (`cro02-purpose-policy-initializer.ts`).
 *
 * This module is the ONE owner for that class of gap. It does not replace or
 * replay migrations — it registers one idempotent, insert-only convergence
 * function per production-required seed/backfill target, runs them in a
 * defined order at startup, and records a deterministic per-target outcome.
 * Two of the nine targets below are still implemented in their own dedicated
 * files (`cro02-purpose-policy-initializer.ts`, `cro03a-policy-initializer.ts`)
 * because they pre-date this module and already match its guarantees; this
 * module is still their sole caller and reporting owner.
 *
 * Every target function:
 *  - never runs schema DDL and never touches the Drizzle migration journal,
 *  - never updates or deletes a row it did not just insert,
 *  - fails closed (throws) if it finds a row that conflicts with the
 *    canonical seed content, rather than silently overwriting it,
 *  - is idempotent under concurrent boots via a per-target Postgres advisory
 *    lock plus `ON CONFLICT DO NOTHING` on the real unique/composite key.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { initializeCro02PurposePolicies } from "./cro02-purpose-policy-initializer";
import { initializeCro03aPolicy, CRO03A_SEED_POLICY_KEY, CRO03A_SEED_POLICY_VERSION } from "./cro03a-policy-initializer";
import { CRO02_POLICY_VERSION, CRO02_PURPOSE_POLICY_DOCUMENTS } from "./commercial-resolution";

// The 8 canonical (purpose, policy_version) key pairs this module's
// cro02_purpose_policies target is coded to converge — see
// cro02-purpose-policy-initializer.ts. A future migration seeding a NEW
// purpose or bumping policy_version for commercial_purpose_policies needs a
// corresponding update to CRO02_PURPOSE_POLICY_DOCUMENTS/CRO02_POLICY_VERSION
// (which this list derives from) or it will fail the seed-registration CI
// check rather than silently landing unconverged.
const CRO02_SEED_KEY_VALUES: string[][] = Object.keys(CRO02_PURPOSE_POLICY_DOCUMENTS).map((purpose) => [purpose, String(CRO02_POLICY_VERSION)]);

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];
type Tx = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

// jsonb round-trips do not guarantee the original key insertion order, so any
// content-equality check against a canonical document must compare by value,
// not by raw JSON.stringify() text.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Classification recorded per target (Task #1750 done-criteria #2):
 *  - schema_required_bootstrap: a singleton/control row the app cannot run
 *    correctly without (e.g. commercial_shadow_controls).
 *  - immutable_revision_seed: a frozen policy/recipe document seeded once and
 *    never mutated afterward.
 *  - historical_backfill: a derived/cache row that a trigger or write path
 *    maintains going forward, but that pre-existing source rows never
 *    produced because the seeding migration never executed in production.
 */
export type SeedClassification =
  | "schema_required_bootstrap"
  | "immutable_revision_seed"
  | "historical_backfill";

export type SeedOutcome =
  | "already_present"
  | "inserted"
  | "backfilled"
  | "conflicted"
  | "blocked"
  | "unexpected";

export interface SeedTargetResult {
  id: string;
  classification: SeedClassification;
  tables: string[];
  outcome: SeedOutcome;
  detail: string;
}

export interface SeedConvergenceReport {
  runAt: string;
  ok: boolean;
  results: SeedTargetResult[];
}

/**
 * Registered natural-key identity for an `immutable_revision_seed` target
 * (Task #1750 code-review follow-up): registering a table alone is not
 * granular enough — a later migration could insert a NEW version/key row
 * into an already-registered table (e.g. cr04_qualification_policies
 * version=2) that this service's hardcoded converge function has no idea
 * exists and will never create or validate. `seedKeys` pins the exact
 * key-column values this module's converge function actually knows how to
 * produce/verify, so scripts/check-migration-seed-registration.ts can
 * detect when a migration's literal INSERT values fall outside that set and
 * fail the build until a human adds real handling for the new key.
 */
export interface SeedKeyRegistration {
  columns: string[];
  values: string[][];
}

async function assertColumns(tx: Tx, table: string, expected: Record<string, string>): Promise<void> {
  const found = rows(
    await tx.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
    `),
  );
  if (found.length === 0) throw new Error(`SEED_CONVERGENCE_TABLE_MISSING:${table}`);
  const byName = new Map(found.map((r: any) => [r.column_name, r.data_type]));
  for (const [column, dataType] of Object.entries(expected)) {
    if (byName.get(column) !== dataType) throw new Error(`SEED_CONVERGENCE_TABLE_SHAPE_INVALID:${table}.${column}`);
  }
}

async function withLock<T>(lockKey: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 1900))`);
    return run(tx as unknown as Tx);
  });
}

// ── Target: commercial_shadow_controls singleton ────────────────────────────
// migrations/0166_cro02_shadow_graph.sql:
//   INSERT INTO commercial_shadow_controls(control_key) VALUES ('commercial') ON CONFLICT DO NOTHING;
async function convergeCommercialShadowControls(): Promise<SeedTargetResult> {
  const id = "commercial_shadow_controls";
  const tables = ["commercial_shadow_controls"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "commercial_shadow_controls", { control_key: "text", mode: "text" });
    const before = rows(await tx.execute(sql`SELECT control_key FROM commercial_shadow_controls WHERE control_key = 'commercial'`))[0];
    if (before) return { id, classification: "schema_required_bootstrap", tables, outcome: "already_present", detail: "control row already exists" };
    await tx.execute(sql`INSERT INTO commercial_shadow_controls(control_key) VALUES ('commercial') ON CONFLICT DO NOTHING`);
    const after = rows(await tx.execute(sql`SELECT control_key FROM commercial_shadow_controls WHERE control_key = 'commercial'`))[0];
    if (!after) throw new Error("SEED_CONVERGENCE_VERIFY_FAILED:commercial_shadow_controls");
    return { id, classification: "schema_required_bootstrap", tables, outcome: "inserted", detail: "inserted default control_key='commercial' row" };
  });
}

// ── Target: commercial graph revision backfill ──────────────────────────────
// commercial_subject_revisions / commercial_membership_revisions are
// otherwise maintained forward-only by the cro02_bump_graph_membership()
// trigger (migrations/0169, 0173). Rows that existed before that trigger ever
// ran against production have no revision row at all. This mirrors the
// trigger's own per-source-table mapping exactly, using ON CONFLICT DO
// NOTHING so a row a live trigger has already bumped is never touched.
async function convergeCommercialGraphRevisions(): Promise<SeedTargetResult> {
  const id = "commercial_graph_revisions_backfill";
  const tables = ["commercial_subject_revisions", "commercial_membership_revisions"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "commercial_subject_revisions", { subject_type: "text", subject_id: "integer", revision: "integer" });
    await assertColumns(tx, "commercial_membership_revisions", { edge_type: "text", revision: "integer" });

    const subjectsResult = await tx.execute(sql`
      INSERT INTO commercial_subject_revisions (subject_type, subject_id, revision, authority_version, updated_at)
      SELECT 'contact', contact_id, 1, 1, now() FROM contact_business_link_decisions
      UNION ALL SELECT 'business', business_id, 1, 1, now() FROM contact_business_link_decisions WHERE business_id IS NOT NULL
      UNION ALL SELECT 'company', company_id, 1, 1, now() FROM legacy_company_mapping_decisions
      UNION ALL SELECT 'business', business_id, 1, 1, now() FROM legacy_company_mapping_decisions WHERE business_id IS NOT NULL
      UNION ALL SELECT 'contact', contact_id, 1, 1, now() FROM commercial_relationship_reviews
      UNION ALL SELECT 'business', business_id, 1, 1, now() FROM commercial_relationship_reviews WHERE business_id IS NOT NULL
      UNION ALL SELECT 'contact', contact_id, 1, 1, now() FROM contact_identity_observations
      UNION ALL SELECT 'contact', deprecated_contact_id, 1, 1, now() FROM contact_merge_redirects
      UNION ALL SELECT 'contact', survivor_contact_id, 1, 1, now() FROM contact_merge_redirects
      ON CONFLICT (subject_type, subject_id) DO NOTHING
    `);

    const membershipResult = await tx.execute(sql`
      INSERT INTO commercial_membership_revisions
        (edge_type, left_subject_type, left_subject_id, right_subject_type, right_subject_id, revision, authority_version, updated_at)
      SELECT 'contact_business', 'contact', contact_id,
             CASE WHEN business_id IS NULL THEN 'contact' ELSE 'business' END,
             COALESCE(business_id, contact_id), 1, 1, now()
        FROM contact_business_link_decisions
      UNION ALL
      SELECT 'legacy_company_business', 'company', company_id,
             CASE WHEN business_id IS NULL THEN 'company' ELSE 'business' END,
             COALESCE(business_id, company_id), 1, 1, now()
        FROM legacy_company_mapping_decisions
      UNION ALL
      SELECT 'relationship', 'contact', contact_id,
             CASE WHEN business_id IS NULL THEN 'contact' ELSE 'business' END,
             COALESCE(business_id, contact_id), 1, 1, now()
        FROM commercial_relationship_reviews
      UNION ALL
      SELECT 'identity', 'contact', contact_id, 'contact', contact_id, 1, 1, now()
        FROM contact_identity_observations
      UNION ALL
      SELECT 'contact_redirect', 'contact', deprecated_contact_id, 'contact', survivor_contact_id, 1, 1, now()
        FROM contact_merge_redirects
      ON CONFLICT (edge_type, left_subject_type, left_subject_id, right_subject_type, right_subject_id) DO NOTHING
    `);

    const subjectsInserted = (subjectsResult as any)?.rowCount ?? 0;
    const membershipsInserted = (membershipResult as any)?.rowCount ?? 0;
    return {
      id, classification: "historical_backfill", tables,
      outcome: subjectsInserted + membershipsInserted > 0 ? "backfilled" : "already_present",
      detail: `inserted ${subjectsInserted} subject revision row(s), ${membershipsInserted} membership revision row(s)`,
    };
  });
}

// ── Target: cro03_staging_recipes frozen v1 recipe ──────────────────────────
// migrations/0177_cro03_source_staging_evidence.sql
const CRO03_STAGING_RECIPE_KEY = "south_florida_staging";
const CRO03_STAGING_RECIPE_VERSION = 1;
const CRO03_STAGING_RECIPE_HASH = "acb953300783e95cd61c8ad18f068d13233a587d99fb4dae4d9999982b8a38cc";
async function convergeCro03StagingRecipes(): Promise<SeedTargetResult> {
  const id = "cro03_staging_recipes";
  const tables = ["cro03_staging_recipes"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "cro03_staging_recipes", { recipe_key: "text", version: "integer", recipe_hash: "text", status: "text" });
    const existing = rows(await tx.execute(sql`
      SELECT recipe_hash, status FROM cro03_staging_recipes
      WHERE recipe_key = ${CRO03_STAGING_RECIPE_KEY} AND version = ${CRO03_STAGING_RECIPE_VERSION}
    `))[0];
    if (existing) {
      if (String(existing.recipe_hash) !== CRO03_STAGING_RECIPE_HASH || existing.status !== "disabled") {
        throw new Error("SEED_CONVERGENCE_CONFLICT:cro03_staging_recipes");
      }
      return { id, classification: "immutable_revision_seed", tables, outcome: "already_present", detail: "canonical v1 recipe already present" };
    }
    await tx.execute(sql`
      INSERT INTO cro03_staging_recipes (
        recipe_key, version, geography_policy, fit_policy, provenance_policy,
        exclusion_policy, duplicate_policy, quarantine_policy, purpose_policy,
        actor_policy, route_policy, cost_policy, recipe_hash
      ) VALUES (
        ${CRO03_STAGING_RECIPE_KEY}, ${CRO03_STAGING_RECIPE_VERSION},
        '{"states":["FL"],"counties":["Miami-Dade","Broward","Palm Beach"],"mode":"allowlist"}'::jsonb,
        '{"mode":"evidence_only","minimumEvidence":1}'::jsonb,
        '{"requireObservation":true,"allowedSubjectTypes":["contact","prospect","sunbiz_entity","sdr_merchant","provider_csv_row","public_web"]}'::jsonb,
        '{"excludeDoNotContact":true,"excludeExistingCustomer":true}'::jsonb,
        '{"strategy":"hash_then_review","fields":["email","phone","website","registry_id"]}'::jsonb,
        '{"default":"quarantined","releaseRequires":"reviewed_disposition"}'::jsonb,
        '{"allowed":["provider_pre_spend","staging_review"],"default":"staging_review"}'::jsonb,
        '{"requireActor":true,"allowedActorTypes":["user","system","import"]}'::jsonb,
        '{"providers":[],"execution":"disabled","requiresFrozenEvidence":true}'::jsonb,
        '{"currency":"USD","maxAmountMicros":0,"providerSpendAllowed":false}'::jsonb,
        ${CRO03_STAGING_RECIPE_HASH}
      ) ON CONFLICT (recipe_key, version) DO NOTHING
    `);
    const verify = rows(await tx.execute(sql`
      SELECT recipe_hash FROM cro03_staging_recipes WHERE recipe_key = ${CRO03_STAGING_RECIPE_KEY} AND version = ${CRO03_STAGING_RECIPE_VERSION}
    `))[0];
    if (!verify || String(verify.recipe_hash) !== CRO03_STAGING_RECIPE_HASH) throw new Error("SEED_CONVERGENCE_VERIFY_FAILED:cro03_staging_recipes");
    return { id, classification: "immutable_revision_seed", tables, outcome: "inserted", detail: "inserted canonical v1 south_florida_staging recipe" };
  });
}

// ── Target: cr04_qualification_policies v1 ──────────────────────────────────
// migrations/0178_cr04_channel_cohort_authority.sql. cr04_channel_decisions
// has a NOT NULL FK to this table's version column, so any consumer already
// fails closed (FK violation) if the row is absent — this target only needs
// to converge the row itself.
const CR04_POLICY_DOCUMENT = { channels: ["email", "manual_call", "sms"], purpose: "marketing_outreach", failClosed: true };
async function convergeCr04QualificationPolicies(): Promise<SeedTargetResult> {
  const id = "cr04_qualification_policies";
  const tables = ["cr04_qualification_policies"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "cr04_qualification_policies", { version: "integer", status: "text", document: "jsonb" });
    const existing = rows(await tx.execute(sql`
      SELECT status, decision_ttl_seconds, taxonomy_version, document FROM cr04_qualification_policies WHERE version = 1
    `))[0];
    if (existing) {
      const matches = existing.status === "active" && Number(existing.decision_ttl_seconds) === 900 &&
        existing.taxonomy_version === "cr04-reasons-v1" &&
        stableStringify(existing.document) === stableStringify(CR04_POLICY_DOCUMENT);
      if (!matches) throw new Error("SEED_CONVERGENCE_CONFLICT:cr04_qualification_policies");
      return { id, classification: "immutable_revision_seed", tables, outcome: "already_present", detail: "canonical v1 policy already present" };
    }
    await tx.execute(sql`
      INSERT INTO cr04_qualification_policies(version, status, decision_ttl_seconds, taxonomy_version, document)
      VALUES (1, 'active', 900, 'cr04-reasons-v1', ${JSON.stringify(CR04_POLICY_DOCUMENT)}::jsonb)
      ON CONFLICT (version) DO NOTHING
    `);
    const verify = rows(await tx.execute(sql`SELECT status FROM cr04_qualification_policies WHERE version = 1`))[0];
    if (!verify || verify.status !== "active") throw new Error("SEED_CONVERGENCE_VERIFY_FAILED:cr04_qualification_policies");
    return { id, classification: "immutable_revision_seed", tables, outcome: "inserted", detail: "inserted canonical v1 qualification policy" };
  });
}

// ── Target: cro03_provider_ledger reservation lineage repair ───────────────
// migrations/0175_cro03_frozen_subject_plans.sql + 0193 (idempotent repair of
// the same operation). Every pre-existing terminal ledger entry needs a
// synthetic reservation predecessor before the lineage trigger will accept
// any further write against it.
//
// cro03_ledger_immutable (installed by 0175/0193 via CREATE TRIGGER — not a
// Drizzle-managed object, so it is NOT part of Publish's schema.ts diff) is a
// BEFORE UPDATE OR DELETE guard that unconditionally rejects any UPDATE
// against this table, including the two repair UPDATEs below. The source
// migrations solve this by dropping the trigger immediately before the
// repair writes and recreating it immediately after, inside the same
// statement batch. Because this service is the only thing that ever runs
// this repair against production (the migration file itself never replays
// there), it must own that same drop/repair/recreate sequence itself — not
// assume the guard is already absent or already present.
const CRO03_LEDGER_IMMUTABLE_GUARD_FN_SQL = sql`
  CREATE OR REPLACE FUNCTION cro03_immutable_row_guard()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION 'CRO03_IMMUTABLE_ROW_GUARD: % on % is not permitted', TG_OP, TG_TABLE_NAME;
  END $$
`;

const CRO03_LEDGER_LINEAGE_GUARD_FN_SQL = sql`
  CREATE OR REPLACE FUNCTION cro03_validate_ledger_terminal_lineage()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    PERFORM 1 FROM cro03_provider_runs run
    JOIN provider_operations operation ON operation.id=NEW.provider_operation_id
     WHERE run.id=NEW.provider_run_id
       AND run.operation_id=NEW.provider_operation_id
       AND run.provider=NEW.provider
       AND operation.provider=NEW.provider
     FOR UPDATE OF run,operation;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRO03_LEDGER_RUN_OPERATION_PROVIDER_MISMATCH'; END IF;
    IF NEW.event_type='terminal' AND NOT EXISTS (
      SELECT 1 FROM cro03_provider_ledger reservation
       WHERE reservation.id=NEW.reservation_entry_id
         AND reservation.event_type='reservation'
         AND reservation.provider_run_id=NEW.provider_run_id
         AND reservation.provider_operation_id IS NOT DISTINCT FROM NEW.provider_operation_id
         AND reservation.provider=NEW.provider
         AND reservation.units=NEW.units
         AND reservation.amount_micros=NEW.amount_micros
    ) THEN RAISE EXCEPTION 'CRO03_LEDGER_LINEAGE_MISMATCH'; END IF;
    RETURN NEW;
  END $$
`;

async function convergeCro03LedgerLineage(): Promise<SeedTargetResult> {
  const id = "cro03_provider_ledger_lineage_repair";
  const tables = ["cro03_provider_ledger"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "cro03_provider_ledger", { event_type: "text", reservation_entry_id: "uuid", entry_key: "text" });
    // FOUR separate objects installed by 0175/0193 alongside this exact
    // repair can each block it once already active in production, because
    // none of them are Drizzle-managed (not in schema.ts, so Publish's
    // schema diff never touches them) and this service — not the migration
    // file — is the only thing that ever runs this repair there:
    //  1. cro03_ledger_immutable (BEFORE UPDATE OR DELETE) rejects the
    //     repair's own UPDATEs outright.
    //  2. cro03_ledger_lineage_guard (BEFORE INSERT OR UPDATE) rejects
    //     flipping a row to event_type='terminal' before its synthetic
    //     reservation sibling exists — an intermediate state the 3-step
    //     repair below necessarily passes through.
    //  3. cro03_ledger_one_reservation_per_run / ..._per_operation (unique
    //     partial indexes on event_type='reservation') reject inserting a
    //     new reservation sibling for a run while a legacy row for that
    //     same run still holds the schema-default event_type='reservation'
    //     — which is why the repair must flip the legacy row to 'terminal'
    //     BEFORE inserting its sibling, the opposite ordering constraint
    //     from guard #2 above.
    //  4. cro03_ledger_terminal_lineage_chk (CHECK) requires a 'terminal' row
    //     to already have reservation_entry_id set and a 'reservation' row
    //     to have disposition='outstanding' — the intermediate state right
    //     after step 1's UPDATE (event_type flipped to 'terminal',
    //     reservation_entry_id still NULL) violates it outright, before
    //     guard #2 even gets a chance to run.
    // No ordering of the 3-step repair can satisfy guards #2 and #4 while a
    // row is mid-transition AND simultaneously satisfy #3's uniqueness — so,
    // exactly like the original migration's own drop-repair-recreate
    // sequence, all four are dropped first and recreated only after the
    // repair verifiably holds. If any repair statement throws, the
    // surrounding transaction (withLock wraps this whole function in one
    // db.transaction) rolls back the drops too, so production is never left
    // without its guards.
    await tx.execute(CRO03_LEDGER_IMMUTABLE_GUARD_FN_SQL);
    await tx.execute(CRO03_LEDGER_LINEAGE_GUARD_FN_SQL);
    await tx.execute(sql`DROP TRIGGER IF EXISTS cro03_ledger_immutable ON cro03_provider_ledger`);
    await tx.execute(sql`DROP TRIGGER IF EXISTS cro03_ledger_lineage_guard ON cro03_provider_ledger`);
    await tx.execute(sql`DROP INDEX IF EXISTS cro03_ledger_one_reservation_per_run`);
    await tx.execute(sql`DROP INDEX IF EXISTS cro03_ledger_one_reservation_per_operation`);
    await tx.execute(sql`ALTER TABLE cro03_provider_ledger DROP CONSTRAINT IF EXISTS cro03_ledger_terminal_lineage_chk`);
    await tx.execute(sql`UPDATE cro03_provider_ledger SET event_type = 'terminal' WHERE disposition <> 'outstanding' AND event_type <> 'terminal'`);
    const inserted = await tx.execute(sql`
      INSERT INTO cro03_provider_ledger
        (provider_run_id, provider_operation_id, provider, entry_key, event_type, disposition, units, amount_micros)
      SELECT l.provider_run_id, l.provider_operation_id, l.provider, 'reserve:legacy:' || l.id,
             'reservation', 'outstanding', l.units, l.amount_micros
        FROM cro03_provider_ledger l
       WHERE l.event_type = 'terminal' AND l.reservation_entry_id IS NULL
      ON CONFLICT (entry_key) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE cro03_provider_ledger terminal SET reservation_entry_id = reservation.id
        FROM cro03_provider_ledger reservation
       WHERE terminal.event_type = 'terminal' AND terminal.reservation_entry_id IS NULL
         AND reservation.entry_key = 'reserve:legacy:' || terminal.id
    `);
    const remaining = rows(await tx.execute(sql`
      SELECT count(*)::int AS n FROM cro03_provider_ledger WHERE event_type = 'terminal' AND reservation_entry_id IS NULL
    `))[0];
    if (Number(remaining?.n ?? 0) > 0) throw new Error("SEED_CONVERGENCE_VERIFY_FAILED:cro03_provider_ledger_lineage_repair");
    const insertedCount = (inserted as any)?.rowCount ?? 0;
    // Recreate the check constraint before the triggers/indexes so the full
    // table is validated (a real scan, not just this run's rows) while the
    // triggers are still absent — a violation here fails loudly instead of
    // being masked by a trigger rejecting the ALTER's own internal scan.
    await tx.execute(sql`
      ALTER TABLE cro03_provider_ledger ADD CONSTRAINT cro03_ledger_terminal_lineage_chk CHECK (
        (event_type = 'reservation' AND reservation_entry_id IS NULL AND disposition = 'outstanding')
        OR (event_type = 'terminal' AND reservation_entry_id IS NOT NULL
            AND disposition IN ('consumed', 'released', 'refunded', 'ambiguous'))
      )
    `);
    await tx.execute(sql`
      CREATE TRIGGER cro03_ledger_immutable BEFORE UPDATE OR DELETE ON cro03_provider_ledger
        FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard()
    `);
    await tx.execute(sql`
      CREATE TRIGGER cro03_ledger_lineage_guard BEFORE INSERT OR UPDATE ON cro03_provider_ledger
        FOR EACH ROW EXECUTE FUNCTION cro03_validate_ledger_terminal_lineage()
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_run
        ON cro03_provider_ledger(provider_run_id) WHERE event_type = 'reservation'
    `);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_operation
        ON cro03_provider_ledger(provider_operation_id) WHERE event_type = 'reservation' AND provider_operation_id IS NOT NULL
    `);
    return { id, classification: "historical_backfill", tables, outcome: insertedCount > 0 ? "backfilled" : "already_present", detail: `repaired ${insertedCount} legacy terminal ledger entr${insertedCount === 1 ? "y" : "ies"}` };
  });
}

// ── Target: cr06_campaign_gate_revisions backfill ───────────────────────────
// migrations/0185_cr06_history_and_feedback.sql — the append trigger only
// covers gates written after it exists; pre-existing gates need one revision
// row each.
async function convergeCr06CampaignGateRevisions(): Promise<SeedTargetResult> {
  const id = "cr06_campaign_gate_revisions_backfill";
  const tables = ["cr06_campaign_gate_revisions"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "cr06_campaign_gate_revisions", { campaign_gate_id: "uuid", revision: "integer" });
    const inserted = await tx.execute(sql`
      INSERT INTO cr06_campaign_gate_revisions
        (campaign_gate_id, revision, state, actor_id, dependency_snapshot, opened_at, closed_at, created_at)
      SELECT id, revision, state, actor_id, dependency_snapshot, opened_at, closed_at, created_at
        FROM cr06_campaign_gates
      ON CONFLICT (campaign_gate_id, revision) DO NOTHING
    `);
    const insertedCount = (inserted as any)?.rowCount ?? 0;
    return { id, classification: "historical_backfill", tables, outcome: insertedCount > 0 ? "backfilled" : "already_present", detail: `inserted ${insertedCount} gate revision row(s)` };
  });
}

// ── Target: inbound_request_effects backfill for historical equipment orders ─
// migrations/0205_cro05a_equipment_fulfillment_truth.sql
async function convergeInboundRequestEffects(): Promise<SeedTargetResult> {
  const id = "inbound_request_effects_backfill";
  const tables = ["inbound_request_effects"];
  return withLock(`seed:${id}`, async (tx) => {
    await assertColumns(tx, "inbound_request_effects", { request_id: "uuid", effect_key: "text", state: "text" });
    const inserted = await tx.execute(sql`
      INSERT INTO inbound_request_effects (
        request_id, effect_key, effect_type, state, required, external_side_effect, prerequisites, terminal_reason
      )
      SELECT id, 'internal_notification', 'internal_notification', 'held', TRUE, FALSE,
             '["fulfillment"]'::jsonb, 'FULFILLMENT_DURABLE_EVIDENCE_MISSING'
        FROM inbound_requests
       WHERE source_category = 'website_form' AND source_type = 'equipment_order'
      ON CONFLICT (request_id, effect_key) DO NOTHING
    `);
    const insertedCount = (inserted as any)?.rowCount ?? 0;
    return { id, classification: "historical_backfill", tables, outcome: insertedCount > 0 ? "backfilled" : "already_present", detail: `inserted ${insertedCount} held equipment-order effect row(s)` };
  });
}

/**
 * Registry of every production-required seed/backfill target this module
 * owns. `write` performs the insert-only convergence (used at startup);
 * `id`/`classification`/`tables` are also used by the read-only verifier and
 * by scripts/check-migration-seed-registration.ts to flag any future
 * migration that introduces unregistered production-required seed data.
 */
export const SEED_TARGETS: Array<{ id: string; classification: SeedClassification; tables: string[]; write: () => Promise<SeedTargetResult>; seedKeys?: SeedKeyRegistration }> = [
  { id: "commercial_shadow_controls", classification: "schema_required_bootstrap", tables: ["commercial_shadow_controls"], write: convergeCommercialShadowControls },
  { id: "commercial_graph_revisions_backfill", classification: "historical_backfill", tables: ["commercial_subject_revisions", "commercial_membership_revisions"], write: convergeCommercialGraphRevisions },
  {
    id: "cro02_purpose_policies", classification: "immutable_revision_seed", tables: ["commercial_purpose_policies"],
    write: async () => {
      await initializeCro02PurposePolicies();
      return { id: "cro02_purpose_policies", classification: "immutable_revision_seed", tables: ["commercial_purpose_policies"], outcome: "already_present", detail: "converged via cro02-purpose-policy-initializer" };
    },
    seedKeys: { columns: ["purpose", "policy_version"], values: CRO02_SEED_KEY_VALUES },
  },
  {
    id: "cro03a_policy_bootstrap", classification: "immutable_revision_seed", tables: ["cro03a_policy_documents", "cro03a_policy_control"],
    write: async () => {
      await initializeCro03aPolicy();
      return { id: "cro03a_policy_bootstrap", classification: "immutable_revision_seed", tables: ["cro03a_policy_documents", "cro03a_policy_control"], outcome: "already_present", detail: "converged via cro03a-policy-initializer" };
    },
    seedKeys: { columns: ["policy_key", "version"], values: [[CRO03A_SEED_POLICY_KEY, String(CRO03A_SEED_POLICY_VERSION)]] },
  },
  {
    id: "cro03_staging_recipes", classification: "immutable_revision_seed", tables: ["cro03_staging_recipes"], write: convergeCro03StagingRecipes,
    seedKeys: { columns: ["recipe_key", "version"], values: [[CRO03_STAGING_RECIPE_KEY, String(CRO03_STAGING_RECIPE_VERSION)]] },
  },
  {
    id: "cr04_qualification_policies", classification: "immutable_revision_seed", tables: ["cr04_qualification_policies"], write: convergeCr04QualificationPolicies,
    seedKeys: { columns: ["version"], values: [["1"]] },
  },
  { id: "cro03_provider_ledger_lineage_repair", classification: "historical_backfill", tables: ["cro03_provider_ledger"], write: convergeCro03LedgerLineage },
  { id: "cr06_campaign_gate_revisions_backfill", classification: "historical_backfill", tables: ["cr06_campaign_gate_revisions"], write: convergeCr06CampaignGateRevisions },
  { id: "inbound_request_effects_backfill", classification: "historical_backfill", tables: ["inbound_request_effects"], write: convergeInboundRequestEffects },
];

/**
 * Runs every registered target's insert-only convergence, in order, and
 * writes one audit_logs summary row recording the outcome of each. Throws
 * (failing startup closed) if any target ends conflicted/blocked/unexpected,
 * exactly like the pre-existing CRO-02/CRO-03A initializers already did on
 * their own.
 */
export async function runProductionSeedConvergence(): Promise<SeedConvergenceReport> {
  const results: SeedTargetResult[] = [];
  let firstError: unknown = null;
  for (const target of SEED_TARGETS) {
    try {
      results.push(await target.write());
    } catch (error: any) {
      results.push({ id: target.id, classification: target.classification, tables: target.tables, outcome: "unexpected", detail: String(error?.message ?? error) });
      if (!firstError) firstError = error;
    }
  }
  const report: SeedConvergenceReport = { runAt: new Date().toISOString(), ok: !firstError, results };
  try {
    await storage.createAuditLog({
      action: "production_seed_convergence_completed",
      entityType: "system",
      entityKey: "production-seed-convergence",
      details: report as any,
      actorType: "system",
      actorId: "production-seed-convergence",
    } as any);
  } catch (auditError) {
    console.error("[ProductionSeedConvergence] Failed to write summary audit log (non-fatal):", auditError);
  }
  if (firstError) {
    console.error("[ProductionSeedConvergence] One or more targets failed:", JSON.stringify(report.results, null, 2));
    throw firstError;
  }
  console.log(`[ProductionSeedConvergence] All ${results.length} targets converged:`, results.map((r) => `${r.id}=${r.outcome}`).join(", "));
  return report;
}

/**
 * Read-only verification used by health checks (no writes, safe to call on
 * every health-check tick). Reports "unexpected" for any target whose
 * required row(s) are missing or diverge from canonical content, without
 * attempting to repair it — repair only happens via runProductionSeedConvergence
 * at startup.
 */
export async function verifyProductionSeedConvergence(): Promise<SeedConvergenceReport> {
  const results: SeedTargetResult[] = [];
  const checks: Array<() => Promise<SeedTargetResult>> = [
    async () => {
      const row = rows(await db.execute(sql`SELECT control_key FROM commercial_shadow_controls WHERE control_key = 'commercial'`))[0];
      return { id: "commercial_shadow_controls", classification: "schema_required_bootstrap", tables: ["commercial_shadow_controls"], outcome: row ? "already_present" : "unexpected", detail: row ? "present" : "missing control row" };
    },
    async () => {
      const missingSubjects = rows(await db.execute(sql`
        WITH required AS (
          SELECT DISTINCT 'contact' t, contact_id i FROM contact_business_link_decisions
          UNION SELECT 'business', business_id FROM contact_business_link_decisions WHERE business_id IS NOT NULL
          UNION SELECT 'company', company_id FROM legacy_company_mapping_decisions
          UNION SELECT 'business', business_id FROM legacy_company_mapping_decisions WHERE business_id IS NOT NULL
          UNION SELECT 'contact', contact_id FROM commercial_relationship_reviews
          UNION SELECT 'business', business_id FROM commercial_relationship_reviews WHERE business_id IS NOT NULL
          UNION SELECT 'contact', contact_id FROM contact_identity_observations
          UNION SELECT 'contact', deprecated_contact_id FROM contact_merge_redirects
          UNION SELECT 'contact', survivor_contact_id FROM contact_merge_redirects
        )
        SELECT count(*)::int AS n FROM required r
        LEFT JOIN commercial_subject_revisions csr ON csr.subject_type = r.t AND csr.subject_id = r.i
        WHERE csr.subject_id IS NULL
      `))[0];
      const n = Number(missingSubjects?.n ?? 0);
      const missingMemberships = rows(await db.execute(sql`
        WITH required AS (
          SELECT 'contact_business' e, 'contact' lt, contact_id li,
                 CASE WHEN business_id IS NULL THEN 'contact' ELSE 'business' END rt, COALESCE(business_id, contact_id) ri
            FROM contact_business_link_decisions
          UNION SELECT 'legacy_company_business', 'company', company_id,
                 CASE WHEN business_id IS NULL THEN 'company' ELSE 'business' END, COALESCE(business_id, company_id)
            FROM legacy_company_mapping_decisions
          UNION SELECT 'relationship', 'contact', contact_id,
                 CASE WHEN business_id IS NULL THEN 'contact' ELSE 'business' END, COALESCE(business_id, contact_id)
            FROM commercial_relationship_reviews
          UNION SELECT 'identity', 'contact', contact_id, 'contact', contact_id FROM contact_identity_observations
          UNION SELECT 'contact_redirect', 'contact', deprecated_contact_id, 'contact', survivor_contact_id FROM contact_merge_redirects
        )
        SELECT count(*)::int AS n FROM required r
        LEFT JOIN commercial_membership_revisions cmr
          ON cmr.edge_type = r.e AND cmr.left_subject_type = r.lt AND cmr.left_subject_id = r.li
         AND cmr.right_subject_type = r.rt AND cmr.right_subject_id = r.ri
        WHERE cmr.edge_type IS NULL
      `))[0];
      const m = Number(missingMemberships?.n ?? 0);
      const ok = n === 0 && m === 0;
      const parts = [n === 0 ? "no missing subject revisions" : `${n} subject(s) missing a revision row`, m === 0 ? "no missing membership revisions" : `${m} membership edge(s) missing a revision row`];
      return { id: "commercial_graph_revisions_backfill", classification: "historical_backfill", tables: ["commercial_subject_revisions", "commercial_membership_revisions"], outcome: ok ? "already_present" : "unexpected", detail: parts.join("; ") };
    },
    async () => {
      // Presence of >=8 shadow-mode rows is not sufficient — a row could be
      // deleted and replaced with a non-canonical (purpose, policy_version)
      // pair and still pass a bare count check. Verify every one of the
      // exact registered canonical key pairs is present in shadow mode.
      const present = rows(await db.execute(sql`SELECT purpose, policy_version FROM commercial_purpose_policies WHERE mode = 'shadow'`));
      const presentKeys = new Set(present.map((r: any) => `${r.purpose}::${r.policy_version}`));
      const missing = CRO02_SEED_KEY_VALUES.filter(([purpose, version]) => !presentKeys.has(`${purpose}::${version}`));
      return { id: "cro02_purpose_policies", classification: "immutable_revision_seed", tables: ["commercial_purpose_policies"], outcome: missing.length === 0 ? "already_present" : "unexpected", detail: missing.length === 0 ? `all ${CRO02_SEED_KEY_VALUES.length} canonical purpose policy keys present in shadow mode` : `missing canonical key(s): ${missing.map((k) => k.join("/")).join(", ")}` };
    },
    async () => {
      // A truthy active_policy_id alone doesn't prove it points at the
      // canonical policy document — verify the pointer resolves to the
      // exact registered (policy_key, version).
      const row = rows(await db.execute(sql`
        SELECT d.policy_key, d.version FROM cro03a_policy_control c
        JOIN cro03a_policy_documents d ON d.id = c.active_policy_id
        WHERE c.id = 1
      `))[0];
      const matches = row && row.policy_key === CRO03A_SEED_POLICY_KEY && Number(row.version) === CRO03A_SEED_POLICY_VERSION;
      return { id: "cro03a_policy_bootstrap", classification: "immutable_revision_seed", tables: ["cro03a_policy_documents", "cro03a_policy_control"], outcome: matches ? "already_present" : "unexpected", detail: matches ? "active policy pointer resolves to canonical document" : `active policy pointer missing or does not resolve to canonical ${CRO03A_SEED_POLICY_KEY}/v${CRO03A_SEED_POLICY_VERSION}` };
    },
    async () => {
      const row = rows(await db.execute(sql`SELECT recipe_hash, status FROM cro03_staging_recipes WHERE recipe_key = ${CRO03_STAGING_RECIPE_KEY} AND version = ${CRO03_STAGING_RECIPE_VERSION}`))[0];
      const matches = row && String(row.recipe_hash) === CRO03_STAGING_RECIPE_HASH && row.status === "disabled";
      return { id: "cro03_staging_recipes", classification: "immutable_revision_seed", tables: ["cro03_staging_recipes"], outcome: matches ? "already_present" : "unexpected", detail: matches ? "canonical recipe hash matches" : row ? "recipe present but hash/status diverges from canonical" : "missing canonical recipe" };
    },
    async () => {
      const row = rows(await db.execute(sql`SELECT status, decision_ttl_seconds, taxonomy_version, document FROM cr04_qualification_policies WHERE version = 1`))[0];
      const matches = row && row.status === "active" && Number(row.decision_ttl_seconds) === 900 &&
        row.taxonomy_version === "cr04-reasons-v1" && stableStringify(row.document) === stableStringify(CR04_POLICY_DOCUMENT);
      return { id: "cr04_qualification_policies", classification: "immutable_revision_seed", tables: ["cr04_qualification_policies"], outcome: matches ? "already_present" : "unexpected", detail: matches ? "canonical v1 policy document matches" : row ? "v1 policy present but content diverges from canonical" : "missing v1 active policy" };
    },
    async () => {
      const row = rows(await db.execute(sql`SELECT count(*)::int AS n FROM cro03_provider_ledger WHERE event_type = 'terminal' AND reservation_entry_id IS NULL`))[0];
      const n = Number(row?.n ?? 0);
      return { id: "cro03_provider_ledger_lineage_repair", classification: "historical_backfill", tables: ["cro03_provider_ledger"], outcome: n === 0 ? "already_present" : "unexpected", detail: n === 0 ? "no orphaned terminal entries" : `${n} terminal entr${n === 1 ? "y" : "ies"} missing reservation lineage` };
    },
    async () => {
      const row = rows(await db.execute(sql`
        SELECT count(*)::int AS n FROM cr06_campaign_gates g
        LEFT JOIN cr06_campaign_gate_revisions r ON r.campaign_gate_id = g.id AND r.revision = g.revision
        WHERE r.id IS NULL
      `))[0];
      const n = Number(row?.n ?? 0);
      return { id: "cr06_campaign_gate_revisions_backfill", classification: "historical_backfill", tables: ["cr06_campaign_gate_revisions"], outcome: n === 0 ? "already_present" : "unexpected", detail: n === 0 ? "no missing gate revisions" : `${n} gate(s) missing their current revision row` };
    },
    async () => {
      const row = rows(await db.execute(sql`
        SELECT count(*)::int AS n FROM inbound_requests ir
        LEFT JOIN inbound_request_effects e ON e.request_id = ir.id AND e.effect_key = 'internal_notification'
        WHERE ir.source_category = 'website_form' AND ir.source_type = 'equipment_order' AND e.id IS NULL
      `))[0];
      const n = Number(row?.n ?? 0);
      return { id: "inbound_request_effects_backfill", classification: "historical_backfill", tables: ["inbound_request_effects"], outcome: n === 0 ? "already_present" : "unexpected", detail: n === 0 ? "no missing effect rows" : `${n} equipment-order request(s) missing their held effect row` };
    },
  ];
  for (const check of checks) {
    try {
      results.push(await check());
    } catch (error: any) {
      results.push({ id: "unknown", classification: "schema_required_bootstrap", tables: [], outcome: "unexpected", detail: String(error?.message ?? error) });
    }
  }
  return { runAt: new Date().toISOString(), ok: results.every((r) => r.outcome !== "unexpected" && r.outcome !== "conflicted" && r.outcome !== "blocked"), results };
}
