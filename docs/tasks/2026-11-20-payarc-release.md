# Liberty consolidated release — November 20, 2026

Matt explicitly authorized fixing the observed Payarc discrepancies, running checks, integrating all outstanding local fixes/PRs into GitHub main, syncing Replit and publishing. Automatic Payarc signature sending must remain off; global outbound stays paused; the Outscraper cap stays $50. No additional live application, signature email, signing or underwriting action is part of this release.

## Fixes and consolidation

- Remote `validate:true` is no longer called by the signature worker. Its compatibility helper refuses locally with PAYARC_REMOTE_VALIDATION_UNSAFE and makes zero network requests in either environment. Preflight remains local and revision/payload/review/activation/lease checks remain in place before the sole explicit provider delivery request.
- `submitted_to_boarding` is accepted only for the actually observed unsigned Status 0/1/2/16 + application-module context. It cannot assign a MID, mark signed or approve underwriting. Other combinations still hold for reconciliation.
- The actual HTTP/worker fixture now rejects any validation-only network call and verifies one explicit delivery call under concurrency, uncertainty holds, permission revocation and application changes. Previous fixtures that assumed the provider honored validation-only mode were replaced rather than treated as live proof.
- Integrated the remaining dev-predeploy and Phase 8 planning documentation branches. The planning add/add conflict retained the later repair status, without restoring obsolete planning-only assertions.
- Integrated PR #11, the Yelp actor/input/page-result repair, while retaining Liberty's paid-provider activation guard. Corrected actor-path formatting to Apify's documented owner~actor form, bounded page inputs and added a pure contract fixture. No paid scrape or budget change was performed.
- Audited older worktree changes against current source. Existing test/browser fixes already present in current source were retained, including newer improvements. Brought forward the remaining CRM area-link nowrap/shrink fix. Regenerated browser screenshots and temporary evidence in the older worktree remain preserved in place; they are not source fixes to republish.

## Release controls and evidence

Candidate checks, final commit, remote sync, migration and publication results are recorded after execution. This document does not itself assert a passing full canonical integration roster or a successful deployment. The affected Payarc fixture uses disposable PostgreSQL/Redis and mocked provider transport; publication verification must use the real deployed health SHA and live controls readback. The new Payarc migration is additive, without activation or test-data backfill.

Before this release, production served 587555ffea597c83a20fbb72aed45165045a8cb3; Replit workspace and GitHub main were at 550c9e127d9edaab2c89c37a411938c542314a90. Replit workspace readback showed automatic signature/status flags off. No additional provider test email is authorized by publication.

Executed candidate checks: 70 codec/adapter, 49 HTTP/lifecycle, 14 status-apply, 76 boarding-worker, 119 reporting and 11 Yelp contract assertions passed; migration catalog validated 1,057 checks; all 109 deterministic static suites passed. The release artifact gate passed typecheck, production build, dependency inventory and redacting credential scan. No real provider transport was used by these checks. The CI integration runner is pinned to Ubuntu 24.04: the actual previous main job failed before any assertions because Ubuntu 26.04 could not install its required postgresql-16 fixture package. The full cloud integration roster is not represented as passing by these focused results.
