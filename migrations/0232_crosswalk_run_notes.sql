-- Migration 0232: Add run_notes jsonb to identity crosswalk runs
-- Used by the runner to record one-time run-level metadata such as tier_skips
-- (e.g. filing-number tier 2 deferred because businesses has no filing_number column).

ALTER TABLE contact_identity_reconciliation_runs
  ADD COLUMN IF NOT EXISTS run_notes jsonb;

-- Indexes for the new matching tiers added in Gen-1 v2:
-- Company + domain matching (tier 4) uses split_part(email, '@', 2) — covered by the
-- existing contacts_lower_email_crosswalk_idx; no separate index needed.
-- Business website_domain lookup (tier 4 for business candidates) — already indexed by
-- businesses_website_domain_idx in the businesses table definition.
-- Company + phone on contacts (tier 5) — phone is unindexed; regexp_replace seqscan is
-- acceptable for Gen-1 batch sizes. A GiST/pg_trgm index can be added in Gen-2.
-- No additional DDL required for this migration.
