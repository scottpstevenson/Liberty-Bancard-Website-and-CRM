-- Fix GHL contact ID ownership conflicts that were tripping the circuit breaker.
--
-- Part 1: General dedup — null out ghl_contact_id on non-canonical contacts if
-- any duplicate assignments exist in the DB (possible only if data predates the
-- contacts_ghl_contact_id_unique constraint added in migration 0066).
-- Canonical owner = most recent last_synced_at, or lowest id as tiebreak.
WITH conflicting_ghl_ids AS (
  SELECT ghl_contact_id
  FROM contacts
  WHERE ghl_contact_id IS NOT NULL
  GROUP BY ghl_contact_id
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY c.ghl_contact_id
      ORDER BY c.last_synced_at DESC NULLS LAST, c.id ASC
    ) AS rn
  FROM contacts c
  INNER JOIN conflicting_ghl_ids cg ON c.ghl_contact_id = cg.ghl_contact_id
)
UPDATE contacts
SET ghl_contact_id = NULL
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Part 2: Document the 7 known conflict contacts in the audit log so they are
-- visible in any future conflict-resolution tooling. These contacts have NULL
-- ghl_contact_id and are known to conflict with a canonical owner in GHL.
-- After the code fix (GhlIdentityConflictError + ownership pre-check), these
-- contacts will be gracefully skipped on every sync tick instead of tripping
-- the circuit breaker.
INSERT INTO audit_logs (action, entity_type, entity_id, actor_type, details, created_at)
SELECT
  'ghl_sync_identity_conflict',
  'contact',
  c.id,
  'system',
  jsonb_build_object(
    'message', 'Known identity conflict — this contact maps to a GHL contact already owned by another local record. Gracefully skipped by ownership pre-check. Manual review recommended: merge contacts or determine canonical owner.',
    'migrationRef', '0074',
    'remediationStatus', 'code_fix_applied'
  ),
  NOW()
FROM contacts c
WHERE c.id IN (155757, 155720, 155549, 155548, 155547, 155407, 155406);
