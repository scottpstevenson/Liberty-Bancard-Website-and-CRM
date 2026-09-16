-- Task #1978 code-review fix: a free_discovery_candidates row must always be
-- attributable to a concrete subject. Without this constraint, application
-- code that forgot to resolve a fallback owner (e.g. a role-inbox candidate
-- for a contact with no linked business) could silently insert a row with
-- both business_id and contact_id null — an orphan no downstream review UI
-- or ownership/audit logic could ever find.
ALTER TABLE free_discovery_candidates DROP CONSTRAINT IF EXISTS free_discovery_candidates_subject_scope_chk;
ALTER TABLE free_discovery_candidates
  ADD CONSTRAINT free_discovery_candidates_subject_scope_chk
  CHECK (business_id IS NOT NULL OR contact_id IS NOT NULL);
