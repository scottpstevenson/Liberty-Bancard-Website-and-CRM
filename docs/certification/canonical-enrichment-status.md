# Canonical enrichment: dependency gate and early workbook tests

## Status

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

The approved task remains open. Native supported delivery/parity, shared
authority construction, repaired ingestion/replay, whole-population accounting,
production entity-to-receipt-to-preparation traces, all five production workbook
imports/replays, and two real scheduled progression cycles remain unproved.
These are remaining task requirements, not deferred follow-up work.