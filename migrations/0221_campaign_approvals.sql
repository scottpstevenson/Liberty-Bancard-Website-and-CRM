-- Migration 0221: Campaign immutable launch approvals
-- Adds campaign_approvals table so every campaign send requires an explicit,
-- versioned approval that is invalidated whenever content, audience, sender,
-- or caps change.  Edits bump approved_revision so stale approvals are
-- automatically rejected without manual intervention.

CREATE TABLE IF NOT EXISTS campaign_approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  -- Monotonically increasing; matches campaigns.approved_revision
  revision         INTEGER NOT NULL,
  approved_by      TEXT NOT NULL,
  approved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Fingerprint of content+audience+sender+caps at approval time.
  -- Any material edit changes this, making the approval stale.
  scope_hash       TEXT NOT NULL,
  -- Human-readable confirmation token required from the approver.
  confirm_token    TEXT NOT NULL,
  -- Optional notes from the approver.
  notes            TEXT,
  -- Approval is superseded when a later revision exists for the same campaign.
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_approvals_campaign_revision_uidx
  ON campaign_approvals(campaign_id, revision);

CREATE INDEX IF NOT EXISTS campaign_approvals_campaign_id_idx
  ON campaign_approvals(campaign_id);

-- Add revision tracking to campaigns table
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS content_revision  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_revision INTEGER;

-- approved_revision NULL means the campaign has never been approved or was
-- edited since the last approval; approved_revision = content_revision means
-- the current revision is approved.

COMMENT ON COLUMN campaigns.content_revision IS
  'Bumped on every material edit (content, audience, sender, caps). '
  'Approval is only valid when approved_revision = content_revision.';
COMMENT ON COLUMN campaigns.approved_revision IS
  'The content_revision that was approved. NULL = unapproved.';
