# Publication and verdicts

Nothing in Stage 4D was published, released, approved, adopted, backfilled or sent. All changes are uncommitted working-tree changes on top of HEAD `73272418`; the agent made no commit, so the tested identity is "HEAD plus these files". Publish deploys from the app's own head, so repairs take effect only after the owner's normal Publish. No migration and no startup DDL; rollback is a code rollback only.

Files changed this pass: `client/src/components/BookingCommandPanel.tsx`, `BookingCreatePanel.tsx`, `client/src/lib/zoned-time.ts` (new), `client/src/pages/dashboard/Calendar.tsx`, `Campaigns.tsx`, `server/routes/toolkit.ts` (preview adds display-only context, not hashed), `scripts/scanner-reviewed-gates.ts` (new), `scripts/compliance-scan.ts`, `scripts/check-queue-compliance.ts`, `scripts/smoke-role-guards.ts`, `scripts/test-stage4c2-workspace-browser.ts`, `scripts/certification/test-stage4d-integrated-acceptance.ts`, `scripts/test-stage4d-vertical-county-matrix.ts` (new), `scripts/pre-deploy.ts`, `scripts/run-sfp2060-certification-disposable.ts`, and these evidence files. No package, lockfile, sidebar, public CSS, outbound pause or GHL control change.

## Verdicts (kept separate)

| Verdict | Result |
|---|---|
| Implementation | **Ready.** Stage 4D certification (47), matrix (16), role-guard smoke, 173-check browser run, all section 19 suites that were run, scanners and build pass. |
| Data / counts | Unchanged; no claim. Production recapture recorded. |
| SFP prep / staging | Unchanged. Staging suites pass on a disposable database; no production staging run. |
| Content / CTA | Unchanged. Content, preview and CTA suites pass; five-touch drafts verified, not adopted or approved. |
| Native GHL / calendar | **BLOCKED.** No authorized protected path. Feasibility packet and proposal are in `owner-and-native-matrix.md`. |
| Roles / UI / performance | Roles and Calendar console verified in a real browser. Campaigns filter and Program Health note not browser-verified. No performance measurement was made. |
| Publication / schema / rollback | No schema change. Owner SQL repair for `no_show` still pending. Rollback is code only. |

## Overall

**Implementation ready; acceptance blocked** on native evidence and owner decisions. Stage 4D is not fully accepted.

## Known open items

- `ghl-projection-authority` GPA-99 fails on an untouched export as well (baseline, not repaired).
- Not run: `test-stage4b-workspace-browser`, `test-stage4c1-browser`, full pre-deploy roster, real-path seed send (design decision), production cold-email infrastructure proof.
- Journey scenarios marked partial/open in `integrated-journey-matrix.md` (bad-source exclusions as one journey; specialized-only/generic-only signed reply HTTP fixtures; partner role on booking routes).
