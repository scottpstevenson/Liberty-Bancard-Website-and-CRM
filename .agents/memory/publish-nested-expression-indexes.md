---
name: Publish nested-expression indexes
description: Publish can truncate valid nested normalization index expressions; verify its actual generated SQL.
---

Do not treat a valid development index or a passing disposable SQL test as proof that Publish can serialize that index. The managed schema diff truncated nested regexp_replace/coalesce expressions into invalid SQL ending in COALES.

**Why:** Both Sunbiz identity indexes were valid in development, but Publish generated incomplete expressions and failed validation near WHERE. A development-only probe confirmed that the same normalization round-trips intact as a STORED generated column with an ordinary column index.

**How to apply:** Preserve the normalization and partial-index predicates using database-generated keys and matching column-index queries. Verify the actual explainSchemaDiff output after applying the journaled development migration. Keep production DDL Publish-only; never use the overwrite-development-data option as an index-syntax repair. Stored generated columns recompute existing rows, so disclose the migration duration/write-lock implications on large tables.

Simple calls to an already installed, reviewed immutable SQL function can
round-trip as expression indexes without exposing their nested regexp bodies
to Publish's expression serializer. Equivalent inline read expressions can
use those indexes through PostgreSQL SQL-function inlining.

**Why:** The actual managed diff preserved three canonical normalization
function-index definitions intact; disposable plans and development plans
proved inline name/DBA reads use them. Full-registry materialization and
filing-number probes across every linked business both remained too slow in
production-scale reads despite tiny-fixture correctness.

**How to apply:** Verify function immutability, exact normalization equivalence,
real index paths and the actual managed diff before recommending this option.
Do not substitute older ASCII/space-normalized keys for NFKD identity keys:
accented names and punctuation can otherwise lose candidate matches.
Parameterize selective name/alias probes rather than scanning all source
affiliations. Never infer production performance from the development plan.