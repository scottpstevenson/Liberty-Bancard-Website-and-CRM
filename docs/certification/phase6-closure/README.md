# Phase 6 closure — CRM / SDR Operator Experience

Closure task for the external post-Publish verification of 2026-11-12 (`attached_assets/LIBERTY_PHASE6_POST_PUBLISH_VERIFICATION_2026-11-12_1794516397092.md`, 26-row matrix). This is one closure pass with checkpoints. It does not reopen the original audit and it is not a CRM redesign.

**Read this first.** Sections 1–8 were produced on isolated infrastructure (throwaway databases, fake provider transports, a private browser) against the candidate source named in section 1. The owner published these repairs afterwards. Section 9 records what was then read from the live site and the production database with read-only requests (2026-11-13). It proves which build is serving and that the client files are byte-identical to the candidate; it does not prove the signed-in screens, because no signed-in session was used. Rows still say "LIMITED" where that matters.

## 1. Frozen identity

| Item | Value |
|---|---|
| Workspace HEAD (commit the work sits on) | `8b61ae5e4eac07f187bda90291a0ae36f6b5db02` plus the uncommitted Phase 6 files in the working tree |
| GitHub `main` when frozen | `1e16a849…` (does not contain the working-tree repairs) |
| Serving build when frozen | `/api/health` sha `a83a94cd93e4c6248f107d29361e7ea2d1319d33`, build `695c00fc-db90-40e0-840e-d46415cfc68e`, built 2026-11-12T17:08:49Z |
| Serving build named in the audit | sha `0538805f…`, build `9cab9974…` (an earlier build; the audit's FAIL rows describe that build) |
| Candidate source hash (`dist/candidate-integrity.json`) | `456d46f5a89e525c2512db455da979939917a8cb1a1eebc919b6fb4d8b138412` |
| Candidate output hash | `05558463a5b340bda5505ab860785ab83e2fad8c1508743d16a0de7214e5ad08` |
| Qualification | Compiled client and registered handlers in an isolated preview. Not a deployed bundled-server parity check. |

The source hash covers `scripts/`, `client/` and `server/`; `docs/` is outside it, so this README and the roadmap can change without moving the identity. Any edit to those three folders requires a rebuild and a repeat of section 4.

No migration was added by this work, so there is no schema or rollback record to keep separately.

## 2. Repairs (R01–R09)

| Repair | Rows | What changed |
|---|---|---|
| R01 | CRM-02, 13 | Task and request links open the exact task or request. Task evidence comes only from recorded work-link relations; a stale target is "unavailable", never guessed. |
| R02 | CRM-09, 12 | Backlog and launch-inventory reads are bounded: progress is reported, a generation fence rejects stale reads, the 25 s deadline is unchanged and there are no recount loops. |
| R03 | CRM-16 | Email-lane guidance matches the local receipts and states. No delivery or activation claim. |
| R04 | CRM-05 | Narrowing a desktop window to phone width keeps the exact record address; the notice offers the same contact in the mobile app knowingly; widening restores the desktop view. |
| R05 | CRM-12, 21A, 22A | Intake cohorts, Today and Pipeline counts each say what they count. Pending 4 versus open 5 is not forced equal. |
| R06 | CRM-18 | A Contact is a person. The business is shown separately and labelled "as entered, not verified" unless a reviewed link verifies it. Consent has three states; "not recorded" is "unknown, not a refusal". |
| R07 | CRM-17 | Notifications carry their own request metadata. Older rows resolve only through the immutable inbound request id, and only for admin and manager. A name, email or title never picks the destination. |
| R08 | CRM-21D | The emergency stop stays visible on Lead Ops; maintenance details sit behind disclosures. |
| R09 | CRM-22B | Area names come from the sidebar entries. Record pages show an area-only breadcrumb and Back. An explicit `from=` beats the recorded origin; the recorded origin is per actor and per record. |

Also changed during this closure pass (each covered by the final sweep):

- `GET /api/contacts/:id/zerobounce-history` now applies the contact access check, so an agent reading the history of another owner's contact gets 404.
- `GET /api/deals/:dealId/co-branded-proposals` now applies the deal access check, so another owner's deal answers 404 (archived deals included).
- Accessible names added: Outreach Queue row checkbox, Inbox search box, Pipeline deal-drawer fields and proposal link, comment boxes.
- Pipeline toolbar was sticky at every width; below the `md` breakpoint it was taller than a 320 px screen and covered every card. It is now sticky from `md` upward only. This was found by the populated-journey browser run.
- Contact header made compact on phones so Status, Next action and the section navigation stay above the 844 px fold: the labelled "Person:" line stays for screen readers but is not repeated visually when the heading already is the person's name; the business qualifier reads "As entered, not verified" (full sentence on hover); when both channels are "not recorded" the explanation "(unknown, not a refusal)" is shown once. A mixed state keeps full per-channel labels. See section 5.
- D06 contract test now names `WorkspaceTitle` as the owner of the page heading (contract unchanged); `WorkspaceTitle.test.tsx` imports `ClaimingHeading`.

## 3. Provenance (CRM-10) and QA records (CRM-11)

- Policy: a domain is attributed to a business only when an independent source recorded that ownership. The check fails closed. Nothing here releases, sends or reclassifies anyone. Proof: `test-phase6-provenance-and-record-class` (disposable database).
- No production reclassification was made or proposed by name. Contacts 159444, 166171, 166166 and 166167 are already archived and production-class; deal 2587 is excluded; application 92 ("QA TEST MERCHANT — DO NOT BOARD") is unlinked. Names that look like tests are not treated as test records. Any cohort reclassification needs the owner's approval (owner-deferred).

## 4. Sweep results on the final candidate

Run by `/tmp/p6-final.sh` (rebuild, then every suite below). Per-suite output is in `generated-artifacts/p6f-*.log` (local, not committed); the summary is copied to `suite-results.txt` in this folder.

**Passed (all exit 0):**

| Suite | Result | Rows it supports |
|---|---|---|
| `test-phase6-legacy-alias-matrix` | 44 aliases, 220 cases | 03 |
| `test-phase6-work-presentation` | 93 checks | 02, 04, 14, 20 |
| `test-phase6-mobile-continuity` | 100 checks (source level) | 05, 06, 07, 08 |
| `test-phase6-mounted` (injected fetch; includes SelectedTaskPanel, Notifications, MaintenanceDisclosures, WorkspaceTitle) | all suites | 02, 07, 17, 21D, 22B |
| `test-phase6-email-lane-states` | 514 checks | 15, 16 |
| `test-phase6-count-contract` | 131 checks | 12 |
| `test-phase6-contact-and-applications` | 59 checks | 18, 19 |
| `test-phase6-today-pipeline-reports` | 153 checks | 21A, 21B, 22A |
| `test-phase6-workspace-identity` | 341 checks | 22B |
| `test-phase6-inventory-reads`, `-inventory-set-reads` (disposable DB) | pass | 09, 12 |
| `test-phase6-provenance-and-record-class` (disposable DB) | pass | 10, 11 |
| `test-phase6-task-evidence` (disposable DB) | pass | 02, 13 |
| `test-phase6-intake-cohorts` (disposable DB) | pass | 12, 21A, 22A |
| `test-phase6-contact-header-task` (disposable DB) | pass | 18 |
| `test-phase6-notification-targets` (disposable DB) | pass | 17 |
| `test-phase6-browser` (private browser) | `PHASE6_BROWSER_PASS`, 55 named checks, 36 audited states | 05, 07, 14, 17, 21C, 22B |
| `test-phase6-populated-journeys` (private browser) | 66 named checks | 01, 08, 21B, 21C |
| `test-c2-contact-header` (private browser) | pass | 18 |
| `smoke-role-guards`, `check-route-guards`, `test-stage3-d-v-contracts` (33), `test-task1721-inbox-statement-structure` | pass | role refusal, structure |

Browser evidence: `browser/phase6-browser-results.json` (55 checks listed by name) and `populated-journeys/phase6-populated-results.json` (66 checks) with screenshots in the same folders.

**What the browser suites cover.** Five widths (1280, 768, 454, 390, 320 px) and native 200% zoom on the contact record, Pipeline, Notifications and Lead Ops (browser suite) and on the Inbox, Outreach Queue, validation history and proposal events (populated suite): no horizontal overflow, one h1, named controls, no page error. Back, reload and breakpoint continuity for a record opened from Pipeline. A late response for an earlier record does not replace the visible one. After an actor change in the same browser profile the earlier actor's record is not shown, including offline. A revoked manager no longer gets the manager-only page. Keyboard: 30 distinct controls in 30 presses, none unnamed, focus never falls back to the page body. Role matrix for admin, manager, agent, merchant, affiliate and partner on contacts, deals and notifications; an agent reading another agent's contact gets 404. Claim fencing: a claim with the current version is 200; a second claim from the stale version is 409, changes nothing and writes no second event; two simultaneous claims have one winner and one event; an agent claiming unassigned work is refused (404); merchant, affiliate and partner get 403; an agent bulk-assigning gets 403. Notification failure semantics (fake fetch, mounted): a failed target check leaves the alert unread, issues no read request, announces the failure and Retry recovers; a stale or denied target behaves the same.

### Failures that also fail on the exact clean base

The clean base is the HEAD commit's tree exported to `/tmp/p6-base` (a throwaway empty git repository was created there only so the build script's `git rev-parse HEAD` could run). The first six scripts below fail on the base and on the final candidate at the identical first assertion (compared line by line in `suite-results.txt`). The seventh fails on the base and passes on the candidate.

| Script | First failing assertion (base and candidate) |
|---|---|
| `test-crm-operator-experience` | `server/routes/crm-operations.ts must contain db.select().from(tasks).where(eq(tasks.contactId, contactId))` |
| `test-task2056-crm-ui-contracts` | regex for `user?.role === "admin" && <ContactBusinessReconciliationPanel />` not found |
| `test-lead-ops-budget-removal` | regex `/AUTHORIZE PAID PILOT/` not found |
| `test-attestation-promotion-regression` | Gate 6 `ORDER BY captured_at DESC`; Gate 6 `ATTESTATION_SCHEMA_ERROR` |
| `test-dashboard-polish` | calendar PUT `/api/calendar-events/:id` answers 400 (14 pass, 1 fail) |
| `test-stage3-d-r2-contracts` | "Every listed industry page is server-rendered; only an unknown industry slug answers 404…" (an earlier candidate run stopped sooner, at "Shell title is the fallback h1 and yields to a claiming page"; the `ClaimingHeading` import rename fixed that, and the first failure now matches the base) |
| `test-c2-contact-header` | base fails "mobile: navigation below fold" (section navigation bottom 910 px against an 844 px screen). The candidate passes after the compact-header change in section 2 and a login-order correction in the script (see section 5). |

Caveat: these assertion-style scripts stop at the first failure, so every assertion after it is unexecuted on the base and on the candidate. A pass on later assertions is not claimed. The failures are preserved; none was hidden, skipped or loosened. The SEO audit's hydrated-metadata flake was not compared with the base.

## 5. Decisions made while closing, with reasons

- **Compact header.** The C2 contact-header test fails on the clean base because the person, business and consent lines already at HEAD pushed the section navigation below the phone fold. It is the same Phase 6 header (CRM-18), so it was repaired here rather than reported as an inherited failure. Facts stay on screen: person (heading), business and its "not verified" status, consent states, outbound pause, next action. Only repetition was removed. The test's own login step stored the desktop-layout choice after signing in; at native 200% zoom the page is under 768 px wide, so the post-login page was the mobile choice notice. The script now stores the choice before signing in. The base never reached that step because it failed earlier, so whether the order was already a problem there is not known. Tracked Stage 3 C2 evidence under `docs/certification/stage3-c2/contact-header/` was restored to its committed content; this run's output is in `c2-contact-header-final-run/`.
- **Outreach Queue populated rows** come from a labelled stand-in for the CR04 projection. Start was never pressed; only Skip was exercised.
- **R08** browser coverage is the Lead Ops generic audit with unregistered sources; the mounted suite covers the disclosure behaviour.

## 6. Row-by-row dispositions

Dispositions: **ACCEPTED** = repaired and proved by the executed isolated evidence named. **ACCEPTED, LIMITED** = accepted for the stated scope; the named part was not executed here. **OWNER-DEFERRED** = needs an owner decision or the owner's Publish. "Live readback" means a GET-only check after Publish, which has not been done for any row. A "—" in the audit column means the audit's own pass/partial/fail lists did not name that row.

| Row | Audit result | Repair | Disposition | Evidence and limits |
|---|---|---|---|---|
| CRM-01 Inbox visibility | PARTIAL | — | ACCEPTED, LIMITED | Populated Inbox checks 43–65: mapped, unmapped and foreign-owner messages, partial-window label, loaded-page unread badge, selection kept on reload, failed read shown as unavailable, agent sees own messages only, 404 on a foreign message, 403 for merchant, affiliate and partner. The audit's missing production message and Chat/Google source failures are provider-side state and were not reproduced; live readback. |
| CRM-02 exact task | FAIL | R01 | ACCEPTED, LIMITED | `task-evidence`, mounted SelectedTaskPanel, `work-presentation`. The exact task, request and file actions were not walked in a real browser; proof is database and mounted level. |
| CRM-03 legacy aliases | PASS | — | ACCEPTED | `legacy-alias-matrix`: 44 aliases, 220 cases. |
| CRM-04 business time zone | PASS | — | ACCEPTED, LIMITED | `work-presentation` (DST and midnight cases). Browser runs used the container's time zone only; a foreign device time zone was not run. |
| CRM-05 mobile continuity | FAIL | R04 | ACCEPTED, LIMITED | `mobile-continuity` (100) and browser checks 10–14 (narrow keeps the exact address, notice offers the same contact on mobile, widen restores, desktop choice kept, phone-width link opens the same contact). Chromium only; no real phone and no WebKit. |
| CRM-06 mobile privacy | PASS | — | ACCEPTED, LIMITED | `mobile-continuity` (source level: no private API caching in the service worker). No installed-app lifecycle on a device. |
| CRM-07 stale, actor change | source present | — | ACCEPTED, LIMITED | Browser checks 15–19: late response, actor change, offline, revocation. Actor changes were sequential in one browser profile. Real simultaneous multi-tab behaviour was not executed. |
| CRM-08 foreground refresh | PARTIAL | — | ACCEPTED, LIMITED | Populated checks 56–59: a new message arrives through the bounded refresh with selection and half-typed draft kept (desktop Inbox). Mobile inbox foreground and background transitions are covered at source level only. |
| CRM-09 bounded reads | FAIL | R02 | ACCEPTED, LIMITED | `inventory-reads`, `inventory-set-reads` on fixtures. Production-scale timing and query plans were not measured; live readback. |
| CRM-10 provenance | PARTIAL | — | ACCEPTED | `provenance-and-record-class`; policy in section 3; nothing released or reclassified. |
| CRM-11 record class / QA | PARTIAL | — | ACCEPTED for labels and predicates; OWNER-DEFERRED for any reclassification cohort | Labels come from the classification authority only. See section 3. |
| CRM-12 counts | — | R02, R05 | ACCEPTED, LIMITED | `count-contract` (131), `inventory-set-reads`, `intake-cohorts`. Each count states its definition; pending 4 versus open 5 is not forced equal. Fixture scale; live readback. |
| CRM-13 exact request | — | R01 | ACCEPTED, LIMITED | Same evidence and limit as CRM-02. |
| CRM-14 claim fencing | PARTIAL | — | ACCEPTED | Browser checks 45–55 (section 4). |
| CRM-15 email-lane states | PASS | — | ACCEPTED | `email-lane-states` (514). Presentation only; no delivery claim. |
| CRM-16 email-lane guidance | FAIL | R03 | ACCEPTED, LIMITED | `email-lane-states`. Not visible live until Publish. |
| CRM-17 notifications | — | R07 | ACCEPTED, LIMITED | `notification-targets` (database), mounted Notifications (failure, stale and denied targets, Retry), browser role matrix on `/api/notifications` and populated list. Real alert-open journey in a browser not run. |
| CRM-18 Contact is a person | FAIL | R06 | ACCEPTED | `contact-header-task`, `contact-and-applications`, `test-c2-contact-header` (section 5). |
| CRM-19 documents | PASS | — | ACCEPTED | `contact-and-applications`. |
| CRM-20 work presentation | PASS | — | ACCEPTED, LIMITED | `work-presentation`. The Work page was not in the five-width browser audit. |
| CRM-21A Today queue | — | R05 | ACCEPTED, LIMITED | `intake-cohorts`, `today-pipeline-reports`. First-viewport density on Today was not measured in a browser. |
| CRM-21B Pipeline | PARTIAL | — | ACCEPTED, LIMITED; drawer layout OWNER-DEFERRED | Populated Pipeline and proposal-event checks 17–33 at five widths and 200% zoom, plus the 320 px toolbar fix. The deal drawer is still an edit form first; a read-first drawer is a design change and was not made. Board-wide proposal badges need a per-deal open (a separate proposed task). |
| CRM-21C responsive | PARTIAL | — | ACCEPTED, LIMITED | Five widths and 200% zoom as listed in section 4. Today, Work, Applications and Reports were not audited at widths. No real devices. |
| CRM-21D maintenance | — | R08 | ACCEPTED, LIMITED | Mounted `MaintenanceDisclosures` and the Lead Ops browser audit (section 5). |
| CRM-22A | — | R05 | ACCEPTED, LIMITED | Same as CRM-21A. |
| CRM-22B page identity | FAIL | R09 | ACCEPTED | `workspace-identity` (341), mounted WorkspaceTitle, browser checks 5–9 (one h1, Back, reload, same area). |

## 7. Not executed (not claimed)

- Step 7 partly (see section 9): done are the health sha and build capture, the source and client-bundle comparison, unauthenticated GET checks, post-Publish log review and read-only production counts. Not done: any signed-in readback of the repaired screens, and timing or query plans for the bounded inventory reads at production scale (the routes need an admin session; the production database is reachable only through read-only SQL here).
- Real simultaneous multi-tab behaviour, WebKit, real phones, installed-app lifecycle.
- Browser run in a device time zone different from the container's.
- Real-browser walk of the exact task, request and file actions (CRM-02, 13) and of opening a notification.
- Signed-in production screens.
- Outreach Queue Start and enrolment (never pressed).
- Later assertions of the scripts listed in section 4's failure table.
- Known observations left unfixed: the SLA worker's stale `background_jobs` row (`sla-worker`, last run 2026-09-05; Program Health shows `failed` ahead of stale; hosting is an owner decision); pool contention seen around the commercial-graph lock; validation history sits behind the closed diagnostics disclosure on the contact page.

## 8. Needs the owner

1. Publish: done (section 9).
2. Done with the owner's go-ahead on 2026-11-13 (12:47Z), after section 9's readback: deal 2589 (David Turner) was classified production through the admin route (one immutable classification event, id 83784, audit action `deal_classified_production_by_admin`), then inbound request d6a49091-1b76-416c-a942-4c9d335f4d4c was continued through the existing resume command (audit action `inbound_review_resumed`). Read back afterwards: the request is `accepted` / `assigned` to scott@libertybancard.com; follow-up task 7075 "Follow up business inquiry — David Turner" exists, pending, linked to contact 166172 and deal 2589. Nothing was sent: no communication event for the contact in the following 30 minutes, the request's acknowledgement is still the 2026-11-12 17:01Z one, and the outbound pause is still `paused`, epoch 4. This was the only production write in the closure; it used an admin sign-in, and nothing else was changed.
3. Approval of any QA or provenance reclassification cohort.
4. If the owner wants the signed-in live screens proved, a signed-in walk (or a read-only account) is needed; this closure used none.

## 9. After Publish: live readback (read-only, 2026-11-13)

No request below wrote anything. Production SQL used the read-only production query tool; HTTP requests were GET/HEAD only and unauthenticated.

**Serving identity**

| Item | Value |
|---|---|
| `GET /api/health` | `status: ok`, sha `b58b20beca1f068761e9eb64776c99a4a1b2aa6a`, build `b7a93741-d631-4a67-88b5-2fd30f8d48f6`, built 2026-11-13T03:47:37Z, env `production` |
| Deployment record | published, VM, build successful, public, primary URL `libertybancard.com` |
| Workspace HEAD after Publish | `7ee8a1e1f902825bd7c8b9743299b94e7b0b0c08` ("Published your App"); its tree is identical to `b58b20be…` (`git diff` empty); working tree clean |
| Source comparison | Candidate input receipts (`dist/candidate-integrity.json`, every file) re-captured from the published tree: **0 differences**; recomputed source hash `456d46f5…8412` equals section 1 |
| Client bundle | The live `index.html` references `assets/index-CJvYQnEX.js` and `assets/index-DLGVzxzN.css`. Downloaded from the live site, SHA-256 `41084547…2f06` (js) and `946987a8…c13a` (css) are **byte-identical** to the candidate's `dist/public/assets` files |
| Not comparable | The bundled server file (`index.cjs`) is not publicly readable, so server-bundle parity is shown only through the source hash and startup log, not byte for byte. The candidate output hash `05558463…` covers the whole `dist/` folder and was not reproducible from outside. |

**Live behaviour without a session**

- Public pages `/`, `/about`, `/contact`, `/login`, `/dashboard` answer 200 (the dashboard path serves the app shell).
- `/api/notifications`, `/api/contacts/1`, `/api/deals`, `/api/contacts/166172/zerobounce-history` and `/api/deals/2589/co-branded-proposals` answer 401. This shows the routes exist and refuse anonymous callers. It does **not** show the agent-vs-other-owner 404 results (signed-in; isolated proof only).
- Startup log after the Publish: production migrations skipped (schema managed by Publish), native objects already current, 18 seed-convergence targets already present, outbound pause authority started `paused`, epoch 4, from the database. No HTTP 5xx on an API route in the post-Publish log lines searched.
- Background queues logged repeated 30-second statement timeouts after Publish (`sfp-free-classification`, the Sunbiz enrichment queue, `canonical-import-recovery`) and a few `ORGANIZATION_AMBIGUOUS_ORGANIZATION_MATCH` enrichment errors. None touches a screen in this closure, and they were not compared with the build before Publish. Cause not investigated here.

**Production facts read (read-only SQL, scale reference; not what any screen displayed)**

- Schema: `notifications.inbound_request_id` and `command_key` columns exist in production (R07 relies on the first).
- Rows: 161,060 contacts (160,554 not archived); 177,330 businesses (canonical 99,984, production 77,309, unknown 37); 18 inbound requests; 2 undeleted tasks; 1,543 unarchived deals; 4,923 notifications (3,838 unread, 9 carrying an inbound request id).
- Inbound requests by lifecycle / assignment: failed/pending 5, accepted/pending 5, review_required/review_required 4, accepted/assigned 2, review_required/pending 2. Counts that mix these groups are not forced equal (CRM-12); the exact on-screen numbers were not read.
- Deals by class: 1,578 unknown, 1 production (deal 2587, archived). Deal 2589: unknown, not archived, stage New Lead.
- Application 92 ("QA TEST MERCHANT — DO NOT BOARD"): status submitted, no deal or contact link.
- Outbound pause: `paused`, epoch 4, committed 2026-11-12T19:20Z ("Re-paused after owner-approved QA deal cleanup"). Nothing was unpaused, sent or released.

**What this does not establish:** the repaired screens working for a signed-in admin, manager or agent on the live site; production-scale latency of the bounded inventory reads; real-device behaviour. Rows keep their section 6 dispositions; the "live readback" caveat on CRM-01, 09, 12 and 16 is narrowed to "serving build and client files confirmed; signed-in screens and production-scale timing not run".
