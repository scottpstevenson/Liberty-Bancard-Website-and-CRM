---
name: Immutable provider import evidence
description: Compatibility rule for evolving raw evidence and provider field maps across interrupted imports.
---
Retain original provider-import observations when a mapping or raw-evidence contract evolves. Do not add fields to an observation under its existing idempotency key. A new raw representation belongs to the same source subject and must not create duplicate arbitration candidates, entities or provider work.

**Why:** Immutable batch fingerprints include the mapped payload. Upload and restart recovery previously had different field maps; merely enriching the old payload can turn a legitimate interrupted-import replay into an idempotency mismatch.

**How to apply:** Share field mapping between uploads and recovery. Before preserving an existing mapped observation, verify its original raw-row fingerprint, format and source coordinate. Reject conflicting or unprovable evidence rather than overwriting it. Add raw evidence under a versioned identity, keeping vendor validation labels observational rather than authoritative.