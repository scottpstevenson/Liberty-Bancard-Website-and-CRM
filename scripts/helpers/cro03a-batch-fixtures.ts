import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** Real local source receipts, never dependent on production census contents. */
export async function seedCro03aBatchFixtures(label: string): Promise<string[]> {
  const { assertDisposableTestInfrastructure } = await import("../test-infrastructure-guard");
  await assertDisposableTestInfrastructure({ operation: `${label} source fixtures`, requireRedis: false });
  const { createCro03SourceBatch } = await import("../../server/services/cro03/source-staging");
  const run = randomUUID();
  const result = await createCro03SourceBatch({
    idempotencyKey: `ci-batch-${label}-${run}`,
    actorType: "system",
    actorId: `ci-batch-${label}`,
    purpose: "staging_review",
    subjects: Array.from({ length: 134 }, (_, index) => ({
      subjectType: "provider_csv_row" as const,
      subjectKey: `ci-batch-${run}-${index}`,
      sourceSystem: "apollo",
      provenance: { test: true, run, index },
      payload: {
        businessName: `CI Batch ${run} ${index}`,
        vertical: index % 3 === 0 ? "Restaurant" : index % 3 === 1 ? "Healthcare" : "Unknown",
        city: "Miami", state: index % 7 === 0 ? "GA" : "FL",
        postalCode: "33101", countyFips: "12086",
        entityStatus: index % 11 === 0 ? "inactive" : "active",
        phone: index % 5 === 0 ? null : "7865550100",
        address: index % 5 === 0 ? null : "100 Certification Ave",
      },
    })),
  });
  assert.equal(result.occurrenceIds.length, 134, "Every fixture subject has its own persisted occurrence");
  assert.equal(new Set(result.occurrenceIds).size, 134, "Fixture receipts have distinct immutable identities");
  return result.occurrenceIds;
}