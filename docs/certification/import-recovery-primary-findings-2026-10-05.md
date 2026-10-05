# Published import-recovery diagnostic findings

## Serving build and scope

Public production health returned HTTP 200 with `status=ok`,
`env=production`, SHA `43ed1448f08ff3bc122c8e099a366e4ae36e4722`,
build time `2026-10-05T21:29:38.363Z` and publish build ID
`e9dd5b6e-9763-499f-adcb-2b0955ddd2b2`.

This investigation consumed ordinary recovery diagnostics and read-only
production-replica accounting queries. No recovery replay, provider dispatch,
control change, lock termination, production write or deployment was performed.
Replica accounting is not being used as primary lock evidence.

## Exact primary deadlock

Two primary snapshots at **21:30:17.852 UTC** and **21:30:18.271 UTC** captured:

| Native PID | Worker / phase | Checkout | Waiting on |
| --- | --- | --- | --- |
| 13053 | canonical-import-recovery / import_owner_claim | e9184355-75d9-438d-89ec-41696e623c09 | PID 13110, transaction 20617263 |
| 13110 | sfp-free-classification | 4dfbdaa7-afd6-4b3c-b06e-c9571611c770 | PID 13053, transaction 20617264 |

Both waits were ungranted transaction-ID `ShareLock`s. This is an observed
two-way wait cycle, not an inference from simultaneous worker activity.

At **21:30:18.572 UTC**, the recovery checkout emitted SQLSTATE **40P01** with
sanitized native deadlock edges `13053 -> 13110` and `13110 -> 13053`.
Its protocol connection ID was `174298318`, demonstrating why protocol IDs
must not be substituted for native PIDs.

Exact SQL attribution:

- Recovery fingerprint `7fa440840a90d56f` is the owner-row `FOR UPDATE` in
  `advanceSfpPublishedRelease()`, called by `claimSfpRuntimeDeploymentOwner()`.
- Classification snapshot fingerprint `ce1120aad38af2bf` is the
  `lockCurrentSfpRuntimeOwner()` selector/owner `FOR SHARE` statement.
  The complete application fingerprint is `7da8fbdaa89d0468`.
  Rendering the static template, prefixing the snapshot's exact trace comment,
  truncating the native tracked query to 1,023 bytes, stripping that comment and
  hashing reproduces `ce1120aad38af2bf` exactly.
- The classification transaction had owner-side write-lock metadata and was
  blocked on selector-side authority; recovery was blocked obtaining owner-side
  authority. The primary relation OIDs resolve to
  `sfp_runtime_owner_authority` (11550924) and
  `sfp_runtime_release_selectors` (11551060), plus their primary-key indexes.

The blocking worker and shared-pin helper are proven. The snapshots do not
provide a JavaScript call stack for the classification helper's parent call;
do not invent one or attribute this particular cycle to heartbeat renewal.

## Additional materialization blockage

At **21:30:16.072 UTC**, recovery PID 13049, checkout
`f856916a-3d23-4dbf-b65c-072ee0f89ada`, phase `import_materialize`, was blocked
by classification PID 13110, checkout
`81b00813-c392-43cd-8c28-225c31712e3f`.
Classification also blocked campaign staging on the runtime-owner advisory lock.
The correlated application transaction event recorded `55P03` on the complete
shared-pin fingerprint `7da8fbdaa89d0468`; the original row error for source row
241 was retained separately.

Later diagnostic logs continue to record original `55P03` failures and separate
cleanup `55P03` failures with shared failure IDs. The diagnostic publication
did not repair either transaction lifecycle.

## Observation limitation

Capture `d6fdb419-9ec2-4394-bd9b-981ac35147ac` reported observation failure at
21:30:41.371 UTC and final state `failed` at 21:30:51.472 UTC after 47 samples,
23 of which contained blocked backends. Its failure supplied no SQLSTATE.
The observation did not complete the requested full window. The two primary
cycle snapshots and PostgreSQL's independent deadlock edges remain valid
evidence; an exact cause for the observer's own failure is not established.

## Retained-row reconciliation at 21:51:57 UTC

Production-replica accounting matched batch keys belonging to original execution
`79356e0b-c0b0-4a2f-abe1-f5844b7c9335`:

| State / terminal reason | Rows |
| --- | ---: |
| Committed canonical-local fulfillment | 92 |
| Staging recipe disabled | 1,205 |
| Recovery retry required | 108 |
| Ambiguous organization match | 15 |
| Running, all claims expired | 52 |
| **Total** | **1,472** |

There are 1,472 distinct original source-row batch keys spanning rows 1–1,472.
Latest canonical fulfillment remains **20:49:59.452 UTC**: no increase over the
pre-diagnostic 92-row observation. This is complete item accounting, **not**
complete downstream fulfillment or sustained recovery acceptance.

Original immutable accounting remains 1,471 deferred dispositions and one failed
disposition; those dispositions are not downstream fulfillment receipts.
Outbound pause is `paused`. ZeroBounce provider control is enabled with its
circuit closed; no selective-admission policy or validation setting was changed
by this investigation. Provider readiness alone does not prove selective
validation execution.

## Required correction and acceptance boundary

The next correction must eliminate the demonstrated selector/owner transaction
cycle across recovery acquisition and classification pinning, preserving owner,
release, native-guard and claim-token fencing. It must also preserve original
failure evidence and safe token-fenced cleanup/reclamation.

Reproduce this specific cycle in disposable infrastructure before claiming a
fix. Do not increase application pool sizes, timeouts or leases, disable the
blocking worker, bypass authority, or force ambiguous rows into completion.
Production remains unaccepted until multiple normal automatic cycles commit
new fulfillment and every original row has evidence-backed downstream accounting.

## Implemented correction (not yet production acceptance)

The transitive dispatch path is
`markSfpProviderOperationDispatchBoundary()` →
`renewSfpRuntimeOwnerLease()` →
`renewSfpRuntimeJobLease()`.
Renewal updated the owner before the job-lease helper requested the selector
share pin. Dispatch now takes the matching selector share pin **before** its
direct, epoch/token/lease-fenced owner update. It does not take an owner share
lock before updating, avoiding competing dispatchers' lock-upgrade deadlock.

`npx tsx scripts/test-sfp-dispatch-lock-order.ts` extracts and executes the actual
production helpers against a test-owned native PostgreSQL cluster. Its control
reproduces the historical `40P01`; the corrected dispatch and actual recovery
claim path both commit under the same schedule. Concurrent dispatch renewals
serialize safely. Unselected releases, revoked/expired owners, stale epochs and
tokens, expiry during a selector wait, wrong job claim tokens, cancellation and
expired operation claims remain rejected. No app database or provider is used.

Application pool sizes, timeouts, leases, provider controls and outbound policy
are unchanged. The correction needs publication before production convergence
can be evaluated; the earlier 92/1,472 observation is not acceptance of this code.

Verification: 13 focused regression checks, the 22-check primary-capture suite,
and canonical transaction retry checks pass. Project type checking (including
the new regression script), production client/server build, and the restarted
public app preview pass.

The full pre-deploy gate still has its pre-existing server test-environment
failure (`development` reported where `test` is required). The older standalone
runtime-fence source check also still expects an obsolete all-exclusive
`FOR UPDATE` clause; that literal is absent in unchanged HEAD as well as this
correction. Neither failure is claimed fixed or counted as a passing gate.

## Verification after publishing the lock-order correction

Production health returned HTTP 200 / `status=ok`, SHA
`eb06495c37339fb7d958285bd99ec68c8fec5b18`, built
`2026-10-05T22:50:23.068Z`, publish build
`ee2475a7-057c-47e4-8b4f-c8a4f18fb2e9`.

The automatic capture contained 22 primary blocked snapshots and no observed
two-way cycle. It ended with observation failure after 52 samples; this is not
proof of absence outside the captured window. Recovery still logged original
and cleanup `55P03` failures, plus acquisition failures with no SQLSTATE.

New primary evidence:

- At 22:51:44.914 and 22:51:45.514 UTC, classification PID 27288 was the root
  blocker while working through job/operation guards; recovery PID 27284 waited
  for its owner-authority pin.
- At 22:51:56.467 UTC, classification PID 27283 held the dispatch transaction
  while recovery PID 27285 waited for its owner-authority pin.
- At 22:51:57.615 UTC, classification PID 27283 was committing with `SyncRep`
  wait and still blocked recovery. Its transaction age exceeded four seconds.
- Owner-update fingerprint `b2a5232ffa1f6fd4` maps to both dispatch owner renewal
  and the redundant owner renewal inside the job helper. Job-lease update
  fingerprint `3f8b57aec7d54529` and operation checks are downstream in that
  same owner-write-pinned transaction.

At 22:59:56 UTC, committed fulfillment is **96/1,472**, up four from the earlier
92. The other states are 1,110 staging-disabled, 160 retry-required, 17 ambiguous,
and 89 running (88 expired claims). Last fulfillment is 22:51:43.592 UTC.
All 96 completed rows have a fulfillment audit receipt, an existing referenced
business, and provenance events for every contact ID recorded in that receipt.
This does not assert that every retained mailbox or downstream qualification
requirement is satisfied.

Outbound remains `paused` at epoch 1. ZeroBounce remains enabled/circuit closed;
no provider controls or selective-admission policy were changed.

### Further implemented correction

Dispatch owner upkeep now commits in a short selector-first transaction before
the larger dispatch effect transaction. That effect transaction immediately
SHARE-pins and checks the exact owner, before policy/graph/budget work; job renewal
does not perform a second owner update. Claim, cancellation, provider/program,
parent, budget, expiry and final durable dispatch guards remain intact.

The expanded native regression suite passes 26 checks. Executing the actual
dispatch boundary against a deliberately held budget lock reproduces the
historical blocked recovery reader; with independent upkeep, recovery's shared
pin completes while dispatch waits. Revocation, expiry, epoch/token and release
drift between upkeep and effect execution fail before budget or dispatch.
Operational upkeep remains committed after effect rollback, without permitting
provider execution. The test deliberately stops before parent/provider marker
execution and makes no app-database or provider calls.

This further correction is workspace code, not the served production build.
It still requires publishing and ordinary production-cycle verification. No
pool size, application timeout, lease duration or safety control was increased.
