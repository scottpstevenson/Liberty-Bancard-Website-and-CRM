# SFP whole-pipeline execution and release gate

## Scope and completion

This repair remains open until the published pipeline produces real qualified
recipients and demonstrates continuing replenishment toward 5,000 unique
addresses in the five requested verticals. Offline fixtures, provider-operation
counts, successful publication, and a canary are not production acceptance.

Keep outbound paused, campaigns draft, native sequences and enrollments paused.
Neither review nor paused enrollment grants sending permission. Local CRM
visibility is not proof of GoHighLevel projection.

## Refreshed production baseline — October 1, 2026

The following are read-only production-replica observations, not observations
of the development database or evidence that workspace changes are live.
Measurements span 12:00–12:04 UTC (8:00–8:04 a.m. Eastern); they are not one
atomic snapshot unless specified.

- Public health still reports release
  `0788ff1d70eb42b6c862145b69bd13d39f1fce5d`, built at
  `2026-10-01T09:45:48.781Z`. Workspace application source initially matched
  audited remote main; only the approved brief and project memory differed.
- `south-florida-v1` is active, taxonomy 2 and program policy 2.
  Recurrence is disabled. The stored schedule is free 25, paid 10,
  validation 25, campaign staging 0.
- Outbound is paused at epoch 1.
- All five current `.v2` packages map to draft campaigns and paused native
  sequences. These mappings must be preserved, not recreated.
- The active outreach-policy document is version 1, with a 30-day validation
  TTL, business-role inbox eligibility, and independent review for named or
  unclassified addresses.
- At 12:02:59 UTC, an atomic aggregate query found 175 fresh-valid eligible
  rows across current frozen, nonvoid, nonsuperseded cohorts and the current
  policy document, representing **12 distinct address hashes**. This query
  does not replace final source/receipt/classification/package checks.
- At 12:00:39 UTC, review-required inventory was 20 eligibility rows,
  representing five business/address identities and five address hashes.
  The earlier planning observation of zero review backlog is now obsolete.
  Genuine independent review remains required.
- There were **zero paid email evidence rows**, zero ready-held intents,
  and zero paused bridge receipts. There were 1,810 paid evidence rows for
  other fields such as business names, addresses, categories and websites.
  Those are not revealed email recipients.
- There were no stored business-location rows. A headquarters, registered
  address, or filing address must not be claimed as an operating branch.
- Apollo, Outscraper, Serper, ZeroBounce and OpenAI controls were enabled with
  closed circuits. This does not establish effective secret-backed flags,
  current runtime ownership, transport access or account permissions.
- Trailing-24-hour SFP operation counts at 12:03:39 UTC: Outscraper 176
  completed / 6 failed; Apollo 197 completed; Serper 334 completed / 9
  failed / 1 running; ZeroBounce 32 completed / 8 failed. Three validation
  failures specifically recorded `PRE_DISPATCH_LEASE_EXPIRED`.
  These are operation receipts, not billed HTTP call counts, email yield,
  unique recipients or queue-completion rates.
- The inspected migration ledger contained 318 rows. Row count and its
  maximum timestamp are not proof that any particular migration's exact
  content hash was applied.

## Offline isolation

Use the dedicated disposable launchers and provider-deny boundary. Each run
must create its own socket-only PostgreSQL database, scrub inherited provider
and database credentials, and destroy the entire cluster. If Redis is used,
give the run its own namespace. Do not run DB-writing certifications against
shared development or production data. Inject provider responses only inside
the ordinary reserve/dispatch/settle path.

Certify actual free, paid and contact-source paths, current stored CRM business
links, final mutable eligibility, recipient uniqueness, exact decimal billing,
leases, restart/concurrent behavior, API role/CSRF controls and rendered UI.
Compare unrelated repository-wide failures against the unchanged baseline;
do not silently skip or call a failing gate clean.

The full isolated release wrapper is
`npx tsx scripts/run-sfp2060-predeploy-disposable.ts`. It creates private
socket-only PostgreSQL and private loopback Redis, sets a fresh test namespace,
chooses an unoccupied HTTP port, supplies only disposable test credentials and
the current Git SHA, and destroys its services after the gate. Do not replace it
with the configured legacy pre-deploy workflow: that workflow is not a
disposable-database launcher.

### Baseline comparison during implementation

- The initial `npm run check` passed before the later coordinated edits.
  The subsequent `npm run check -- --pretty false` failed with classification,
  provider-runtime, logical-job-manifest and recursive schema-reference errors
  while those owners were still editing. Neither result is final release proof.
- Migration integrity passed: 820 checks and two warnings; the five new
  entries have timestamps above the prior journal high-water mark.
- The CSRF scanner passed all 114 mutation call sites at that checkpoint.
- API coverage was rerun against an extracted, unchanged starting source tree.
  It fails with the same six unrecognized contact-business/contact-link paths
  shown in the configured workflow. This is a measured baseline failure, not a
  clean gate and not proof that the actual authenticated handlers fail.
  Actual affected HTTP/role checks remain required. The failed baseline log is
  `/tmp/sfp2060-baseline-api-coverage.log` for this workspace session; it is not a
  durable release artifact.

### Integrated implementation checkpoint — not release certification

The disposable launcher has now exercised the real migrated SQL paths. An
intermediate full run passed fairness, provider contracts, ready-held contracts,
private Redis reservation, automatic continuity, candidate deduplication,
classification, free continuation and source recovery. It then failed the
contact-source bridge certification; the integrated suite was not reached in
that run. These results are valid only for the code measured at that checkpoint.

The separately executed command
`npx tsx scripts/run-sfp2060-certification-disposable.ts --only integrated-pipeline`
failed: four addresses reached ordinary validation reservations, but all four
were recorded as retryable validation failures and none were valid. A sanitized
operation/attempt diagnostic is being added to distinguish a transport failure
from a reservation, ownership, SQL or dispatch failure. Do not replace this proof
with manually inserted eligible rows or lower the expected positive result.

The core review still blocks release on retired-owner selection, leases or
receipt TTLs expiring during transaction waits, staging lock upgrades, absent
suppression/content races and the final paused-state check. The documented
Apollo people-search work-accounting mismatch has been repaired, but the
governed SQL integration proof remains pending. Current type errors are not
certified as an unrelated baseline: the initial pre-edit typecheck passed.

No production schema change, provider execution, recurrence activation,
paused-enrollment output or publication has occurred as part of this repair.
The same task remains open.

## Publication prerequisite

Publication is a user action. A workspace edit, GitHub push, or isolated task
branch does not change the deployed application.

Production DDL belongs to managed Publish. Do not replay migrations at
production startup, add a production migration runner, or fabricate migration
hashes. Preserve the already repaired contact-source and Sunbiz system-link
contracts.

Before requesting publication, inspect the actual development-to-production
Publish diff. Confirm every new required CHECK, FK, unique index, function and
trigger is included. A table/column-only diff is not proof of the link-authority
contract. If functions/triggers or constraint replacements are omitted, record
the exact omitted contracts as a release blocker and obtain a supported
platform/operator resolution. Never claim that publishing an incomplete diff
will make the pipeline ready.

After publication, verify the public health SHA and production catalogs
independently before spending through the repaired adapters.

## Production continuation

Use authenticated, audited admin actions and ordinary workers for the already
authorized enrichment, recurrence, staging and paused-enrollment work.
Production-replica SQL is verification only. Do not infer production control
state from development controls.

1. Recheck outbound pause, active program/policy, five exact current packages
   and live content, provider access, and current deployment/job ownership.
2. Complete the currently eligible subset of the 12 baseline addresses using
   genuine matching fresh receipts. Explain each held identity rather than
   forcing it through or buying duplicate validation.
3. Enable bounded positive staging and the canonical paused-bridge consumer
   through their audited controls, only after their prerequisites pass.
4. Aim for a real representative batch of 20 distinct businesses per vertical.
   Record actual shortages, account errors, billing uncertainty and independent
   review holds. Continue other eligible routes when one provider is blocked.
5. Correct observed failures and keep scheduled replenishment running. Capture
   at least two scheduled measurements with new distinct full-chain receipts.
6. Join source → original validation receipt → current policy/review →
   master lead → pinned package → ready-held intent → recipient commitment →
   CRM contact → current verified business link → paused enrollment receipt.
   Separate unique addresses, distinct businesses, observations, alias lineage,
   operations and intents.
7. Verify zero sends, zero task-created active enrollments, no unpause and no
   unauthorized GHL dispatch. Report actual rates, unresolved backlog and
   evidence-based projections; do not present scheduling capacity as yield.

Any publication, missing authority contract, genuine account permission or
independent-review blocker remains part of this same repair. Do not mark the
task complete or move required production execution into a follow-up.