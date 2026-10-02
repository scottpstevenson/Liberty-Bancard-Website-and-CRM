# SFP enrichment: current diagnosis

## Scope and targets

The enrichment task is not the separate GHL incoming-contact import.
Its cumulative objective is 5,000 globally unique qualified, validated,
policy-eligible recipients. The representative business batch is 20 distinct
businesses in each of five verticals, totalling 100 businesses. There is no
50-recipient-per-business quota.

## Read-only production observations

October 2, 2026, production-scoped reads beginning at 16:47 UTC:

- 31 historical paused bridge receipts, 28 distinct businesses and 31 committed
  recipient addresses; 72 ready-held intents.
- 28 receipts across 25 businesses pass the queried minimum fresh-valid,
  unsuppressed, verified-link and paused-enrollment checks. This is **not full
  policy/receipt-chain qualification certification**.
- Minimum-check distinct businesses by package: Automotive 1, Beauty/Spa 3,
  Construction/Trades/Home Services 20, Fitness/Recreation 0, Healthcare 1.
- Most recent bridge receipt: October 2, 13:15:06 UTC. No later final output was
  present in this read.
- Paid candidate evidence contains business fields, but **zero email rows**.
  Business lookup completion is not successful email retrieval.
- 230 completed Outscraper Maps retrieval tasks, 61 no-result tasks and five
  outstanding tasks. All observed tasks have a blank original domain snapshot;
  none has a recorded contact-retrieval operation. The contact step requires a
  unique matched result with a usable domain; do not bypass that identity gate.
- 457 failed Apollo operations in the trailing 24-hour aggregate. Their attempts
  contain only generic transport categories (450 retryable failures and seven
  ambiguous failures), with no retained HTTP class. A separate expired
  pre-dispatch lease was also recorded. These records do **not** establish
  unauthorized, forbidden or rate-limited HTTP responses.
- 20 distinct businesses have valid named/unclassified email candidates requiring
  genuine independent policy review. That is a held intermediate queue, not
  certified output.
- 879 distinct businesses have discovery-required eligibility entries with no
  staged candidate.
- All six previously missing database authority triggers are now present; the
  three inspected function hashes match the previously verified development
  definitions. The historical missing-contract diagnosis is superseded.

Counts are separate snapshots, not a single atomic census. Rows, attempts,
recipient addresses and businesses must remain separate. No provider call,
production mutation, review approval, configuration activation or send was
performed for this diagnosis.

## Newly confirmed live ownership blocker

Publisher-controlled deployment logs at October 2, 16:51:26 UTC show the app
loaded artifact SHA `7e9b8425b6ab61c454b59b9a8d8f315bd0dd4d68`, build UUID
`7d09a107-0a12-41ac-9f36-06b6d7f04757`, and deployment identity
`publish-build:7d09a107-0a12-41ac-9f36-06b6d7f04757`.

The production `routine_sfp` selector still names SHA
`53ef7bdc5c48b1821adc92153e56c88b69ac6cfe` and identity
`publish-build:1df21193-ae7e-46aa-b2d2-db1ff46d39bb`, selection version 5.
The matching old runtime owner lease expired at 16:53:36 UTC. Its absence of
revocation does not make an expired lease usable. The current published process
cannot acquire or renew SFP ownership while the selector names another release.

This is a current live blocker, separate from the earlier zero-email yield.
No selector transfer was performed. The deployment metadata callback confirms
deployment/build success and domains, but exposes no publisher record, source
binding, timestamp or build ID. It alone cannot satisfy the independent
publisher verification prerequisite.

Use Lead Ops → South Florida Prospecting → SFP staging worker telemetry →
Published runtime-release ownership. After genuinely verifying the successful
publisher release record/protected logs against the intended source and current
runtime tuple, provide its HTTPS evidence URL and use **Transfer selection to
this published release**. This is the existing audited CAS-controlled
`POST /api/lead-ops/sfp/runtime-release-selection/select` path, not another
spending approval or outbound activation. Re-read current status/version first;
another Publish changes the UUID even if the SHA stays the same.

## Prepared diagnostic correction (workspace only)

Apollo request settlement now retains an allowlisted HTTP status, endpoint kind
and machine failure code, and writes the safe HTTP class and failure code to the
existing attempt record. Raw response/error text, credentials, emails and person
data are not retained in these diagnostics. Existing accounting, dispatch,
ownership, identity and policy guards are unchanged.

Pure-helper regression tests, TypeScript checking and the production build pass.
This change is prepared in the workspace, **not yet verified in the published
build**. It neither fixes an unproven provider-account issue nor creates qualified
leads. After publication, use existing governed operation results to identify
the actual Apollo failure before choosing the provider correction. Do not submit
a blind duplicate batch merely to recreate the old failures.

The enrichment task remains unfinished. Its full-chain production acceptance
and sustained replenishment target have not been met.