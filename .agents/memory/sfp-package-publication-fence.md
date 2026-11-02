---
name: SFP package publication and generic-route fence
description: Why package content is edited only through one paired publish command, and the READ COMMITTED stale-race behaviour.
---
Current SFP package content (campaign steps + sequence steps) changes only through the admin package publication command; the generic campaign/sequence step routes refuse pinned rows with 409 `pinned_package_content`.

**Why:** a single-sided edit drifts one half away from the pinned content hash, and the launch populator treats drift as "needs review".

**How to apply:** operator-published versions keep `SFP_LAUNCH_CONTENT_VERSION` in notes so the populator never overwrites them. A publish that waited on the locked current-version row sees it superseded under READ COMMITTED and gets no row: report that as `PACKAGE_STALE`, not "no version". Premium drafts are adopted client-side only (session storage); there is no server draft table because schema changes were out of scope. Disposable certs that exercise this need convergence + populate first (see the launch-content cert fixture).

## Stored-copy adoption and as-sent previews
Installed rows are never rewritten by seeds. Workflows/templates adopt corrected wording through `convergeReviewedCopy` (exact-substring, versioned, startup + admin POST). Sequences adopt through a plan-hash-bound admin route that does NOT run at startup; an ACTIVE sequence is refused until an operator pauses it, and the command never pauses or activates anything.

**Why:** operator edits must survive (a changed substring is reported as a conflict, not overwritten) and activation stays an owner decision.

**How to apply:** the legacy-editor "Message as sent" preview is asset-addressed: the caller sends asset identity only, the server picks transport/signature/substitution and shares `interpolateSequenceText` with the worker, so edit the shared function, not a copy. The production census (hashes/links only) shows about 78 sequences still link the GoHighLevel booking widget instead of `/book`; those are outside the adoption plan and need an owner decision.

## Adoption receipts, layered edits and link reconciliation
- Per-step receipts are written inside each step's transaction; a non-adoption error stops the loop and is rethrown, the batch summary is best-effort. `auditChange` redacts the exact payload key `hash`, so use `wordingDigest`.
- A later review revision of an already-adopted step is a `layered` edit (matches the earlier edit's output); it must converge from both the original and the adopted wording.
- Widget-link reconciliation is by step purpose and by the anchor's own label (booking label -> `/book`, upload label -> secure upload). Unlabeled, application, referral, proposal and Account Management links stay on the widget as owner decisions. Active sequences are never bulk-paused or edited.
- The disposable seed must union the production snapshot with the link-target fixture. Campaign package convergence matches campaigns by exact name, so browser fixtures must not suffix names.
- The campaigns "as sent" preview uses snake_case merge tokens; an unknown token is a warning (delivered literally), not a block.
