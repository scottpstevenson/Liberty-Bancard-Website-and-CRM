-- Migration 0149: Unique partial index on statement_proposals(deal_id)
--
-- Prevents duplicate proposal rows for the same deal when the upload chain
-- and the AI analyzer race concurrently (Task #1639 concurrency fix).
--
-- Production already has zero duplicate non-null deal_id groups, so this
-- CREATE UNIQUE INDEX can run without a prior dedup pass.
--
-- The partial predicate (WHERE deal_id IS NOT NULL) allows unlimited rows
-- where deal_id is NULL (contact-only proposals without a deal).

CREATE UNIQUE INDEX IF NOT EXISTS statement_proposals_deal_id_uidx
  ON statement_proposals (deal_id)
  WHERE deal_id IS NOT NULL;
