# Schema repair packet: `ghl_appointment_state_status_chk` and `no_show`

Status: **packet prepared and rehearsed on a disposable database. Not applied to production.** Applying it needs an operator with normal production DDL authority. The agent did not run DDL against production, added no startup DDL, and edited no historical migration.

## What production has (read-only observation, 2026-11-03)

| Fact | Observed |
|---|---|
| `ghl_appointment_state_status_chk` allows | `booked, rescheduled, updated, showed, canceled` (no `no_show`) |
| `ghl_appointment_state` rows | 0 |
| Migrations 0376–0379 objects | present, but the four migrations are **not recorded** in `drizzle.__drizzle_migrations` |
| Application behaviour needing `no_show` | the 0378 contract (provider no-show status is stored) |

Consequence while the constraint is unrepaired: an appointment event with status `no_show` cannot be stored. Because the table is empty and the booking writer and outgoing GHL control are off, nothing is currently failing; the gap is latent.

## Options (owner chooses; the packet implements B)

| Option | What it is | Cost / risk |
|---|---|---|
| A | Let the normal migrator replay the idempotent 0378/0379 on the next controlled migration run (they use `DROP CONSTRAINT IF EXISTS` and `ADD CONSTRAINT`) | Also records the four migrations in the journal. Uses the owner's existing migration authority; replays two migrations that have never been journaled in production, so review them first. |
| B | Run the four SQL files in this directory as a targeted repair | Smallest change. Does not record anything in the migration journal, so A (or an explicit journal decision) is still needed to stop the journal and the objects from disagreeing. |

## Order of operations (option B)

1. `04-verify.sql` (read-only): note the constraint definition and the row counts.
2. `01-forward.sql`: one transaction, `lock_timeout 5s`, `statement_timeout 30s`. Drops and re-adds the constraint with `no_show` as `NOT VALID`, so the exclusive lock covers only the catalog change and never a table scan.
3. `02-validate.sql`: `VALIDATE CONSTRAINT` under a weaker lock; writers are not blocked.
4. `04-verify.sql` again: expect `convalidated = true` and a definition containing `no_show`.

## Rollback

`03-rollback.sql` restores the five-status constraint **only if no real `no_show` row exists**. If one does, it skips and keeps the repaired constraint, because rewriting or deleting a real provider observation would lose evidence and the application tolerates the wider constraint. Rollback never deletes or updates rows.

## Rehearsal evidence

`scripts/certification/test-stage4d-appointment-constraint-repair.ts` (15 checks, disposable database only, registered in the pre-deploy roster and the disposable roster). It proves: the production-shaped constraint rejects a `no_show` write (negative control); step 1 takes ACCESS EXCLUSIVE for the catalog change only; an abandoned step 1 and a lock-timeout failure each leave the installed constraint unchanged, and the lock timeout fails fast instead of queueing writers; step 1 installs `no_show` as `NOT VALID`; an unknown status is still rejected; step 2 validates including a real `no_show` row; rollback with a real `no_show` row keeps the row and the repaired constraint; rollback with none restores the five-status constraint; the repair can be re-applied; replaying 0378 and 0379 (option A) over the production-shaped state is idempotent and installs `no_show`; and the open-appointment index predicate excludes `no_show`.

Not proven: behaviour against the real production table and lock contention (the table is empty, so a lock wait is unlikely, but this was not measured there).
