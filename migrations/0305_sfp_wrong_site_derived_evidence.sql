-- One-time follow-through for the business 9555 wrong-site incident. Preserve
-- the original processor observation and free summary in separate audit rows;
-- remove only the live projections derived from the disproven website.
CREATE TABLE IF NOT EXISTS sfp_discredited_processor_signals (
  signal_id integer PRIMARY KEY,
  business_id integer NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  original_row jsonb NOT NULL,
  reason_code text NOT NULL,
  discredited_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sfp_discredited_free_enrichment_summaries (
  business_id integer PRIMARY KEY REFERENCES businesses(id) ON DELETE RESTRICT,
  original_evidence jsonb NOT NULL,
  reason_code text NOT NULL,
  discredited_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sfp_discredited_processor_signals (signal_id,business_id,original_row,reason_code)
SELECT p.id,p.business_id,to_jsonb(p),'SERPER_WRONG_GEOGRAPHY'
  FROM processor_signals p
  JOIN sfp_identity_quarantines q ON q.business_id=p.business_id AND q.cleared_at IS NULL
    AND q.reason_code='SERPER_WRONG_GEOGRAPHY' AND q.suspect_domain='prolawnlandscaper.com'
 WHERE p.id=1548 AND p.business_id=9555
   AND p.signal_type='ecommerce_platform'
   AND p.vendor_name='Squarespace Commerce' AND p.detection_method='script'
   AND p.evidence='Script source: //assets.squarespace.com/@sqs/polyfiller/1.6/legacy.js'
ON CONFLICT (signal_id) DO NOTHING;

DELETE FROM processor_signals p
 USING sfp_discredited_processor_signals d
 WHERE p.id=d.signal_id AND p.business_id=d.business_id
   AND p.id=1548 AND p.business_id=9555 AND to_jsonb(p)=d.original_row;

INSERT INTO sfp_discredited_free_enrichment_summaries
  (business_id,original_evidence,reason_code)
SELECT b.id,b.free_enrichment_evidence,'SERPER_WRONG_GEOGRAPHY'
  FROM businesses b
  JOIN sfp_identity_quarantines q ON q.business_id=b.id AND q.cleared_at IS NULL
    AND q.reason_code='SERPER_WRONG_GEOGRAPHY' AND q.suspect_domain='prolawnlandscaper.com'
 WHERE b.id=9555 AND b.website_domain IS NULL
   AND b.free_enrichment_evidence->>'collectedAt'='2026-09-28T01:06:23.035Z'
   AND b.free_enrichment_evidence->>'contactPageEmailCount'='2'
   AND b.free_enrichment_evidence->'processorVendors' @> '["Squarespace Commerce"]'::jsonb
ON CONFLICT (business_id) DO NOTHING;

UPDATE businesses b SET free_enrichment_evidence=NULL,updated_at=NOW()
  FROM sfp_discredited_free_enrichment_summaries d
 WHERE b.id=d.business_id AND b.id=9555
   AND b.free_enrichment_evidence=d.original_evidence;
