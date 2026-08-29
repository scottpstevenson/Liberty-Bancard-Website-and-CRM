---
name: CR-06 immutable rollout versioning
description: How to evolve premium campaign copy after an immutable rollout has been applied.
---

An applied CR-06 manifest and its artifact documents, hashes, parentage, approvals, and history are immutable. Content corrections require a new manifest version and new artifact identities/versions; the prior package remains queryable and may only receive truthful lifecycle classification.

**Why:** Editing governed copy while retaining its original manifest identity makes legitimate existing databases fail rollout preview with an identity/hash conflict. Weakening that conflict would allow silent marketing-copy replacement.

**How to apply:** For any premium package change, preserve the old package byte-semantically, create a versioned replacement graph, verify exact counts within the current version, and certify dry-run/apply/replay against a database containing the verified prior version.