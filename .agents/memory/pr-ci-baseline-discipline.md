---
name: PR CI baseline discipline
description: Distinguish introduced regressions from already-failing repository checks before expanding a merge task
---

When reconciling an existing PR, compare each failing check against the current main branch. Fix introduced regressions in the PR; report and track unrelated baseline failures separately rather than broadening the reconciliation to repair the entire repository.

For a specific pipeline task, a failing repository check is not automatically part of the task. Establish whether it was introduced by the change or demonstrably blocks the requested runtime path. A formally required release check can remain a reported blocker; its failure does not authorize unrelated repository-wide repairs.

**Why:** Successive pre-existing failures prompted unrelated repairs and delayed the requested feature and production execution. The user explicitly rejected expanding shared-authority/reporting repairs into repairing every legacy test; a specific task must not become an implicit repository-cleanup project.

**How to apply:** Check the exact failing test on both main and PR, verify the feature's focused certification, and check whether the branch has required status protections. Do not bypass required checks; also do not assume every red non-required check was caused by the PR.

If scope has already expanded, pause the unrelated work and keep its edits separate from the task candidate. Do not silently bundle them, discard them, or claim that partial unverified repairs make the release ready.