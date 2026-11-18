-- Task 2161: no provider activation, program seed or schedule enablement occurs here.
CREATE TABLE discovery_schedules (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 daily_dispatch_count integer NOT NULL DEFAULT 1 CHECK(daily_dispatch_count BETWEEN 1 AND 1000),
 timezone text NOT NULL DEFAULT 'America/New_York', repeat_days integer NOT NULL DEFAULT 30 CHECK(repeat_days BETWEEN 1 AND 365),
 worker_heartbeat_at timestamptz, last_error text, updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE discovery_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES sfp_programs(id),
 program_pin text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), vertical text NOT NULL,
 county_fips text NOT NULL, area_type text NOT NULL CHECK(area_type IN ('county','city','zip')),
 area_key text NOT NULL, query text NOT NULL CHECK(length(query) BETWEEN 1 AND 500),
 language text NOT NULL DEFAULT 'en' CHECK(language='en'), region text NOT NULL DEFAULT 'US' CHECK(region='US'),
 result_limit integer NOT NULL DEFAULT 100 CHECK(result_limit BETWEEN 1 AND 100),
 endpoint_version text NOT NULL DEFAULT 'google-maps-v2' CHECK(endpoint_version='google-maps-v2'), enabled boolean NOT NULL DEFAULT true,
 next_due_at timestamptz NOT NULL DEFAULT now(), last_attempt_at timestamptz, last_retrieved_at timestamptz,
 last_imported_at timestamptz, failure_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE discovery_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES discovery_definitions(id),
 occurrence_key uuid NOT NULL UNIQUE, mode text NOT NULL CHECK(mode IN ('preview','scheduled')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','pending','submission_unknown','results_retained','preview_ready','importing','completed','failed','expired','cancelled')),
 snapshot jsonb NOT NULL, actor_id text NOT NULL, operation_id uuid UNIQUE REFERENCES provider_operations(id),
 provider_task_id text UNIQUE CHECK(provider_task_id IS NULL OR provider_task_id ~ '^[A-Za-z0-9_-]{1,160}$'),
 submitted_at timestamptz, last_pending_at timestamptz, results_expires_at timestamptz, next_poll_at timestamptz,
 import_execution_id uuid UNIQUE REFERENCES import_executions(id), import_requested boolean NOT NULL DEFAULT false,
 saturated boolean NOT NULL DEFAULT false, preview jsonb, totals jsonb, last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX discovery_runs_active_definition_uidx ON discovery_runs(definition_id)
 WHERE state IN ('queued','dispatching','pending','submission_unknown','results_retained','importing');
--> statement-breakpoint
CREATE INDEX discovery_runs_recovery_idx ON discovery_runs(state,next_poll_at,created_at);
--> statement-breakpoint
CREATE INDEX discovery_definitions_due_idx ON discovery_definitions(next_due_at,id) WHERE enabled;
--> statement-breakpoint
CREATE TABLE discovery_artifacts (
 run_id uuid PRIMARY KEY REFERENCES discovery_runs(id), content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 mapper_version text NOT NULL DEFAULT 'outscraper-artifact-v1', matching_policy text NOT NULL DEFAULT 'scheduled-discovery-v1',
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows)<=100),
 raw_count integer NOT NULL CHECK(raw_count BETWEEN 0 AND 100), retained_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE discovery_lane (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), run_id uuid UNIQUE REFERENCES discovery_runs(id),
 token uuid, acquired_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((run_id IS NULL)=(token IS NULL))
);
--> statement-breakpoint
CREATE TABLE discovery_coverage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), definition_id uuid NOT NULL REFERENCES discovery_definitions(id),
 definition_revision integer NOT NULL CHECK(definition_revision>0), area_type text NOT NULL, area_key text NOT NULL,
 covered_through timestamptz NOT NULL, actor_id text NOT NULL, reference text,
 created_at timestamptz NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE UNIQUE INDEX discovery_definitions_scope_uidx ON discovery_definitions(program_id,program_pin,vertical,county_fips,area_type,area_key,query);
--> statement-breakpoint
CREATE INDEX discovery_runs_definition_history_idx ON discovery_runs(definition_id,created_at);
--> statement-breakpoint
CREATE INDEX discovery_coverage_exact_area_idx ON discovery_coverage(definition_id,definition_revision,area_type,area_key,covered_through);

--> statement-breakpoint
CREATE INDEX provider_operations_scheduled_discovery_subject_idx ON provider_operations(target_fingerprint,created_at) WHERE operation_type='scheduled_discovery';
