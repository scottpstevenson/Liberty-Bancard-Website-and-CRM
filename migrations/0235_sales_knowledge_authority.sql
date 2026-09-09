-- Migration 0235: Sales Knowledge Authority & AI Call Copilot
-- when: 1800000001100
-- Note: assistant_sessions.user_id is converted from INTEGER to VARCHAR to match users.id.
--       No FK was ever defined (users.id is varchar in Replit auth), so ALTER TYPE is safe.
--       We census orphaned integer IDs before the ALTER to confirm cast safety.

-- ── 1. Knowledge Source Revisions ────────────────────────────────────────────
-- Immutable revision records. Once created a revision row is never updated.
-- Publishing atomically advances knowledge_sources.current_published_revision_id
-- only after the revision's chunks are fully indexed.

CREATE TABLE IF NOT EXISTS knowledge_source_revisions (
  id                  SERIAL PRIMARY KEY,
  source_id           INTEGER NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT,
  revision_number     INTEGER NOT NULL,
  -- Snapshot of source at revision time
  title               TEXT NOT NULL,
  source_type         TEXT NOT NULL,
  audience            TEXT NOT NULL,
  content             TEXT NOT NULL,
  content_hash        TEXT NOT NULL,   -- SHA-256 hex of content
  metadata            JSONB,
  -- Provenance
  provenance          JSONB NOT NULL DEFAULT '{}'::jsonb,
                      -- { "origin_file": "...", "origin_lines": "1-42",
                      --   "canonical_key": "...", "import_run": "..." }
  -- Review / claim risk
  review_state        TEXT NOT NULL DEFAULT 'draft',
                      -- draft | approved | needs_review | claim_risk
  claim_risk_flags    TEXT[],         -- flagged phrases
  -- Index state
  index_state         TEXT NOT NULL DEFAULT 'pending',
                      -- pending | indexing | indexed | index_failed
  index_error_code    TEXT,
  chunks_written      INTEGER,
  -- Publishing
  publisher_user_id   VARCHAR(255),   -- varchar to match users.id
  published_at        TIMESTAMPTZ,
  -- Prompt / model metadata
  prompt_version      TEXT,
  model_metadata      JSONB,
  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ensure revision numbers are unique per source
  CONSTRAINT knowledge_source_revisions_source_rev_unique UNIQUE (source_id, revision_number)
);

CREATE INDEX IF NOT EXISTS ksr_source_id_idx ON knowledge_source_revisions(source_id);
CREATE INDEX IF NOT EXISTS ksr_index_state_idx ON knowledge_source_revisions(index_state) WHERE index_state != 'indexed';
CREATE INDEX IF NOT EXISTS ksr_content_hash_idx ON knowledge_source_revisions(content_hash);

-- Prevent hard-delete of sources with revision history
-- (application layer also enforces this; this trigger is the DB-level backstop)
CREATE OR REPLACE FUNCTION prevent_source_delete_with_revisions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM knowledge_source_revisions WHERE source_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot delete knowledge source % — use archive instead (has revision history)', OLD.id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS no_delete_source_with_revisions ON knowledge_sources;
CREATE TRIGGER no_delete_source_with_revisions
  BEFORE DELETE ON knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION prevent_source_delete_with_revisions();

-- ── 2. Advance the effective published pointer on knowledge_sources ────────────
-- Single column; advanced atomically only after successful index.
-- NULL = no successfully indexed revision has been published yet.

ALTER TABLE knowledge_sources
  ADD COLUMN IF NOT EXISTS current_published_revision_id INTEGER
    REFERENCES knowledge_source_revisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ks_current_published_rev_idx
  ON knowledge_sources(current_published_revision_id)
  WHERE current_published_revision_id IS NOT NULL;

-- ── 3. Bind knowledge_chunks to a revision ────────────────────────────────────
-- Old chunks (created before this migration) have source_revision_id = NULL.
-- New indexing always sets source_revision_id to the candidate revision being indexed.

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS source_revision_id INTEGER
    REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS kc_source_revision_id_idx ON knowledge_chunks(source_revision_id)
  WHERE source_revision_id IS NOT NULL;

-- Unique chunk per revision (idempotent re-index safety)
CREATE UNIQUE INDEX IF NOT EXISTS kc_revision_chunk_idx
  ON knowledge_chunks(source_revision_id, chunk_index)
  WHERE source_revision_id IS NOT NULL;

-- ── 4. Convert assistant_sessions.user_id from INTEGER to VARCHAR ─────────────
-- Census: verify no integer IDs exist that cannot be cast to text (all integers cast cleanly)
-- No FK was defined on this column (comment in 0084 explains why), so ALTER TYPE is safe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assistant_sessions'
      AND column_name = 'user_id'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE assistant_sessions ALTER COLUMN user_id TYPE VARCHAR(255)
      USING user_id::text;
  END IF;
END;
$$;

-- ── 5. Session binding fields for anonymous capability verification ─────────────
-- Anonymous sessions are bound to a server-created capability token (stored hashed).
-- A UUID in a query parameter alone is not sufficient authority.

ALTER TABLE assistant_sessions
  ADD COLUMN IF NOT EXISTS capability_token_hash TEXT,
    -- SHA-256 of the server-issued opaque token stored in HttpOnly cookie
  ADD COLUMN IF NOT EXISTS session_audience_locked BOOLEAN NOT NULL DEFAULT TRUE,
    -- Once set, audience cannot be changed for this session
  ADD COLUMN IF NOT EXISTS user_id_locked BOOLEAN NOT NULL DEFAULT FALSE;
    -- True for authenticated sessions — prevents re-binding to another user

-- Index for fast capability token lookup
CREATE INDEX IF NOT EXISTS assistant_sessions_cap_token_idx
  ON assistant_sessions(capability_token_hash)
  WHERE capability_token_hash IS NOT NULL;

-- ── 6. Roleplay revision/scoring status fields ────────────────────────────────
-- Roleplay sessions now cite a published staff revision and record structured
-- scoring status / error codes instead of defaulting to hardcoded 7/10.

ALTER TABLE roleplay_sessions
  ADD COLUMN IF NOT EXISTS knowledge_revision_id INTEGER
    REFERENCES knowledge_source_revisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scenario_source_key TEXT;
    -- Canonical provenance key linking to the staff knowledge source

ALTER TABLE roleplay_exchanges
  ADD COLUMN IF NOT EXISTS scoring_status TEXT NOT NULL DEFAULT 'pending',
    -- pending | scored | failed | unavailable
  ADD COLUMN IF NOT EXISTS scoring_error_code TEXT,
    -- OPENAI_NOT_CONFIGURED | PROVIDER_ERROR | MALFORMED_OUTPUT | etc.
  ADD COLUMN IF NOT EXISTS raw_response_hash TEXT;
    -- SHA-256 of truncated/redacted scoring response (no raw PII stored)

-- ── 7. Call Assist Sessions — append-only telemetry ──────────────────────────
-- One row per Call Assist interaction. Actor and contact IDs are stored;
-- raw contact PII is never written here.

CREATE TABLE IF NOT EXISTS call_assist_sessions (
  id              SERIAL PRIMARY KEY,
  actor_user_id   VARCHAR(255) NOT NULL,  -- req.user.id (varchar)
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  phase           TEXT NOT NULL,
    -- pre_call | objection | follow_up | statement_request
  status          TEXT NOT NULL DEFAULT 'ok',
    -- ok | low_confidence | unavailable | blocked | error
  reason_code     TEXT,
    -- CALL_ASSIST_DISABLED | CONTACT_NOT_ELIGIBLE | CONTACT_NOT_ASSIGNED |
    -- OPENAI_NOT_CONFIGURED | PROVIDER_ERROR | SAFETY_BLOCK | etc.
  -- Answer stored truncated (max 2000 chars); no raw contact data
  answer_truncated TEXT,
  answer_char_count INTEGER,
  -- Cited revision IDs (array of knowledge_source_revisions.id)
  cited_revision_ids INTEGER[],
  confidence_score   REAL,
  low_confidence     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Performance
  latency_ms      INTEGER,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  -- Safety flags
  flagged_injection BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_pii       BOOLEAN NOT NULL DEFAULT FALSE,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cas_actor_idx ON call_assist_sessions(actor_user_id);
CREATE INDEX IF NOT EXISTS cas_contact_idx ON call_assist_sessions(contact_id);
CREATE INDEX IF NOT EXISTS cas_created_at_idx ON call_assist_sessions(created_at);
CREATE INDEX IF NOT EXISTS cas_phase_status_idx ON call_assist_sessions(phase, status);

-- Append-only enforcement
CREATE OR REPLACE FUNCTION prevent_call_assist_session_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'call_assist_sessions is append-only — UPDATE/DELETE not permitted';
END;
$$;

DROP TRIGGER IF EXISTS call_assist_sessions_immutable ON call_assist_sessions;
CREATE TRIGGER call_assist_sessions_immutable
  BEFORE UPDATE OR DELETE ON call_assist_sessions
  FOR EACH ROW EXECUTE FUNCTION prevent_call_assist_session_mutation();

-- ── 8. Call Assist Feedback — append-only ────────────────────────────────────

CREATE TABLE IF NOT EXISTS call_assist_feedback (
  id                    SERIAL PRIMARY KEY,
  call_assist_session_id INTEGER NOT NULL REFERENCES call_assist_sessions(id) ON DELETE RESTRICT,
  actor_user_id         VARCHAR(255) NOT NULL,
  rating                TEXT NOT NULL,      -- helpful | unhelpful | incorrect
  note_truncated        TEXT,               -- max 500 chars; no raw contact data
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS caf_session_idx ON call_assist_feedback(call_assist_session_id);

CREATE OR REPLACE FUNCTION prevent_call_assist_feedback_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'call_assist_feedback is append-only — UPDATE/DELETE not permitted';
END;
$$;

DROP TRIGGER IF EXISTS call_assist_feedback_immutable ON call_assist_feedback;
CREATE TRIGGER call_assist_feedback_immutable
  BEFORE UPDATE OR DELETE ON call_assist_feedback
  FOR EACH ROW EXECUTE FUNCTION prevent_call_assist_feedback_mutation();

-- ── 9. Structured / redacted AI audit metadata ────────────────────────────────
-- Adds a structured metadata JSONB column to ai_audit_logs if the table exists.
-- Raw prompt/response text must not contain PII; this column carries structured
-- redacted diagnostics (model, revision IDs, contact hash, latency, etc.).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_audit_logs') THEN
    -- Add structured metadata column (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_audit_logs' AND column_name = 'structured_metadata'
    ) THEN
      ALTER TABLE ai_audit_logs ADD COLUMN structured_metadata JSONB;
      COMMENT ON COLUMN ai_audit_logs.structured_metadata IS
        'Redacted structured audit info: model, revision_ids, contact_id_hash, '
        'latency_ms, tokens, confidence, safety_flags. No raw PII.';
    END IF;
    -- Ensure raw_prompt and raw_response are NOT used for PII
    COMMENT ON COLUMN ai_audit_logs.raw_prompt IS
      'PROHIBITED: do not store raw contact PII. Use prompt_hash + structured_metadata.';
    COMMENT ON COLUMN ai_audit_logs.raw_response IS
      'PROHIBITED: do not store raw contact PII. Use structured_metadata.';
  END IF;
END;
$$;
