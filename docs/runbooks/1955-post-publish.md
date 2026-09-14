# Task #1955 — Post-merge handoff runbook

**Status: document only. Nothing in this file has been executed by Task #1955. This runbook is for a human/agent to run manually in a separate, later session, after #1955 is merged and published on its own.**

A Replit task workspace cannot merge or publish itself and continue into a later phase — see `.agents/memory/task-agent-isolated-branch.md` and `.agents/memory/publish-vs-dev-environment-drift.md`. This runbook exists so that separation is explicit: everything below happens only after a human has reviewed and approved each step, one at a time, in order. Do not batch or automate this sequence.

## Scope reminder before you start
This runbook only ever activates the isolated `db-backup` worker lane and applies a human-approved, clean-match-only `deals`/`businesses` record_class backfill. It does **not**:
- Clear `global_paused` or touch any GHL sync state.
- Enable `system-audit`, `health-monitor`, `operations`, `critical-commands`, `ghl-integration`, or `outreach`.
- Retry or replay any of the GHL sync backlog.
- Hand-write or manually execute any SQL against production. The two originally-targeted constraints (`businesses_record_class_check` missing `'canonical'`, `cro03_source_subjects` subject_type check missing `'business'`) are genuinely still missing from production as of this writing — an earlier BUILD note wrongly claimed they were already fixed based on a `psql` check that connected to the **development** database, not production. Migration `0266_repair_record_class_subject_type_constraints.sql` (new, append-only, state-aware, does not edit 0240/0250) exists to close this gap and must reach production through the normal Publish/migration deploy path — **never** via a manually run SQL statement.

## Sequence

1. **Confirm #1955 is merged into canonical GitHub `main`.**
   `git branch --contains <merge-commit-sha>` from a machine with the real `origin` remote — confirm `origin/main` is listed.

2. **Obtain and verify a recoverable production database snapshot before Publish.**
   Use Replit's database backup/checkpoint mechanism (not this task's `db-backup` worker — it isn't enabled yet). Confirm the snapshot is restorable, not just "created".

3. **Publish the exact merged SHA.**
   Use Replit Publish. Do not publish an in-progress or uncommitted working tree.

4. **Verify `/api/health` reports that SHA.**
   `curl https://<production-domain>/api/health` (or the equivalent authenticated admin endpoint) and confirm `releaseSha` matches step 3's SHA exactly. Then run:
   `RELEASE_SHA=<sha> npx tsx scripts/check-release-identity.ts`
   against the same commit, from a checkout with the real `origin` remote, to confirm it resolves in GitHub history.

5. **Verify that the standard Publish/migration mechanism applied migration 0266.**
   Query the actual production constraint definitions (via the platform's production-scoped query path — **not** ad-hoc `psql`/`DATABASE_URL`, which resolves to development on this project):
   `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname IN ('businesses_record_class_check', 'cro03_source_subject_type_chk');`
   Confirm the first result's definition includes `'canonical'` and the second's includes `'business'`. Then run
   `npx tsx scripts/check-bounded-schema-drift.ts`
   against the production database connection to confirm `contacts`, `cro03_source_subjects`, `deals`, `businesses` still match `shared/schema.ts` at the level this task cares about. Expect the pre-existing unrelated findings noted in the task file (contacts nullability, `contact_bounced_at`, `businesses.free_enrichment_attempt_count`) to still be present — those are known, out of scope, and not this runbook's concern.

6. **Stop if either constraint is still missing its value, or if any other schema state does not match.** Do not hand-write or manually execute SQL against production to force it — that defeats the point of routing schema change through Publish. If the migration did not apply, escalate to a human with the exact query output from step 5 and treat it as a deploy-mechanism problem to diagnose, not something to patch around with direct DDL.

7. **Run the production record-class preview.**
   `npx tsx scripts/record-class-preview.ts --json > /tmp/deals-preview.json`
   `npx tsx scripts/record-class-preview.ts --target=businesses --json > /tmp/businesses-preview.json`
   This is read-only by default — no `--apply` flag yet.

8. **Present preview evidence for explicit human approval.**
   Share both JSON reports with a human decision-maker. For `deals`, they are approving the `cleanMatch` bucket count and a sample. For `businesses`, remember `testCandidate` rows are **never** auto-applied by this tooling regardless of flags — any business reclassification is a fully manual, separate decision outside this script's `--apply` path.

9. **Apply only explicitly approved clean-match rows.**
   `npx tsx scripts/record-class-preview.ts --apply`
   This only ever updates `deals` rows in the `cleanMatch` bucket, is idempotent (safe to rerun), and writes a `record_class_reconciliation_log` row per change.

10. **Reconcile every affected row.**
    `SELECT * FROM record_class_reconciliation_log ORDER BY applied_at DESC;` — confirm the row count matches step 9's reported "applied" count, and spot-check a sample against the original preview JSON.

11. **Configure only the isolated `db-backup` lane.**
    Set `BACKGROUND_JOB_PROFILE=selective:<existing-groups>,db-backup` (append to whatever is already running — do not replace it). Confirm with:
    `npx tsx scripts/test-1955-worker-lanes.ts`
    that this selection does not also enable `system-audit`.

12. **Restart through the normal controlled deployment mechanism if configuration requires it.**
    Use the standard Replit deployment restart path for the production service — never a manual process kill/restart on the box.

13. **Confirm one bounded backup completion.**
    Check the `db-backup` job's own completion record (`background_jobs` row for job name `db-backup`, or its audit log) for one successful run after the restart, before considering this step done.

14. **Leave every other worker group held.**
    Re-run `npx tsx scripts/test-1955-worker-lanes.ts` one more time and manually confirm the production `BACKGROUND_JOB_PROFILE` value only adds `db-backup` to whatever groups were already active — nothing else changed.

15. **Return final evidence and stop.**
    Compile: the merged SHA, the `/api/health` confirmation, the schema-drift check output, the preview JSON + human approval record, the reconciliation row count, and the `db-backup` completion record. Hand this off; do not proceed to enable any further group without a new, separate decision.
