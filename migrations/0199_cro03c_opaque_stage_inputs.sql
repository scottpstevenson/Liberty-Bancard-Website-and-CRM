-- CRO-03C stage plans retain only opaque references and integrity metadata.
-- Provider request material is reconstructed from the canonical observation
-- under lock at dispatch and is never copied into a CRO-03C relation.
CREATE TABLE cro03c_stage_input_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID NOT NULL REFERENCES cro03c_generations(id) ON DELETE RESTRICT,
  stage_key TEXT NOT NULL,
  source_observation_id UUID NOT NULL REFERENCES cro03_source_observations(id) ON DELETE RESTRICT,
  source_payload_hash TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  price_schedule_version INTEGER NOT NULL,
  price_schedule_hash TEXT NOT NULL,
  reserved_units INTEGER NOT NULL,
  units_hash TEXT NOT NULL,
  cap_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (generation_id, stage_key),
  CONSTRAINT cro03c_stage_input_provider_chk CHECK (
    provider IN ('internal_source','first_party_web','rdap','jsonld','serper','outscraper','openai','apollo','zerobounce')
  ),
  CONSTRAINT cro03c_stage_input_schedule_chk CHECK (price_schedule_version >= 1 AND reserved_units >= 0),
  CONSTRAINT cro03c_stage_input_hash_chk CHECK (
    source_payload_hash ~ '^[0-9a-f]{64}$' AND evidence_hash ~ '^[0-9a-f]{64}$'
    AND price_schedule_hash ~ '^[0-9a-f]{64}$' AND units_hash ~ '^[0-9a-f]{64}$'
    AND cap_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION cro03c_stage_input_integrity_guard() RETURNS trigger AS $$
DECLARE canonical_hash TEXT;
DECLARE generation_plan_hash TEXT;
DECLARE command_plan_hash TEXT;
BEGIN
  SELECT payload_hash INTO canonical_hash
    FROM cro03_source_observations WHERE id=NEW.source_observation_id FOR SHARE;
  SELECT g.stage_plan_hash,c.stage_plan_hash INTO generation_plan_hash,command_plan_hash
    FROM cro03c_generations g JOIN cro03c_commands c ON c.id=g.command_id
   WHERE g.id=NEW.generation_id FOR SHARE OF g,c;
  IF canonical_hash IS NULL OR canonical_hash <> NEW.source_payload_hash
     OR generation_plan_hash IS NULL OR generation_plan_hash <> command_plan_hash THEN
    RAISE EXCEPTION 'CRO03C_STAGE_INPUT_INTEGRITY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cro03c_stage_input_integrity_guard
  BEFORE INSERT OR UPDATE ON cro03c_stage_input_references
  FOR EACH ROW EXECUTE FUNCTION cro03c_stage_input_integrity_guard();

ALTER TABLE cro03c_stage_dispositions
  ADD COLUMN stage_input_reference_id UUID UNIQUE
    REFERENCES cro03c_stage_input_references(id) ON DELETE RESTRICT;

-- Remove request copies written by the superseded implementation. The legacy
-- column remains for migration compatibility, but the database prevents it
-- from receiving content again.
DROP TRIGGER IF EXISTS cro03c_stage_disposition_immutable ON cro03c_stage_dispositions;
UPDATE cro03c_stage_dispositions SET frozen_input='{}'::jsonb
 WHERE frozen_input <> '{}'::jsonb;
ALTER TABLE cro03c_stage_dispositions
  ALTER COLUMN frozen_input SET DEFAULT '{}'::jsonb,
  ADD CONSTRAINT cro03c_stage_frozen_input_empty_chk CHECK (frozen_input = '{}'::jsonb),
  ADD CONSTRAINT cro03c_stage_input_reference_required_chk CHECK (
    (disposition = 'eligible' AND stage_input_reference_id IS NOT NULL)
    OR (disposition <> 'eligible' AND stage_input_reference_id IS NULL)
  ) NOT VALID;

CREATE FUNCTION cro03c_stage_input_reference_guard() RETURNS trigger AS $$
DECLARE ref cro03c_stage_input_references%ROWTYPE;
BEGIN
  IF NEW.stage_input_reference_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO ref FROM cro03c_stage_input_references WHERE id=NEW.stage_input_reference_id;
  IF ref.id IS NULL OR ref.generation_id <> NEW.generation_id OR ref.stage_key <> NEW.stage_key
     OR ref.evidence_hash <> NEW.evidence_hash THEN
    RAISE EXCEPTION 'CRO03C_STAGE_INPUT_REFERENCE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cro03c_stage_input_reference_guard
  BEFORE INSERT OR UPDATE ON cro03c_stage_dispositions
  FOR EACH ROW EXECUTE FUNCTION cro03c_stage_input_reference_guard();

CREATE TRIGGER cro03c_stage_disposition_immutable
  BEFORE UPDATE OR DELETE ON cro03c_stage_dispositions
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();

CREATE TRIGGER cro03c_stage_input_reference_immutable
  BEFORE UPDATE OR DELETE ON cro03c_stage_input_references
  FOR EACH ROW EXECUTE FUNCTION cro03b_append_only_guard();