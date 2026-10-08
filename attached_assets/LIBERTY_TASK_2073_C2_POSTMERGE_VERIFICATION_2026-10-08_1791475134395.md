# Liberty Stage 3 — Task #2073 / C2 postmerge verification

Date: 2026-10-08 UTC. Scope: current accessible repository, retained Replit closeout, and bounded authenticated admin desktop checks on the published CRM.

**Verdict: merged and published, with source-tree alignment and specific live improvements verified. Full C2 acceptance remains qualified.** Two existing repair groups still contain source-confirmed gaps. Calendar appointment coverage and selected Inbox message resolution also need live verification. This report supersedes the prebuild status for the checks below; it does not rewrite the historical October 7 correction file or close all original audit claims.

## 1. Serving source and review boundary

| Evidence | Verified value / meaning |
| --- | --- |
| Accessible main | `436b1575adbd2fbc9bcb2025d8bff88196455057` — Published your App |
| Live `/api/health` source | `ddcb35aaf271436437434c06af6c3d1644490207` |
| Live build time | `2026-10-08T14:54:54.220Z` |
| Live publish build ID | `f8a4602d-de8f-4bbe-90fa-c803cf98f10e` |
| Health | status `ok`, environment `production`, `ghlTransportFailFast=false` |
| Both commit trees | `822d01cf05fe0c10e36fa0962c3d3ed2c1d2fa5b`; commit-to-commit diff empty |
| Review checkout | Clean detached checkout at accessible main; earlier working checkout preserved |

The health-reported source now resolves and has the same Git tree as main. This resolves the earlier source-availability discrepancy for this build. It does not certify every deployed asset, setting, migration, provider, action or role.

No application-code edit, production record mutation, outbound send, draft save, upload, link/unlink, campaign enrollment, scan, paid generation, settings change, schema change, worker change or deployment was performed during this verification. Browser navigation and read-only filters/selections were used. The outbound-paused banner remained visible. Incoming GHL synchronization must remain enabled independently, with no echo; its continuing end-to-end operation was not certified by a banner, old inbox item or health flag.

## 2. Changes actually visible in the published CRM

| Surface / existing scope | Live result | Limit |
| --- | --- | --- |
| Today / Overview | “Today” briefing, five principal metrics, source/as-of qualification, Open Work link, collapsed additional performance details | Existing lower sections remain; no full metric/role acceptance |
| Contact navigation | Five URL-backed areas: Overview, Sales work, Conversations, Lifecycle, Service & performance | Five entrances verified; not every nested action retested |
| Contact Overview | Summary, Relationships and Locations grouped together | Conditional company intelligence preserved in source |
| Activity / History | Separate drawers opened and closed; history displayed a creation entry | No full keyboard, focus or alternate-role acceptance |
| Locations | Overview → People → record → Locations now settles without the previous `g.filter is not a function` ErrorBoundary | No parent/link/unlink mutation |
| Inbox geometry | At 1363px viewport, list width 320px; thread begins at x616 with width723; body width1363 | Desktop sample only; not phone/zoom certification |
| Inbox identity | One native email card in the sampled window; old replicated chat/SMS/voicemail presentation absent | Not proof of all provider types or exhaustive deduplication |
| Inbox pagination | “Load next window” enabled and clickable; partial-source qualification remains visible | Same sampled row remained; complete pagination coverage unverified |
| Pipeline | Linked contact names appear in both Board and List; toggles work | No stage move, bulk save or failure rollback tested |
| Work | Tasks/Appointments selection works; browser Back returns from Appointments to Tasks | No durable task/event mutation tested |
| Calendar coverage | Appointment-provider read failure is explicitly displayed with Retry and partial-coverage explanation | Provider read itself did not pass |

Today and Pipeline both displayed two open sales deals for this sample. This is one equivalent-metric observation, not certification of all cross-page counts.

### Contact destinations implemented

The canonical map is in `client/src/lib/crm-destination-state.ts:124–133`; Contact integration is in `client/src/pages/dashboard/ContactDetail.tsx` around the area selection and navigation.

| Area | Canonical sections retained in source |
| --- | --- |
| Overview | `overview`, `relationships`, `locations`, `company-intelligence` |
| Sales work | `deals`, `tasks`, `call-logs`, `call-assist`, `offer-intelligence`, `sales-prep` |
| Conversations | `comm-timeline`, `comm-health`, `delivery-log`, `notes`, `comments` |
| Lifecycle | `documents`, `onboarding-stages`, `rfis` |
| Service & performance | `tickets`, `live-processing`, `chargebacks`, `churn-risk`, `nps` |

Twenty area sections were visible for the sampled record, with Activity and History as two drawers. Three source-retained sections are conditional. This is regrouping of the existing Contact surface, not deletion of those capabilities. Lazy “Unknown” counts were not classified as corrupt values without loading their readers.

**The complete premium redesign is not finished.** The Contact header still contains a substantial readiness block and many actions above the area navigation. The current sidebar remains the prior set of destinations; the final eleven-entry consolidation belongs to the existing C5 boundary. C3/C4 interiors and remaining design acceptance are not implied by C2 publication.

## 3. Source repairs present, with appropriate evidence limits

| Repair | Current source evidence | Disposition |
| --- | --- | --- |
| Locations DTO/cache collision and paged picker | `client/src/pages/dashboard/contact-detail-tabs/LocationsTab.tsx` now uses canonical CRM queries/contact readers, scoped paged selection, and throwing failure states | Present in code; prior navigation crash reproduction passes live |
| Company counterparty selection | `client/src/components/crm/AuthorizedContactPicker.tsx`; Company detail consumes it | Present in code; picker action not reaccepted live here |
| Pipeline contact identity | `client/src/pages/dashboard/Pipeline.tsx` around1689 reads authorized embedded contact facts | Present in code and visible in Board/List |
| Inbox layout and next cursor | `client/src/pages/dashboard/CommsHub.tsx` around712 and849; shared CRM grid styles | Layout passes sampled viewport; exhaustive source-window progression unverified |
| Inbox actual message typing | `server/services/ghl-message-normalization.ts`; `server/routes/inbox.ts:402–414` | Explicit typed IDs/channel/direction and conversation-scope check replace broad guessing; full provider parity unverified |
| Work URL/history | Shared destination codec and Tasks/Appointments push navigation | Sample browser Back passes |
| Cross-workspace freshness | `client/src/hooks/use-work-commands.ts` family invalidation and server freshness service | Source implementation present; full mutation-to-reader proof pending |

Replit's retained provider-contract document is reference evidence; it does not demonstrate an incoming production webhook or every native message channel.

## 4. Corrections and remaining acceptance — keep existing owners

### C2-R07 — Calendar existing-event date repair: confirmed source defect remains

At `client/src/pages/dashboard/Calendar.tsx:202–207`, the existing-event Fix mutation still constructs one09:00 timestamp and submits it as **both `startTime` and `endTime`**. A persisted event can therefore become zero-duration. This is the narrow existing-event repair path, not the Add Event form. No live save was performed.

**Repair:** preserve the valid original local start time and positive duration when moving to another day. For invalid timestamps, require validation or an explicit positive fallback; never silently submit equal endpoints. Preserve event ownership and event/deal namespaces and keep provider appointments read-only. Verify ordinary day changes, month end and DST boundaries, rejected/invalid dates, positive `end > start`, persistence/reload, and mutation failure without a success toast. Do not broaden this into provider write authority.

Discovery check:

```bash
rg -n 'fixEventDateMutation|startTime: iso|endTime: iso|readOnly|appointment' client/src/pages/dashboard/Calendar.tsx
```

### C2-R03 — Contact pending-task predicate: confirmed source discrepancy remains

At `client/src/pages/dashboard/ContactDetail.tsx:1604`, pending tasks are filtered by `effectiveState === "open"`. The canonical `isPendingTask` in `client/src/lib/task-source.ts:20` includes **open and in_progress**. Equivalent pending populations can disagree. The current sample did not supply an in-progress fixture, so no exact production miscount is claimed.

**Repair:** consume the canonical predicate/authorized reader, retaining actor, contact, archive and scope constraints. Do not add a competing task SQL definition or treat unavailable rows as zero. Verify a scoped fixture containing open, in-progress, completed and cancelled tasks; reconcile Contact and Work counts for the same population and as-of window, including reload after a successful task change.

Discovery check:

```bash
rg -n 'pendingTasks|effectiveState.*open|isPendingTask|taskPresentationState' client/src/pages/dashboard/ContactDetail.tsx client/src/lib/task-source.ts
```

### Existing Inbox and Calendar reader acceptance

- **Inbox / R06:** clicking the sampled native message selected it, but the settled thread displayed “Information unavailable” and explained that the source was missing, unmapped or outside access. It offered Try Again and Clear unavailable selection. Investigate the same authorized message through the source adapter/detail resolver; distinguish mapping, deletion, provider availability and legitimate access denial. Preserve namespace/scope checks and do not substitute a loaded preview as authoritative thread data. No IDOR or provider outage cause is proved by this state.
- **Calendar / R07:** the appointment reader explicitly failed. Verify the authorized provider response and role/location/owner scope; demonstrate successful coverage and truthful partial/error coverage. The UI error-state repair is visible, while the integration success gate remains open.
- **GHL:** the record displayed an unavailable sync status and disabled outbound Re-sync with an incoming-only explanation. This does not establish that incoming sync is disabled. Verify an incoming protected fixture and durable receipt/no echo under the existing sync owner. Do not enable outbound to obtain a green test.
- **UI finish:** compact the remaining record header/readiness/action hierarchy within the existing design ownership. Verify mobile, zoom, focus, loading/error/empty states, destructive-action permissions and long content before calling the experience fully premium.

These are scoped dispositions within existing repair groups. They are not new original finding IDs or a new task ladder. The original95-entry register,14 repair groups and established implementation ownership are preserved; no global confirmed/partial/deduplicated totals were recomputed by this bounded check.

## 5. Test evidence and final acceptance boundary

**Checks performed here:** clean pinned source review; commit-tree equality; targeted code reads; authenticated admin desktop workspace/area navigation; Locations reproduction; drawer opening/closing; Inbox geometry/selection/next-window click; Pipeline Board/List; Work browser Back; source/as-of and sample equivalent metric comparison. Screenshots retained. No fresh install, typecheck, build, stock CI/security suite, alternate-role suite, protected durable mutation suite or mobile/zoom suite was run here.

**Replit retained evidence, not fresh passes by this review:** `docs/certification/stage3-c2/closeout.md` and `verification-status.md` describe335 bounded browser observations and281 counted contract assertions, with denied external effects and a disposable fixture environment. Those counts are not unique production controls or full coverage. The last compiled/browser-tested source was `4df9b86e6e403dbdc5464dbf0b8f01162d46490d`; later source changes received focused syntax checks rather than the same browser acceptance. The final typecheck timed out without diagnostics. User-requested closeout stopped further full suites.

The1002-control `actions.csv` inventory is discovery, not an accepted control count. Retained security high findings, SFP static-lane failure, CSV/server-lane failures and incomplete integration receipts retain their existing owners and qualified statuses. Historical failures are not erased by a later selected browser pass. The retained compiled-client/registered-handler fixture is not equivalent to the deployed bundled server with real roles, providers and configuration.

**Next step:** finish the two narrow existing C2 repairs and affected Inbox/Calendar reader verification through the established owner; preserve independent incoming GHL and outbound pause. Continue the already-planned C3/C4/C5 work under its scope. D remains responsible for integrated live closure. Stage3 remains in progress; Stage1/2 prior completion is unchanged. No Stage9 freeze, final certification or all95 closure is issued.

## 6. Screenshots

- `liberty-c2-published-areas-20261008.jpg`: published five-area Contact navigation, Overview sub-tabs and Locations mounted without the former error.
- `liberty-c2-published-contact-20261008.jpg`: retained Contact header showing remaining density and the unavailable GHL status/incoming-only explanation.

The screenshots document the sampled live state, not universal visual/action acceptance.
