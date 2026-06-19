CREATE TABLE IF NOT EXISTS "bot_contexts" (
  "id" serial PRIMARY KEY NOT NULL,
  "context_id" text NOT NULL,
  "name" text NOT NULL,
  "system_prompt" text NOT NULL,
  "faq_items" jsonb DEFAULT '[]',
  "active" boolean DEFAULT true,
  "auto_reply_enabled" boolean DEFAULT false,
  "auto_reply_delay_seconds" integer DEFAULT 180,
  "confidence_threshold" integer DEFAULT 60,
  "channel" text DEFAULT 'all',
  "vertical_key" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "bot_contexts_context_id_idx" ON "bot_contexts" ("context_id");

CREATE TABLE IF NOT EXISTS "handoff_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "pattern" text NOT NULL,
  "type" text NOT NULL,
  "active" boolean DEFAULT true,
  "description" text,
  "created_at" timestamp DEFAULT now()
);
