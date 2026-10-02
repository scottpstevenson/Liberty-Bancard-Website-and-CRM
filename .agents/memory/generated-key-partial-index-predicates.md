---
name: Generated-key partial-index predicates
description: PostgreSQL does not infer source-column nullability from equality on a stored normalized key.
---

When querying a generated identity key through a partial index, include the index's source-column nullability predicate explicitly when it is semantically implied by the match.

**Why:** PostgreSQL did not infer a non-null original DBA from equality on its stored normalized key. The batched identity lookup consequently scanned the large source table per key despite an existing appropriate partial index.

**How to apply:** Inspect the actual production plan and index predicate, preserve matching semantics, and benchmark the full batched SQL. Reducing the page size does not repair an unusable partial index.