# Import recovery primary-lock capture

This is diagnostic instrumentation, not a recovery fix or production acceptance.
It does not change owner fencing, retries, pool capacity, application timeouts,
row leases, provider controls, selective validation or outbound pause.

## Collection after publishing

The first ordinary canonical-import recovery tick in each published process
starts a 60-second capture automatically. No manual replay is needed. It uses
one independent connection with read-only defaults, a 750 ms diagnostic-only
statement limit, a 1-second diagnostic query deadline and a hard capture deadline.
It never uses an application pool slot. Samples are sequential at 250 ms minimum
spacing and capped at 240. The connection closes at completion or failure.

The observer verifies `pg_is_in_recovery()=false` before collecting. Replica or
permission failures emit `db:primary_lock_capture_unavailable`; they do not fail
recovery. PostgreSQL `pg_blocking_pids()` supplies actual waiter/blocker edges,
including recursive upstream blockers. Snapshots include native backend PIDs,
transaction/query ages, lock types, modes, object IDs and granted flags.

Non-sensitive SQL comment tags identify instance, checkout, worker and phase.
They require no extra statements in application transactions. Named prepared
statements and pg Query objects are not rewritten. Untagged blockers remain
visible by PID and fingerprint; do not invent a worker mapping for them.
Legacy `backendId` values are explicitly labelled protocol IDs, not native PIDs.
Startup claims, runtime-heartbeat claims/renewals and queue-selection-watch
renewals have distinct phase labels, so otherwise identical renewal SQL can be
attributed to the actual caller rather than guessed from its fingerprint.

## Evidence access

Deployment logs contain `db:primary_lock_capture_started`,
`db:primary_lock_snapshot` and `db:primary_lock_capture_finished`.
`canonical_import_recovery_original_error` and
`canonical_import_recovery_cleanup_error` share a failure ID and contain
separate, sanitized cause chains. Original exception/cleanup behavior is
unchanged; the diagnostic change does not claim to repair cleanup.

Admin-only, no-store routes:

- `GET /api/admin/import-recovery/lock-capture`: status and last 20 blocked samples.
- `POST /api/admin/import-recovery/lock-capture`, empty body: another bounded
  observation window, not a recovery run. Existing authentication, admin-role
  checks and global CSRF protection apply. Concurrent starts reuse the window.

No SQL bodies, parameters, raw error messages, source records, credentials or
claim tokens are emitted. PostgreSQL deadlock details are parsed only into
numeric waiter/blocker edges and lock modes; appended statement text is omitted.

## Interpretation

Correlate a snapshot's native PID, trace checkout, phase and query fingerprint
with the separate failure events and existing transaction logs. A blocker PID
with no trace is an access/attribution limitation, not proof of a particular
caller. A full 64-backend result is flagged as potentially truncated. An empty
window means no blocker was captured, not that contention or recovery is fixed.

Certify with `npx tsx scripts/test-import-lock-capture.ts`. The test creates and
destroys its own loopback PostgreSQL cluster and does not use the app DB, Redis,
provider transports or production.
