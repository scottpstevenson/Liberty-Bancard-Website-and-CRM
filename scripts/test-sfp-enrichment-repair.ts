/**
 * Provider-free regression for the actual high-confidence preview.
 * DB execute is replaced before any function runs; no fixture is persisted.
 */
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "../server/db";
import { previewHighConfidenceClassificationCandidates } from "../server/services/cro03/sfp-classification-bridge";

const dialect = new PgDialect();
const originalExecute = db.execute;
const idsSeen = new Set<number>();
const batchSizes: number[] = [];
let maxBindCount = 0;
const businesses = Array.from({ length: 85_000 }, (_, index) => ({
  id: index + 1,
  canonical_name: `Neutral business ${index + 1}`,
  vertical: index >= 84_997 ? "Automotive" : null,
  city: "Miami", state: "FL", postal_code: "33101",
}));

(db as any).execute = async (query: any) => {
  const compiled = dialect.sqlToQuery(query);
  maxBindCount = Math.max(maxBindCount, compiled.params.length);
  const ids = compiled.params.filter((value): value is number => typeof value === "number");
  if (compiled.sql.includes("FROM sfp_programs")) return { rows: [{
    id: "00000000-0000-4000-8000-000000000001", taxonomy_version: 2, policy_version: 1,
    county_fips: ["12086"], vertical_ids: ["Automotive"],
  }] };
  if (compiled.sql.includes("FROM business_locations")) {
    batchSizes.push(ids.length);
    ids.forEach((id) => idsSeen.add(id));
    return { rows: ids.map((id) => ({
      id, business_id: id, is_primary: true, city: "Miami", state: "FL",
      postal_code: "33101", county_fips: "12086",
    })) };
  }
  if (compiled.sql.includes("AS exclusion_reason")) return { rows:
    ids.includes(84_998) ? [{ business_id: 84_998, exclusion_reason: "dbpr" }] : [] };
  if (compiled.sql.includes("LOWER(COALESCE(status")) return { rows:
    ids.includes(84_999) ? [{ id: 84_999 }] : [] };
  if (compiled.sql.includes("FROM businesses")) return { rows: businesses };
  throw new Error(`Unexpected preview query: ${compiled.sql.slice(0, 80)}`);
};

try {
  const result = await previewHighConfidenceClassificationCandidates("00000000-0000-4000-8000-000000000001");
  assert.equal(idsSeen.size, 85_000, "all businesses must be examined before ranking");
  assert.equal(batchSizes.length, 22, "large populations must use bounded location lookups");
  assert.ok(batchSizes.every((size) => size <= 4000));
  assert.ok(maxBindCount < 5000, "locations AND both exclusion lookups must stay below the bind limit");
  assert.ok(result.candidates.some((row) => row.businessId === 85_000), "late-ID high-confidence business must not be truncated");
  assert.equal(result.candidates.find((row) => row.businessId === 84_998)?.exclusionStatus, "dbpr");
  assert.equal(result.candidates.find((row) => row.businessId === 84_999)?.exclusionStatus, "business_wide_suppression");
  assert.ok(result.candidates.every((row) => row.proposedVerticalId === "Automotive"));
  console.log("PASS: 85,000-business preview; bounded binds, complete ranking, DBPR and suppression preserved; no DB/provider writes.");
} finally {
  (db as any).execute = originalExecute;
  await pool.end();
}