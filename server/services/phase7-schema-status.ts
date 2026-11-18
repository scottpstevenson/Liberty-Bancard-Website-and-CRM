import { pool } from "../db";
import { PHASE7_NATIVE_ENTRY } from "../native-objects/phase7.generated";
export async function readPhase7SchemaStatus() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const native = (await c.query(PHASE7_NATIVE_ENTRY.verifySql)).rows[0]
      .repair_verified;
    const tables = [
      "cro07_subject_assignments",
      "cro07_receipt_exposures",
      "cro07_verified_outcomes",
      "cro07_evaluation_snapshots",
      "cro07_experiment_commands",
      "cro07_attempt_bindings",
      "cro07_attempt_envelopes",
      "cro07_mailbox_receipts",
      "cro07_reply_qualifications",
      "cro07_provider_receipts",
      "conversion_journey_evidence",
      "conversion_evidence_checkpoints",
    ];
    const catalog = (
      await c.query(
        `SELECT name,to_regclass('public.'||name)IS NOT NULL AS present FROM unnest($1::text[])name`,
        [tables],
      )
    ).rows;
    const columns = (
      await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='cro07_experiments' AND column_name=ANY($1::text[])`,
        [
          [
            "phase7_design",
            "revision",
            "collection_ends_at",
            "maturity_ends_at",
            "evaluation_lease_token",
            "evaluation_lease_expires_at",
          ],
        ],
      )
    ).rows;
    const invalid = (
      await c.query(
        `SELECT conrelid::regclass::text AS relation,conname FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace`,
      )
    ).rows;
    const index = (
      await c.query(
        `SELECT to_regclass('public.cro07_one_collecting_step')IS NOT NULL AS present`,
      )
    ).rows[0].present;
    await c.query("COMMIT");
    return {
      asOf: new Date().toISOString(),
      migration: "0387_phase7_conversion_integrity",
      schemaVerified:
        native &&
        catalog.every((r) => r.present) &&
        columns.length === 6 &&
        invalid.length === 0 &&
        index,
      nativeVerified: native,
      tables: catalog,
      experimentColumnCount: columns.length,
      validatedChecks: invalid.length === 0,
      invalidChecks: invalid,
      collectingStepIndex: index,
      productionActivation: false,
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
