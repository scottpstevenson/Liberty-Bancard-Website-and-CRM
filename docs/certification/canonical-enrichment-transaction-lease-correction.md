# Transaction and lease correction: local proof, production acceptance open

## What changed

- Explicit connection tracing records physical/backend/checkout IDs, safe
  correlation labels, phases, acquisition/execution/checkout durations and
  idle open transactions. SQL is hashed; parameters and error text are omitted.
  Release is observed through pg-pool events, never replaced. Query observation
  is installed once per physical connection. Native idle-transaction errors are
  handled without converting failed queries into successes.
- Contact admission reads now use the caller's transaction instead of a nested
  global pool checkout while runtime authority is pinned. An active-recipe
  denial still rejects the write; its receipt is persisted after rollback and
  release. This is a verified local self-wait mechanism, not proof of the sole
  production cause or attribution of the observed 22-second idle transaction.
- Import uses short atomic organization, source/location and mailbox units.
  Each mailbox unit includes its contact, provenance and restrictive consent
  facts. Pure parsing/module preparation is outside authority-pinned units.
  Preparation performs qualification and its candidate read outside the write
  transaction, then locks and rechecks affiliation/current facts inside it.
- Preparation checkpoints around qualification and real effects. Import renews
  its exact live source-item claim at bounded units. Both reject expiry after a
  lock wait; expired/transferred tokens cannot renew or overwrite progress.
  Final preparation guards roll back effects if expiry occurs before commit.
  Import finalization locks the row before evaluating wall-clock expiry.
- Authority-pinned write units use 1-second lock, 5-second idle-transaction and
  10-second statement bounds. No authorization is cached. Only PostgreSQL-known
  aborted deadlocks are retried; uncertain connection/commit failures are not.

The existing serial worker and continuation policy remain the only recovery
path. Original source evidence/accounting, native guards, runtime-owner fencing,
outbound pause and selective validation authority are retained.

## Final local certification

All commands below ran against disposable PostgreSQL/Redis with a provider-deny
boundary, never the shared or production database:

| Certificate | Result |
| --- | --- |
| `canonical-transaction-leases` | 103 checks passed |
| `canonical-recipient-preparation` | 96 checks passed |
| `canonical-provider-intake` | 79 checks passed |
| `canonical-program-discovery` | 45 checks passed |
| `canonical-owner-repair` | 34 checks passed |

Run each with:

```sh
npx tsx scripts/run-sfp2060-certification-disposable.ts --only <certificate>
```

The final full backlog test fulfilled **1,472 genuine deferred source rows in
13 serial continuation batches, 386,270 ms**, using **one pooled application
connection**. The first batch fulfilled 104 rows. It verifies immutable original
accounting/evidence, committed outcomes, no duplicate contacts on replay and no
further work after completion. No real provider calls, validation purchases,
cohorts or outbound messages occurred.

Additional adversarial tests use actual independent PostgreSQL lock holders,
competing preparation workers, expiry after qualification/after writes, native
connection termination, and a fault after the first mailbox commits. Recovery
reclaims the crashed actor's expired running item, reuses its first contact,
adds exactly the missing mailbox, and rejects the stale actor afterward.

`npm run check`, `npm run build`, the focused deadlock/phase test and
`git diff --check` pass. Build has existing bundle/import-meta warnings.
Unrelated old pre-deploy failures were not modified or claimed fixed.

The existing jobs-off application workflow was restarted once and serves port
5000 without a backend startup crash. The public screenshot exposes a styling
problem outside this backend patch; no client/styles/packages/frontend config
changed. Signed-in UI was not verified. Do not describe the screenshot as
successful full-app visual certification.

## Production: not certified

The live app still serves release `19995f4feabfcd640a16401ab61aece44095c00c`,
build `93d9237b-5b59-4989-a9c3-28e7eca6cded`. The correction above is **not
published**. Publishing the task's isolated workspace or pushing a branch does
not establish that the main app serves this code.

At **2026-10-05 18:33:40 UTC**, read-only production data reports:

| Legacy source outcome | Rows |
| --- | ---: |
| Committed completion | 51 |
| Still staged/blocked | 1,409 |
| Retry required | 9 |
| Running | 2 |
| Ambiguous organization match held | 1 |
| **Total** | **1,472** |

Outbound remains paused. ZeroBounce is enabled/closed, with its selective
admission predicate unchanged. No production writes, provider-control changes,
workbook import or manual replay were performed.

Production replica reads cannot attribute the primary lock graph. The live
logs still show old uninstrumented connection timings, slow contact-admission
reads and an owner-claim statement cancellation. These are not evidence that
the unpublished correction solved production contention.

## Required owner handoff and continuation

1. Merge the tested patch into the actual main publish workspace; owner publishes.
2. Verify health, live build identity and current runtime owner agree. Do not
   reuse a local build receipt as published-build proof.
3. Correlate instrumented backend/checkout/phase/last-query hashes with primary
   blocker observations during contention. Identify the actual caller before
   declaring the production cause resolved.
4. Observe multiple real scheduled preparation/import cycles, measure committed
   throughput and reconcile all original 1,472 rows. An explicit held terminal
   reason is not a fabricated completion. Retry-required/running/staged rows
   remain unresolved.
5. Verify subsequent scheduled progress and replay idempotency while outbound
   remains paused and validation remains selective.

**Task 2063 and the original consolidation acceptance remain open.** Production
acceptance is not moved into a follow-up task and is not replaced by local proof.
