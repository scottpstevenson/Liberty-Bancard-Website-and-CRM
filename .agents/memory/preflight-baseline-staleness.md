---
name: Preflight baseline staleness
description: Attached build specs quote a published SHA and migration head; local HEAD can be ahead with unpublished migrations.
---
Read the migration journal on the local HEAD, not only origin/main, when auditing a spec that states a journal head.

**Why:** a partner-upgrade spec quoted origin/main's head (idx 385), but local HEAD already carried an unpublished migration (idx 386), so the next migration number differed from the spec's.

**How to apply:** compare `git rev-list --count origin/main..HEAD` and the local `migrations/meta/_journal.json` last entry against the spec; report both heads and tell the build to recapture the number. Partner mailbox uniqueness is app-level only (no DB unique index on `partners.email`; only `users.email` is unique), so any no-password application path needs its own database-backed uniqueness.
