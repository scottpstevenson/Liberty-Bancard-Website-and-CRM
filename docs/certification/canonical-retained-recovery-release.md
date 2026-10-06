# Canonical retained recovery release

This is a release-certification record, **not production recovery acceptance**.
The existing recovery workstream stays open until owner publication, sustained
ordinary automatic progress and reconciliation of all original production rows.

## Repair

- Matching live-owner acquisition now uses selector-first shared verification.
  Genuine acquisition, handoff and reclamation remain separate, bounded,
  serialized and release-fenced.
- Healthy verification does not renew authority. Near-expiry upkeep is a
  separate short transition fenced to the observed live epoch and token.
- Recovery retains both the original row error and cleanup error. Confirmed
  PostgreSQL row aborts can yield only after a fresh bounded authority/health
  check. Failed cleanup leaves the original token intact for ordinary expired
  claim reclamation; uncertain commits and authority loss remain explicit failures.
- Acquisition and processing have separate timings and truthful zero-progress
  outcomes.
- Only the original `RECOVERY_PROVIDER_STAGING_FAILED` failure class is added
  to recovery eligibility. Its original failed receipt remains immutable.
- Fulfillment now verifies actual mailboxes, their business projection and
  fingerprint-bound provenance. Finalization pins the original live claim
  before graph rows. Another business's shared mailbox is held, not transferred.
- Previously completed source items without the stronger qualification
  certificate are automatically reverified through their original work items.
  Native hold diagnostics are persisted independently of immutable accounting.

No production controls, pool ceilings, transaction timeout ceilings or lease
durations were increased. No outbound or ZeroBounce policy was changed.

## Disposable verification

The original retained raw rows were copied with read-only production queries.
Raw data stayed outside the repository in `/tmp`. Tests used a private migrated
PostgreSQL cluster, stripped provider credentials and a fatal provider/network
deny boundary. No production replay, imports, cohorts or approvals were created
to manufacture proof.

Commands:

```sh
npx tsx scripts/run-retained-import-recovery-disposable.ts /tmp/canonical-retained-recovery-input
npx tsx scripts/test-sfp-dispatch-lock-order.ts
npx tsc --noEmit
```

Results:

| Check | Result |
| --- | --- |
| Published artifact/runtime handoff, rollback, revoked/retired fencing | Passed |
| Five actual workbook intake cases | Passed; 2,914 rows |
| Native canonical transaction/lease suite | Passed; 135 checks |
| Native dispatch lock-order suite | Passed; 26 checks |
| Actual recovery faults, fresh-process restart, legacy re-verification, budget contention, retained recovery and replay | Passed; 40 checks |
| Provider calls, outbound effects, nonselective validation admission | Zero |
| TypeScript check | Passed |

The held-budget fixture invokes both the actual initial owner claim and actual
recovery tick, with real mailbox/business materialization while dispatch remains
blocked on the native budget lock. Faults include real row/cleanup lock failures,
abandoned-token expiry and loss of a commit acknowledgement after the first
mailbox is physically committed. Restart completes every mailbox, without
misreporting that partial commit as row fulfillment.

## Retained workload reconciliation

Input digest:
`2b4e04af8bdd3a14935616a8119f83141e0d649a4ac46ea73b48fdec07645926`

| Outcome | Rows |
| --- | ---: |
| Fulfilled with mailbox, business and provenance proof | 997 |
| Fulfilled business-only rows; no expected mailbox | 161 |
| Ambiguous organization match hold | 296 |
| Native business-affiliation conflict hold | 18 |
| **Total reconciled** | **1,472** |

All 1,277 expected mailbox occurrences were reconciled: 997 verified fulfilled
and 280 on explicit held rows. These are row-bound occurrences, not a claim of
997 distinct send-ready recipients. Hygiene and outbound eligibility remain
separate authorities.

Recovery converged over 10 concurrent-worker cycles. Replay converged over
6 cycles with the same outcomes and **no new contacts, businesses or provenance
records**. No unresolved running/retry work remained. Original fingerprints and
all original dispositions were unchanged, including the infrastructure-failed
row. Every hold had fingerprint-bound native diagnostic evidence.

## Production acceptance still required

After the owner publishes the release containing this record:

1. Verify the deployed build identity matches the supplied release commit.
2. Observe sustained committed fulfillment across ordinary automatic cycles,
   not an administrative replay or a job-level completion message.
3. Reconcile every original production row, expected mailbox, actual business
   projection and provenance, including formerly completed rows.
4. Report fulfilled rows separately from each genuine hold reason and from any
   retry/abandoned/authority failures. Do not substitute disposable counts for
   production evidence.
5. Keep outbound paused and ZeroBounce selective; keep the existing task open
   until that acceptance is established.
