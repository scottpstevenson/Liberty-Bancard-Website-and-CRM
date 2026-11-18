-- Additive Phase 7 facts. Legacy designs/results are retained and excluded until explicitly bound.
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS phase7_design jsonb;
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS collection_ends_at timestamptz;
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS maturity_ends_at timestamptz;
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS evaluation_lease_token uuid;
ALTER TABLE cro07_experiments ADD COLUMN IF NOT EXISTS evaluation_lease_expires_at timestamptz;
CREATE TABLE IF NOT EXISTS cro07_subject_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid NOT NULL REFERENCES cro07_experiments(id) ON DELETE RESTRICT,
 business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT, arm text NOT NULL CHECK (arm IN ('A','B')),
 design_hash text NOT NULL CHECK (design_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(experiment_id,business_id)
);
CREATE TABLE IF NOT EXISTS cro07_receipt_exposures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid NOT NULL REFERENCES cro07_subject_assignments(id) ON DELETE RESTRICT,
 outbound_log_id integer NOT NULL UNIQUE, provider_message_id text NOT NULL,
 rendered_hash text NOT NULL CHECK (rendered_hash ~ '^[a-f0-9]{64}$'), occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(assignment_id,provider_message_id)
);
CREATE INDEX IF NOT EXISTS cro07_exposures_assignment_idx ON cro07_receipt_exposures(assignment_id,occurred_at);
CREATE TABLE IF NOT EXISTS cro07_verified_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exposure_id uuid NOT NULL REFERENCES cro07_receipt_exposures(id) ON DELETE RESTRICT,
 receipt_kind text NOT NULL, receipt_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('qualified_reply','reply','open','click','hard_bounce','complaint','opt_out','unknown','automated','ambiguous')),
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(receipt_kind,receipt_id,kind)
);
CREATE TABLE IF NOT EXISTS cro07_evaluation_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), experiment_id uuid NOT NULL REFERENCES cro07_experiments(id) ON DELETE RESTRICT,
 experiment_revision integer NOT NULL, design_hash text NOT NULL, horizon timestamptz NOT NULL,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(experiment_id,design_hash,horizon)
);
CREATE TABLE IF NOT EXISTS cro07_experiment_commands (
 actor_id text NOT NULL, command_id uuid NOT NULL, experiment_id uuid NOT NULL REFERENCES cro07_experiments(id) ON DELETE RESTRICT,
 payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE IF NOT EXISTS conversion_journey_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_type text NOT NULL, source_id text NOT NULL, source_version integer NOT NULL CHECK(source_version>0),
 stage text NOT NULL CHECK(stage IN ('lead','engaged','statement_requested','statement_received','proposal_sent','application','closed_won')),
 business_id integer REFERENCES businesses(id) ON DELETE RESTRICT, contact_id integer REFERENCES contacts(id) ON DELETE RESTRICT,
 deal_id integer REFERENCES deals(id) ON DELETE RESTRICT, journey_key text,
 occurred_at timestamptz NOT NULL, ingested_at timestamptz NOT NULL DEFAULT now(),
 dimensions jsonb NOT NULL DEFAULT '{}', record_class text NOT NULL CHECK(record_class IN ('production','test','unknown')),
 CONSTRAINT conversion_journey_evidence_occurrence_key UNIQUE(source_type,source_id,source_version,stage)
);
CREATE INDEX IF NOT EXISTS conversion_evidence_cohort_idx ON conversion_journey_evidence(stage,occurred_at,journey_key) WHERE record_class='production';
CREATE INDEX IF NOT EXISTS conversion_evidence_journey_idx ON conversion_journey_evidence(journey_key,occurred_at);
CREATE TABLE IF NOT EXISTS conversion_evidence_checkpoints (
 source_type text PRIMARY KEY, cursor_value text, observed_at timestamptz, status text NOT NULL CHECK(status IN ('unavailable','partial','complete')),
 reason text NOT NULL
);
-- Native append-only guards are also generated into the production startup manifest.
CREATE OR REPLACE FUNCTION phase7_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'PHASE7_IMMUTABLE_EVIDENCE'; END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cro07_subject_assignments','cro07_receipt_exposures','cro07_verified_outcomes','cro07_evaluation_snapshots','conversion_journey_evidence'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname='phase7_append_only') THEN
 EXECUTE format('CREATE TRIGGER phase7_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase7_append_only()',t);
 END IF; END LOOP;
END $$;
CREATE OR REPLACE FUNCTION phase7_experiment_design_immutable() RETURNS trigger AS $$
BEGIN
 IF OLD.phase7_design IS NOT NULL AND (NEW.phase7_design IS DISTINCT FROM OLD.phase7_design OR NEW.design_hash IS DISTINCT FROM OLD.design_hash
 OR NEW.allocation IS DISTINCT FROM OLD.allocation OR NEW.versions IS DISTINCT FROM OLD.versions OR NEW.min_sample_size IS DISTINCT FROM OLD.min_sample_size
 OR NEW.min_duration_days IS DISTINCT FROM OLD.min_duration_days OR NEW.confidence_rule IS DISTINCT FROM OLD.confidence_rule OR NEW.guardrails IS DISTINCT FROM OLD.guardrails OR NEW.key IS DISTINCT FROM OLD.key OR NEW.hypothesis IS DISTINCT FROM OLD.hypothesis OR NEW.population_definition IS DISTINCT FROM OLD.population_definition) THEN
 RAISE EXCEPTION 'PHASE7_FROZEN_DESIGN_IMMUTABLE'; END IF;
 IF OLD.state IN ('stopped_guardrail','cancelled','revoked','superseded') AND (NEW.decision IN ('winner_a','winner_b') OR NEW.new_version_handoff_key IS NOT NULL) THEN
 RAISE EXCEPTION 'PHASE7_TERMINAL_WINNER_REFUSED'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS phase7_frozen_design ON cro07_experiments;
CREATE TRIGGER phase7_frozen_design BEFORE UPDATE ON cro07_experiments FOR EACH ROW EXECUTE FUNCTION phase7_experiment_design_immutable();
CREATE TABLE IF NOT EXISTS cro07_attempt_bindings (
 outbound_log_id integer PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES cro07_subject_assignments(id) ON DELETE RESTRICT,
 rendered_hash text NOT NULL CHECK(rendered_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='cro07_attempt_bindings'::regclass AND tgname='phase7_attempt_immutable') THEN CREATE TRIGGER phase7_attempt_immutable BEFORE UPDATE OR DELETE ON cro07_attempt_bindings FOR EACH ROW EXECUTE FUNCTION phase7_append_only(); END IF; END $$;

CREATE TABLE IF NOT EXISTS cro07_attempt_envelopes (
 outbound_log_id integer PRIMARY KEY REFERENCES cro07_attempt_bindings(outbound_log_id) ON DELETE RESTRICT,
 envelope_hash text NOT NULL CHECK(envelope_hash ~ '^[a-f0-9]{64}$'), sender_account text NOT NULL, reply_account text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='cro07_attempt_envelopes'::regclass AND tgname='phase7_append_only') THEN CREATE TRIGGER phase7_append_only BEFORE UPDATE OR DELETE ON cro07_attempt_envelopes FOR EACH ROW EXECUTE FUNCTION phase7_append_only(); END IF; END $$;

CREATE TABLE IF NOT EXISTS cro07_mailbox_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_hash text NOT NULL,provider_message_id text NOT NULL,
 exposure_id uuid REFERENCES cro07_receipt_exposures(id) ON DELETE RESTRICT,kind text NOT NULL CHECK(kind IN ('reply','automated','unknown')),reason text NOT NULL,
 occurred_at timestamptz,evidence_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account_hash,provider_message_id)
);
CREATE TABLE IF NOT EXISTS cro07_reply_qualifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_id uuid NOT NULL UNIQUE REFERENCES cro07_mailbox_receipts(id) ON DELETE RESTRICT,
 classification text NOT NULL CHECK(classification IN ('qualified','not_qualified')),reason text NOT NULL,actor_id text NOT NULL,command_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['cro07_mailbox_receipts','cro07_reply_qualifications'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname='phase7_append_only')THEN EXECUTE format('CREATE TRIGGER phase7_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase7_append_only()',t);END IF;END LOOP;END $$;
CREATE UNIQUE INDEX IF NOT EXISTS cro07_one_collecting_step ON cro07_experiments ((phase7_design->>'stepId')) WHERE state='collecting' AND phase7_design IS NOT NULL;

CREATE TABLE IF NOT EXISTS cro07_provider_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL,provider_event_id text NOT NULL,account_hash text NOT NULL,
 exposure_id uuid REFERENCES cro07_receipt_exposures(id) ON DELETE RESTRICT,contact_id integer REFERENCES contacts(id) ON DELETE RESTRICT,
 event_type text NOT NULL CHECK(event_type IN ('delivered','hard_bounce','complaint','explicit_unsubscribe','open','click')),
 occurred_at timestamptz NOT NULL,payload_hash text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(source,provider_event_id)
);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='cro07_provider_receipts'::regclass AND tgname='phase7_append_only')THEN CREATE TRIGGER phase7_append_only BEFORE UPDATE OR DELETE ON cro07_provider_receipts FOR EACH ROW EXECUTE FUNCTION phase7_append_only();END IF;END $$;

-- Observed forward-only SendGrid/mailbox coverage; no operator-complete flag or historical inference.
ALTER TABLE gmail_mailbox_reader_state ADD COLUMN IF NOT EXISTS phase7_generation uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE gmail_mailbox_reader_state ADD COLUMN IF NOT EXISTS phase7_history_complete boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS cro07_feedback_coverage_observations (
 id bigserial PRIMARY KEY, sender_account text NOT NULL, reply_account text NOT NULL,
 identity_hash text NOT NULL, healthy boolean NOT NULL, reason text NOT NULL,
 proof jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT cro07_feedback_coverage_identity_check CHECK(identity_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS cro07_feedback_coverage_window_idx ON cro07_feedback_coverage_observations(sender_account,reply_account,observed_at,id);
CREATE TABLE IF NOT EXISTS cro07_sendgrid_event_observations (
 id bigserial PRIMARY KEY, provider_event_id text NOT NULL UNIQUE, sender_account text NOT NULL,
 provider_message_id text, sendgrid_message_id text, recipient text, event_type text, occurred_at timestamptz,
 payload_hash text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cro07_sendgrid_event_hash_check CHECK(payload_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS cro07_sendgrid_smtp_link_idx ON cro07_sendgrid_event_observations(sender_account,provider_message_id,recipient);
CREATE INDEX IF NOT EXISTS cro07_sendgrid_message_link_idx ON cro07_sendgrid_event_observations(sender_account,sendgrid_message_id,recipient);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['cro07_feedback_coverage_observations','cro07_sendgrid_event_observations'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname='phase7_append_only') THEN
 EXECUTE format('CREATE TRIGGER phase7_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase7_append_only()',t);
 END IF; END LOOP; END $$;

-- Same-transaction milestone evidence from canonical facts; never browser analytics or financial contents.
CREATE OR REPLACE FUNCTION phase7_emit_conversion(src text, sid text, milestone text, cid integer, did integer, happened timestamptz, extra jsonb) RETURNS void AS $$
DECLARE bid integer; cls text; dims jsonb; valid_deal integer; prior conversion_journey_evidence%ROWTYPE; version_number integer;
BEGIN
 SELECT c.business_id,CASE WHEN c.record_class='test' OR d.record_class='test' THEN 'test'
   WHEN c.record_class='production' AND c.archived_at IS NULL AND (did IS NULL OR (d.record_class='production' AND d.archived_at IS NULL AND d.pipeline='sales')) THEN 'production' ELSE 'unknown' END,
   jsonb_build_object('vertical',COALESCE(b.effective_vertical_id,'unknown'),'verticalProvenance',COALESCE(b.effective_vertical_status,'unknown'),
    'rep',COALESCE(d.owner,c.assigned_to,'unknown'),'source',COALESCE(extra->>'source','unknown'),'campaign','unknown'),
   CASE WHEN d.id IS NOT NULL AND (d.contact_id=c.id OR dc.business_id=c.business_id) THEN d.id ELSE NULL END
 INTO bid,cls,dims,valid_deal FROM contacts c LEFT JOIN businesses b ON b.id=c.business_id
 LEFT JOIN deals d ON d.id=did LEFT JOIN contacts dc ON dc.id=d.contact_id WHERE c.id=cid;
 -- Serialize one canonical occurrence; corrected identity appends a new version rather than rewriting history.
 PERFORM pg_advisory_xact_lock(hashtext(src||':'||sid||':'||milestone));
 SELECT * INTO prior FROM conversion_journey_evidence WHERE source_type=src AND source_id=sid AND stage=milestone ORDER BY source_version DESC LIMIT 1;
 IF prior.id IS NOT NULL AND prior.business_id IS NOT DISTINCT FROM bid AND prior.contact_id IS NOT DISTINCT FROM cid
 AND prior.deal_id IS NOT DISTINCT FROM valid_deal AND prior.record_class=COALESCE(cls,'unknown') THEN RETURN; END IF;
 version_number:=COALESCE(prior.source_version,0)+1;
 INSERT INTO conversion_journey_evidence(source_type,source_id,source_version,stage,business_id,contact_id,deal_id,journey_key,occurred_at,dimensions,record_class)
 VALUES(src,sid,version_number,milestone,bid,cid,valid_deal,CASE WHEN bid IS NOT NULL AND valid_deal IS NOT NULL THEN 'deal:'||valid_deal::text ELSE NULL END,
 COALESCE(prior.occurred_at,happened,now()),COALESCE(prior.dimensions,dims,'{"vertical":"unknown","rep":"unknown","source":"unknown","campaign":"unknown"}'),COALESCE(cls,'unknown'))
 ON CONFLICT(source_type,source_id,source_version,stage) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION phase7_milestone_trigger() RETURNS trigger AS $$
DECLARE r jsonb:=to_jsonb(NEW); prior jsonb:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END; cid integer; did integer; sid text;
BEGIN
 cid:=(r->>'contact_id')::integer;did:=(r->>'deal_id')::integer;sid:=r->>'id';
 IF TG_TABLE_NAME='inbound_requests' THEN
  IF r->>'source_class'='sales_request' AND r->>'lifecycle_state' IN ('accepted','completed') AND cid IS NOT NULL THEN
   PERFORM phase7_emit_conversion('inbound_request',sid,'lead',cid,did,(r->>'source_received_at')::timestamptz,jsonb_build_object('source',r->>'source_category'));
  END IF;
 ELSIF TG_TABLE_NAME='statement_requests' THEN
  PERFORM phase7_emit_conversion('statement_request',sid,'statement_requested',cid,did,((r->>'requested_at')::timestamp AT TIME ZONE 'UTC'),'{}');
 ELSIF TG_TABLE_NAME='statement_upload_commands' THEN
  IF r->>'document_id' IS NOT NULL THEN PERFORM phase7_emit_conversion('statement_upload',sid||':document:'||(r->>'document_id'),'statement_received',cid,did,COALESCE((r->>'completed_at')::timestamptz,(r->>'created_at')::timestamptz),'{}');END IF;
 ELSIF TG_TABLE_NAME='merchant_applications' THEN
  IF r->>'status' IN ('in_progress','submitted','under_review','approved') AND (prior->>'status' IS DISTINCT FROM r->>'status') THEN
   PERFORM phase7_emit_conversion('merchant_application',sid||':'||(r->>'status'),'application',cid,did,COALESCE((r->>'submitted_at')::timestamptz,now()),'{}');END IF;
 ELSIF TG_TABLE_NAME='deals' THEN
  did:=(r->>'id')::integer;
  IF r->>'stage'='Closed Won' AND (prior->>'stage' IS DISTINCT FROM r->>'stage') THEN
   PERFORM phase7_emit_conversion('deal_transition',sid||':'||gen_random_uuid()::text,'closed_won',cid,did,now(),'{}');END IF;
  IF r->>'proposal_email_sent_at' IS NOT NULL AND prior->>'proposal_email_sent_at' IS DISTINCT FROM r->>'proposal_email_sent_at' THEN
   PERFORM phase7_emit_conversion('proposal_send',sid||':'||(r->>'proposal_email_sent_at'),'proposal_sent',cid,did,(r->>'proposal_email_sent_at')::timestamptz,'{}');END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['inbound_requests','statement_requests','statement_upload_commands','merchant_applications','deals'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=t::regclass AND tgname='phase7_source_evidence') THEN
 EXECUTE format('CREATE TRIGGER phase7_source_evidence AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION phase7_milestone_trigger()',t);
 END IF;END LOOP;
END $$;
INSERT INTO conversion_evidence_checkpoints(source_type,status,reason) VALUES
 ('inbound_request','partial','New canonical accepted sales requests only; historical reconciliation not run'),
 ('statement_request','partial','New durable requests only; historical reconciliation not run'),
 ('statement_upload','partial','New retained document bindings only; historical reconciliation not run'),
 ('proposal_send','partial','Definitive proposal email send timestamps; other channel evidence unavailable'),
 ('merchant_application','partial','Canonical started/submitted transitions; historical reconciliation not run'),
 ('deal_transition','partial','New Closed Won transitions; no inferred historical stage events'),
 ('phase7_feedback','unavailable','Signed provider subscription, authenticated reply reader continuity and human qualification coverage require certification'),
 ('qualified_reply','unavailable','Only verified message-linked human qualification can supply engagement; browser events excluded')
 ON CONFLICT DO NOTHING;
