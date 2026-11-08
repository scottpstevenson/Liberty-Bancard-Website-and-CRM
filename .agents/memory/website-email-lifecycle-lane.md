---
name: Website email lifecycle lane
description: Warm Gmail lane for website requesters — durable decisions the code cannot tell you; default closed, never activated by code.
---
- The warm lane is a centrally decided narrow exception beside the unchanged pure CR-06 function (dispatch constant stays false). Nurture stays promotional; requested follow-up is human_response. Marked enrollments reference a paused source sequence, but content comes from an immutable warm revision snapshot.
  **Why:** relabeling promotional mail as transactional is a kill line; the exception must be provable from one place.
  **How to apply:** any new reader of active enrollments (workers, widgets, counters) must decide explicitly whether marked rows belong; unfiltered readers treat multi-day waits as stalls.
- One journey per contact and program, enforced independently of the warm revision and of the source sequence (check under the contact lock plus a database unique index). A remap to different approved content or a different sequence must never start a second overlapping journey.
  **Why:** both journeys could send to the same person; a revision-scoped check passes silently after any remap.
  **How to apply:** any new uniqueness or overlap rule keys on the person and purpose, never on content or configuration identifiers that an admin can change.
- Non-cold transport is Gmail OAuth; the mailbox reader polls history (no signed ingress), is closed by default, and its first poll initializes the cursor with no backfill.
- The communication ledger's provider CHECK had to be widened to name Gmail. Publish delivers new tables but has skipped CHECK changes on existing tables, so the lane proves from the catalog that the ledger accepts Gmail (typed hold, open refused) instead of trusting the migration ran. Publish also reconciles from the development database, which only receives a migration when the dev app boots. Narrowing the CHECK back is refused while Gmail rows exist, so roll back code and close the lane, not the schema.
- Every public form that can request follow-up must appear both in the lane's source-program map and in the certification source matrix; a route that is not exercised end to end is not covered by contract tests alone.
- Post-publish schema check is a read-only script (`scripts/check-website-email-publish.ts`) that reuses the status route's ledger function and prints the migration's own repair statements without running them. It checks whatever `DATABASE_URL` points at, so the workspace shell checks development, not production (see shell-psql-defaults-to-dev). On the task-fork dev database (2026-11-08) none of the 0382 objects existed, so the dev DB must receive the migration before Publish can carry it.
