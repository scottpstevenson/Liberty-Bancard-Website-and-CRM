---
name: Disposable database capabilities
description: Safety and migration-ledger rules for local production-backup rehearsals.
---

Local rehearsal database targets must be opaque capabilities minted by the process that launched the temporary PostgreSQL cluster. Never let an exported SQL, restore, or migration function accept an arbitrary structural host/port/database object.

**Why:** A database-name or URL heuristic can be bypassed and turn rehearsal code into a production mutation path. Private socket and data-directory identities must be rechecked at every SQL sink.

**How to apply:** Build child environments from an allowlist, add the launcher-owned socket target only after scrubbing inherited credentials, disable TCP, and verify server identity before queries or restore commands. Require both decompressor and restore-process success.

Migration-ledger parity is based on the runner's distinct hash/timestamp records. Two journal tags may intentionally share identical SQL and therefore one recorded hash.

**Why:** Requiring one ledger row per tag falsely reports a missing migration when the runner deliberately deduplicates identical hashes.

**How to apply:** Preserve every tag in the receipt, but compare the actual ledger against first occurrence of each distinct canonical hash and timestamp.