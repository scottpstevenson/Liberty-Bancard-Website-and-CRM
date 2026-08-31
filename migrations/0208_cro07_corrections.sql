-- CRO-07 corrections (additive, post-0207-head):
-- 1. A feedback receipt whose identity cannot be resolved to a contact must
--    still be persisted as review-required reply work (no-contact provider
--    events are a legitimate, expected state, not an error) — contact_id
--    must be nullable to allow that row to exist.
-- 2. A release must claim exactly one attempt — enforce this as a hard
--    database constraint, not just an idempotency-key convention.
ALTER TABLE cro07_reply_work ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE cro07_attempts
  ADD CONSTRAINT cro07_attempts_release_id_unique UNIQUE (release_id);
