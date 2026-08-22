---
name: GitHub workflow push scope
description: GitHub rejects workflow-file pushes made with the workspace OAuth credential when it lacks the workflow scope.
---

Use a GitHub credential with explicit workflow-file permission when pushing changes under `.github/workflows/`. The Replit GitHub OAuth connection may have repository access without the separate `workflow` scope, causing GitHub to accept the objects and reject the ref update.

**Why:** GitHub protects Actions workflow files more strictly than ordinary repository contents, so a normal `git push` can fail even though repository pushes otherwise work.

**How to apply:** Check the remote ref after pushing. If the error mentions an OAuth App and missing workflow scope, use the workspace's authorized GitHub token path or reauthorize with a credential that includes workflow permission; never put the token in a remote URL or commit it.