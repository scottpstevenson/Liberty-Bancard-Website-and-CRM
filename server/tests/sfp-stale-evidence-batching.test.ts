import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  chunkSfpBusinessIds,
  findStaleSfpClassificationEvidenceBusinessIds,
  STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE,
} from "../services/cro03/sfp-stale-classification-evidence";

const root = path.resolve(import.meta.dirname, "../..");
const selectorSource = fs.readFileSync(path.join(root, "server/services/cro03/roi-cohort-selector.ts"), "utf8");
const stagingSource = fs.readFileSync(path.join(root, "server/services/cro03/sfp-campaign-staging-v2.ts"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "server/routes/lead-ops.ts"), "utf8");

const inputIds = Array.from({ length: 10_002 }, (_, index) => index + 1);
assert.deepEqual(
  chunkSfpBusinessIds([...inputIds, 1]).map((chunk) => chunk.length),
  [5_000, 5_000, 2],
  "the stale-evidence lookup deduplicates IDs and bounds each SQL parameter list",
);
assert.throws(() => chunkSfpBusinessIds([1, 0]), /SFP_STALE_EVIDENCE_BUSINESS_ID_INVALID/);
assert.throws(() => chunkSfpBusinessIds([1], STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE + 1), /SFP_STALE_EVIDENCE_CHUNK_SIZE_INVALID/);

const queryBatchSizes: number[] = [];
const staleIds = await findStaleSfpClassificationEvidenceBusinessIds(
  inputIds,
  { policyVersion: 2, classifierVersion: 2, taxonomyVersion: 2 },
  {
    execute: async (statement) => {
      const compiled = new PgDialect().sqlToQuery(statement);
      queryBatchSizes.push(compiled.params.length);
      assert(compiled.params.length <= STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE + 3);
      const callsBeforeThisQuery = queryBatchSizes.length;
      const returnedId = callsBeforeThisQuery === 1 ? 1 : callsBeforeThisQuery === 2 ? 5_001 : 10_002;
      return { rows: [{ business_id: returnedId }] };
    },
  },
);
assert.deepEqual(queryBatchSizes, [5_003, 5_003, 5]);
assert.deepEqual([...staleIds], [1, 5_001, 10_002]);

assert.match(selectorSource, /findStaleSfpClassificationEvidenceBusinessIds\(/);
assert.match(stagingSource, /stagedIntents:\s*Array<\{ eligibilityId: string; intentId: string \}>/);
assert.match(stagingSource, /stagedIntents\.push\(\{ eligibilityId: previewRow\.eligibilityId, intentId \}\)/);
assert.match(stagingSource, /return String\(intent\.id\)/);
assert.match(routeSource, /app\.post\(\"\/api\/lead-ops\/sfp\/campaign-staging-v2\/execute\", requireRole\(\"admin\"\)/);
assert.match(routeSource, /res\.json\(result\);/);

console.log("SFP stale-evidence batching and admin staging-intent receipt assertions passed");