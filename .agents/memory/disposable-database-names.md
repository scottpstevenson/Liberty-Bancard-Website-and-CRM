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