-- 0280: Fix cro03c_roi_candidate_scores so repeated ROI selection runs
-- upsert the latest score per (business_id, score_version) instead of
-- silently duplicating rows through a no-op ON CONFLICT DO NOTHING with no
-- matching unique constraint.

-- Keep only the most recent row per (business_id, score_version); drop the
-- older duplicates accumulated before this fix.
DELETE FROM cro03c_roi_candidate_scores a
USING cro03c_roi_candidate_scores b
WHERE a.business_id = b.business_id
  AND a.score_version = b.score_version
  AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS cro03c_roi_candidate_scores_biz_version_uidx
  ON cro03c_roi_candidate_scores (business_id, score_version);
