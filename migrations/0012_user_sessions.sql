CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_id" varchar NOT NULL,
  "ip" varchar,
  "user_agent" text,
  "created_at" timestamp DEFAULT now(),
  "last_active_at" timestamp DEFAULT now(),
  "is_invalidated" boolean DEFAULT false,
  "invalidated_at" timestamp
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_session_id_idx" ON "user_sessions" ("session_id");
CREATE INDEX IF NOT EXISTS "user_sessions_last_active_idx" ON "user_sessions" ("last_active_at");
