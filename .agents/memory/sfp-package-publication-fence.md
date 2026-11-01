---
name: SFP package publication and generic-route fence
description: Why package content is edited only through one paired publish command, and the READ COMMITTED stale-race behaviour.
---
Current SFP package content (campaign steps + sequence steps) changes only through the admin package publication command; the generic campaign/sequence step routes refuse pinned rows with 409 `pinned_package_content`.

**Why:** a single-sided edit drifts one half away from the pinned content hash, and the launch populator treats drift as "needs review".

**How to apply:** operator-published versions keep `SFP_LAUNCH_CONTENT_VERSION` in notes so the populator never overwrites them. A publish that waited on the locked current-version row sees it superseded under READ COMMITTED and gets no row: report that as `PACKAGE_STALE`, not "no version". Premium drafts are adopted client-side only (session storage); there is no server draft table because schema changes were out of scope. Disposable certs that exercise this need convergence + populate first (see the launch-content cert fixture).
