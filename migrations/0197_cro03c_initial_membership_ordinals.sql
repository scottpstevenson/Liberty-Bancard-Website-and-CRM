-- CRO-03C initial-rollout membership is a human-auditable immutable cohort:
-- ordinals are deliberately one-based and bounded at one hundred members.
ALTER TABLE cro03c_initial_memberships
  DROP CONSTRAINT IF EXISTS cro03c_membership_ordinal_chk;
ALTER TABLE cro03c_initial_memberships
  ADD CONSTRAINT cro03c_membership_ordinal_chk CHECK (ordinal BETWEEN 1 AND 100);