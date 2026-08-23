-- BT-07: canonical identity observations and reviewed/reversible contact merges.
CREATE TABLE IF NOT EXISTS "contact_identity_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "identity_kind" text NOT NULL CHECK ("identity_kind" IN ('email', 'phone')),
  "normalized_value" text,
  "lookup_token" text NOT NULL,
  "normalization_version" integer NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text,
  "country_code" text,
  "phone_endpoint_type" text,
  "phone_ownership" text,
  "eligibility" text NOT NULL DEFAULT 'ineligible' CHECK ("eligibility" IN ('eligible', 'weak', 'ineligible')),
  "confidence" integer NOT NULL DEFAULT 0 CHECK ("confidence" BETWEEN 0 AND 100),
  "invalid_reason" text,
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("normalized_value" IS NOT NULL) OR ("invalid_reason" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "cio_contact_kind_idx" ON "contact_identity_observations" ("contact_id", "identity_kind", "observed_at");
CREATE UNIQUE INDEX IF NOT EXISTS "cio_observation_dedupe_uidx" ON "contact_identity_observations" ("contact_id", "identity_kind", "lookup_token", "normalization_version", "source_type");
CREATE INDEX IF NOT EXISTS "cio_lookup_token_idx" ON "contact_identity_observations" ("identity_kind", "lookup_token");
CREATE INDEX IF NOT EXISTS "cio_eligible_idx" ON "contact_identity_observations" ("identity_kind", "eligibility") WHERE "eligibility" = 'eligible';

CREATE TABLE IF NOT EXISTS "contact_merge_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key" uuid NOT NULL UNIQUE,
  "survivor_contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "deprecated_contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "status" text NOT NULL DEFAULT 'previewed',
  "actor_id" text NOT NULL, "actor_role" text NOT NULL,
  "manifest_version" integer NOT NULL, "normalization_version" integer NOT NULL,
  "preview_hash" text NOT NULL, "contact_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "field_decisions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "conflict_reason" text, "ghl_disposition" text NOT NULL DEFAULT 'none',
  "reconciliation_status" text NOT NULL DEFAULT 'not_required',
  "approved_at" timestamptz, "executed_at" timestamptz, "undone_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("survivor_contact_id" <> "deprecated_contact_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cmo_pair_active_uidx" ON "contact_merge_operations" ("survivor_contact_id", "deprecated_contact_id")
  WHERE "status" IN ('previewed','approved','executing','committed','reconciliation_pending','completed');
CREATE INDEX IF NOT EXISTS "cmo_survivor_idx" ON "contact_merge_operations" ("survivor_contact_id");
CREATE INDEX IF NOT EXISTS "cmo_deprecated_idx" ON "contact_merge_operations" ("deprecated_contact_id");

CREATE TABLE IF NOT EXISTS "contact_merge_redirects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "deprecated_contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "survivor_contact_id" integer NOT NULL REFERENCES "contacts"("id"),
  "operation_id" uuid NOT NULL REFERENCES "contact_merge_operations"("id"),
  "active" boolean NOT NULL DEFAULT true, "retired_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK ("deprecated_contact_id" <> "survivor_contact_id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "cmr_active_deprecated_uidx" ON "contact_merge_redirects" ("deprecated_contact_id") WHERE "active";
CREATE INDEX IF NOT EXISTS "cmr_survivor_idx" ON "contact_merge_redirects" ("survivor_contact_id");

CREATE TABLE IF NOT EXISTS "contact_merge_relationship_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "operation_id" uuid NOT NULL REFERENCES "contact_merge_operations"("id"),
  "manifest_version" integer NOT NULL, "relation_key" text NOT NULL,
  "source_record_id" text NOT NULL, "action" text NOT NULL,
  "status" text NOT NULL DEFAULT 'committed',
  "before_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "after_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(), "undone_at" timestamptz,
  UNIQUE ("operation_id", "relation_key", "source_record_id")
);
CREATE INDEX IF NOT EXISTS "cmra_operation_idx" ON "contact_merge_relationship_actions" ("operation_id");

CREATE TABLE IF NOT EXISTS "contact_merge_undo_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "operation_id" uuid NOT NULL UNIQUE REFERENCES "contact_merge_operations"("id"),
  "requested_by" text NOT NULL, "status" text NOT NULL DEFAULT 'requested', "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(), "completed_at" timestamptz
);
CREATE TABLE IF NOT EXISTS "contact_merge_reconciliations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "operation_id" uuid NOT NULL UNIQUE REFERENCES "contact_merge_operations"("id"),
  "status" text NOT NULL DEFAULT 'pending', "reason" text NOT NULL, "attempts" integer NOT NULL DEFAULT 0,
  "completed_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now()
);