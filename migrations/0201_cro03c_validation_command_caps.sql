-- Initial-batch ZeroBounce authority is bounded by immutable, server-derived
-- command membership and approved pricing.
ALTER TABLE cro03c_validation_revocations
  ADD COLUMN disposition TEXT NOT NULL DEFAULT 'quarantined_dispatched',
  ADD CONSTRAINT cro03c_validation_revocation_disposition_chk
    CHECK (disposition IN ('released_undispatched','quarantined_dispatched'));

CREATE UNIQUE INDEX cro03c_validation_authorization_generation_uidx
  ON cro03c_validation_authorizations(generation_id);

ALTER TABLE cro03c_commands
  ADD CONSTRAINT cro03c_initial_validation_caps_chk CHECK (
    command_type <> 'initial_batch' OR (
      (caps->>'validationMaxUnits')::integer BETWEEN 1 AND 100
      AND (caps->>'validationMaxAmountMicros')::bigint >= 0
      AND (caps->>'validationPriceScheduleVersion')::integer >= 1
      AND caps->>'validationPriceScheduleHash' ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;