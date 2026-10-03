/**
 * Independent early workbook certification. Not a production import and not
 * certification of the unrepaired HTTP import route or downstream enrichment.
 *
 * First run extract-enrichment-workbooks.py into /tmp, then run this script
 * with matching DATABASE_URL/TEST_DATABASE_URL against a migrated disposable DB.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { parse } from "csv-parse/sync";
import { assertDisposableTestInfrastructure } from "../test-infrastructure-guard";

type RecordRow = Record<string, string>;
type Fixture = { name: string; sha256: string; rows: number; columns: number; json: string; csv: string };

async function main() {
  await assertDisposableTestInfrastructure({ operation: "enrichment-workbook-certification" });
  const fixtureDir = path.resolve(process.argv[2] ?? "/tmp/canonical-enrichment-workbooks");
  assert(fixtureDir.startsWith("/tmp/"));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, "manifest.json"), "utf8")) as {
    files: Fixture[]; aggregate: Record<string, number>;
  };
  let forbiddenNetworkAttempts = 0;
  const denyNetwork = () => {
    forbiddenNetworkAttempts++;
    throw new Error("WORKBOOK_CERTIFICATION_EXTERNAL_NETWORK_DENIED");
  };
  globalThis.fetch = denyNetwork as typeof fetch;
  http.request = denyNetwork as typeof http.request;
  http.get = denyNetwork as typeof http.get;
  https.request = denyNetwork as typeof https.request;
  https.get = denyNetwork as typeof https.get;
  syncBuiltinESMExports();

  // Even the format classifier currently imports DB-bearing helpers.
  // Import application code only after the disposable infrastructure check.
  const { classifyCsvSourceFormat } = await import("../../server/services/import-normalizer");
  const { providerCsvSourceSubject } = await import("../../server/services/cro03a/adapters");
  const { createCro03SourceBatch } = await import("../../server/services/cro03/source-staging");
  const { pool } = await import("../../server/db");
  try {
    const source = fs.readFileSync("server/routes/imports.ts", "utf8");
    // Use the current route's actual maps, not a stale second mapping implementation.
    const literals = ["googleMapsColumnMap", "apolloColumnMap", "genericColumnMap"].map(name => {
      const match = source.match(new RegExp(`const ${name}: Record<string, string> = (\\{[\\s\\S]*?\\n      \\});`));
      assert(match, `Current route map ${name} not found; refresh certification`);
      return `const ${name} = ${match[1]};`;
    });
    const columnMap = runInNewContext(literals.join("\n") + "\ngenericColumnMap;", {}, { timeout: 1000 }) as Record<string, string>;
    const safetyTables = ["contacts", "businesses", "provider_operations", "provider_observations",
      "sequence_enrollments", "communication_events", "sfp_campaign_staging_intents"];
    const safetyCounts = async () => {
      const result: Record<string, number> = {};
      for (const table of safetyTables) {
        result[table] = Number((await pool.query(`SELECT count(*) AS count FROM "${table}"`)).rows[0].count);
      }
      return result;
    };
    const before = await safetyCounts();
    const receipt = [];
    const seenPairs = new Set<string>();
    let droppedNonblankCells = 0;
    let dottedVendorStatusRows = 0;
    for (const fixture of manifest.files) {
      assert.equal(createHash("sha256").update(fs.readFileSync(path.join("attached_assets", fixture.name))).digest("hex"), fixture.sha256);
      const rawRows = JSON.parse(fs.readFileSync(fixture.json, "utf8")) as RecordRow[];
      const exactCsvRows = parse(fs.readFileSync(fixture.csv, "utf8"), { columns: true, skip_empty_lines: true }) as RecordRow[];
      assert.deepEqual(exactCsvRows, rawRows, `${fixture.name}: every original cell must round-trip`);
      const csvRows = parse(fs.readFileSync(fixture.csv, "utf8"), {
        columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, relax_quotes: true,
      }) as RecordRow[];
      assert.equal(csvRows.length, fixture.rows);
      assert.equal(classifyCsvSourceFormat(Object.keys(csvRows[0])), "google_maps_outscraper");
      const subjects = csvRows.map((row, index) => {
        const mapped: RecordRow = {};
        for (const [header, value] of Object.entries(row)) {
          const normalized = header.toLowerCase().trim().replace(/\s+/g, "_");
          const field = columnMap[normalized] || columnMap[header.toLowerCase().trim()];
          if (field && value) mapped[field] = value.trim();
          else if (value.trim()) droppedNonblankCells++;
        }
        if (row["email.emails_validator.status"].trim()) dottedVendorStatusRows++;
        // This is the existing CSV adapter; test raw retention at its underlying
        // staging boundary without pretending the current HTTP route supplies it.
        const draft = providerCsvSourceSubject({
          importExecutionId: fixture.sha256, sourceRowNumber: index + 1,
          sourceSystem: "outscraper", row: mapped,
        });
        assert.equal(draft.subjectKey, `${fixture.sha256}:${index + 1}`);
        assert.equal(draft.candidateValues.email, mapped.email || undefined);
        assert.equal((draft.candidateValues as Record<string, unknown>).email_status, undefined);
        if (row.email.trim()) seenPairs.add(`${row.place_id}:${row.email.trim().toLowerCase()}`);
        return { ...draft, payload: { mapped, rawSourceRow: rawRows[index] } };
      });
      const request = {
        idempotencyKey: `workbook-cert:${fixture.sha256}`, actorType: "import",
        actorId: "workbook-certification", purpose: "staging_review", subjects,
      };
      const first = await createCro03SourceBatch(request);
      assert.equal(first.replayed, false, "Run this certificate on a fresh disposable database");
      assert.equal(first.totalCount, fixture.rows);
      assert.equal(first.occurrenceIds.length, fixture.rows);
      const second = await createCro03SourceBatch(request);
      assert.equal(second.replayed, true);
      assert.equal(second.id, first.id);
      assert.deepEqual(second.occurrenceIds, first.occurrenceIds);
      const stored = (await pool.query(`
        SELECT m.ordinal, o.payload
          FROM cro03_batch_memberships m
          JOIN cro03_source_observations o ON o.id=m.source_observation_id
         WHERE m.batch_id=$1 ORDER BY m.ordinal`, [first.id])).rows;
      assert.equal(stored.length, fixture.rows);
      stored.forEach((row, i) => assert.deepEqual(row.payload.rawSourceRow, rawRows[i]));
      await assert.rejects(createCro03SourceBatch({
        ...request, subjects: subjects.map((entry, i) => i === 0
          ? { ...entry, payload: { ...entry.payload, changed: true } } : entry),
      }), /CRO03_IDEMPOTENCY_PAYLOAD_MISMATCH/);
      receipt.push({ file: fixture.name, rows: fixture.rows, columns: fixture.columns,
        csvCellParity: "PASS", rawEvidencePersistence: "PASS", stagingReplay: "PASS",
        changedPayloadRejection: "PASS" });
    }
    assert.equal(seenPairs.size, 2822);
    const totals = (await pool.query(`
      SELECT (SELECT count(*) FROM cro03_source_subjects) AS subjects,
             (SELECT count(*) FROM cro03_source_observations) AS observations,
             (SELECT count(*) FROM cro03_source_occurrences) AS occurrences,
             (SELECT count(*) FROM cro03_enrichment_batches) AS batches`)).rows[0];
    assert.equal(Number(totals.subjects), 2914);
    assert.equal(Number(totals.observations), 2914);
    assert.equal(Number(totals.occurrences), 2914);
    assert.equal(Number(totals.batches), 5);
    assert.deepEqual(await safetyCounts(), before, "Staging must create no CRM/provider/preparation/enrollment effects");
    assert.equal(forbiddenNetworkAttempts, 0);
    assert(droppedNonblankCells > 0);
    assert.equal(dottedVendorStatusRows, 2836, "78 original rows have no vendor status");
    const result = {
      scope: "Independent parser parity and existing underlying evidence-staging boundary only; not repaired HTTP ingestion or downstream readiness",
      observedAt: new Date().toISOString(), files: receipt, aggregate: manifest.aggregate,
      noExternalHttpAttempts: true, crmProviderPreparationEnrollmentCountsUnchanged: true,
      knownCurrentRouteGaps: {
        xlsxRejected: source.includes('message: "Only CSV files are supported."'),
        originalRowNotPassedToStaging: true,
        unmappedNonblankCells: droppedNonblankCells,
        dottedVendorStatusRowsNotRetainedByCurrentMapping: dottedVendorStatusRows,
      },
      pending: ["Supported native production delivery", "Repaired shared importer replay",
        "Canonical entity/outbox/receipt/preparation trace", "Production imports and scheduled cycles"],
    };
    fs.mkdirSync("docs/certification", { recursive: true });
    fs.writeFileSync("docs/certification/canonical-enrichment-workbooks.json", JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  // Never dump failed assertion payloads containing workbook contact data.
  console.error("Workbook certification failed:", String(error.message).split("\n")[0]);
  console.error(error.stack?.split("\n").filter((line: string) => line.trim().startsWith("at ")).join("\n"));
  process.exitCode = 1;
});