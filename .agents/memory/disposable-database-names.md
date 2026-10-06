---
name: Disposable database names
description: PostgreSQL identifier truncation can invalidate verified disposable targets.
---

Keep generated disposable database names within PostgreSQL's 63-byte identifier
limit, including the suite prefix and random suffix.

**Why:** A long certification name generated a database identifier that PostgreSQL
silently truncated. The infrastructure guard then correctly refused the connection
because the actual database name differed from the verified target.

**How to apply:** Use concise suite names or bound the generated identifier without
reducing uniqueness. Never loosen the disposable-target guard to accept a mismatch.

Disposable database/Redis slugs must also avoid `prod` and `live` substrings
anywhere, including ordinary words such as `producer` and `delivery`.

**Why:** The conservative isolation guard rejects those words even in a clearly
test-prefixed, freshly created private database. A suite filename can therefore
unintentionally make an otherwise correctly isolated launcher fail.

**How to apply:** Use neutral, concise suite slugs such as `adapter` or `dispatch`;
keep the same behavioral assertions and strict isolation proof. Do not weaken the
guard or switch to the workspace database to work around a naming rejection.