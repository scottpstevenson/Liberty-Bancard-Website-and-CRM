---
name: Production schema delivery boundaries
description: Publish versus migration-ledger provenance, native-guard parity and owner-console evidence.
---

For the managed production database, Publish owns schema reconciliation.
Do not replay the development Drizzle journal at production application startup.

**Why:** Publish can install schema without advancing the application's custom
migration ledger; startup replay can collide with already-installed relations
and prevent readiness.

**How to apply:** Validate development schema and migrations locally, then use
the supported Publish flow. An exact source-file ledger hash, installed native
body parity and declarative schema presence are separate evidence; do not
fabricate ledger entries or replay historical creation to make them agree.

Do not assume migration-only native guards or existing-table CHECK changes
were delivered because publication succeeded or reported no remaining diff.
New-table CHECK generation has also produced a nested CHECK around an already
wrapped live-development definition.

**Why:** This project's Publish investigations found missing migration-defined
triggers, older surviving routine bodies, omitted CHECK alterations and invalid
new-table constraint SQL. Source declarations alone did not prove delivery.

**How to apply:** Inspect actual catalog definitions and computed postconditions
covering the referenced schema, routines and triggers. Recheck current platform
behavior rather than treating past diff quirks as universal guarantees.
Missing native write guards remain release holds, never permission to substitute
an application-only fence. Read availability can be kept separate only with
semantic parity against the reviewed native evaluator.

The user's established native-repair workflow is the Database SQL console:
"I've always used the console to do these repairs." Do not make installation
of an external SQL client a prerequisite.

**Why:** The user explicitly rejected that workflow substitution. Driver-tested
SQL did not prove console transport compatibility; earlier quoting failures and
later successful unchanged batches did not establish a universal parser defect.

**How to apply:** Use actual owner-console diagnostics and independently verify
persisted results. If the console explicitly requests batch selection, select
the full interior batch without standalone outer BEGIN/COMMIT; retain internal
PL/pgSQL blocks and exact native semantics. Do not repeatedly invent encodings
or infer full installation from a success message or one matching function.
Owner-console verification is not Agent production-write authority or
authorization for a custom production migration runner.
