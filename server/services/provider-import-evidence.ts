import { pool } from "../db";
import { providerCsvSourceSubject } from "./cro03a/adapters";
import { createCro03SourceBatch,hashCro03Evidence } from "./cro03/source-staging";
import { mapProviderCsvRow } from "./provider-import-columns";
import { computeFileHash } from "./import-normalizer";
import type { ImportSourceCoordinate } from "./tabular-import-reader";
import {db} from "../db";
import {verifyProviderImportIdentity} from "./provider-import-identity";

/** JSONB reorders object keys. Keep the original acquisition fingerprint when
 * the exact retained row is recovered, rather than re-hashing JSON.stringify
 * and silently giving an immutable observation a different identity. */
export async function providerImportRowFingerprint(input:{
  executionId:string;sourceRowNumber:number;rawRow:Record<string,string>;
}):Promise<string> {
  const identity=await verifyProviderImportIdentity(db,input);
  return identity?.fingerprint ?? computeFileHash(Buffer.from(JSON.stringify(input.rawRow)));
}

/**
 * One evidence boundary for live uploads and restart recovery. Existing mapped
 * observations remain immutable; raw rows get a versioned representation of
 * the SAME source subject, not a second business/contact or provider operation.
 */
export async function retainProviderImportRow(input: {
  executionId: string; sourceRowNumber: number; sourceFormat: string;
  actorId: string; rawRow: Record<string, string>;
  sourceCoordinate?: ImportSourceCoordinate;
  fileName?: string;
  authorityCheck?: (tx: any) => Promise<boolean>;
}): Promise<void> {
  const { executionId, sourceRowNumber, sourceFormat, actorId, rawRow } = input;
  if (!["google_maps_outscraper", "apollo_lead_list"].includes(sourceFormat)) {
    throw new Error("PROVIDER_IMPORT_FORMAT_UNSUPPORTED");
  }
  const rowFingerprint = await providerImportRowFingerprint(input);
  const identity=await verifyProviderImportIdentity(db,input);
  const mapped = mapProviderCsvRow(rawRow, sourceFormat);
  const draft = providerCsvSourceSubject({
    importExecutionId: executionId, sourceRowNumber,
    sourceSystem: sourceFormat === "google_maps_outscraper" ? "outscraper" : "apollo",
    row: { ...mapped, ...(mapped.vertical ? { industry: mapped.vertical } : {}) },
  });
  const idempotencyKey = `csv-source:${executionId}:${sourceRowNumber}`;
  const original = await pool.query(`
    SELECT o.payload,b.total_count
      FROM cro03_enrichment_batches b
      JOIN cro03_batch_memberships m ON m.batch_id=b.id
      JOIN cro03_source_observations o ON o.id=m.source_observation_id
     WHERE b.idempotency_key=$1`, [idempotencyKey]);
  if (original.rows.length) {
    const old = original.rows[0];
    if (original.rows.length !== 1 || Number(old.total_count) !== 1
      || old.payload?.rowFingerprint !== (identity?.mappedFingerprint ?? rowFingerprint)
      || Number(old.payload?.sourceRowNumber) !== sourceRowNumber
      || old.payload?.sourceFormat !== sourceFormat) {
      throw new Error("PROVIDER_IMPORT_ORIGINAL_EVIDENCE_MISMATCH");
    }
  } else {
    await createCro03SourceBatch({
      authorityCheck:input.authorityCheck,
      idempotencyKey, actorType: "import", actorId, purpose: "staging_review",
      subjects: [{
        ...draft,
        payload: { ...draft.payload, sourceRowNumber, rowFingerprint, sourceFormat },
        provenance: { ...draft.provenance, rowFingerprint, sourceFormat },
      }],
    });
  }
  // Candidate values intentionally stay empty on the extra raw representation:
  // it preserves evidence without duplicating arbitration candidates.
  await createCro03SourceBatch({
    authorityCheck:input.authorityCheck,
    idempotencyKey: `csv-source-raw-${identity?.bridged ? "v3" : "v2"}:${executionId}:${sourceRowNumber}`,
    actorType: "import", actorId, purpose: "staging_review",
    subjects: [{
      ...draft, candidateValues: {},
      payload: { rawSourceRow: rawRow, sourceRowNumber, rowFingerprint, sourceFormat,
        sourceCoordinate: input.sourceCoordinate ?? null, fileName: input.fileName ?? null,
        coordinatePrecision: input.sourceCoordinate ? "original" : "logical_record_only" },
      provenance: { ...draft.provenance, rowFingerprint, sourceFormat, representation: "original_row_v2" },
    }],
  });
}