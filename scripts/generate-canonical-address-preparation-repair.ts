import fs from "node:fs";
import assert from "node:assert/strict";

/** Owner-executed administration file only. Never imported by server startup,
 * the build command or a production runner. Preserve canonical routine bytes. */
export function canonicalAddressPreparationOwnerSql() {
  const address=fs.readFileSync("migrations/0330_canonical_address_validation.sql","utf8")
    .replace("CREATE TABLE canonical_address_validation_claims","CREATE TABLE IF NOT EXISTS canonical_address_validation_claims")
    .replace("CREATE INDEX canonical_address_receipt_lookup_idx","CREATE INDEX IF NOT EXISTS canonical_address_receipt_lookup_idx");
  const preparation=fs.readFileSync("migrations/0331_canonical_recipient_preparation.sql","utf8");
  const parts=preparation.split("--> statement-breakpoint").map(part=>part.trim());
  assert.equal(parts.length,5,"Preparation migration structure changed: review the owner delivery generator");
  const columnClause=parts[0].split("  ADD CONSTRAINT canonical_preparation_scope_chk")[0]
    .replaceAll("ADD COLUMN ","ADD COLUMN IF NOT EXISTS ").trim().replace(/,$/,"")+";";
  const constraint=parts[0].slice(parts[0].indexOf("  ADD CONSTRAINT canonical_preparation_scope_chk")).trim();
  const capacityFunction=parts[3].replace("CREATE FUNCTION crm_enforce_canonical_preparation_capacity()",
    "CREATE OR REPLACE FUNCTION crm_enforce_canonical_preparation_capacity()");
  assert(capacityFunction.includes("CREATE OR REPLACE FUNCTION crm_enforce_canonical_preparation_capacity()"));
  const preflight=`DO $preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.crm_enforce_canonical_preparation_capacity()')
    AND md5(prosrc)<>'6e8864b97bd634386a156bca78c2dc5b') THEN
    RAISE EXCEPTION 'CANONICAL_PREPARATION_OWNER_REPAIR_FUNCTION_DRIFT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.cr04_enrollment_intents'::regclass
    AND t.tgname='canonical_preparation_capacity'
    AND (t.tgfoid IS DISTINCT FROM to_regprocedure('public.crm_enforce_canonical_preparation_capacity()')
      OR t.tgenabled NOT IN ('O','A') OR t.tgisinternal OR t.tgqual IS NOT NULL OR t.tgtype<>23)) THEN
    RAISE EXCEPTION 'CANONICAL_PREPARATION_OWNER_REPAIR_TRIGGER_DRIFT';
  END IF;
END $preflight$;`;
  const guardedConstraint=`DO $constraint$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.cr04_enrollment_intents'::regclass
    AND conname='canonical_preparation_scope_chk') THEN
    ALTER TABLE cr04_enrollment_intents ${constraint}
  END IF;
END $constraint$;`;
  const indexes=parts.slice(1,3).join("\n").replaceAll("CREATE UNIQUE INDEX ","CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replaceAll("CREATE INDEX ","CREATE INDEX IF NOT EXISTS ");
  const trigger=`DO $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cr04_enrollment_intents'::regclass
    AND tgname='canonical_preparation_capacity') THEN
    ${parts[4]}
  END IF;
END $trigger$;`;
  return [
    "-- Explicit versioned owner repair. Standard psql: submit the COMPLETE file.\n"+
    "-- SQL Console: select ALL statements between the standalone BEGIN; and COMMIT;\n"+
    "-- below, from SET LOCAL lock_timeout through END $trigger$;, and run ONCE as a\n"+
    "-- selected batch. The console supplies the transaction; do not run the outer\n"+
    "-- BEGIN; / COMMIT;. Keep every inner DO/function BEGIN/END block unchanged.",
    "-- Agent production access remains read-only. No startup/build DDL or publishing.",
    "-- Installs only canonical address/preparation prerequisites; not discovery or whole-task acceptance.",
    "BEGIN;","SET LOCAL lock_timeout='5s';","SET LOCAL statement_timeout='120s';",
    preflight,address,columnClause,guardedConstraint,indexes,capacityFunction,trigger,"COMMIT;","",
  ].join("\n\n");
}

if(process.argv[1]?.endsWith("generate-canonical-address-preparation-repair.ts")) {
  const target="docs/certification/canonical-enrichment-address-preparation-native-repair-v1.sql";
  fs.writeFileSync(target,canonicalAddressPreparationOwnerSql());
  console.log(`Generated ${target}; no database connection or execution.`);
}