---
name: PR CI baseline discipline
description: Distinguish introduced regressions from already-failing repository checks before expanding a merge task
---

When reconciling an existing PR, compare each failing check against the current main branch. Fix introduced regressions in the PR; report and track unrelated baseline failures separately rather than broadening the reconciliation to repair the entire repository.

**Why:** A static-suite runner stopped at successive pre-existing failures, leading to unrelated repairs being added to a PR whose goal was to land a verified feature. That delayed the requested merge and required additive reverts.

**How to apply:** Check the exact failing test on both main and PR, verify the feature's focused certification, and check whether the branch has required status protections. Do not bypass required checks; also do not assume every red non-required check was caused by the PR.