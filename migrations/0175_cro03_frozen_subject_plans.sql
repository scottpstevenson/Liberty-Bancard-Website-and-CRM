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

-- 0174 did not persist its routing inputs.  Freeze the only deterministic
-- legacy evidence available (the membership-bound contact) before any worker
-- can read these rows.  A membership without that evidence is not executable:
-- it is terminally superseded rather than routed from a mutable contact later.
ALTER TABLE cro03_batch_memberships DISABLE TRIGGER cro03_membership_immutable;
WITH legacy AS (
  SELECT m.id,
    jsonb_build_object(
      'id', c.id, 'businessId', c.business_id, 'companyName', c.company_name,
      'title', c.title, 'website', c.website, 'phone', c.phone, 'email', c.email,
      'emailStatus', c.email_status, 'city', c.city, 'state', c.state,
      'industry', c.industry
    ) AS snapshot,
    CASE
      WHEN c.company_name IS NOT NULL AND c.business_id IS NULL
       AND c.website IS NULL AND c.phone IS NULL THEN ARRAY['outscraper']::text[]
      WHEN c.company_name IS NOT NULL AND (c.title IS NULL OR c.title = '') THEN ARRAY['apollo']::text[]
      WHEN c.website IS NULL OR c.phone IS NULL THEN ARRAY['serper']::text[]
      ELSE ARRAY[]::text[]
    END ||
    CASE WHEN c.email IS NOT NULL AND c.email NOT LIKE '%no-email-%'
               AND COALESCE(c.email_status, '') NOT IN ('valid','invalid','risky')
         THEN ARRAY['zerobounce']::text[] ELSE ARRAY[]::text[] END AS providers
  FROM cro03_batch_memberships m
  JOIN contacts c ON c.id = m.contact_id
  WHERE m.subject_snapshot = '{}'::jsonb
     OR m.frozen_route_plan = '{"providers":[],"recipes":[]}'::jsonb
)
UPDATE cro03_batch_memberships m
   SET subject_snapshot = legacy.snapshot,
       subject_snapshot_hash = md5(legacy.snapshot::text),
       frozen_route_plan = jsonb_build_object(
         'policyVersion', 1, 'providers', to_jsonb(legacy.providers),
         'stopReasons', jsonb_build_array('legacy_0174_frozen_at_migration'),
         'recipes', (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'provider', p,
             'operation', CASE p WHEN 'zerobounce' THEN 'email_validation_backlink'
               WHEN 'outscraper' THEN 'business_discovery' WHEN 'apollo' THEN 'contact_enrichment'
               ELSE 'search_enrichment' END,
             'requiresPaidEligibility', p = 'apollo'
           )), '[]'::jsonb)
           FROM unnest(legacy.providers) AS p
         )
       ),
       route_plan_hash = md5(jsonb_build_object(
         'policyVersion', 1, 'providers', to_jsonb(legacy.providers),
         'stopReasons', jsonb_build_array('legacy_0174_frozen_at_migration')
       )::text)
  FROM legacy WHERE m.id = legacy.id;

UPDATE cro03_batch_memberships
   SET disposition = 'superseded',
       disposition_reason = 'legacy_frozen_evidence_unavailable'
 WHERE subject_snapshot = '{}'::jsonb
    OR COALESCE((frozen_route_plan->>'policyVersion')::integer, 0) < 1
    OR jsonb_typeof(frozen_route_plan->'providers') <> 'array';
UPDATE cro03_enrichment_items i
   SET state = 'superseded', terminal_code = 'legacy_frozen_evidence_unavailable',
       claim_token = NULL, lease_expires_at = NULL, completed_at = COALESCE(completed_at, NOW()),
       updated_at = NOW()
  FROM cro03_batch_memberships m
 WHERE i.membership_id = m.id AND m.disposition = 'superseded'
   AND i.state IN ('queued','running','waiting');
ALTER TABLE cro03_batch_memberships ENABLE TRIGGER cro03_membership_immutable;

ALTER TABLE cro03_provider_runs
  ADD COLUMN IF NOT EXISTS outcome_code TEXT,
  ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_request_hash TEXT,
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES cro03_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider_attempt_id UUID REFERENCES provider_attempts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS validation_intent_id UUID REFERENCES validation_intents(id) ON DELETE RESTRICT;

ALTER TABLE cro03_receipts ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE cro03_receipts DISABLE TRIGGER cro03_receipt_immutable;
UPDATE cro03_receipts receipt
   SET provider = run.provider
  FROM cro03_provider_runs run
 WHERE receipt.provider_run_id = run.id AND receipt.provider IS NULL;
ALTER TABLE cro03_receipts ENABLE TRIGGER cro03_receipt_immutable;
ALTER TABLE cro03_receipts ALTER COLUMN provider SET NOT NULL;

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
-- The legacy supersession above predates this trigger; touch those terminal
-- rows once so persisted batch counters reconcile immediately.
UPDATE cro03_enrichment_items SET updated_at = updated_at
 WHERE state = 'superseded' AND terminal_code = 'legacy_frozen_evidence_unavailable';

-- The existing membership immutability trigger makes these versioned snapshots
-- and plans append-only.  Provider run receipt links are mutable only while a
-- run settles; receipts and ledger rows remain immutable evidence.

-- Ledger evidence is an append-only two-event lineage: reservation followed by
-- exactly one terminal settlement.  Existing one-row ledgers are normalized
-- while the migration is applied, then database guards prohibit mutation.
ALTER TABLE cro03_provider_ledger
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'reservation',
  ADD COLUMN IF NOT EXISTS reservation_entry_id UUID REFERENCES cro03_provider_ledger(id) ON DELETE RESTRICT;
UPDATE cro03_provider_ledger SET event_type = 'terminal'
 WHERE disposition <> 'outstanding';
INSERT INTO cro03_provider_ledger
  (provider_run_id, provider_operation_id, provider, entry_key, event_type, disposition, units, amount_micros)
SELECT l.provider_run_id, l.provider_operation_id, l.provider, 'reserve:legacy:' || l.id,
       'reservation', 'outstanding', l.units, l.amount_micros
  FROM cro03_provider_ledger l
 WHERE l.event_type = 'terminal' AND l.reservation_entry_id IS NULL;
UPDATE cro03_provider_ledger terminal
   SET reservation_entry_id = reservation.id
  FROM cro03_provider_ledger reservation
 WHERE terminal.event_type = 'terminal' AND terminal.reservation_entry_id IS NULL
   AND reservation.entry_key = 'reserve:legacy:' || terminal.id;
ALTER TABLE cro03_provider_ledger
  ADD CONSTRAINT cro03_ledger_event_type_chk CHECK (event_type IN ('reservation','terminal')),
  ADD CONSTRAINT cro03_ledger_terminal_lineage_chk CHECK (
    (event_type = 'reservation' AND reservation_entry_id IS NULL AND disposition = 'outstanding')
    OR (event_type = 'terminal' AND reservation_entry_id IS NOT NULL AND disposition IN ('consumed','released','refunded','ambiguous'))
  );
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_run
  ON cro03_provider_ledger(provider_run_id) WHERE event_type = 'reservation';
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_reservation_per_operation
  ON cro03_provider_ledger(provider_operation_id)
  WHERE event_type = 'reservation' AND provider_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cro03_ledger_one_terminal_per_run
  ON cro03_provider_ledger(provider_run_id) WHERE event_type = 'terminal';
CREATE OR REPLACE FUNCTION cro03_validate_ledger_terminal_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
    FROM cro03_provider_runs run
    JOIN provider_operations operation ON operation.id = NEW.provider_operation_id
   WHERE run.id = NEW.provider_run_id
     AND run.operation_id = NEW.provider_operation_id
     AND run.provider = NEW.provider
     AND operation.provider = NEW.provider
   FOR UPDATE OF run, operation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRO03_LEDGER_RUN_OPERATION_PROVIDER_MISMATCH';
  END IF;

  IF NEW.event_type = 'terminal' AND NOT EXISTS (
    SELECT 1 FROM cro03_provider_ledger reservation
     WHERE reservation.id = NEW.reservation_entry_id
       AND reservation.event_type = 'reservation'
       AND reservation.provider_run_id = NEW.provider_run_id
       AND reservation.provider_operation_id IS NOT DISTINCT FROM NEW.provider_operation_id
       AND reservation.provider = NEW.provider
       AND reservation.units = NEW.units
       AND reservation.amount_micros = NEW.amount_micros
  ) THEN
    RAISE EXCEPTION 'CRO03_LEDGER_LINEAGE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro03_ledger_lineage_guard ON cro03_provider_ledger;
CREATE TRIGGER cro03_ledger_lineage_guard
  BEFORE INSERT OR UPDATE ON cro03_provider_ledger
  FOR EACH ROW EXECUTE FUNCTION cro03_validate_ledger_terminal_lineage();

CREATE OR REPLACE FUNCTION cro03_validate_receipt_lineage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1
    FROM cro03_provider_runs run
    JOIN provider_operations operation ON operation.id = NEW.provider_operation_id
   WHERE run.id = NEW.provider_run_id
     AND run.operation_id = NEW.provider_operation_id
     AND run.provider = NEW.provider
     AND operation.provider = NEW.provider
   FOR UPDATE OF run, operation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRO03_RECEIPT_RUN_OPERATION_PROVIDER_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cro03_provider_ledger ledger
     WHERE ledger.provider_run_id = NEW.provider_run_id
       AND ledger.provider_operation_id = NEW.provider_operation_id
       AND ledger.provider = NEW.provider
       AND ledger.units = NEW.units
       AND ledger.amount_micros = NEW.amount_micros
       AND (
         (NEW.billing_disposition = 'outstanding'
          AND ledger.event_type = 'reservation' AND ledger.disposition = 'outstanding')
         OR
         (NEW.billing_disposition <> 'outstanding'
          AND ledger.event_type = 'terminal'
          AND ledger.disposition = NEW.billing_disposition)
       )
  ) THEN
    RAISE EXCEPTION 'CRO03_RECEIPT_LEDGER_LINEAGE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cro03_receipt_lineage_guard ON cro03_receipts;
CREATE TRIGGER cro03_receipt_lineage_guard
  BEFORE INSERT OR UPDATE ON cro03_receipts
  FOR EACH ROW EXECUTE FUNCTION cro03_validate_receipt_lineage();
DROP TRIGGER IF EXISTS cro03_ledger_immutable ON cro03_provider_ledger;
CREATE TRIGGER cro03_ledger_immutable
  BEFORE UPDATE OR DELETE ON cro03_provider_ledger
  FOR EACH ROW EXECUTE FUNCTION cro03_immutable_row_guard();