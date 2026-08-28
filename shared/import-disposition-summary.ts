/**
 * The import ledger is the authority for these terminal outcomes. Keep this
 * browser-safe so API callers and Lead Imports render the same six buckets.
 */
export const IMPORT_DISPOSITIONS = [
  "created",
  "matched_noop",
  "updated",
  "rejected",
  "deferred",
  "failed",
] as const;

export type ImportDisposition = typeof IMPORT_DISPOSITIONS[number];
export type ImportDispositionCounts = Record<ImportDisposition, number>;

export function zeroImportDispositionCounts(): ImportDispositionCounts {
  return {
    created: 0,
    matched_noop: 0,
    updated: 0,
    rejected: 0,
    deferred: 0,
    failed: 0,
  };
}

export function normalizeImportDispositionCounts(
  counts: Partial<Record<string, number | string | null | undefined>>,
): ImportDispositionCounts {
  const normalized = zeroImportDispositionCounts();
  for (const disposition of IMPORT_DISPOSITIONS) {
    const value = Number(counts[disposition] ?? 0);
    normalized[disposition] = Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return normalized;
}

export function summarizeImportDispositionCounts(
  counts: Partial<Record<string, number | string | null | undefined>>,
) {
  const normalized = normalizeImportDispositionCounts(counts);
  return {
    counts: normalized,
    total: IMPORT_DISPOSITIONS.reduce((total, disposition) => total + normalized[disposition], 0),
  };
}

/** Existing response fields retained while exposing every durable outcome. */
export function importDispositionCompatibility(
  counts: Partial<Record<string, number | string | null | undefined>>,
) {
  const summary = summarizeImportDispositionCounts(counts);
  return {
    ...summary.counts,
    counts: summary.counts,
    inserted: summary.counts.created,
    duplicatesSkipped: summary.counts.matched_noop,
    invalidRows: summary.counts.rejected,
    skippedRows: summary.counts.deferred,
    errors: summary.counts.failed,
    total: summary.total,
  };
}