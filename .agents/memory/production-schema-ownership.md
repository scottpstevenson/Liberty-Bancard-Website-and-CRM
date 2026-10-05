---
name: Production schema ownership
description: Why production application startup must not execute the development Drizzle migration journal on Replit.
---

Replit Publish is the sole owner of production schema reconciliation. Application startup must skip Drizzle migrations when `NODE_ENV=production`; development and disposable tests may continue applying the migration journal.

**Why:** Publish can provision development tables in production without advancing the application's `drizzle.__drizzle_migrations` journal. Replaying that older journal during container startup then collides with already-provisioned relations and prevents the readiness probe from succeeding.

**How to apply:** Put the environment gate at the application entrypoint before invoking the migration runner. Keep schema changes in development sources, validate them there, and let Publish apply the development-to-production diff.

**Corollary — Publish diffs `shared/schema.ts`, not `migrations/*.sql`:** writing a new, correct, idempotent migration file does **not** get it applied to production. Publish introspects live production and diffs it against `shared/schema.ts`; it never executes files under `migrations/`. If a schema element (e.g. a CHECK constraint) exists only in a raw migration file and isn't declared in `shared/schema.ts` (via `check()`, etc.), Publish's diff has nothing to compare it against and will never generate DDL for it — no matter how many times you publish. Confirmed on this project: two CHECK constraints existed in migration files (0240, 0250) and were live in development, but were never declared in `schema.ts`, so repeated publishes never pushed them to production. Fix: declare the constraint in `schema.ts` to match what the migration already established in dev, then publish — don't write another migration file expecting it to run.

**Deeper corollary — `check()` on an already-existing table may never diff at all:** even after declaring the constraint correctly in `schema.ts`, `explainSchemaDiff()` kept reporting `hasDiff:false`. Two isolated tests proved it's not a caching or naming artifact: (1) fixing an unrelated real bug — a JS `BigInt` literal default (`.default(1n)`) that crashed `drizzle-kit push`'s `diffSchemasOrTables` with `TypeError: Do not know how to serialize a BigInt` — did not change the result; (2) adding a brand-new, never-before-existing constraint name to the same table also produced `hasDiff:false`. This narrows it to: Publish's schema diff does not generate `ALTER TABLE ADD CONSTRAINT` for `check()` on a table that already exists in production, regardless of the constraint's name — it very likely only applies `check()` constraints that are part of a table's initial `CREATE TABLE` (new table). Adding/changing a CHECK constraint on an existing production table currently has no confirmed supported path through Publish.

**New-table CREATE also mis-generates `check()` — and the bug follows the live dev DB, not `schema.ts`:** for a table that doesn't exist in production yet, Publish's diff generator introspects the constraint from the live development database (where `pg_get_constraintdef` already returns full text like `CHECK (singleton)`) and wraps that text in another `CHECK (...)` when emitting the new table's `CREATE TABLE` for production, producing invalid SQL (`CHECK (CHECK (singleton))`). Removing the `check()` call from `shared/schema.ts` alone does **not** fix this — the physically installed development constraint must also be considered. Do not work around this with application-startup DDL or a custom production migration executor; a failed/omitted Publish contract is a release blocker requiring supported platform/operator resolution.

**Human-console operational history, not agent migration authority:** the user executed the complete canonical repair through the production SQL console, with independently verified persisted guards. Earlier syntax failures do not establish a general ban on explicit transactions or dollar-quoted function bodies; their cause remains unproved. Clear the editor and verify persisted results instead of treating a result panel or speculative parser diagnosis as proof. Agent production access remains read-only, and owner execution does not authorize a custom production migration executor.

**SQL Console transaction-wrapper diagnostic:** When the console reports “To run statements in a transaction - select multiple statements and run”, omit the standalone outer `BEGIN;`/`COMMIT;` and select the whole interior batch. Keep PL/pgSQL `BEGIN`/`END` blocks and function bodies unchanged.

**Why:** The user encountered this explicit console diagnostic; official documentation confirms selected multi-statement batches receive automatic transaction wrapping. It does not establish the cause of older quoting errors.

**How to apply:** Distinguish standard psql file execution from SQL Console batch selection. A suggested selection is not verified production installation; independently check persisted native guards after owner execution.

Do not accept a SQL Console success message or an exact function body alone as
full-batch installation proof. Require a computed completion check covering the
referenced schema as well as the routines, then independently verify production.

**Why:** The owner confirmed Production and reported success, yet production held
the capacity function/trigger without its referenced columns or the other required
objects. The specific console selection/execution cause was not established.

**How to apply:** Preserve canonical routine bytes and guards. Keep console
transaction adaptation separate from native semantics, and make partial
installation fail the completion check rather than appearing ready.

**Migration-only triggers also need separate verification:** Publish can create a new table and its declarative constraints without executing a migration's `CREATE FUNCTION`/`CREATE TRIGGER`; the table's existence does not prove its append-only audit guard exists.

**Why:** Published tables can have their columns and CHECKs while migration-defined guards remain absent and the Publish diff reports no outstanding changes. An existing trigger can also survive publication with its older function body, so trigger-name presence alone is insufficient.

**How to apply:** Compare `pg_trigger` and `pg_proc` on production with the intended reviewed definitions, including function-body fingerprints, before allowing guarded writes or claiming a pipeline ready. Do not mistake a healthy deployment or a no-diff Publish report for trigger parity.

**Read availability and write authority are separate:** Missing native relationship functions must not make Contacts, census scanning, or evidence-review reads unavailable. A read-only equivalent is acceptable only with semantic parity checks against the reviewed native evaluator; it does not authorize a replacement application-side write fence.

**Why:** Native-function rollout can lag the declarative schema even when published columns and tables are current. Coupling ordinary reads to that rollout caused several independent CRM screens to fail simultaneously.

**How to apply:** Keep read evaluation and native evaluation semantically equivalent when changing relationship rules. Preserve fingerprinted native guards on writes and report missing production guards as a release hold, never as permission to bypass them.

Native-body parity and migration-ledger provenance are separate evidence.
A current routine body can match the intended source even when the exact
source-file hash is absent from the development ledger. Do not fabricate an
applied migration entry or replay historical table creation to reconcile that
discrepancy.

**Why:** Native-repair investigation found correctly installed development
functions without an exact current-source migration hash, alongside production
tables/constraints present without their original ledger entries.

**How to apply:** Keep both observations explicit; certify a forward repair
against the actual installed mismatch and preserve the historical discrepancy.
The user-authorized owner-route exception is documented in `replit.md`;
Agent production SQL access remains read-only.

PostgreSQL driver certification is not owner SQL-console certification.
Earlier editable production SQL-runner attempts rejected both a driver-tested dollar-quoted
native DO block and its exact-body escape-string transport, reporting
unterminated dollar-quoted and quoted strings respectively. A later owner
execution of the complete unchanged canonical dollar-quoted statement
succeeded, with independent production postcondition verification.

**Why:** Repeating instructions to paste the same block did not change the
failure; owner screenshots established both the correct target and the actual
syntax error. Documentation-search claims about console parser behavior were
not sufficient evidence. The later successful execution also means those
failures do not establish that the console cannot execute complex native SQL.

**How to apply:** Inspect execution errors before asking for repeated exports.
Do not offer more speculative console encodings. Exact decoded-body parity and
one literal terminator did not establish console compatibility. The current
public vendor parser preserved both failed forms intact; this does not identify
the owner's actual deployed console parser or downstream transport.
Keep any owner-managed standard SQL-client administration separate from Agent
read-only production access and prohibited custom production runners. Never
retrieve the owner's production credentials. Report native repair only after
independent production verification, and automatic Publish delivery separately.

The user's established repair workflow here is the Database SQL console:
"I've always used the console to do these repairs." They rejected being
redirected to installing an external PostgreSQL client.

**Why:** The user explicitly corrected the external-client handoff; an optional
documented alternative must not become a prerequisite imposed on their workflow.

**How to apply:** Continue console diagnosis with minimal non-mutating probes
and actual owner-console results, not further speculative large repair variants.
Distinguish Agent read-only SQL execution from owner-console compatibility.
When the user requests the complete reviewed repair, provide the whole atomic
statement without splitting its definitions or claiming an unproved parser fix.
Verify persisted production postconditions before calling the repair successful;
do not impose an external client based on earlier syntax errors.
