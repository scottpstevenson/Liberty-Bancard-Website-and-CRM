-- Task #1978: Free-discovery candidate evidence (Sunbiz/free-email pipeline).
--
-- Durable, contract-compatible run/generation envelope for FREE (non-paid)
-- email discovery (first-party contact-page crawl, JSON-LD, etc). Deliberately
-- separate from cro03c_generations/cro03c_commands, which represent paid-
-- provider billing/ceremony authority (activation policy + live runtime
-- attestation + CRO-03A/B admission chain) that free discovery never performs
-- or impersonates. Reuses the same envelope-encryption/hash/mask contract as
-- cro03c_candidate_evidence so a later governed promotion into that table
-- (under explicit operator authorization) can reference this evidence by
-- immutable id/hash rather than rewriting it.

CREATE TABLE IF NOT EXISTS free_discovery_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'email_discovery',
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',
  subject_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS free_discovery_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES free_discovery_generations(id) ON DELETE RESTRICT,
  field TEXT NOT NULL DEFAULT 'email',
  subject_type TEXT NOT NULL,
  business_id INTEGER REFERENCES businesses(id) ON DELETE RESTRICT,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  domain TEXT NOT NULL,
  source TEXT NOT NULL,
  attribution_scope TEXT NOT NULL,
  person_name_evidence TEXT,
  person_title_evidence TEXT,
  disposition TEXT NOT NULL DEFAULT 'staged',
  confidence INTEGER NOT NULL DEFAULT 0,
  envelope_ciphertext TEXT NOT NULL,
  envelope_nonce TEXT NOT NULL,
  envelope_tag TEXT NOT NULL,
  envelope_key_version INTEGER NOT NULL DEFAULT 1,
  normalized_value_hash TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  promoted_candidate_evidence_id UUID REFERENCES cro03c_candidate_evidence(id) ON DELETE SET NULL,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT free_discovery_candidates_attribution_chk CHECK (attribution_scope IN ('role', 'named'))
);

CREATE UNIQUE INDEX IF NOT EXISTS free_discovery_candidates_gen_field_value_uniq
  ON free_discovery_candidates (generation_id, field, normalized_value_hash);
CREATE INDEX IF NOT EXISTS free_discovery_candidates_business_idx ON free_discovery_candidates (business_id);
CREATE INDEX IF NOT EXISTS free_discovery_candidates_contact_idx ON free_discovery_candidates (contact_id);
CREATE INDEX IF NOT EXISTS free_discovery_candidates_domain_idx ON free_discovery_candidates (domain);

-- Cross-run domain crawl cache. Cached role-inbox evidence is reusable without
-- recrawling; named-person evidence is NEVER cached here — it stays scoped to
-- the one free_discovery_candidates row carrying its name/title evidence, so
-- it can never leak onto a different contact sharing the same domain.
CREATE TABLE IF NOT EXISTS email_discovery_domain_cache (
  domain TEXT PRIMARY KEY,
  first_crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  crawl_count INTEGER NOT NULL DEFAULT 1,
  role_emails JSONB NOT NULL DEFAULT '[]',
  last_generation_id UUID REFERENCES free_discovery_generations(id) ON DELETE SET NULL
);
