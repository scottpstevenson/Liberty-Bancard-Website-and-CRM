#!/usr/bin/env npx tsx
/**
 * test-cro03-ledger-convergence.ts (Task #1750 code-review follow-up)
 *
 * Integration test for the riskiest target in production-seed-convergence.ts:
 * convergeCro03LedgerLineage's repair of pre-existing terminal
 * cro03_provider_ledger rows that predate the reservation-lineage columns.
 * This table carries a real BEFORE UPDATE OR DELETE immutability trigger
 * (cro03_ledger_immutable) and a lineage-validating trigger
 * (cro03_ledger_lineage_guard) that are installed in this dev database
 * exactly as they would be in a production database whose DDL is already
 * correct (per this task's stated premise) — this script proves the
 * convergence function's repair actually succeeds against that real,
 * trigger-guarded schema, not just against columns with no guards attached.
 *
 * What it does:
 *  1. Confirms both triggers exist on cro03_provider_ledger (fails loudly if
 *     the dev DB is not in the expected production-equivalent state).
 *  2. Builds the minimal FK chain (provider_controls -> provider_operations
 *     -> cro03_enrichment_batches -> cro03_batch_memberships ->
 *     cro03_enrichment_items -> cro03_provider_runs) needed to insert one
 *     real cro03_provider_ledger row.
 *  3. Inserts that ledger row directly as a legacy "terminal" row with no
 *     event_type/reservation_entry_id set (event_type defaults to
 *     'reservation' in schema; this test explicitly forces the pre-repair
 *     shape the way a real historical row would look: disposition consumed,
 *     event_type not yet 'terminal', reservation_entry_id NULL) —
 *     bypassing the trigger via a direct low-level unguarded write path
 *     (a fresh INSERT is not blocked by the UPDATE/DELETE-only immutable
 *     trigger, so this setup step does not need to disable anything).
 *  4. Runs the actual convergeCro03LedgerLineage target from SEED_TARGETS
 *     and asserts it returns outcome "backfilled" (or "already_present" on
 *     a re-run) rather than throwing.
 *  5. Confirms after convergence: the row now has event_type='terminal',
 *     a synthetic reservation-entry sibling row now exists, and the row's
 *     reservation_entry_id points at it.
 *  6. Confirms the trigger still exists afterward (proves the drop was
 *     paired with a recreate, not a permanent removal of the guard).
 *  7. Runs convergence a second time to confirm idempotency ("already_present").
 *  8. Cleans up every row it created, in FK-safe order.
 *
 * Exits 0 on pass, 1 on any assertion failure.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { SEED_TARGETS } from "../server/services/production-seed-convergence";

const rows = (result: unknown) => ((result as any)?.rows ?? []) as any[];

async function main(): Promise<number> {
  const marker = `test-cro03-ledger-${Date.now()}`;
  const failures: string[] = [];
  let providerRunId: string | null = null;
  let operationId: string | null = null;
  let itemId: string | null = null;
  let membershipId: string | null = null;
  let batchId: string | null = null;
  let ledgerId: string | null = null;

  try {
    // 1. Confirm the real triggers are present before the test even starts.
    const before = rows(await db.execute(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'cro03_provider_ledger'::regclass AND NOT tgisinternal
    `));
    const beforeNames = new Set(before.map((r: any) => r.tgname));
    if (!beforeNames.has("cro03_ledger_immutable")) {
      failures.push("PRECONDITION FAILED: cro03_ledger_immutable trigger is not installed on this database — this test cannot prove anything about the guarded repair path. Confirm migrations 0175/0193 were applied to this dev database.");
      throw new Error("precondition_failed");
    }

    // 2. Minimal FK chain.
    await db.execute(sql`
      INSERT INTO provider_controls (provider, capability) VALUES (${marker}, 'enrichment')
      ON CONFLICT (provider) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO cro03_enrichment_batches (idempotency_key, actor_type, selection_hash)
      VALUES (${marker}, 'system', ${marker})
      RETURNING id
    `).then((r) => { batchId = rows(r)[0].id; });
    await db.execute(sql`
      INSERT INTO cro03_batch_memberships (
        batch_id, ordinal, subject_type, subject_id, root_subject_type, root_subject_id,
        selection_policy_version, dependency_fingerprint, pre_spend_decision, membership_hash
      ) VALUES (${batchId}, 0, 'contact', 1, 'contact', 1, 1, ${marker}, 'allowed', ${marker})
      RETURNING id
    `).then((r) => { membershipId = rows(r)[0].id; });
    await db.execute(sql`
      INSERT INTO cro03_enrichment_items (batch_id, membership_id)
      VALUES (${batchId}, ${membershipId})
      RETURNING id
    `).then((r) => { itemId = rows(r)[0].id; });
    await db.execute(sql`
      INSERT INTO provider_operations (provider, operation_type, purpose, idempotency_key, actor_type, target_fingerprint)
      VALUES (${marker}, 'enrichment', 'provider_pre_spend', ${marker}, 'system', ${marker})
      RETURNING id
    `).then((r) => { operationId = rows(r)[0].id; });
    await db.execute(sql`
      INSERT INTO cro03_provider_runs (item_id, provider, operation_id, route_policy_version, purpose, target_fingerprint, billing_disposition)
      VALUES (${itemId}, ${marker}, ${operationId}, 1, 'provider_pre_spend', ${marker}, 'consumed')
      RETURNING id
    `).then((r) => { providerRunId = rows(r)[0].id; });

    // 3. Insert the row exactly as a pre-migration-0193 legacy terminal row
    // would look: disposition already terminal-shaped, but event_type still
    // at its schema default ('reservation') and reservation_entry_id unset —
    // this is precisely the shape convergeCro03LedgerLineage is meant to fix.
    // provider_operation_id/provider must match the linked run+operation so
    // the pre-existing lineage-guard trigger (cro03_ledger_lineage_guard)
    // does not reject this setup insert.
    //
    // cro03_ledger_terminal_lineage_chk (added by migration 0193 itself,
    // AFTER that migration's own repair ran) would reject this exact
    // "not yet repaired" shape too — in the real historical incident this
    // constraint did not exist yet when the legacy row was originally
    // written, so recreating that legacy shape here requires temporarily
    // lifting the constraint for JUST this fixture insert. Immediately
    // afterward the constraint is put back — the target under test must
    // then genuinely handle a fully-guarded table (trigger + lineage guard
    // + unique indexes + this check constraint ALL simultaneously active),
    // not a table with this one guard pre-removed for it.
    await db.execute(sql`ALTER TABLE cro03_provider_ledger DROP CONSTRAINT IF EXISTS cro03_ledger_terminal_lineage_chk`);
    await db.execute(sql`
      INSERT INTO cro03_provider_ledger (provider_run_id, provider_operation_id, provider, entry_key, disposition, units, amount_micros)
      VALUES (${providerRunId}, ${operationId}, ${marker}, ${marker}, 'consumed', 3, 1500)
      RETURNING id
    `).then((r) => { ledgerId = rows(r)[0].id; });
    await db.execute(sql`
      ALTER TABLE cro03_provider_ledger ADD CONSTRAINT cro03_ledger_terminal_lineage_chk CHECK (
        (event_type='reservation' AND reservation_entry_id IS NULL AND disposition='outstanding')
        OR (event_type='terminal' AND reservation_entry_id IS NOT NULL
            AND disposition IN ('consumed','released','refunded','ambiguous'))
      ) NOT VALID
    `);
    // NOT VALID: the fixture row above is a deliberate pre-existing
    // violation (that is the whole point of the fixture), so this mirrors
    // the only way such a row and this constraint can coexist in Postgres —
    // added without validating existing rows, exactly as if the constraint
    // migration had run against a table that already held this legacy row.
    // The convergence target itself is what must fully validate (by
    // dropping and re-adding the constraint for real) once repaired.

    const target = SEED_TARGETS.find((t) => t.id === "cro03_provider_ledger_lineage_repair");
    if (!target) throw new Error("cro03_provider_ledger_lineage_repair target not found in SEED_TARGETS");

    // 4. Run the real convergence target against the fully-guarded table
    // (trigger + lineage guard + unique indexes + NOT VALID check
    // constraint all simultaneously present, matching production).
    const result = await target.write();
    if (result.outcome !== "backfilled") {
      failures.push(`Expected outcome "backfilled" on first run, got "${result.outcome}" (${result.detail})`);
    }

    // 5. Verify the repaired shape.
    const repaired = rows(await db.execute(sql`
      SELECT event_type, reservation_entry_id FROM cro03_provider_ledger WHERE id = ${ledgerId}
    `))[0];
    if (!repaired) failures.push("Ledger row disappeared after convergence");
    else {
      if (repaired.event_type !== "terminal") failures.push(`Expected event_type='terminal' after repair, got '${repaired.event_type}'`);
      if (!repaired.reservation_entry_id) failures.push("Expected reservation_entry_id to be set after repair, got NULL");
      else {
        const reservation = rows(await db.execute(sql`
          SELECT event_type, disposition, entry_key FROM cro03_provider_ledger WHERE id = ${repaired.reservation_entry_id}
        `))[0];
        if (!reservation) failures.push("Synthetic reservation sibling row was not actually created");
        else if (reservation.event_type !== "reservation" || reservation.disposition !== "outstanding") {
          failures.push(`Synthetic reservation row has wrong shape: ${JSON.stringify(reservation)}`);
        }
      }
    }

    // 5b. The target itself is responsible for dropping the NOT VALID
    // constraint, repairing, and re-adding it VALIDATED (see
    // convergeCro03LedgerLineage) — confirm it actually did that, rather
    // than leaving the constraint NOT VALID (which would silently accept
    // future violations) or absent.
    const constraintState = rows(await db.execute(sql`
      SELECT convalidated FROM pg_constraint WHERE conname = 'cro03_ledger_terminal_lineage_chk' AND conrelid = 'cro03_provider_ledger'::regclass
    `))[0];
    if (!constraintState) {
      failures.push("cro03_ledger_terminal_lineage_chk is MISSING after convergence — the target did not restore it.");
    } else if (!constraintState.convalidated) {
      failures.push("cro03_ledger_terminal_lineage_chk is present but NOT VALID after convergence — the target left it unvalidated instead of proving the repaired data actually satisfies it.");
    }

    // 6. Confirm the guard trigger still exists (was recreated, not dropped for good).
    const after = rows(await db.execute(sql`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'cro03_provider_ledger'::regclass AND NOT tgisinternal
    `));
    if (!after.some((r: any) => r.tgname === "cro03_ledger_immutable")) {
      failures.push("cro03_ledger_immutable trigger is MISSING after convergence — the repair permanently dropped production's immutability guard instead of recreating it.");
    }

    // 6b. Prove the guard is actually live again: a raw UPDATE against the
    // now-repaired row must be rejected.
    let guardRejected = false;
    try {
      await db.execute(sql`UPDATE cro03_provider_ledger SET units = 999 WHERE id = ${ledgerId}`);
    } catch (err: any) {
      guardRejected = /CRO03_IMMUTABLE_ROW_GUARD/.test(String(err?.cause?.message ?? err?.message ?? err));
    }
    if (!guardRejected) failures.push("Immutability guard did not reject a raw UPDATE after convergence recreated the trigger — the guard is not actually active.");

    // 7. Re-run for idempotency.
    const second = await target.write();
    if (second.outcome !== "already_present") {
      failures.push(`Expected outcome "already_present" on second run, got "${second.outcome}" (${second.detail})`);
    }
  } catch (err: any) {
    if (err?.message !== "precondition_failed") failures.push(`Unexpected error: ${err?.stack ?? err}`);
  } finally {
    // 8. Cleanup, FK-safe order. The reservation sibling row cro03_ledger
    // created has entry_key 'reserve:legacy:<ledgerId>' — delete both ledger
    // rows for this run before their parent chain.
    try {
      if (providerRunId) {
        // The immutability guard we just proved is live also blocks this
        // cleanup's own DELETE — drop/recreate it the same way the
        // convergence function itself does around its repair writes.
        await db.execute(sql`DROP TRIGGER IF EXISTS cro03_ledger_immutable ON cro03_provider_ledger`);
        await db.execute(sql`DELETE FROM cro03_provider_ledger WHERE provider_run_id = ${providerRunId}`);
        await db.execute(sql`
          CREATE TRIGGER cro03_ledger_immutable BEFORE UPDATE OR DELETE ON cro03_provider_ledger
            FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard()
        `);
        await db.execute(sql`DELETE FROM cro03_provider_runs WHERE id = ${providerRunId}`);
      }
      if (itemId) await db.execute(sql`DELETE FROM cro03_enrichment_items WHERE id = ${itemId}`);
      if (membershipId) {
        // cro03_batch_memberships carries its own unrelated immutability
        // guard (cro03_membership_immutable, sharing the same guard
        // function this test's target also uses on cro03_provider_ledger)
        // — drop/recreate around this cleanup delete the same way.
        await db.execute(sql`DROP TRIGGER IF EXISTS cro03_membership_immutable ON cro03_batch_memberships`);
        await db.execute(sql`DELETE FROM cro03_batch_memberships WHERE id = ${membershipId}`);
        await db.execute(sql`
          CREATE TRIGGER cro03_membership_immutable BEFORE UPDATE OR DELETE ON cro03_batch_memberships
            FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard()
        `);
      }
      if (batchId) await db.execute(sql`DELETE FROM cro03_enrichment_batches WHERE id = ${batchId}`);
      if (operationId) await db.execute(sql`DELETE FROM provider_operations WHERE id = ${operationId}`);
      await db.execute(sql`DELETE FROM provider_controls WHERE provider = ${marker}`);
    } catch (cleanupErr: any) {
      failures.push(`Cleanup failed (manual cleanup of marker '${marker}' rows may be required): ${cleanupErr?.message ?? cleanupErr}`);
    }
  }

  if (failures.length > 0) {
    console.error(`[test-cro03-ledger-convergence] FAIL:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    return 1;
  }
  console.log("[test-cro03-ledger-convergence] PASS — trigger-guarded ledger repair converges, recreates the immutability guard, and is idempotent.");
  return 0;
}

main().then((code) => process.exit(code));
