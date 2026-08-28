-- CRO-03 completion: append-only command evidence and truthful terminal accounting.
-- No provider is enabled or contacted by this migration.

ALTER TABLE cro03_enrichment_batches
  ADD COLUMN IF NOT EXISTS command_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS superseded_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_count INTEGER NOT NULL DEFAULT 0;
UPDATE cro03_enrichment_batches
   SET command_fingerprint = COALESCE(command_fingerprint,
       md5(idempotency_key || ':' || selection_hash || ':' || purpose || ':' ||
           selection_policy_version::text || ':' || routing_policy_version::text));
ALTER TABLE cro03_enrichment_batches
  ALTER COLUMN command_fingerprint SET NOT NULL,
  ALTER COLUMN command_fingerprint SET DEFAULT 'legacy_unversioned';
CREATE UNIQUE INDEX IF NOT EXISTS cro03_batches_idempotency_command_uidx
  ON cro03_enrichment_batches(idempotency_key, command_fingerprint);

ALTER TABLE cro03_batch_memberships
  ADD COLUMN IF NOT EXISTS subject_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subject_snapshot_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS frozen_route_plan JSONB NOT NULL DEFAULT '{"providers":[],"recipes":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS route_plan_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS discovery_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS paid_enrichment_eligible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cro03_enrichment_items
  ADD COLUMN IF NOT EXISTS subject_snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS route_plan_hash TEXT;

ALTER TABLE cro03_provider_runs
  ADD COLUMN IF NOT EXISTS outcome_code TEXT,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES cro03_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider_attempt_id UUID REFERENCES provider_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS validation_intent_id UUID REFERENCES validation_intents(id) ON DELETE RESTRICT;

ALTER TABLE provider_observations
  DROP CONSTRAINT IF EXISTS provider_observations_outcome_chk;
ALTER TABLE provider_observations
  ADD CONSTRAINT provider_observations_outcome_chk CHECK (outcome IN
    ('valid','invalid','risky','unknown','success','not_configured','disabled',
     'budget_blocked','budget_exhausted','circuit_blocked','circuit_open',
     'rate_limited','rejected','timeout','transport','provider_error',
     'invalid_input','parse_error','ambiguous_billing','no_result',
     'conflict','excluded','cancelled','superseded'));

-- A batch must always reconcile exactly: total = all terminal buckets + outstanding.
CREATE OR REPLACE FUNCTION cro03_refresh_batch_accounting()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch UUID := COALESCE(NEW.batch_id, OLD.batch_id);
BEGIN
  UPDATE cro03_enrichment_batches b
     SET blocked_count = s.blocked_count,
         completed_count = s.completed_count,
         failed_count = s.failed_count,
         cancelled_count = s.cancelled_count,
         superseded_count = s.superseded_count,
         outstanding_count = s.outstanding_count,
         state = CASE
           WHEN b.cancel_requested_at IS NOT NULL AND s.outstanding_count = 0 THEN 'cancelled'
           WHEN s.outstanding_count > 0 AND
                (s.completed_count + s.failed_count + s.cancelled_count + s.superseded_count) > 0
             THEN 'running'
           WHEN s.outstanding_count > 0 THEN b.state
           WHEN s.completed_count = 0 AND
                (s.failed_count + s.superseded_count) > 0 THEN 'failed'
           WHEN s.completed_count > 0 AND
                (s.failed_count + s.cancelled_count + s.superseded_count) > 0
             THEN 'partially_completed'
           ELSE 'completed'
         END,
         completed_at = CASE
           WHEN s.outstanding_count = 0 THEN COALESCE(b.completed_at, NOW())
           ELSE NULL
         END,
         updated_at = NOW()
    FROM (
      SELECT batch_id,
        COUNT(*) FILTER (WHERE state = 'blocked')::int blocked_count,
        COUNT(*) FILTER (WHERE state = 'completed')::int completed_count,
        COUNT(*) FILTER (WHERE state = 'failed')::int failed_count,
        COUNT(*) FILTER (WHERE state = 'cancelled')::int cancelled_count,
        COUNT(*) FILTER (WHERE state = 'superseded')::int superseded_count,
        COUNT(*) FILTER (WHERE state IN ('queued','running','waiting'))::int outstanding_count
      FROM cro03_enrichment_items WHERE batch_id = batch GROUP BY batch_id
    ) s
   WHERE b.id = s.batch_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cro03_item_accounting_refresh ON cro03_enrichment_items;
CREATE TRIGGER cro03_item_accounting_refresh
AFTER INSERT OR UPDATE OR DELETE ON cro03_enrichment_items
FOR EACH ROW EXECUTE FUNCTION cro03_refresh_batch_accounting();

-- The existing membership immutability trigger makes these versioned snapshots
-- and plans append-only.  Provider run receipt links are mutable only while a
-- run settles; receipts and ledger rows remain immutable evidence.