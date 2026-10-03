# Versioned native-contract repair

## Native repair blocked in the owner SQL runner

**Both SQL-runner handoffs failed. Do not execute either form there again.**
Task #2063 remains open. Do not resume dependent enrichment or production
workbook imports until the production verification returns all seven `true`.

### Confirmed failures; no console compatibility certificate

The owner's screenshots confirm **Production Database** and **Enable Editing**,
and show an **unterminated dollar-quoted string** error when submitting the
original repair. The earlier driver-level certificate did not prove that
Replit's SQL runner would submit that dollar-quoted block intact. Do not keep
asking the owner to paste the same original block or change database selection.

The replacement also failed with **unterminated quoted string at or near E'**,
as shown in the owner's five subsequent screenshots. The file below is retained
as failed-handoff evidence, **not recommended for owner execution**:

**`docs/certification/canonical-enrichment-native-console.sql`**

SHA256: **`a8aa0616cf110c0d7a5e8a9f5b5c18041fc9d6884c1a06daddbd231dabd22fc6`**

This was a transport form of the same versioned 0329 repair, not another
migration or another schema authority. It uses a PostgreSQL escape-string DO
body, with inner semicolons and dollar signs escaped. The submitted text has
exactly one literal semicolon (the final terminator) and no dollar-quote
delimiters. A PostgreSQL round-trip proves the decoded body is byte-for-byte
identical to the canonical migration's body. All 29 PostgreSQL-driver checks
passed, including the original 24 safety checks. Those checks did not certify
the live owner SQL runner; its subsequent failure supersedes that handoff.

The observed error is consistent with an incomplete dollar-quoted statement;
a deliberately split original statement reproduces it. This does not claim
knowledge of the SQL runner's internal parser or prove live console success.
No console-specific corrected transport is currently established. The current
public Drizzle Studio parser preserves both files as single complete statements
in isolated parsing tests; that public bundle is not proven to be the exact
owner-console build or execution path. A simple semicolon-splitting diagnosis
is not established. The canonical migration source and guard fingerprints
remain unchanged.

The user explicitly authorized a versioned native-schema repair through an
authorized database administration route. This is a narrow amendment to the
previous project prohibition, not permission for startup/build DDL, weaker
guards, changed fingerprints, bulk paid validation, or outbound sends.

The Agent's production SQL transport is read-only: the refreshed production
query reports `transaction_read_only=on`. Its principal has schema CREATE and
owner-role membership, but **those privileges do not override the transport's
read-only restriction**. No production DDL was attempted, no credentials were
retrieved, and no production migration runner was added.

## Source and journal findings

| Original source | Role | SHA256 |
| --- | --- | --- |
| `0312_contact_business_system_links.sql` | System evidence table, immutable trigger and initial reviewed-link extension | `2ad3368b98a06a849bea990ee117059bb6452e889a1087a10f937245016a2fee` |
| `0314_sfp_verified_recipient_link_commitments.sql` | Typed SFP evidence extension; reviewed body matching current production | `1086b507553d470df5e673b53ef11abc1ce343c3ae6efd605b268eadc92a574d` |
| `0325_crm_evidence_relationship_authority.sql` | Three identity functions, optional source entity, reviewed relationship predicate | `51670bda2ec7efad4a9c4cd0c8fc639979708c379a3e6655631addff30329957` |

Development's ledger has exact matches for 0312 and 0314, but no exact match
for the current 0325 source hash. Development nevertheless has all expected
routine bodies. Its high-water ledger includes later entries. Production's
ledger has no exact match for any of these three source hashes, despite
physically installed evidence tables/triggers/constraints and the 0314 review
body. Do not infer that absent ledger entries authorize wholesale replay.
Do not rewrite the historical ledger to claim original migrations executed.
The unexplained development 0325 hash discrepancy remains separately recorded;
body parity does not resolve historical migration provenance.

Original migration files were not edited. The forward schema-source migration is:

**`migrations/0329_crm_native_contract_repair.sql`**

SHA256: **`6213c5ac119d9cca2ec5128b2f84b3f3e18ca79b24a01735e45ab649d27d4242`**

It is registered after the existing journal high-water mark for normal
development/disposable migration execution. It contains one atomic `DO`
statement and the exact 0325 source definitions. It does not create/drop tables,
delete records, recreate triggers, change guard constants, run providers,
release outbound pause, or invent historical migration-journal entries.
It restores 0325's intended nullable `source_entity_id`; validated foreign
keys and native relationship evidence requirements remain intact.

### Why Publish reports zero statements

The supported Publish flow introspects development and production to generate
a recognized schema diff; it does **not** replay the application migration
journal. The actual observed diff has zero statements even while `pg_proc`
shows missing routines and a different trigger-function body. Thus this
native-routine/body mismatch is outside the changes emitted by this project's
current Publish diff. The root mismatch is routine delivery, not a missing
column/table fix or permission to replay every earlier migration.

This observation does not establish the implementation or capabilities of all
Replit deployment backends, nor guarantee that Publish can never support native
objects. It establishes that this specific pending native contract is not
being delivered by the current project diff.

## Supported owner administration alternative

Replit's actual [Connection details documentation](https://docs.replit.com/features/data-and-storage/connection-details)
explicitly says a production database can be connected to from a
PostgreSQL-compatible external SQL client using the connection string from
**Production Database → Settings**. This is an owner-managed database client,
not an application endpoint, startup hook, build hook or custom migration runner.
Do not disclose the connection string to Agent or put it in this repository/chat.

The owner, or an authorized database administrator, can load the existing
**`migrations/0329_crm_native_contract_repair.sql`** as a whole SQL script in that
client. Use script/file execution, not a selected fragment. The original
versioned source is unchanged; there is no third SQL encoding to paste.

The before/verify SQL files remain read-only diagnostic tools. The repair's
permission, predecessor and postcondition checks are enforced inside its one
atomic statement. Actual primary production endpoint access, permissions and
execution through an owner client remain unverified until the owner performs
them. The Agent does not retrieve credentials, execute production DDL, or
create a production runner.

**Consequences of authorized execution:** this narrowly changes native definitions and one intended
nullability contract. It may briefly wait for the evidence-table lock;
lock waits are limited to five seconds. Existing records, foreign keys,
trigger identities, function owner/ACL and outbound pause are preserved.
An unknown predecessor body, missing guard, insufficient privilege, or failed
postcheck raises an error and rolls back the entire statement. If the statement
fails, do not partially paste/execute its inner definitions. Address the
reported restriction/drift and replay the unchanged whole statement.

The repair is not complete until independent production verification returns
all seven true with the four intended routine fingerprints. If the owner cannot
use an authorized PostgreSQL client, native delivery remains blocked. Routine
republishing does not replace that prerequisite.

### Expected after-repair routines

| Signature | Body MD5 |
| --- | --- |
| `crm_identity_name(text)` | `e45d1eb858ef5e5f9d94b8b9aa965c49` |
| `crm_identity_domain(text)` | `d0af69048a9c4845df1589219a522629` |
| `crm_automatic_relationship_reasons(integer,integer,uuid,integer)` | `6868a6d639a3fd0af7a10346821dad19` |
| `enforce_reviewed_contact_business_link()` | `46f89326f7c158ac739814ce343c2559` |

The before-query also reports immutable evidence routines, trigger shape,
security settings and historical ledger matches. The unchanged full guard
verifies the validated FK and typed-contact CHECK contracts.

## Disposable certification

`scripts/certification/test-crm-native-repair.ts` passed 24 checks on a fresh
normally migrated disposable PostgreSQL database:

- Reproduced production's exact old reviewed body and missing three functions.
- Injected failure after native DDL: all changes rolled back atomically.
- Rejected an unknown predecessor, disabled trigger and insufficient permissions.
- Restored all seven native guard predicates.
- Preserved trigger OIDs/shape, constraints, owner/ACL/security, and existing
  data/provider/enrollment/communication/journal counts during repair.
- Executed a supported Google identity with no website/cohort/deal.
- Accepted its real native verified-link write, rejected missing evidence, and
  rejected updates to append-only evidence.
- Replayed without changing identities or stored facts.

The existing native/read-only evaluator comparison passed its disposable
database probes. TypeScript and migration-integrity checks pass. No production
schema mutation or workbook import is included in this certificate.

The additional `--console` PostgreSQL-driver run passed 29 checks, including exact decoded-body
parity, one literal statement delimiter, no dollar-quote delimiters, and
reproduction of the partial-original-statement syntax failure. Its receipt is
`canonical-enrichment-native-console-test.json`. This is not a console
compatibility certificate; the actual owner console subsequently rejected it.

The `--psql` run passed 28 checks against a fresh disposable PostgreSQL
database. It executes the unchanged canonical repair through the standard
`psql` client, confirms all seven native guards and unchanged triggers,
constraints and data counts, reconstructs the same predecessor, then runs the
24 existing driver-level safety checks. Its receipt is
`canonical-enrichment-native-psql-test.json`. The test's disposable-infrastructure
guard runs before any client connection or child process. Neither the test
nor that receipt authorizes Agent production execution or proves the owner's
production endpoint connection.

### Publish/build investigation

The configured Publish build runs `npm run build`, which compiles the app;
it does not run the separate pre-deploy workflow or replay SQL migrations.
Production logs explicitly confirm startup migrations are skipped, as required
for this managed database. Adding unsafe production DDL to build/startup is
not a fix. The zero native-object diff remains the automatic-delivery gap:
neither failed console transport establishes repair, and automatic native
Publish delivery is still unresolved.

## Recorded delivery evidence

The application build, managed Publish diff, owner console, and owner
PostgreSQL client are distinct paths; do not conflate their certificates.

1. Production has old reviewed body `30910090e380e90ea27bff572d2c5847`;
   development has expected `46f89326f7c158ac739814ce343c2559`.
2. Three named routines above exist in development and are missing in production.
3. `explainSchemaDiff()` reports success, no diff, and zero statements.
4. Production read-only Agent transport reports `transaction_read_only=on`
   even though its underlying role has ownership/CREATE privileges.
5. Both owner's SQL-runner errors and enabled editing are already recorded.
   Do not ask for repeated screenshots or exports. Keep credentials and contact
   data out of receipts.
6. Required native delivery outcome: authorized delivery of the exact native
   contract, followed by all seven guard predicates passing. Routine
   republishing without a changed native diff is not sufficient proof.

Receipts:

- `canonical-enrichment-migration-investigation.json`
- `canonical-enrichment-native-delivery.json`
- `canonical-enrichment-native-repair-test.json`
- `canonical-enrichment-native-repair-production.json`
- `canonical-enrichment-native-console-test.json`
- `canonical-enrichment-native-psql-test.json`
- `canonical-enrichment-native-execution-investigation.json`

The latest production receipt records serving revision
`42309395870515b0a575e85f6c753a65da408c2a` and native guards still failing.
**Source certification is not production success.** A user SQL handoff alone
does not satisfy schema repair or enrichment completion.