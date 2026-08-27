---
name: Sealed contact purge
description: Safety rules for one-time permanent purges that also delete provider records.
---

A reviewed permanent purge must bind both the exact local IDs and the exact external-provider IDs. Lock all local target rows, validate byte-for-byte provider bindings and approved scope predicates, then call the provider with the sealed IDs rather than re-reading mutable links.

**Why:** A local ID manifest alone can delete the wrong external record if a sync relinks the contact between review and execution. Trimming provider IDs can also turn a drifted value into an apparently valid binding while sending a different path.

**How to apply:** Use this for any one-time destructive cleanup spanning the local database and an external CRM. Keep ordinary user-facing delete actions reversible and local-only; provider deletion belongs only in the sealed purge path.