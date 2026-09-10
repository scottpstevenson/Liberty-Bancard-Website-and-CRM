-- MI-02: Extend source_import_runs for safe, DB-authoritative imports.
--
-- csv_data      — uploaded CSV stored in DB; not embedded in BullMQ job payloads
--                 (so no source PII transits through Redis). NULLed after run completes.
-- is_full_snapshot — persisted with the run so the worker reads intent from DB,
--                 not from ephemeral job metadata. BullMQ payload contains only run_id.
-- requested_adapter_key — the adapter the caller declared; worker validates that
--                 this matches source_import_runs.adapter_key before processing.
ALTER TABLE source_import_runs
  ADD COLUMN IF NOT EXISTS csv_data              bytea   NULL,
  ADD COLUMN IF NOT EXISTS is_full_snapshot      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requested_adapter_key TEXT    NULL;

-- Unique partial index to enforce single-active-run-per-adapter covering both
-- 'queued' and 'running' states. Prevents duplicate enqueueing and double-processing.
CREATE UNIQUE INDEX IF NOT EXISTS source_import_runs_one_active_per_adapter
  ON source_import_runs (adapter_key)
  WHERE status IN ('queued', 'running');
