# Repository History Cleanup Runbook (BT-01)

**Status:** Current-tree containment COMPLETE. The steps below are **owner-authorized
follow-up actions** — they were NOT performed automatically and MUST NOT be run
without explicit repository-owner approval and coordination.

## Background

As of August 2026 the repository's current tracked tree contained:

- 7 database backups: `backups/db-backup-2026-07-29T03-00-00.sql.gz` …
  `backups/db-backup-2026-08-13T19-59-34.sql.gz`
- 7 spreadsheet lead exports under `attached_assets/` (`26k_Brands…`,
  `CC_Leads…`, `Credit_Card_Leads…`, `Google_Maps_Listings_Scraper…`,
  `Leads_-_Brands…`, `Outscraper…` `.xlsx` files)

These were removed from the **current index** (`git rm --cached`), `.gitignore`
now blocks the entire artifact class, and `scripts/scan-tracked-files.ts` is a
required pre-deploy gate. **However, the file contents remain reachable in Git
history** until a history rewrite is performed. Removing a file from the current
tree is NOT proof it is gone from reachable history.

## Exposure window

- Backups: committed between 2026-07-29 and 2026-08-13 (per filename timestamps).
- Spreadsheet exports: committed between ~2026-06 and 2026-07 (per asset timestamps).
- Repository visibility: remote is a Replit-internal SSH remote; public/private
  posture could not be confirmed from the development environment. **Owner must
  verify** whether the repl or any linked GitHub mirror is public.

## Potentially affected credential categories (names only, no values)

Anything embedded in a database dump may be reachable via history, including:

- Session data / password hashes stored in the database
- Any API tokens or integration credentials persisted in DB tables
  (e.g. GHL tokens, SMTP configuration rows, encrypted credential rows —
  encrypted rows depend on `CREDENTIAL_ENCRYPTION_KEY` remaining secret)
- Contact/lead PII (emails, phones) in both dumps and spreadsheet exports

Environment secrets (Replit Secrets) were **not** found in tracked files, but
if any dump contains credential material, security/operations should rotate:
GHL private integration token, SMTP credentials, session secret, ZeroBounce,
Serper, and OpenAI keys, plus `CREDENTIAL_ENCRYPTION_KEY` (with re-encryption).

## Owner actions (in order)

1. **Verify repository visibility** (repository admin). If any mirror is/was
   public, treat all history contents as exposed and prioritize rotation.
2. **Rotate credentials** (security/operations) for the categories above.
   Rotate BEFORE the history rewrite — rewriting does not un-expose anything
   already cloned.
3. **History rewrite** (repository admin, coordinated):
   1. Announce a freeze window; ensure no in-flight branches/tasks.
   2. Fresh mirror clone: `git clone --mirror <remote> repo.git`
   3. Rewrite with `git filter-repo`:
      ```
      git filter-repo --invert-paths \
        --path backups/ \
        --path-glob '*.sql.gz' \
        --path-glob 'attached_assets/*.xlsx'
      ```
      (or BFG: `bfg --delete-files '*.sql.gz' --delete-files '*.xlsx'`)
   4. Verify: `git log --all --diff-filter=A -- 'backups/*' '*.xlsx'` → empty;
      `git rev-list --objects --all | grep -E '\.(sql\.gz|xlsx)$'` → empty.
   5. Force-push all refs; have every collaborator re-clone (no pulls onto old
      clones). Redeploy from the rewritten history.
   6. Ask the host (Replit/GitHub support) to run GC / invalidate cached
      objects and any cached PR/commit views.
   7. Rollback plan: keep the pre-rewrite mirror clone in secure offline
      storage for 30 days, then destroy it.
4. **Confirm the gate**: `npx tsx scripts/scan-tracked-files.ts` must exit 0 on
   the rewritten repository.

## Explicit non-goals

- No production database rows are deleted by this runbook or by BT-01.
- No live-record classification by filename/prefix — canonical test/demo data
  classification (`record_class`) is owned by **BT-06**.
- Local backups in `backups/` on the running host are operational artifacts and
  remain on disk; they are simply no longer tracked by Git.
