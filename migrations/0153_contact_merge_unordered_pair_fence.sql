-- A reviewed pair is unordered for overlap purposes: A→B and B→A must never
-- both be reservable while either operation is still active.
CREATE UNIQUE INDEX IF NOT EXISTS "cmo_unordered_pair_active_uidx"
  ON "contact_merge_operations" (
    LEAST("survivor_contact_id", "deprecated_contact_id"),
    GREATEST("survivor_contact_id", "deprecated_contact_id")
  )
  WHERE "status" IN ('previewed','approved','executing','committed','reconciliation_pending','completed');