# Canonical enrichment: latest transaction/lease certification

**Current — 2026-10-05:** local transaction/lease correction is certified;
production acceptance remains open. Final certificates pass 103 connection/lease,
96 preparation, 79 intake/replay, 45 discovery/authority and 34 owner-contract
checks. The final disposable one-connection serial worker committed all 1,472
deferred rows in 13 batches (386,270 ms), then replayed without new work.

At 18:33:40 UTC the older live build reports 51 completed, 1,409 staged,
nine retry-required, two running and one ambiguous-match hold. No production
write or publish occurred. Primary blocking-caller attribution, sustained
corrected throughput and subsequent scheduled convergence remain unverified.
Owner must merge this isolated patch into the actual publish workspace and
publish before those checks can proceed. Keep task 2063 open, outbound paused
and validation selective.

See `canonical-enrichment-transaction-lease-correction.json` and its companion
`.md` for the exact proof, limitations and owner handoff. The public preview
styling problem is outside this backend patch; signed-in UI was not verified.

## Historical dependency gate and early workbook tests

## Status

**Current:** the indexed contact-link lookup is published and independently
verified. Linking has scanned 25 records without the old preview failure;
all 25 were held and none committed. Preparation has scanned 785 records,
all held, with no program-scoped preparation intents. This is bounded scan
progress, not full-population convergence or downstream acceptance.

Production owner-console repair was independently verified at
2026-10-05 00:57:22 UTC. All eight additional address/preparation predicates
and all seven general-link predicates pass. Receipt:
`canonical-enrichment-console-batch-production-verification.json`.

Ordinary discovery now selects current canonical program/business scope in the
existing stage/provider ledgers, without freezing cohorts or requiring a manual
preview. Immutable selection pins fence reservation, dispatch and promotion;
dispatched facts still settle after authority drift. Asynchronous Outscraper
polling and Apollo child requests retain the original scope. Historical cohort
void/cancellation controls remain enforced. The unused cohort-freezing discovery
tick was removed rather than retained as a second implementation.

The focused disposable certificate currently passes 32 checks
(`canonical-program-discovery.json`). Development has migration 0332 installed.
The 34-check native owner-delivery certificate passes. Production execution,
actual workbook imports/replay, full-population convergence, representative
receipt-to-paused-enrollment traces and two deployed scheduled cycles remain
required before closure of the original task. They are not follow-up tasks.
No Agent production writes, provider release, outbound release or production
workbook imports occurred.

### Owner publish independently verified — 2026-10-05

Read-only verification confirms the published health endpoint serves revision
`e024f02a550e5a4733c0eecef20798a6a1f1098f`, build
`c6923213-d037-4d83-bbfb-3ef46009d6f2`, with HTTP 200. The production release
selector and leased runtime owner match that release. Outbound remains paused.
All seven relationship predicates and all eight address/preparation predicates
pass. Program discovery columns, nullable historical cohort fields and the
validated exclusive-parent CHECK are present. The exact migration 0332 hash
is absent from the custom ledger; catalog materialization is independently
verified, not proof that Publish replayed the migration file.

Scheduled discovery has run three audited cycles without creating cohorts.
These are **not passing operational acceptance cycles**: validation recovery
reports zero queued work; no program-scoped preparation intents exist in the
observed snapshot. Preparation scanned 65 contacts, all held with
`NO_CURRENT_PROGRAM_BINDING_OR_AVAILABLE_EMAIL`. The linking cursor remains
at zero, with no committed links; production logs show repeated query timeouts
at the contact-link preview boundary and connection errors in other workers.
Discovery audits also exceed their nominal drain budget. These observations
require diagnosis; they do not establish full-population convergence or
receipt-to-paused-enrollment progression.

Observed denominators are 154,418 contacts (154,016 production-class) and
92,831 businesses (85,808 canonical-class). They are a point-in-time inventory,
not a completed coverage certificate. No workbook imports were performed.
The original task remains open. Receipt:
`canonical-enrichment-post-publish-verification.json`.

### Contact-link timeout correction — local verification before republish

Candidate retrieval now separates legal-name, domain, registry-name/DBA and
retained stable-key matches before running the unchanged relationship evaluator.
All competing alternatives remain visible; the final per-source predicate,
native write guard, provenance and eligibility rules remain unchanged.
Forward migration 0333 adds three lookup indexes over the already reviewed
immutable normalization function. No native bodies or old generated keys change.

The initial unindexed and broad registry-lookup experiments remained too slow
on production read-only EXPLAIN (19–29 seconds) and are not the final solution.
The final candidate query uses selective parameterized name/DBA lookups.
Sixteen disposable checks prove candidate parity and all three normalization
index paths with 50,001 unrelated businesses plus 50,001 registry entities
(144 ms observed). The real migrated automatic-linking certificate passes 31
checks, including native commitment, replay, explicit holds and retired/revoked
owner denial; no provider/enrollment/communication/cohort effects occurred.
TypeScript and build pass. The final real development page uses both registry
indexes (975 ms execution; cold planning 5,222 ms). These timings are not a
deployed production performance certificate.

Development indexes are installed. The actual managed Publish diff emits
exactly three syntactically intact CREATE INDEX statements, with no structural
data loss or removed objects. Production remains on the prior published build
and has not received this correction. Owner republishing is required; index
construction can lengthen Publish and temporarily hold writes on the affected
tables. Workbook imports and successful downstream scheduled-cycle acceptance
remain unproved. Receipts:
`canonical-enrichment-candidate-retrieval.json`,
`canonical-enrichment-contact-link-automation-test.json`,
`canonical-enrichment-lookup-publish-diff.json`,
`canonical-enrichment-indexed-query-development-plan.json`.

Development restarted successfully with background workers disabled and outbound
paused. The unauthenticated dashboard capture renders the sign-in page; the
signed-in UI was not verified in this pass. Production logs still show database
connection timeouts across multiple workers, so the candidate-query correction
must not be described as proof that every production bottleneck is resolved.

### Indexed lookup republish independently verified — 2026-10-05

Production health returns HTTP 200 for revision
`2e3655a5c32a8670bc6d362d10ac4907d5840475`, build
`1abdef16-c785-473e-a95f-11d6bc4c1481`. The release selector and unrevoked
leased owner match that build. All three new lookup indexes are installed.
Outbound remains paused at epoch 1; Agent checks were read-only.

The final full candidate/evaluator query for contact IDs 1–25 completed in
2,847 ms with 1,321 ms planning, returning one evidence alternative. The
production optimizer used the new registry-name lookup; this is a bounded
query measurement, not proof for all pages. The scheduled linking worker
completed its first 25-record page with no last error, holding all records
and committing zero links.

Preparation advanced from 760 to 785 examined records during this observation
window, still with zero prepared recipients and no program-scoped intents.
This is not sufficient downstream progress to satisfy acceptance. Production
logs still show connection timeouts across other workers, including a runtime
heartbeat; campaign staging reported five failures. Full-population coverage,
representative useful-recipient/paused-enrollment traces, two successful
downstream cycles and owner-only workbook import/replay remain outstanding
within this original task. No production imports or manual worker triggers
were performed. Receipt: `canonical-enrichment-indexed-publish-verification.json`.

### Historical native-delivery investigation (superseded by current status)

**Updated owner-execution repair:** the user has amended the earlier
project-level prohibition. A forward native-contract repair now passes
disposable certification; see `canonical-enrichment-native-repair.md` for
the exact versioned source, authorized-owner steps and verification queries.
Production has not been repaired or verified. The investigation below is
historical context for that deliverable, not a continuing ban on the
user-authorized owner route.

**Incomplete; contract-dependent implementation is blocked.** No application,
schema, dependency, deployment configuration, production import, or outbound
behavior was changed by this investigation.

The read-only managed Publish diff reports `success=true`, `hasDiff=false`,
and zero statements while production lacks all three required relationship
functions and retains the older reviewed-link function body. The exact
production application guard still returns:

| Predicate | Result |
| --- | --- |
| Reviewed-link trigger/body installed | false |
| Immutable evidence trigger | true |
| Evidence table | true |
| Evidence column | true |
| Evidence foreign keys | true |
| Typed contact-source checks | true |
| Relationship evaluator | false |

Development contains the expected relationship function bodies and reviewed
trigger body. Therefore ordinary republishing is **not a proved delivery
route** for these objects. The serving health endpoint now reports the merged
application revision `42309395870515b0a575e85f6c753a65da408c2a`; the older
serving revision in the planning audit is historical.

**Platform owner:** Replit's managed PostgreSQL / Publish schema synchronization.
**Required resolution:** a supported platform-owned delivery or a documented
supported route demonstrably delivering the exact functions, trigger bodies,
and constraints. Generic schema-sync documentation is insufficient evidence.
Replit documentation did not establish that route for this native contract.
The official support channel is the workspace's **Get Help** entry, as described
in [Support Policy](https://docs.replit.com/legal-and-security-info/support-policy).
The JSON native-delivery receipt contains non-sensitive catalog evidence.

Do not substitute manual production SQL, build/startup DDL, a custom production
migration runner, changed expected fingerprints, or weakened write guards.
Do not import the supplied workbooks into production while this gate is blocked.

## Independent work completed

All five actual October workbooks were independently extracted with Python's
standard library, with no package installation:

- Original file hashes and per-file rows/columns match the approved audit.
- 2,914 rows; 1,245 distinct place businesses; 2,754 distinct normalized emails.
- Every original cell round-trips through XLSX extraction and `csv-parse`.
- All 93 columns persist in protected raw source evidence in a disposable DB.
- The existing `createCro03SourceBatch` boundary persists 2,914 subjects,
  observations, and occurrences across five batches.
- Replaying all five batches creates no duplicates and returns the same
  occurrence identities; changed payloads are rejected.
- HTTP network calls are denied during the certificate; none were attempted.
- CRM, provider-operation/observation, preparation, enrollment, and communication
  row counts remain unchanged during the certificate.

**Scope limitation:** the test supplies raw evidence directly to the existing
staging boundary. The current HTTP route does not do that; this is not proof
that the route, canonical importer, CRM upsert/outbox, validation, preparation,
or scheduled progression has been repaired. The route rejects XLSX and drops
148,523 nonblank unmapped cells across these fixtures; 2,836 nonblank dotted
vendor-status cells are not retained by its mapping. There are also 78 rows
with no vendor status. Vendor `RECEIVING` is not ZeroBounce validation.

The normal disposable migration runner completed. Its knowledge-base seed
reported embedding failures (`require is not defined`); those seed messages
are not provider or enrichment certification. No application was started
against the disposable certification DB.

`npm run check` passes. The test DB and temporary workbook data are removed
after testing; receipts contain only aggregate and file-identity evidence.

The existing preview workflow was found failed and restarted once. It now
serves requests, but the homepage remains visibly unstyled on a fresh
screenshot. The earlier workflow log reported a Tailwind/PostCSS directive
error. No frontend, dependency, or style changes were made here; visual
verification is **not passing**, and signed-in UI was not verified.

## Reproduce the independent certificate

Use a **fresh, migrated, disposable** PostgreSQL database. Never point these
commands at development or production application data. The TypeScript test
enforces matching test/database URLs and a disposable database name before
importing application services.

```sh
python scripts/certification/extract-enrichment-workbooks.py /tmp/canonical-enrichment-workbooks
# Apply the existing migration journal to a fresh disposable database first.
# Prefix the command directly with these variables; do not source a .env file.
DATABASE_URL='<disposable URL>' TEST_DATABASE_URL='<same disposable URL>' \
  NODE_ENV=test BACKGROUND_JOB_PROFILE=off \
  npx --no-install tsx scripts/certification/test-enrichment-workbooks.ts \
  /tmp/canonical-enrichment-workbooks
```

Receipts:

- `canonical-enrichment-native-delivery.json`
- `canonical-enrichment-workbooks.json`

## Remaining closure gates

### Latest continuation: automatic linking and separate recipient native gate

- General-link production repair remains verified by the earlier seven native
  predicates and four routine fingerprints; this is not all-branch readiness.
- Workspace automatic linking no longer needs a frozen cohort. The selected
  deployment owner fences initialization, claims and canonical writes.
  Explicit off, old-rule off, live leases, expiry recovery, replay, retired
  builds and revoked ownership are covered by 31 real disposable-DB checks.
  No provider operations, enrollments, communications or cohorts were added.
  Receipt: `canonical-enrichment-contact-link-automation-test.json`.
- Initial production reads showed the recipient slot table and subject FK
  present, but `crm_enforce_global_recipient_capacity` and its trigger absent.
  Evidence: `canonical-enrichment-recipient-capacity-production-before.json`.
  This was a separate preparation blocker, not a reversal of the general repair.
- Owner-only repair:
  `canonical-enrichment-recipient-capacity-native-repair-v1.sql`.
  SHA256: `424e0a7da2f95d5fae93c113a1ddac2dc5a3bc3d4ade1e9a4ba6c248cd227476`.
  Five disposable checks reproduce absence and certify exact installation,
  reapplication, and unchanged complete rows/FK. This does not certify
  recipient selection or concurrency. Subsequent independent production catalog
  verification passes the exact function, trigger and validated FK; see
  `canonical-enrichment-recipient-capacity-production-after.json`.
- `npm run check` passes. The older preflight suite fails at its existing
  private-schema recipient-capacity test before reaching the modified linking
  assertion (zero of three expected successful reservations). Not a passing
  integration certificate. The existing full pre-deploy log also failed its
  environment posture check; older role smoke was skipped. None is relabeled.
- Preview server starts with background jobs off and canonical outbound pause
  still on. The unchanged public homepage retains the previously observed
  styling defect; visual verification is not passing. Signed-in UI was not
  verified. No frontend/dependency/style changes were made.
- No production workbook imports, provider dispatches, outbound release or
  publishing occurred. The entire task remains open and operational acceptance
  is incomplete. The recipient-capacity native blocker is now cleared; no
  deployed recipient-flow or full-task completion is claimed.

The approved task remains open. Native supported delivery/parity, shared
authority construction, repaired ingestion/replay, whole-population accounting,
production entity-to-receipt-to-preparation traces, all five production workbook
imports/replays, and two real scheduled progression cycles remain unproved.
These are remaining task requirements, not deferred follow-up work.