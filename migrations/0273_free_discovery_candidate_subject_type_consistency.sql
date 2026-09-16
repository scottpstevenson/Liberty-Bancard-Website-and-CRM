-- Task #1978 code-review fix: subject_type must agree with attribution_scope
-- and with which FK actually owns the row. Without this, a named/person
-- address could be misclassified as subject_type='business' (which the
-- governed projection path treats as eligible for businesses.mainEmail),
-- letting a specific person's address get promoted as if it were a shared
-- business inbox. A 'person' row must also never carry a business_id — that
-- would make person-scoped evidence look reusable/business-owned, defeating
-- the no-cross-contact-leak guarantee (correction #4).
ALTER TABLE free_discovery_candidates DROP CONSTRAINT IF EXISTS free_discovery_candidates_subject_type_consistency_chk;
ALTER TABLE free_discovery_candidates
  ADD CONSTRAINT free_discovery_candidates_subject_type_consistency_chk
  CHECK (
    (subject_type = 'business' AND attribution_scope = 'role')
    OR (subject_type = 'person' AND attribution_scope = 'named' AND business_id IS NULL)
  );
