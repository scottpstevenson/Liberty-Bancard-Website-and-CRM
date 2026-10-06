---
name: Standalone contact classification
description: Production-like contact fixtures must account for startup classification absent in standalone certification runners.
---

Declare production-like fixture classification explicitly when standalone tests exercise bridge-created contacts as subsequent candidates.

**Why:** Standalone certification does not run the server's startup contact-classification lifecycle. A reused contact may already be classified while a newly created one remains unknown, making alternative-candidate coverage depend on fixture reuse.

**How to apply:** In disposable databases only, classify the exact intended bridge-created fixture contacts before testing candidate visibility and assert that they really appear. Never alter live classifications to force admission or weaken test/customer exclusions.

First-party intake acceptance must not depend on synchronous contact classification.

**Why:** The canonical writer intentionally creates unknown-class contacts; classification is a separate authority. Requiring production class at the request handoff can reject a legitimate submission after its contact has already committed.

**How to apply:** Keep unknown contacts out of production rep work and leave classification unchanged. A generic unlinked management-review obligation may be admitted only with immutable provenance bound to the exact request occurrence; it must not expose or assign the unknown contact.