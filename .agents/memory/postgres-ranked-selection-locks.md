---
name: PostgreSQL ranked selections and locks
description: Real-SQL constraints to remember when combining ranked identity retrieval, locking and partial expression indexes.
---

Separate window-function/ranked identity selection from simple base-row locking, then recheck the selection under those locks.

**Why:** PostgreSQL rejects `FOR UPDATE` on a query containing window functions. Removing the lock to make it execute is not a safe repair: current candidate identity and ambiguity still need transactional protection.

**How to apply:** In preview/apply and reconciliation paths, select candidates, lock the actual authoritative rows in a consistent order, and recompute identity/conflict checks before committing.

Explicitly include the nullable-column predicate required by a partial expression index, even when a normalized `COALESCE` equality seems logically sufficient.

**Why:** PostgreSQL may not infer the partial-index predicate from the normalization expression. A correct match query can silently use a much broader index and filter a large source inventory.

**How to apply:** Verify each legal-name/alias branch with real PostgreSQL `EXPLAIN`, not just source assertions, and preserve the exact partial-index predicate in the corresponding branch.