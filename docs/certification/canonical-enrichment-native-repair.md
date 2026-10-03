# Versioned native-contract repair

## Immediate deliverable and remaining owner action

**The repair is tested and executable, but has not been applied to production.**
Task #2063 remains open. Do not resume dependent enrichment or production
workbook imports until the production verification returns all seven `true`.

### Confirmed SQL-runner failure and corrected transport

The owner's screenshots confirm **Production Database** and **Enable Editing**,
and show an **unterminated dollar-quoted string** error when submitting the
original repair. The earlier driver-level certificate did not prove that
Replit's SQL runner would submit that dollar-quoted block intact. Do not keep
asking the owner to paste the same original block or change database selection.

For **owner SQL-runner execution**, use:

**`docs/certification/canonical-enrichment-native-console.sql`**

SHA256: **`a8aa0616cf110c0d7a5e8a9f5b5c18041fc9d6884c1a06daddbd231dabd22fc6`**

This is a transport form of the same versioned 0329 repair, not another
migration or another schema authority. It uses a PostgreSQL escape-string DO
body, with inner semicolons and dollar signs escaped. The submitted text has
exactly one literal semicolon (the final terminator) and no dollar-quote
delimiters. A PostgreSQL round-trip proves the decoded body is byte-for-byte
identical to the canonical migration's body. All 29 console-form disposable
checks pass, including the original 24 safety checks.

The observed error is consistent with an incomplete dollar-quoted statement;
a deliberately split original statement reproduces it. This does not claim
knowledge of the SQL runner's internal parser or prove live console success.
Owner execution of the corrected transport and independent production
verification are still required. The canonical migration source and guard
fingerprints remain unchanged.

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

## Where the authorized owner can execute

Replit's [Work with your data documentation](https://docs.replit.com/features/data-and-storage/work-with-your-data)
documents selecting the production database, enabling **Edit** in **My Data**,
and using its **SQL runner**.

1. Open **Database**, select **Production**, then **My Data** and **Edit**.
   Open **SQL runner**. Confirm production is selected; do not overwrite/copy
   development data into production.
2. In a cleared editor, run
   `docs/certification/canonical-enrichment-native-before.sql`, then
   `docs/certification/canonical-enrichment-native-verify.sql`.
   Inspect the *new* results, not an older result panel.
   Owner execution needs `transaction_read_only=off`, schema CREATE, and owner
   membership for the reviewed routine and system-evidence table. The current
   known guard result is `false,true,true,true,true,true,false`; the current
   reviewed body is `30910090e380e90ea27bff572d2c5847`.
3. Paste the **entire** tested
   `docs/certification/canonical-enrichment-native-console.sql` into a cleared editor and
   execute it once. Do not add `BEGIN`, `COMMIT`, or another transaction wrapper:
   the single DO statement is atomic and works with transaction-wrapping
   consoles. The BEGIN inside its encoded PL/pgSQL body belongs there; this
   instruction only forbids adding separate transaction commands.
   Do not paste over uncleared prior contents. Do not use the original
   dollar-quoted migration in this SQL runner after its confirmed rejection.
4. Run both read-only verification files again. Save the actual new results.
   The main native verification must return **all seven true**. Check the
   signatures and hashes below. Notify Agent after execution so production
   can be independently rechecked through its read-only connection.

**Consequences:** this narrowly changes native definitions and one intended
nullability contract. It may briefly wait for the evidence-table lock;
lock waits are limited to five seconds. Existing records, foreign keys,
trigger identities, function owner/ACL and outbound pause are preserved.
An unknown predecessor body, missing guard, insufficient privilege, or failed
postcheck raises an error and rolls back the entire statement. If the statement
fails, do not partially paste/execute its inner definitions. Address the
reported restriction/drift and replay the unchanged whole statement.

The SQL runner route is documented, but **successful owner execution of this
specific DDL remains unverified until step 4**. If Edit is unavailable, the
SQL runner remains read-only, or it rejects native DDL, stop and use the
platform-resolution reproduction below. Do not obtain a production connection
string or add a runner to work around it.

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

The additional `--console` run passed 29 checks, including exact decoded-body
parity, one literal statement delimiter, no dollar-quote delimiters, and
reproduction of the partial-original-statement syntax failure. Its receipt is
`canonical-enrichment-native-console-test.json`.

### Publish/build investigation

The configured Publish build runs `npm run build`, which compiles the app;
it does not run the separate pre-deploy workflow or replay SQL migrations.
Production logs explicitly confirm startup migrations are skipped, as required
for this managed database. Adding unsafe production DDL to build/startup is
not a fix. The zero native-object diff remains the automatic-delivery gap:
the corrected console transport addresses the owner's execution error, not
that separate Publish limitation.

## Support-ready reproduction if owner execution is restricted

Platform owner: **Replit managed database / Publish schema delivery**.

1. Production has old reviewed body `30910090e380e90ea27bff572d2c5847`;
   development has expected `46f89326f7c158ac739814ce343c2559`.
2. Three named routines above exist in development and are missing in production.
3. `explainSchemaDiff()` reports success, no diff, and zero statements.
4. Production read-only Agent transport reports `transaction_read_only=on`
   even though its underlying role has ownership/CREATE privileges.
5. Supply the tested 0329 schema source and JSON receipts listed below. If the
   owner's SQL runner rejected it, include the exact error and whether Edit was
   enabled. Do not include credentials or contact data.
6. Required platform resolution: authorized delivery of the exact native
   contract, followed by all seven guard predicates passing. Routine
   republishing without a changed native diff is not sufficient proof.

Receipts:

- `canonical-enrichment-migration-investigation.json`
- `canonical-enrichment-native-delivery.json`
- `canonical-enrichment-native-repair-test.json`
- `canonical-enrichment-native-repair-production.json`
- `canonical-enrichment-native-console-test.json`

The latest production receipt records serving revision
`42309395870515b0a575e85f6c753a65da408c2a` and native guards still failing.
**Source certification is not production success.** A user SQL handoff alone
does not satisfy schema repair or enrichment completion.