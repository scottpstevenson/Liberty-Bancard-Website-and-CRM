---
name: Publish nested-expression indexes
description: Publish can truncate valid nested normalization index expressions; verify its actual generated SQL.
---

Do not treat a valid development index or a passing disposable SQL test as proof that Publish can serialize that index. The managed schema diff truncated nested regexp_replace/coalesce expressions into invalid SQL ending in COALES.

**Why:** Both Sunbiz identity indexes were valid in development, but Publish generated incomplete expressions and failed validation near WHERE. A development-only probe confirmed that the same normalization round-trips intact as a STORED generated column with an ordinary column index.

**How to apply:** Preserve the normalization and partial-index predicates using database-generated keys and matching column-index queries. Verify the actual explainSchemaDiff output after applying the journaled development migration. Keep production DDL Publish-only; never use the overwrite-development-data option as an index-syntax repair. Stored generated columns recompute existing rows, so disclose the migration duration/write-lock implications on large tables.