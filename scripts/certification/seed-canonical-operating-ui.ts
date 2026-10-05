import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "../certification-provider-deny";

await assertDisposableTestInfrastructure({ operation: "Populated canonical UI fixture" });
applyCertificationProviderDenyBoundary({ fatal: true });
const { pool } = await import("../../server/db");
const { claimCsvExecution, completeImportExecution } = await import("../../server/services/import-execution");
const { materializeCanonicalProviderImportRow } = await import("../../server/services/canonical-provider-import");
const id = randomUUID(), actorId = "system:canonical-private-ui-fixture";
const sourcePayload = [
  { name: "Harbor Auto Services", place_id: `fixture-${id}`, category: "Automotive",
    city: "Miami", state: "FL", postal_code: "33130", email_1: `harbor.${id}@gmail.com`,
    retained_source_note: "Private synthetic row; not a supplied workbook" },
  { email_1: `unresolved.${id}@gmail.com`, retained_source_note: "Missing business identity" },
];
try {
  const claim = await claimCsvExecution({
    fileHash: createHash("sha256").update(JSON.stringify(sourcePayload)).digest("hex"),
    totalRows: sourcePayload.length, actorType: "import", actorId, sourcePayload,
  });
  const committed: Array<{ businessId: number | null }> = [];
  for (const [index, rawRow] of sourcePayload.entries()) {
    committed.push(await materializeCanonicalProviderImportRow({
      executionId: claim.execution.id, claimToken: claim.claimToken!, sourceRowNumber: index + 1,
      sourceFormat: "google_maps_outscraper", actorId, rawRow,
    }));
  }
  await completeImportExecution({
    executionId: claim.execution.id, claimToken: claim.claimToken!, expectedRows: sourcePayload.length,
  });
  const accounted = (await pool.query(`SELECT disposition,diagnostic->>'businessId' business_id
    FROM import_row_dispositions WHERE execution_id=$1 ORDER BY source_row_number`, [claim.execution.id])).rows;
  assert.equal(accounted.length, 2);
  assert(committed.some(row => row.businessId != null));
  assert(accounted.some(row => row.disposition === "deferred"));
  assert.equal(Number((await pool.query("SELECT count(*) n FROM provider_operations")).rows[0].n), 0);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM communication_events")).rows[0].n), 0);
  console.log("POPULATED_CANONICAL_FIXTURE_READY committed=1 deferred=1 providers=0 messages=0");
} finally { await pool.end(); }
