-- 0275: Create cro03c_roi_candidate_scores table (was runtime DDL in roi-cohort-selector.ts)
CREATE TABLE IF NOT EXISTS cro03c_roi_candidate_scores (
  id                    SERIAL PRIMARY KEY,
  business_id           INTEGER NOT NULL,
  roi_score             INTEGER NOT NULL,
  score_version         INTEGER NOT NULL,
  dimensions            JSONB NOT NULL,
  disposition_reason    TEXT NOT NULL,
  eligible              BOOLEAN NOT NULL,
  actor_id              TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roi_candidate_scores_biz_ver
  ON cro03c_roi_candidate_scores (business_id, score_version, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roi_candidate_scores_eligible
  ON cro03c_roi_candidate_scores (eligible, score_version, roi_score DESC)
  WHERE eligible = true;
