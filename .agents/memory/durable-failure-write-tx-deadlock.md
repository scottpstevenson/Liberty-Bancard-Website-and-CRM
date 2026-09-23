---
name: Durable failure-write self-deadlock inside a transaction's own catch block
description: A catch block inside db.transaction() that INSERTs a failure row on a second connection, using the same pre-generated primary key as an uncommitted row on the first (still-open) connection, deadlocks until lock/statement timeout.
---

## The bug

A pattern like:

```
return db.transaction(async (tx) => {
  const row = await tx.execute(sql`INSERT ... (id) VALUES (${preGeneratedId}) ...`); // uncommitted
  try {
    ... work ...
  } catch (err) {
    // WRONG: runs on a different connection (`db`, not `tx`) while `tx`'s
    // transaction is still open (not yet rolled back) on its own connection.
    await db.execute(sql`INSERT ... (id) VALUES (${preGeneratedId}) ON CONFLICT (id) DO UPDATE ...`);
    throw err;
  }
});
```

Postgres must resolve the ON CONFLICT unique-index check against the still-uncommitted
row from the first connection. It cannot determine visibility until that transaction
commits or rolls back — but the first transaction's callback is itself blocked awaiting
this very `await db.execute(...)` to finish (it's inside the same `try/catch`, so the
outer `db.transaction()` promise cannot proceed to ROLLBACK until the catch block's own
async work settles). Neither side can make progress: a real self-deadlock, surfaced only
as a ~30s statement/lock timeout under test, not a fast, obvious failure.

**Why:** discovered via a disposable-Postgres integration test for a durable
failure-persistence feature (freeze-attempt failure rows must survive even though the
transaction that would have written them rolled back). The fix looked correct in review
(different connection avoids the transaction-scoped issue) but the shared primary key
still creates cross-connection lock contention.

**How to apply:** if a failure needs to be durably persisted using the SAME identity
(primary key) that a failing transaction tried to write, do the persistence write in an
outer `try { return await db.transaction(...) } catch (err) { /* write failure row here */ }`
wrapper — never from inside the transaction's own callback/catch. By the time the outer
catch runs, the ORM's `db.transaction()` wrapper has already issued ROLLBACK and released
the connection, so the second connection's INSERT/UPSERT sees a clean, resolved state
immediately instead of waiting on an uncommitted peer.
