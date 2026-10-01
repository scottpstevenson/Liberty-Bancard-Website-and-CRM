import { sql } from "drizzle-orm";

export const STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE = 5_000;

export function chunkSfpBusinessIds(
  businessIds: number[],
  chunkSize = STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE,
): number[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > STALE_EVIDENCE_BUSINESS_ID_BATCH_SIZE) {
    throw new Error("SFP_STALE_EVIDENCE_CHUNK_SIZE_INVALID");
  }
  const uniqueIds = [...new Set(businessIds)];
  if (uniqueIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error("SFP_STALE_EVIDENCE_BUSINESS_ID_INVALID");
  }
  const chunks: number[][] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    chunks.push(uniqueIds.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export async function findStaleSfpClassificationEvidenceBusinessIds(
  businessIds: number[],
  versions: { policyVersion: number; classifierVersion: number; taxonomyVersion: number },
  executor: { execute: (query: any) => Promise<any> },
): Promise<Set<number>> {
  const staleIds = new Set<number>();
  for (const chunk of chunkSfpBusinessIds(businessIds)) {
    const result = await executor.execute(sql`
      SELECT DISTINCT business_id
        FROM sfp_classification_evidence
       WHERE business_id = ANY(ARRAY[${sql.join(chunk.map((id) => sql`${id}::int`), sql`, `)}]::integer[])
         AND NOT (
           policy_version = ${versions.policyVersion}
           AND classifier_version = ${versions.classifierVersion}
           AND taxonomy_version = ${versions.taxonomyVersion}
         )
    `);
    const foundRows: any[] = Array.isArray(result?.rows) ? result.rows : Array.isArray(result) ? result : [];
    for (const row of foundRows) {
      const businessId = Number(row.business_id);
      if (Number.isSafeInteger(businessId) && businessId > 0) staleIds.add(businessId);
    }
  }
  return staleIds;
}