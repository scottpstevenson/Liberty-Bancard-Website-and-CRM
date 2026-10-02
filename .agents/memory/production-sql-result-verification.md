---
name: Production SQL result verification
description: Validate the actual returned result before treating a production read as successful.
---

Check the returned result header or explicit value, not only the production SQL
callback's success flag.

**Why:** Invalid read-only queries returned success=true with only START
TRANSACTION and ROLLBACK in output, without exposing the underlying SQL error.
That output was not a successful empty census.

**How to apply:** If the expected columns or aggregate result are absent, treat
the check as unverified. Inspect the live schema and query syntax, then rerun the
corrected read; never report zero records or use it as mutation evidence.