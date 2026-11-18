---
name: Workspace Git sync procedure
description: How to sync the workspace to GitHub main when the user explicitly asks, given the platform guard on .git writes and the repo's hooks.
---

Any command that writes inside the workspace `.git` (even `git fetch`, which writes FETCH_HEAD and remote refs) is refused unless prefixed with `DANGEROUSLY_ALLOW_GIT=1`. Read-only inspection works with `git --no-optional-locks`; `git ls-remote origin` reads the live remote without touching `.git`.

**Why:** the platform warns that workspace `.git` edits can disturb Replit's Git setup. The prefix is only for a sync the user explicitly requested; it is not general permission to commit, reset or rewrite history.

**How to apply:** (1) read-only preflight: branch, clean tree, no merge/rebase markers, live `ls-remote` SHA equals the requested SHA; (2) `DANGEROUSLY_ALLOW_GIT=1 git fetch --no-tags origin main`; (3) require `merge-base --is-ancestor HEAD <target>` and zero local-only commits, otherwise stop and report; (4) `DANGEROUSLY_ALLOW_GIT=1 git merge --ff-only <target>`; (5) verify HEAD, tree hash and clean status. The `.git/hooks` entries only run Git LFS (git-lfs is installed), so a merge cannot start the app or run migrations. A merge changes source only: the dev ledger, `node_modules` and `dist/` stay as they were, and the next dev restart (NODE_ENV not production) runs any new journal migration on the dev database.
