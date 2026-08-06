-- Prevent concurrent Closed Won triggers from creating duplicate onboarding SLA tasks.
-- Scoped to exactly the 5 canonical title strings so no other task titles are affected.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_onboarding_sla_title_unique
  ON tasks(deal_id, title)
  WHERE deleted_at IS NULL
    AND title IN (
      'Submit application to processor',
      'Collect KYC documents',
      'Order terminal/equipment',
      'Schedule merchant training',
      'Confirm first-batch live date'
    );
