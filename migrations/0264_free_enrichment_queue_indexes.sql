-- Migration 0264: Free Enrichment Queue Index & Plan Certification
--
-- Migration 0250 added businesses_free_enrich_queue_idx, covering only the
-- first branch of the free-enrichment eligibility predicate
-- (free_enrichment_status IS NULL). The worker's batch query
-- (runCanonicalBusinessEnrichmentTick) and the health depth query
-- (canonicalFreeEnrichmentQueueDepth) both also select two additional
-- branches — retryable-failed and stale-enriched — that had no index
-- coverage at all, forcing a full sequential scan of `businesses` for those
-- branches as the table grows. This migration adds the two missing partial
-- indexes. The null-status index from 0250 is left untouched.
--
-- No time-varying function (NOW(), CURRENT_TIMESTAMP, etc.) appears in
-- either predicate below — the 90-day cutoff is applied only in the query's
-- runtime WHERE clause, never baked into the index definition.

-- Branch 2: retryable failures (status='failed' AND attempt_count < 3).
-- Ordered by id to match ORDER BY id / LIMIT in the worker's batch query.
CREATE INDEX IF NOT EXISTS businesses_free_enrich_retryable_failed_idx
  ON businesses (id)
  WHERE website_domain IS NOT NULL
    AND record_class = 'canonical'
    AND free_enrichment_status = 'failed'
    AND free_enrichment_attempt_count < 3;

-- Branch 3: stale-enriched (status='enriched', re-checked after 90 days).
-- Ordered by (free_enrichment_completed_at, id) so the runtime
-- `free_enrichment_completed_at < NOW() - INTERVAL '90 days'` predicate can
-- be served as an efficient range scan instead of a full scan.
CREATE INDEX IF NOT EXISTS businesses_free_enrich_stale_idx
  ON businesses (free_enrichment_completed_at, id)
  WHERE website_domain IS NOT NULL
    AND record_class = 'canonical'
    AND free_enrichment_status = 'enriched';
