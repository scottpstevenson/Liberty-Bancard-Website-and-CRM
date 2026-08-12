-- #1445 Underwriting checklist atomic idempotency
-- Partial unique index ensures concurrent initUnderwritingChecklist() calls for the same
-- deal cannot produce duplicate checklist tasks. Each task has a deterministic automation_key
-- of the form "uw_{dealId}_{titleSlug}" so the constraint is per-item, per-deal.
-- ON CONFLICT DO NOTHING in the insert makes the init idempotent without a read-first guard.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_uw_automation_key_unique
  ON tasks (automation_key)
  WHERE automation_key IS NOT NULL
    AND source = 'underwriting';
