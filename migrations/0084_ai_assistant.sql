-- Migration 0084: AI Assistant — knowledge base, chat sessions, feedback, unanswered queue
-- when: 1787300000000
-- Note: user_id/reviewer_id are plain INTEGER (no FK) because users.id is character varying
-- in the Replit auth schema; FK enforcement is done at the application layer.

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text_block',  -- text_block | url | file
  status TEXT NOT NULL DEFAULT 'draft',             -- draft | published | archived
  audience TEXT NOT NULL DEFAULT 'public',          -- public | merchant | staff | all
  content TEXT NOT NULL,
  metadata JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMP,
  last_indexed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB,  -- float[] stored as JSON (text-embedding-3-small, 1536-dim)
  token_count INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_source_id_idx ON knowledge_chunks(source_id);

CREATE TABLE IF NOT EXISTS assistant_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  audience TEXT NOT NULL DEFAULT 'public',  -- public | merchant | staff
  user_id INTEGER,          -- internal user id (no FK — users.id is varchar in Replit auth)
  contact_id INTEGER,       -- authenticated merchant's contact record
  ip_hash TEXT,             -- hashed IP for rate limiting (not raw IP)
  metadata JSONB,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_sessions_user_id_idx ON assistant_sessions(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS assistant_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assistant_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                        -- user | assistant
  content TEXT NOT NULL,
  sources JSONB,                             -- [{title, source_id, chunk_id, relevance}]
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  flagged_injection BOOLEAN NOT NULL DEFAULT FALSE,
  flagged_pii BOOLEAN NOT NULL DEFAULT FALSE,
  low_confidence BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_messages_session_id_idx ON assistant_messages(session_id);
CREATE INDEX IF NOT EXISTS assistant_messages_created_at_idx ON assistant_messages(created_at);

CREATE TABLE IF NOT EXISTS assistant_feedback (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  rating TEXT NOT NULL,   -- thumbs_up | thumbs_down
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistant_unanswered (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'public',
  question TEXT NOT NULL,
  ai_response TEXT,
  reviewed_at TIMESTAMP,
  reviewer_id INTEGER,    -- no FK — matches integer user ID at app layer
  resolution_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_unanswered_reviewed_idx ON assistant_unanswered(reviewed_at) WHERE reviewed_at IS NULL;
