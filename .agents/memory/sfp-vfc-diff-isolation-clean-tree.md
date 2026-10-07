---
name: Disposable diff-isolation certification
description: Proof-producing suites can invalidate a later clean-tree gate within one batch.
---
Keep the candidate tree immutable during diff-isolation certification.

**Why:** Evidence-producing suites can change tracked files between checks even
when the batch started clean, invalidating a later isolation assertion.

**How to apply:** Separate proof collection from immutable-candidate validation.
Do not change HEAD during certification or weaken isolation assertions.
