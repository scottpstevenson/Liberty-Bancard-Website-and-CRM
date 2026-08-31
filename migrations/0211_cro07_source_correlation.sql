-- CRO-07 immutable webhook-source correlation (companion to 0210's
-- provider_account_id correlation).
--
-- Fixes a second code-review finding: the 0210 fix bound provider_account_id
-- to each attempt, but feedback ingestion never verified that the webhook
-- `source` path segment (which selects the HMAC secret used to sign the
-- request) also matched the source that attempt was actually approved
-- under. Without this, a holder of a valid signing key for their OWN
-- registered source could sign a correctly-formed event under that source
-- while naming a DIFFERENT attempt's provider_account_id, and the account
-- check alone would incorrectly pass.
--
-- provider_source is populated once, at release-creation time (the
-- release's approved webhook source is a first-class immutable input, like
-- sender_route), copied onto the attempt at claim time exactly like
-- provider_account_id, and both must match the incoming signed event
-- before ingestCro07Feedback treats the correlation as resolved.
ALTER TABLE cro07_releases ADD COLUMN IF NOT EXISTS provider_source text;
ALTER TABLE cro07_attempts ADD COLUMN IF NOT EXISTS provider_source text;
