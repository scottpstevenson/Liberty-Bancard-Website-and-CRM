-- Preserve immutable paid evidence while isolating an identity mismatch found
-- in the bounded SFP pilot. Quarantine is a separate, reviewable decision.
CREATE TABLE IF NOT EXISTS sfp_identity_quarantines (
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  suspect_domain TEXT NOT NULL,
  source_cohort_run_id UUID NOT NULL REFERENCES sfp_cohort_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  cleared_by TEXT,
  clear_reason TEXT,
  CONSTRAINT sfp_identity_quarantine_clear_complete CHECK (
    (cleared_at IS NULL AND cleared_by IS NULL AND clear_reason IS NULL) OR
    (cleared_at IS NOT NULL AND cleared_by IS NOT NULL AND clear_reason IS NOT NULL)
  )
);

-- Immutable paid observations are never updated. Their rejection survives a
-- future reviewed release of the business-level quarantine.
CREATE TABLE IF NOT EXISTS sfp_discredited_paid_evidence (
  evidence_id UUID PRIMARY KEY REFERENCES sfp_paid_candidate_evidence(id) ON DELETE RESTRICT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The row is inserted only for the exact business/domain and the audited,
-- voided pilot cohort. No broad matching or guessed provider evidence.
INSERT INTO sfp_identity_quarantines
  (business_id, reason_code, suspect_domain, source_cohort_run_id)
SELECT b.id, 'SERPER_WRONG_GEOGRAPHY', 'prolawnlandscaper.com', r.id
  FROM businesses b
  JOIN sfp_cohort_members m ON m.business_id=b.id
  JOIN sfp_cohort_runs r ON r.id=m.cohort_run_id
 WHERE b.id=9555
   AND LOWER(BTRIM(b.canonical_name)) LIKE 'prolawn & landscaping%'
   AND (
     LOWER(BTRIM(b.website_domain))='prolawnlandscaper.com'
     OR EXISTS (
       SELECT 1 FROM sfp_stage_items i
       JOIN sfp_stage_runs s ON s.id=i.stage_run_id
       JOIN provider_operations o ON o.id=i.provider_operation_id
       WHERE i.business_id=b.id AND i.provider='serper'
         AND s.cohort_run_id=r.id
         AND LOWER(o.sfp_result_data->>'domain')='prolawnlandscaper.com'
     )
   )
   AND r.id='03b65bd0-cf98-427f-92d5-4a7a79705028'::uuid
   AND r.cohort_state='voided' AND r.voided_at IS NOT NULL
ON CONFLICT (business_id) DO NOTHING;

INSERT INTO sfp_discredited_paid_evidence (evidence_id,business_id,reason_code)
SELECT e.id,e.business_id,'SERPER_WRONG_GEOGRAPHY'
  FROM sfp_paid_candidate_evidence e
  JOIN sfp_stage_items i ON i.provider_operation_id=e.provider_operation_id
  JOIN sfp_stage_runs s ON s.id=i.stage_run_id
  JOIN sfp_identity_quarantines q ON q.business_id=e.business_id
 WHERE e.business_id=9555 AND e.provider='serper'
   AND s.cohort_run_id='03b65bd0-cf98-427f-92d5-4a7a79705028'::uuid
ON CONFLICT (evidence_id) DO NOTHING;

-- Null only fields bearing the known wrong-site match. Historical paid
-- evidence stays immutable and is excluded by the quarantine read boundary.
UPDATE businesses b
   SET website_domain=NULL,
       main_phone=CASE WHEN LEFT(RIGHT(REGEXP_REPLACE(COALESCE(b.main_phone,''),'[^0-9]','','g'),10),3)='518'
                       THEN NULL ELSE b.main_phone END,
       free_enrichment_status=NULL,
       free_enrichment_completed_at=NULL,
       updated_at=NOW()
 WHERE b.id=9555 AND LOWER(BTRIM(b.website_domain))='prolawnlandscaper.com'
   AND EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                WHERE q.business_id=b.id AND q.cleared_at IS NULL);

UPDATE free_discovery_candidates f
   SET disposition='rejected'
 WHERE f.business_id=9555 AND LOWER(BTRIM(f.domain))='prolawnlandscaper.com'
   AND f.disposition IN ('staged','validation_admitted')
   AND EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                WHERE q.business_id=f.business_id AND q.cleared_at IS NULL);
