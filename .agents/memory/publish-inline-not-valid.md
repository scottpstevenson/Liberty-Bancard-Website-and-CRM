---
name: Publish inline NOT VALID failure
description: Replit Publish can emit invalid CREATE TABLE SQL when development contains unvalidated constraints.
---

Development constraints must be validated before using Publish to create their tables in production. Preserve legitimate append-only legacy values by widening or replacing the constraint rather than rewriting historical evidence.

**Why:** Publish introspects development and may inline `NOT VALID` check constraints into generated `CREATE TABLE` statements. PostgreSQL only permits `NOT VALID` when adding a constraint with `ALTER TABLE`, so migration validation fails with a syntax error.

**How to apply:** Before publishing a large schema catch-up, query `pg_constraint` for `convalidated = false`, resolve any violating development rows or legacy enum values truthfully, validate every retained constraint, and verify none remain.