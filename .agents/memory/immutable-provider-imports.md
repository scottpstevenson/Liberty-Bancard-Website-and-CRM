---
name: Immutable provider import evidence
description: Compatibility rule for evolving raw evidence and provider field maps across interrupted imports.
---
Retain original provider-import observations when a mapping or raw-evidence contract evolves. Do not add fields to an observation under its existing idempotency key. A new raw representation belongs to the same source subject and must not create duplicate arbitration candidates, entities or provider work.

**Why:** Immutable batch fingerprints include the mapped payload. Upload and restart recovery previously had different field maps; merely enriching the old payload can turn a legitimate interrupted-import replay into an idempotency mismatch.

**How to apply:** Share field mapping between uploads and recovery. Before preserving an existing mapped observation, verify its original raw-row fingerprint, format and source coordinate. Reject conflicting or unprovable evidence rather than overwriting it. Add raw evidence under a versioned identity, keeping vendor validation labels observational rather than authoritative.

Recovery must retain the original acquisition fingerprint after verifying the
retained row's semantic contents. Never regenerate the original fingerprint from
JSON serialization after storage.

**Why:** PostgreSQL JSONB reorders object keys. A recovered row can contain
identical values but produce a different JSON.stringify hash, falsely rejecting
an immutable original observation.

**How to apply:** Compare recovered values with the retained raw representation
using canonical structural equality, then reuse the original acquisition hash.

Only a retained JSON object counts as an original import row; SQL non-nullness
alone is insufficient when choosing recovery evidence.

**Why:** JSONB `null` passes `IS NOT NULL` and takes precedence in `COALESCE`.
That can misreport an unavailable original or hide a usable fallback, even though
JavaScript later receives null.

**How to apply:** Check the JSON type at recovery and availability-reporting
boundaries, then choose the retained object. Keep absent originals explicit and
never reconstruct them from mapped observations.
If exact retained contents are unavailable or disagree, hold recovery explicitly.

Keep current CRM affiliation separate from identifiers recorded in immutable
original import accounting. Provide a current-business drill-down without
filling in missing historical business IDs from today's contact association.

**Why:** A legitimate contact import can record its contact before its canonical
business affiliation is established. Later affiliation is useful evidence for
navigation, but cannot prove what the original accounting recorded.

**How to apply:** Label original identifiers and current affiliation separately
in operator history and evidence views. Never rewrite an original disposition
or disguise a current relationship as original import evidence.