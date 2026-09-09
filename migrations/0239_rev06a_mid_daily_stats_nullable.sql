-- REV-06A (Task #1737): Make optional mid_daily_stats columns nullable.
--
-- The provider (Payarc /merchant_statements) may not include every metric field
-- for every statement record. Storing absent values as 0 fabricates zero-dollar
-- activity where the provider reported nothing — this contradicts the fail-closed,
-- no-zero-fill semantics required by §10.
--
-- These columns drop their DEFAULT 0 constraint and allow NULL so that:
--   - An absent provider field is stored as NULL (not 0).
--   - An ON CONFLICT UPDATE clears stale prior values to NULL when the refreshed
--     record no longer carries that field, rather than retaining the old value.
--   - Consumers (churn-score, attrition-monitor) must COALESCE(col, 0) where a
--     running total is needed, rather than assuming 0 means "no activity".

ALTER TABLE mid_daily_stats
  ALTER COLUMN tx_count      DROP DEFAULT,
  ALTER COLUMN avg_ticket    DROP DEFAULT,
  ALTER COLUMN effective_rate DROP DEFAULT,
  ALTER COLUMN chargeback_count DROP DEFAULT,
  ALTER COLUMN chargeback_amount DROP DEFAULT,
  ALTER COLUMN refund_count  DROP DEFAULT;

-- volume is the primary required field (always present after fail-closed validation);
-- it keeps NOT NULL. The default(0) is dropped to match the notNull() schema definition.
ALTER TABLE mid_daily_stats
  ALTER COLUMN volume DROP DEFAULT;
