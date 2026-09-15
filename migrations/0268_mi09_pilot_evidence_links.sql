-- MI-09: make pilot provenance explicit on generated/staged evidence.
-- Nullable for historical rows and non-pilot CRO-03C generations; governed
-- pilot writes always populate these columns from the originating run.
ALTER TABLE master_leads
  ADD COLUMN IF NOT EXISTS pilot_run_id UUID REFERENCES mi09_pilot_runs(id);
CREATE INDEX IF NOT EXISTS master_leads_pilot_run_id_idx
  ON master_leads (pilot_run_id);

ALTER TABLE master_lead_staging_receipts
  ADD COLUMN IF NOT EXISTS pilot_run_id UUID REFERENCES mi09_pilot_runs(id);
CREATE INDEX IF NOT EXISTS master_lead_staging_receipts_pilot_run_idx
  ON master_lead_staging_receipts (pilot_run_id);

ALTER TABLE cro03c_generations
  ADD COLUMN IF NOT EXISTS pilot_run_id UUID REFERENCES mi09_pilot_runs(id);
CREATE INDEX IF NOT EXISTS cro03c_generations_pilot_run_id_idx
  ON cro03c_generations (pilot_run_id);

ALTER TABLE cro03c_receipts
  ADD COLUMN IF NOT EXISTS pilot_run_id UUID REFERENCES mi09_pilot_runs(id);
CREATE INDEX IF NOT EXISTS cro03c_receipts_pilot_run_id_idx
  ON cro03c_receipts (pilot_run_id);

-- Backfill existing pilot evidence deterministically through its command link.
UPDATE cro03c_generations g
   SET pilot_run_id = pel.pilot_run_id
  FROM mi09_pilot_effect_links pel
 WHERE pel.entity_type = 'cro03c_command'
   AND pel.entity_id = g.command_id
   AND g.pilot_run_id IS NULL;
UPDATE cro03c_receipts r
   SET pilot_run_id = g.pilot_run_id
  FROM cro03c_generations g
 WHERE g.id = r.generation_id
   AND r.pilot_run_id IS NULL
   AND g.pilot_run_id IS NOT NULL;
UPDATE master_lead_staging_receipts sr
   SET pilot_run_id = g.pilot_run_id
  FROM cro03c_generations g
 WHERE g.id = sr.cro03_generation_id
   AND sr.pilot_run_id IS NULL
   AND g.pilot_run_id IS NOT NULL;
UPDATE master_leads ml
   SET pilot_run_id = sr.pilot_run_id
  FROM master_lead_staging_receipts sr
 WHERE sr.master_lead_id = ml.id
   AND ml.pilot_run_id IS NULL
   AND sr.pilot_run_id IS NOT NULL;