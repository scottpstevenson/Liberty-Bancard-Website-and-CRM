---
name: Publish and NOT VALID check constraints
description: A NOT VALID check in the development database makes Publish generate malformed SQL and fail the whole publication.
---

A CHECK constraint that is `NOT VALID` in the development database makes Publish write malformed production SQL (extra closing parentheses and `NOT VALID` inside the CHECK). The dialog then stops at "Migrations failed validation" and none of the diff is applied, including unrelated tables and columns.

**Why:** A partner migration added two checks `NOT VALID`; the owner's Publish dialog showed the broken statements, and production never received the table, 12 columns, 2 indexes or the checks. Validating the constraints in development (empty table) made the generated SQL correct.

**How to apply:** Do not create `NOT VALID` checks in any migration that Publish must carry. Before asking for a Publish, run the schema-diff tool and read every statement for balanced parentheses; `select ... from pg_constraint where not convalidated` in development should return nothing. Fix with a new append-only migration that validates (never edit an applied migration), then apply the generated statements to a disposable database in production's current shape to prove they run.
