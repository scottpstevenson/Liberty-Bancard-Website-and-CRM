-- Migration 0058: Add readiness_breakdown JSONB to campaign_previews as a
-- first-class column so that the 4-category readiness breakdown (excludedByReadiness,
-- blockedByContactability, alreadyQueued, queueable) is stored separately from
-- contactability blockReasons.  This removes the reliance on __ magic-key encoding
-- inside blockReasons.
ALTER TABLE campaign_previews ADD COLUMN IF NOT EXISTS readiness_breakdown JSONB;
