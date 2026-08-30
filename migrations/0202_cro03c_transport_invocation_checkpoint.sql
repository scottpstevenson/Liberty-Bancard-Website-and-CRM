-- A dispatching reservation is not proof that an adapter was invoked.  The
-- worker records this checkpoint immediately at each provider transport edge.
ALTER TABLE cro03c_stage_operations
  ADD COLUMN IF NOT EXISTS transport_may_have_been_invoked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE cro03c_dispatch_checkpoints
  DROP CONSTRAINT IF EXISTS cro03c_dispatch_checkpoint_chk;
ALTER TABLE cro03c_dispatch_checkpoints
  ADD CONSTRAINT cro03c_dispatch_checkpoint_chk CHECK (
    checkpoint IN ('pre_reservation','pre_io','transport_started','transport_returned',
                   'confirmed_not_dispatched','ambiguous','reconciled')
  );