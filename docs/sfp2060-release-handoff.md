# Task 2060 — SFP source-only release handoff

## Current disposition

**Task 2060 remains `IN_PROGRESS`. This is a source-only publication handoff, not
a production release or production-execution report.** This documentation work
made no production lead creation, provider call, production DDL, publication, or
other production mutation. Do not interpret the private UI screenshot as a
production observation: the screenshot was verified against fixture data over
loopback only.

| Gate | Current evidence/status |
| --- | --- |
| Combined offline source certifications | **PASS**. `node_modules/.bin/tsx scripts/run-sfp2060-certification-disposable.ts` exited 0 with all 16 suites after the final authority correction, including commercial authority (31 checks), contact merge (19 assertions), and legacy staging (152/152). Its disposable/fixture results are not production evidence. |
| Integrated-pipeline certification | **PASS**. Four governed ZeroBounce fixtures, two paid-result fixtures, three typed sources, three paused enrollments, exact-decimal/reconciliation and runtime-owner fences verified. |
| Typecheck and build | **PASS**. Typecheck passed after the final authority correction; `npm run build` passed on the final source. Existing chunk-size/CJS import-meta warnings remain. |
| Broader isolated pre-deploy gate | **FAILED in the recorded broader run: 102/137 suites passed, 35 failed.** Subsequent focused repairs do not turn that result into a pass. The broader wrapper has not been rerun against the latest corrections; remaining failures are not presumed baseline. |
| Private UI screenshot | Visually verified against fixtures on loopback. It proves neither production data nor production behavior. |
| Prepared source SHA | Resolve with `git rev-parse HEAD` from the clean committed handoff checkout; the commit/PR records the immutable candidate outside this self-referential file. The earlier `be910b1f53110a97e471960cefbcb5cff79a17a7` is superseded by the subsequent corrections. An isolated-task SHA identifies prepared source only, never the main workspace or live deployment. |
| Main merge / user Publish / deployed SHA and schema verification | **PENDING.** Publishing is a user action; no automatic publication. |
| Representative production output and replenishment | **PENDING.** The 100-business target, actual production receipts, and two scheduled replenishment receipts remain work in this same Task 2060. |

### Latest individual-check evidence

- `node_modules/.bin/tsx scripts/run-sfp2060-certification-disposable.ts` completed the final
  combined offline source-certification run with exit code 0 and all 16 source
  certifications passed after the final authority correction. The C1
  persisted-link certification reported `100/0`; retain that literal result as
  test evidence only, not a production count.
- `npx tsx scripts/run-sfp2060-certification-disposable.ts --only integrated-pipeline`
  **PASS**ed with exit code 0. Its evidence included four
  governed ZeroBounce fixtures, two paid-result fixtures, three typed sources,
  three paused enrollments, exact decimal accounting, reconciliation, and
  runtime owner fences. These are isolated fixture/test results—not live
  provider receipts, production leads, production enrollments, or production
  health.
- Typecheck **PASS**ed after the final authority correction. The final current-source
  `npm run build` **PASS**ed, with existing chunk-size/CJS import-meta warnings.
- The scoped architecture review for the selector fix **PASS**ed. Its
  boundary is material: the selector checks the claimed SHA/deployment match
  and an HTTPS reference; it does **not** independently establish the external
  publisher's identity or signature. Selector validation and fixtures are not
  publisher proof.
- Do not represent fixture evidence or an unverified deployment as `healthy` in
  JSON or any other status artifact.

The previously observed public health SHA
`0788ff1d70eb42b6c862145b69bd13d39f1fce5d` is a historical baseline from the
read-only preflight, **not** the prepared release SHA and not evidence that this
source-only handoff is deployed. The separate production observations and their
timestamps are recorded in
[`docs/runbooks/sfp-whole-pipeline-execution.md`](runbooks/sfp-whole-pipeline-execution.md);
they must not be presented as an atomic or freshly recaptured production snapshot.

## Final offline gate and release identity

Run the repository checks against the exact committed candidate and retain full
commands, results, and any residual baseline failures:

```sh
npm run check
npm run build
node_modules/.bin/tsx scripts/run-sfp2060-certification-disposable.ts
npx tsx scripts/run-sfp2060-predeploy-disposable.ts
```

The disposable wrapper is the documented isolated pre-deploy release gate; it
uses disposable socket-only PostgreSQL and private loopback Redis with provider
egress denied. Follow the execution runbook for relevant certification
coverage, including the integrated pipeline certification:

```sh
npx tsx scripts/run-sfp2060-certification-disposable.ts --only integrated-pipeline
```

The combined offline source-certification run and current-source build passed.
The separate broader pre-deploy wrapper **failed (102/137 passed; 35 failed)** before
the subsequent release-contract and certification repairs. It has not been rerun
against those corrections, and there is no current broader-gate PASS. The integrated certification, C1 result,
typecheck, and scoped architecture review are recorded separately above; fixture
and disposable results are not production evidence. Do not relabel a
fixture-only screenshot or provider-operation receipt as a production result.
Keep genuine failures visible; do not silence skips or classify a failure as
baseline without the documented comparison.

### Subsequent release-contract repairs

- Removed false private-key artifact matches caused by literal PEM delimiters in
  the normalizer, without changing the artifact scanner's detection rules.
- An unverified worker release now reports `runtime_release_held` with no staging work.
- Queue certification checks the exact 40-queue roster and keeps the retired
  attestation queue absent. API coverage resolves actual multiline registrations
  and client path constants instead of treating prefixes as endpoints.
- Immutable SFP contact evidence and recipient commitments explicitly block
  contact merges; they are not silently reparented.
- Sunbiz initialization uses the canonical authority's narrow, database-verified
  automated evidence policy. Its receipt identifies automation and has no human
  approver. General human production-classification approval remains unchanged.
- The final narrow architecture review passed after the unsupported system
  approver attribution was removed. This is source review, not production proof.
- Legacy staging fixtures use governed fake-provider validation with exact
  current-run/source receipt lineage. Negative checks retain zero-master-lead
  and zero-ready-held assertions. No fake provider receipt is production output.
- The expanded disposable launcher completed all 16 suites with exit 0, including
  commercial authority (31 checks), contact merge (19 assertions), and legacy
  staging (152/152). This is separate from the earlier 11-suite pass and the
  failed broader pre-deploy run.

## Main integration without completing this task

Task 2060 must remain `IN_PROGRESS` through production execution. The native
Ready/Apply path closes a task, so it is not a substitute for an active-task
source handoff. The existing GitHub connection can support a separate reviewed
source branch/PR; that does not itself update the main Replit workspace or
publish the app. A draft PR with unresolved release gates must not be presented
as publication readiness. Verify the actual main-workspace source identity
after integration, and preserve the user-initiated Publish boundary.

After committing the complete release candidate, confirm there are no remaining
working-tree changes and record the full immutable commit SHA for that candidate.
Record that candidate SHA in the PR/release record outside this self-referential
file; if subsequent changes alter the release contents, rerun the relevant
gates and resolve it again to the new committed SHA. Then use the supported
path to merge that commit to `main`.
The supported `main` merge must precede the user-initiated Publish action. Do
not publish an unmerged task branch or publish automatically.

Use `git status --porcelain` to confirm a clean tree, then `git rev-parse HEAD`
to resolve the committed candidate SHA. Run those checks after the commit, not
against a dirty working tree.

## User Publish and production safety gate

Before the user publishes, inspect the actual development-to-production Publish
diff. It must include every release-required schema contract, including
functions, triggers, constraints, and foreign keys, not just added tables or
columns. If anything required is absent or unclear, stop at the blocker rather
than claiming readiness.

After the user publishes, independently verify and record the actual published
deployment metadata and public health SHA against the intended merged release
SHA **before any audited production selection or paid provider spend**. The
selector's claimed-SHA/deployment-match and HTTPS-reference checks are not
independent publisher verification, and no fixture is a genuine publisher
proof. If actual published metadata and health cannot be verified, do not
perform audited production selection or spend.

Then verify and record:

1. The actual public health SHA equals the intended merged release SHA, and
   health/build status is current. Do not infer deployment from source, merge,
   a selector claim, or an earlier health response.
2. Production catalogs contain and enforce the required schema: relevant
   functions, triggers, CHECK/unique constraints, foreign keys, and indexes.
   Record the specific verified contracts. Catalog verification is separate
   from source migration-journal inspection.
3. Outbound authority remains paused; campaigns remain draft; native sequences
   and any new enrollments remain paused; there are zero sends and zero
   task-created active enrollments. A local CRM contact is not proof of a
   remote GHL projection.
4. Current provider/program permission, provider controls, actual account/API
   access, rate limits, circuit state, deployment/job ownership, cancellation,
   and operation leases are valid at execution time. Honor existing paid
   permission; do not recreate it unnecessarily or bypass a real denial.
5. Reused evidence points to its original immutable provider/validation
   receipts, with their original subject, provenance, and observation/expiry
   times. Preserve those receipts; do not overwrite, renew, synthesize, or
   relabel them.
6. Any named address requiring review has a real independent named reviewer
   making the item-level decision. No self-approval, reviewer impersonation, or
   fabricated approval. Continue other independently eligible work while a
   real review is pending.

Production DDL is **Publish-only**. Never use startup SQL, a manual production
migration command, or a custom production DDL shortcut. Production SQL access,
where supported for this task, is verification-only. No source-only test,
fixture, or publication request is permission to call a provider or mutate
production.

## Same-task production acceptance and reporting

The representative target is **100 distinct real businesses: 20 per each of
Automotive, Healthcare, Beauty/Spa, Construction/Trades/Home Services, and
Fitness/Recreation**, across Broward (12011), Miami-Dade (12086), and Palm Beach
(12099), subject to actual qualified supply. The objective remains **5,000
globally unique qualified, validated, currently policy-eligible recipients**.
These are targets, not achieved counts or guaranteed inventory. Capture **at
least two real scheduled replenishment measurements** showing new distinct
output and full-chain receipts. The 100-business sample, the two scheduled
receipts, and continued progress toward 5,000 are all part of **this same
Task 2060**, not a follow-up task.

For each of the 15 vertical/county pairs, report a timestamped evidence source
and keep these denominators separate:

- raw source rows/observations;
- distinct canonical businesses;
- distinct businesses currently qualified under the actual geography,
  operating-location, classification, and exclusion rules;
- business/address observations and distinct business/address identities;
- globally deduplicated recipient addresses with genuine current validation
  and policy eligibility;
- actual full-chain downstream receipts, including the current verified
  contact/business link and paused enrollment where applicable; and
- holds grouped by concrete reason, with overlapping-reason semantics stated.

Also report actual scheduled runs and their start/end times, completed outputs
versus failures/retries/duplicates, observed qualified-recipient yield and rate,
measured remaining backlog (or explicitly **unknown**), and a projection based
only on observed yield/rates. Do not substitute raw filings, business
observations, provider operations, queue starts, cached data, or memberships
for unique qualified recipients. Do not infer an operating branch from a
registered/filing address. If there is no qualifying evidence or the inventory
is short, report the actual shortage and holds; never fill a target with fake,
synthetic, misclassified, or otherwise unqualified records.

No production counts, rates, receipts, or backlog are asserted by this
source-only handoff. Populate them only from current production evidence after
the published SHA and required schema have been verified. Keep outbound paused
throughout. Continue the same task through real production output and repeated
scheduled replenishment; do not mark complete or split essential follow-through
into a new task.

Never fabricate health, counts, receipts, reviewer decisions, or a clean gate.