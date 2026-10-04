import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";
import { readTabularImportWithCoordinates } from "../../server/services/tabular-import-reader";

async function main() {
  await assertDisposableTestInfrastructure({ operation: "provider-import-recovery-certification" });
  let forbiddenNetworkAttempts = 0;
  const deny = () => { forbiddenNetworkAttempts++; throw new Error("CERTIFICATION_EXTERNAL_NETWORK_DENIED"); };
  globalThis.fetch = deny as typeof fetch;
  http.request = deny as typeof http.request; http.get = deny as typeof http.get;
  https.request = deny as typeof https.request; https.get = deny as typeof https.get;
  syncBuiltinESMExports();
  const { pool } = await import("../../server/db");
  const { storage } = await import("../../server/storage");
  const { claimCsvExecution, getImportLedgerSummary } = await import("../../server/services/import-execution");
  const { processPersistedCsvImport } = await import("../../server/services/csv-import-processor");
  const { retainProviderImportRow } = await import("../../server/services/provider-import-evidence");
  const { createCro03SourceBatch } = await import("../../server/services/cro03/source-staging");
  const { providerCsvSourceSubject } = await import("../../server/services/cro03a/adapters");
  const { mapProviderCsvRow } = await import("../../server/services/provider-import-columns");
  const { computeFileHash } = await import("../../server/services/import-normalizer");
  const fixtureDirectory = process.argv[2] ?? "/tmp/canonical-enrichment-workbooks";
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, "manifest.json"), "utf8"));
  const safetyTables = ["contacts", "businesses", "provider_operations", "provider_observations",
    "sequence_enrollments", "communication_events", "sfp_campaign_staging_intents"];
  const safetyCounts = async () => Object.fromEntries(await Promise.all(safetyTables.map(async table =>
    [table, Number((await pool.query(`SELECT count(*) n FROM "${table}"`)).rows[0].n)])));
  try {
    const before = await safetyCounts();
    let checkedRows = 0;
    for (const [index, fixture] of manifest.files.entries()) {
      const bytes = fs.readFileSync(path.join("attached_assets", fixture.name));
      const { rows: records, coordinates } = await readTabularImportWithCoordinates(bytes, fixture.name);
      assert.deepEqual(records, JSON.parse(fs.readFileSync(fixture.json, "utf8")));
      const executionClaim = await claimCsvExecution({
        fileHash: computeFileHash(bytes), totalRows: records.length,
        actorType: "user", actorId: "certification",
        metadata: { sourceFormat: "google_maps_outscraper", fileName: fixture.name, sourceCoordinates: coordinates },
        sourcePayload: records,
      });
      assert(executionClaim.claimed);
      const importRecord = await storage.createCsvImport({
        executionId: executionClaim.execution.id, fileName: fixture.name,
        sourceFormat: "google_maps_outscraper", importSource: "google_maps_outscraper",
        totalRows: records.length, status: "processing", importedBy: "certification",
      });
      if (index === 0) {
        // An old upload may have staged mapped evidence before crashing. Keep
        // its exact immutable payload even if today's projection has more fields.
        const row = records[0];
        const draft = providerCsvSourceSubject({
          importExecutionId: executionClaim.execution.id, sourceRowNumber: 1,
          sourceSystem: "outscraper", row: mapProviderCsvRow(row, "google_maps_outscraper"),
        });
        await createCro03SourceBatch({
          idempotencyKey: `csv-source:${executionClaim.execution.id}:1`,
          actorType: "import", actorId: "certification", purpose: "staging_review",
          subjects: [{ ...draft, payload: { ...draft.payload, legacyMarker: true,
            sourceRowNumber: 1, rowFingerprint: computeFileHash(Buffer.from(JSON.stringify(row))),
            sourceFormat: "google_maps_outscraper" } }],
        });
      }
      await processPersistedCsvImport({
        records, executionClaim, importRecord, sourceFormat: "google_maps_outscraper",
        actor: { actorType: "system", actorId: "startup-resumer" }, filename: fixture.name,
      });
      const ledger = await getImportLedgerSummary(executionClaim.execution.id);
      assert.equal(ledger.counts.deferred, fixture.rows);
      assert.equal(ledger.counts.failed, 0);
      assert.equal(ledger.counts.created, 0);
      const stored = (await pool.query(`
        SELECT (o.payload->>'sourceRowNumber')::int row_number,o.payload->'rawSourceRow' raw,
               o.payload->'sourceCoordinate' coordinate,o.payload->>'fileName' filename
          FROM cro03_enrichment_batches b JOIN cro03_batch_memberships m ON m.batch_id=b.id
          JOIN cro03_source_observations o ON o.id=m.source_observation_id
         WHERE b.idempotency_key LIKE $1 ORDER BY row_number`,
        [`csv-source-raw-v2:${executionClaim.execution.id}:%`])).rows;
      assert.equal(stored.length, fixture.rows);
      stored.forEach((row, i) => {
        assert.deepEqual(row.raw, records[i]);
        assert.deepEqual(row.coordinate, coordinates[i]);
        assert.equal(row.filename, fixture.name);
      });
      const replay = await claimCsvExecution({
        fileHash: computeFileHash(bytes), totalRows: records.length,
        actorType: "user", actorId: "certification", sourcePayload: records,
      });
      assert.equal(replay.claimed, false);
      await retainProviderImportRow({
        executionId: executionClaim.execution.id, sourceRowNumber: 1,
        sourceFormat: "google_maps_outscraper", actorId: "startup-resumer", rawRow: records[0],
        sourceCoordinate: coordinates[0], fileName: fixture.name,
      });
      await assert.rejects(retainProviderImportRow({
        executionId: executionClaim.execution.id, sourceRowNumber: 1,
        sourceFormat: "google_maps_outscraper", actorId: "startup-resumer",
        rawRow: { ...records[0], email: "different@example.invalid" },
        sourceCoordinate: coordinates[0], fileName: fixture.name,
      }), /ORIGINAL_EVIDENCE_MISMATCH/);
      checkedRows += records.length;
    }
    assert.equal(checkedRows, 2914);
    assert.equal(forbiddenNetworkAttempts, 0);
    assert.deepEqual(await safetyCounts(), before);
    const legacy = (await pool.query(`SELECT count(*)::int n FROM cro03_source_observations
      WHERE payload->>'legacyMarker'='true'`)).rows[0];
    assert.equal(legacy.n, 1);
    const { readCanonicalEnrichmentStatus } = await import("../../server/services/canonical-enrichment-status");
    const status = await readCanonicalEnrichmentStatus();
    assert.equal(status.contacts.total, Number(before.contacts));
    assert.equal(status.businesses.total, Number(before.businesses));
    assert.equal(status.imports.byState.completed, 5);
    assert.equal(status.providers.total, Number(before.provider_operations));
    assert.equal(status.scope, "production_records_with_historical_work");
    const result = { observedAt: new Date().toISOString(), rows: checkedRows, files: manifest.files.length,
      actualRecovery: "PASS", exactRawCells: "PASS", originalEvidencePreserved: "PASS",
      originalWorksheetRowCoordinates: "PASS",
      replay: "PASS", changedRowRejected: "PASS", truthfulDeferredLedger: "PASS",
      crmProviderPreparationEnrollmentCountsUnchanged: true, forbiddenNetworkAttempts,
      productionExecution: false, fullTaskCertification: false };
    fs.writeFileSync("docs/certification/canonical-enrichment-upload-recovery.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}
main().catch(error => {
  console.error("Provider import certification failed:", String(error.message).split("\n")[0]);
  console.error(error.stack?.split("\n").filter((line: string) => line.trim().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});