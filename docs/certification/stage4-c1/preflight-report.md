# Stage 4C1 preflight report — 2026-10-31

Scope: campaign, sequence and message content workspace (specification: `attached_assets/Liberty-Stage4C1-Master-Preflight-and-Build-2026-10-31_1793469717746.md`).

## Source identity

- HEAD and origin/main at start: `45c51437fefa07419e7e8170408f8e5eb02dfc87`; the working tree was clean. All 4C1 work is uncommitted source in the workspace on top of that commit.
- Runtime: Node v22.23.4. Serving build: the development workflow; `/api/health` reports `release-unverified` (no `RELEASE_SHA` in dev). Nothing was published.
- Production was not read. Appendix A of the specification is the author's October 31 production snapshot; the inventory in this folder is generated from it, not re-read.
- Development database (read-only observation): 8 stored templates, 43 `sequence_steps` that used `{{custom_values.booking_link}}`, 3 that used `{{estimatedSavings}}`. These differ from production and are context only.

## Existing work credited (not rebuilt)

Versioned template drafts/publication/history, reviewed-copy convergence, one token registry and strict renderer, receipt wording, the GHL HTML-only final preview, sender policy, package-hash authority for the five current SFP packages, and the SFP launch renderer all existed and were reused. The existing `publishSystemWording` draft refusal, CSRF, role gates, audit and idempotency were kept.

## Stale premises corrected with code evidence

1. **"One booking ID is configured everywhere."** The three configuration sources are not the same kind of identifier: `GHL_CALENDAR_BOOKING_URL` and `GHL_DEFAULT_CALENDAR_ID` carry the 20-character calendar ID, while `GHL_DEFAULT_BOOKING_LINK` is a `/widget/bookings/<slug>` address (a 14-character slug). A first version of the resolver treated that as a disagreement and `/book` returned 503 in development; the resolver now compares ID sources with each other, validates the slug by shape only, and reports that it cannot be compared with an ID. `/book` then returned 302 to the ID widget.
2. **Hardcoded calendar and savings fallback.** `sequence-worker.ts` and `ghl.ts` carried a literal calendar and a "significant savings" fallback; both are removed. `{{estimatedSavings}}` deliberately has no value, so wording that uses it is blocked at delivery.
3. **Ten-minute claim.** The booking calendars are 30 minutes. The duration is not known to the resolver, so copy may not state one; a lint rule (`unverified_duration`) and a draft check enforce this.
4. **Dead paths.** `/book`, `/upload`, `/apply`, `/refer`, `/terminals`, `/partners/portal` are mapped in `RETIRED_FIRST_PARTY_PATHS` (replacement or none) and rejected by the `retired_link` lint rule. `/book` is now a real first-party adapter.

## Kill-line checks

Global outbound pause, GHL outgoing owner pause and GHL incoming were not touched. No control, enrollment, activation, send, booking, provider call, production write or dependency/lockfile change occurred. No full `tsc` was run. No schema change or startup DDL was added. The eleven-entry sidebar and global stylesheet are unchanged.
