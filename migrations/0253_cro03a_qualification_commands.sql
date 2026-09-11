-- CRO-03A qualification commands outbox table.
-- Atomic with source_import_runs completion: outbox rows are inserted in the
-- same finalization transaction as status='completed', so enqueueing is always
-- durable and survives a crash between the two writes.
--
-- Idempotency is enforced by the unique constraint on
-- (source_import_run_id, chunk_number, selection_hash). Replaying the same
-- finalization produces ON CONFLICT DO NOTHING with no side effects.

CREATE TABLE IF NOT EXISTS cro03a_qualification_commands (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_import_run_id uuid       NOT NULL REFERENCES source_import_runs(id),
  chunk_number        integer     NOT NULL CHECK (chunk_number >= 0),
  selection_hash      text        NOT NULL,
  occurrence_ids      jsonb       NOT NULL,
  state               text        NOT NULL DEFAULT 'pending'
                                  CHECK (state IN ('pending','processing','completed','failed')),
  error_text          text,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  processed_at        timestamptz,
  CONSTRAINT cro03a_qualification_commands_run_chunk_hash_unique
    UNIQUE (source_import_run_id, chunk_number, selection_hash)
);

-- Efficient scan by the background processor
CREATE INDEX IF NOT EXISTS cro03a_qualification_commands_pending_idx
  ON cro03a_qualification_commands (created_at)
  WHERE state = 'pending';
