-- Durable attribution and restart-safe completion for provider-side async
-- retrievals. The task's provider request identity remains stable; polls are
-- separate, fenced provider operations and never masquerade as task results.
CREATE TABLE sfp_provider_retrieval_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider = 'outscraper'),
  task_kind text NOT NULL CHECK (task_kind IN ('maps_search', 'leads_and_contacts')),
  provider_task_id text NOT NULL,
  provider_reference text,
  submission_operation_id uuid NOT NULL REFERENCES provider_operations(id) ON DELETE RESTRICT,
  completion_operation_id uuid REFERENCES provider_operations(id) ON DELETE RESTRICT,
  contact_operation_id uuid REFERENCES provider_operations(id) ON DELETE RESTRICT,
  stage_run_id uuid NOT NULL REFERENCES sfp_stage_runs(id) ON DELETE CASCADE,
  cohort_run_id uuid NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE CASCADE,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  business_name_snapshot text NOT NULL,
  domain_snapshot text,
  city_snapshot text,
  state_snapshot text,
  state text NOT NULL DEFAULT 'submitted'
    CHECK (state IN ('submitted', 'polling', 'completed', 'no_result', 'failed', 'expired')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  -- Retained only when the provider contract actually supplies a completion
  -- timestamp. Current GET /requests/{requestId} documentation does not.
  provider_completed_at timestamptz,
  completion_time_lower_bound_at timestamptz NOT NULL,
  completion_time_bound_kind text NOT NULL
    CHECK (completion_time_bound_kind IN ('provider_completed_at', 'last_pending_observed', 'submission_started')),
  -- Conservative do-not-poll-after bound; not a claim about the provider's
  -- exact expiration instant when based on a lower-bound timestamp.
  results_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text,
  completed_result_count integer,
  completed_result_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT sfp_provider_retrieval_task_expiry_chk CHECK (expires_at > submitted_at),
  CONSTRAINT sfp_provider_retrieval_task_results_expiry_chk CHECK (
    (provider_completed_at IS NOT NULL
      AND completion_time_bound_kind = 'provider_completed_at'
      AND completion_time_lower_bound_at = provider_completed_at
      AND results_expires_at = provider_completed_at + INTERVAL '4 hours')
    OR
    (provider_completed_at IS NULL
      AND completion_time_bound_kind IN ('last_pending_observed', 'submission_started')
      AND results_expires_at = completion_time_lower_bound_at + INTERVAL '4 hours')
  ),
  CONSTRAINT sfp_provider_retrieval_task_result_count_chk
    CHECK (completed_result_count IS NULL OR completed_result_count >= 0),
  CONSTRAINT sfp_provider_retrieval_task_lease_chk CHECK (
    (state = 'polling' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'polling' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT sfp_provider_retrieval_task_hashes_array_chk
    CHECK (jsonb_typeof(completed_result_hashes) = 'array'),
  CONSTRAINT sfp_provider_retrieval_task_provider_id_uidx UNIQUE (provider, provider_task_id)
);

CREATE INDEX sfp_provider_retrieval_tasks_claim_idx
  ON sfp_provider_retrieval_tasks(state, next_poll_at, lease_expires_at, submitted_at)
  WHERE state IN ('submitted', 'polling');

CREATE INDEX sfp_provider_retrieval_tasks_business_idx
  ON sfp_provider_retrieval_tasks(business_id, submitted_at DESC);

CREATE INDEX sfp_provider_retrieval_tasks_stage_idx
  ON sfp_provider_retrieval_tasks(stage_run_id, business_id, state);