-- Migration 0222: serper_lookup_attempts — append-only attempt telemetry for
-- structured business-identity lookups (#1768).
--
-- Records one row per strategy attempt. Never stores raw query text, response
-- bodies, email addresses, phone numbers, personal names, or full addresses.
-- Correlates attempts by a SHA-256 hash of the normalized query parameters.

CREATE TABLE IF NOT EXISTS serper_lookup_attempts (
  id                  bigserial PRIMARY KEY,
  correlation_hash    text        NOT NULL,   -- SHA-256 of normalized query params (no PII)
  caller              text        NOT NULL,   -- calling service/module (≤200 chars)
  strategy_version    integer     NOT NULL DEFAULT 1,
  strategy_name       text        NOT NULL,   -- e.g. "places_primary_name", "search_fallback"
  endpoint            text        NOT NULL,   -- "/places" or "/search"
  outcome_kind        text        NOT NULL,   -- "blocked"|"provider_failure"|"no_result"|"identity_rejected"|"ambiguous"|"accepted_match"
  outcome_reason      text,                   -- sub-reason code (no PII)
  result_count        integer     NOT NULL DEFAULT 0,
  accepted_count      integer     NOT NULL DEFAULT 0,
  rejected_count      integer     NOT NULL DEFAULT 0,
  yield_website       boolean     NOT NULL DEFAULT false,
  yield_phone         boolean     NOT NULL DEFAULT false,
  yield_address       boolean     NOT NULL DEFAULT false,
  yield_category      boolean     NOT NULL DEFAULT false,
  elapsed_ms          integer     NOT NULL DEFAULT 0,
  billed_units        integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by correlation hash for canary reporting
CREATE INDEX IF NOT EXISTS idx_serper_lookup_attempts_correlation
  ON serper_lookup_attempts (correlation_hash);

-- Fast lookup by strategy for aggregate reporting
CREATE INDEX IF NOT EXISTS idx_serper_lookup_attempts_strategy
  ON serper_lookup_attempts (strategy_name, outcome_kind);

-- Fast lookup by time for rolling-window analytics
CREATE INDEX IF NOT EXISTS idx_serper_lookup_attempts_created_at
  ON serper_lookup_attempts (created_at);

-- outcome_kind constraint
ALTER TABLE serper_lookup_attempts
  ADD CONSTRAINT serper_lookup_attempts_outcome_kind_check
  CHECK (outcome_kind IN ('blocked','provider_failure','no_result','identity_rejected','ambiguous','accepted_match'));
