# Liberty W-C Forms and CRM Handoff — Intake and Handoff Record

Date: 2026-11-09
Scope: LI-W02, LI-W04, LI-W05, LI-W07, LI-W21, LI-W23; LB-FT-01 to LB-FT-03, LB-SR-01 to LB-SR-05, LB-C-01 (intake behavior); WB-PV01 (mobile Menu focus) carried forward as checkpoint C0.
Governing contract: `attached_assets/Liberty-W-C-Forms-and-CRM-Handoff_1794235783150.md` (verbatim copy in `.local/tasks/w-c-forms-and-crm-handoff.md`).
Status (refreshed 2026-11-10): the original W-C build was published and is serving; the closure corrections WC-PV01 to WC-PV05 are in source and certified on the disposable stack but **not yet published** (section 17). **W-C is not labelled fully closed** until the corrected build is published and its read-back is recorded (section 17.6). The build-time sentence "Not published" that stood here is superseded by section 17.
Earlier records are not rewritten: `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md` (W-A and W-B sections 7a to 7c) keeps its receipts. Where a W-B sentence is no longer true after W-C it is listed in section 14 as superseded, not deleted.

## 1. Identity of what was tested

| Item | Value |
| --- | --- |
| Base commit | `fe4ae7f8448eae2c42a63a77292beec5f98ab1f3` (HEAD at build time; the task plan was authored against `87f49b15`, which is an ancestor with the same W-A/W-B source) |
| Candidate | Working tree on top of the base commit, **not committed by this work**: 39 tracked files modified plus 12 new files (`client/src/components/intake/`, `client/src/pages/GetStartedTerminal.tsx`, `server/routes/public-inquiry.ts`, `server/routes/public-support.ts`, `server/services/public-statement-fields.ts`, `server/services/public-support-occurrence.ts`, `server/services/statement-chain-read-model.ts`, `shared/public-inquiry.ts`, `shared/statement-chain-state.ts`, `shared/statement-upload-limits.ts`, `scripts/certification/test-public-wc-intake.ts`, `scripts/certification/test-public-wc-intake-browser.ts`). The built artifact records HEAD (`fe4ae7f8`), not the dirty tree. |
| Toolchain | Node v22.23.4, npm 10.9.9 (project pins `npm@10.9.4`, Node `>=22.22.0 <23`; the contract's authoring host used Node 24 / npm 11) |
| Schema, migrations, journal, dependencies, lockfile | **Unchanged.** No schema or migration change (journal still 386 entries, last `0382_website_email_lifecycle`), no package or lock change, no startup DDL. |
| Settings and controls | No production setting written. `statement_auto_analysis_enabled` was not changed or enabled. Outbound pause, GHL controls, background selection and worker profile untouched. |
| Providers | No GHL, provider, paid, Gmail, appointment or real email call. All test transports denied (disposable database and Redis, fake transports, egress denied). |
| CSRF | `/api/public/` stays a blanket exempt prefix; no CSRF middleware change. |

## 2. Requirement crosswalk and LI-W evidence table

| Row | What the contract asked | Source result (this tree) | Route | Test | Unresolved input |
| --- | --- | --- | --- | --- | --- |
| LI-W02 / LB-FT-01, FT-02 | Hardware visual with eligibility and equipment terms next to the offer; no statement-first eligibility | Every primary, eligibility, card and final CTA starts the no-statement equipment inquiry; new offer section carries the approved equipment-terms disclosure beside the CTA; **equipment-options fallback** (section 7) | `/free-smart-terminal` | W-C browser suite, claims contract (960 assertions), shell contract, SSR parity | Approved equipment inventory and image rights (owner evidence) |
| LI-W04 / LB-FT-03 | Ad click keeps terminal intent through confirmation; no redundant quiz | `/get-started?offer=free-terminal` (and compatible `?terminal=yes`) opens the short terminal inquiry; frozen offer context on the occurrence; generic quiz unchanged without a mode | `/get-started` | W-C API cert, W-C browser suite | None for source; paid-traffic landing check belongs to the ads owner |
| LI-W05 / LB-SR-01 to SR-05 | Short hero then the real form; clear deliverable and fields; no savings guarantee | Hero then form; `#upload-form` and `#statement-review-form` are both in the server HTML and, after the WC-PV01 correction (section 17), both scroll to and focus the form below the fixed header on this lazily rendered page (the originally published build did not do this on a cold entry, and the original browser cert did not assert it); phone and industry optional end to end; Quick AI estimate removed; formats stated as PDF, JPG or PNG up to 10 MB everywhere | `/upload-statement` | W-C API cert (real multipart), W-C browser suite | Retention and deletion wording remains W-A owner evidence |
| LI-W07 | Same duration throughout; routing and receipt verified by owner | `/book` resolver, 302, `no-store` and 503 behavior preserved and regressed; neutral labels on pages in scope; no duration claim; no native booking write | `/book` | Existing booking suites; W-C browser suite checks first-party link | **Native booking receipt and routing need separately authorized marked-contact acceptance** (not done) |
| LI-W21 | Prospect versus current-merchant support; no sensitive statements by ordinary email; correct expectations | Support saves without any SMS or marketing acceptance; fake attachment picker removed; sensitive statements pointed to the protected statement form; no 4-hour, 1-hour or 24/7 promise on the page, React and server metadata, thank-you page or generated ticket comment; per-effect resumable executor | `/support`, `/thanks-support` | W-C API cert, W-C browser suite, SEO audit | Owner-approved support hours and response expectations |
| LI-W23 / LB-C-01 | A new merchant can start without a statement; secure application is the next stage | Contact `#inquiry` hosts the short general or new-business inquiry; the secure application link is the next stage; `MerchantApplication.tsx` untouched | `/about-contact#inquiry` | W-C API cert, W-C browser suite | None |
| WB-PV01 | Mobile Menu focus returns to the Menu button after dismissal | Public trigger ref, `aria-expanded`, `aria-controls`; Escape, close button and overlay return focus to the Menu button; link navigation focuses the destination page's own `<main>`; CRM dialogs and the route-change close untouched | all public pages | W-C browser suite (with negative control, section 10) | None |
| WC-09 | Receipt must survive the status check | Verified receipt is returned before intent is cleared; per-form storage keys; 404, 409 and failed reads never clear unresolved intent | public forms | W-C browser suite, API cert | None |
| WC-10 | Fingerprint covers semantics | Versioned semantic fingerprint with legacy replay (section 4) | statement upload | W-C API cert | None |
| WC-08 | Held analysis must never read as success | Read model derives held, manual-review, unavailable truth from durable state (section 9) | `/api/operator/statement-chain`, Lead Ops request detail | W-C API cert, browser suite | Setting stays off by design |

The external workbook was not available to this build; this table is the repository crosswalk, ready to reconcile. No remote sheet was updated.

## 3. Old and new request contracts

**Unchanged (generic).** `POST /api/public/get-started` without `mode` still follows the strict six-step generic schema (goal, vertical, old volume bands, needTerminal, interestedIn0Percent, first and last name, email, phone). Without a mode, the claim resolves to `get_started_form` exactly as before.

**New modes** on the same route. The claim middleware reads an allowlisted `mode` from the already-parsed body. Any other value resolves to the generic source and then fails the generic strict schema before any effect.

| Mode | Source | Fields (strict; unknown field rejected before mutation) |
| --- | --- | --- |
| `equipment_inquiry` | `website_form` / `equipment_inquiry` | first and last name, email, business name, business type (`Medical/Dental/Medspa`, `Automotive`, `Restaurant`, `Home Services`, `Retail`, `Other`), monthly card volume band, current terminal lease answer, optional phone, optional bounded note (1000 characters), optional `offer` route value, attribution, optional text permission (valid phone required) |
| `general_inquiry` | `website_form` / `general_inquiry` | name, email, business name, intent (stable code), optional phone, optional bounded note, attribution, optional text permission (valid phone required) |

Volume bands are stable semantic codes, not guessed dollar amounts: `not_processing_yet`, `under_5000` (0–4,999), `5000_24999`, `25000_99999`, `100000_plus`, `not_sure`. Edges 4,999, 5,000, 24,999, 25,000, 99,999 and 100,000 are proven; "not processing yet" and "not sure" are different answers and neither qualifies nor disqualifies.

**Offer intent is server-owned.** The offer id, version and intent resolve server-side from an allowlisted route value (no open redirect, no client-supplied purpose flag) and are frozen in `inbound_requests.attribution_refs` (schema `wc-inquiry-v1`). They are never stored as contact tags and never inferred later from mutable contact data. A client-forged offer, purpose or disclosure id is rejected.

**Statement upload** (`/api/public/statement-upload`, multipart). Every accepted text field is validated strictly and bounded **before** any claim, store or contact write; unknown multipart keys are rejected; a file is admitted only as PDF, JPEG or PNG by content sniffing, at most 10 MiB. Non-allowlisted failures now return stable error codes instead of `err.message`. Required: business name, your name, email. Optional: phone, industry, current provider, notes.

**Statement answers after acceptance.** Once the request, retained file and review task are durable, the remaining route bookkeeping (the timeline event and the upload audit row) is optional: a failure there is logged (error class only), the timeline failure leaves an audit record for operators, and the route still answers 202 with the accepted receipt. A catch-all after that point also answers with the accepted receipt rather than the failure code. Before this change a fault in either write returned `STATEMENT_UPLOAD_FAILED` for an upload that was already retained.

**Support** (`POST /api/public/support`). Own schema and own executor (section 8). `consentSms` is optional and cannot be true without a valid phone.

**Status read** (`GET /api/public/inbound-requests/:receipt/status`). Requires the receipt, the original Idempotency-Key and the same caller scope (IP-bound); every failure is a 404, so a 404 never proves nothing was saved. The client therefore never treats 404, 409 or a failed read as permission to clear or rotate an unresolved intent.

## 4. Source-policy and fingerprint-version decision

**Source policy.** `website_form|equipment_inquiry` and `website_form|general_inquiry` are added to the **current (v3) contract only**, as `sales_request` policies with the same internal sales effects and the same forbidden effects (promotional enrollment, proposal send) as the generic sales sources. They are not in the frozen v2 table (no v2 occurrence can exist for them) and are deliberately absent from `WEBSITE_LANE_SOURCE_PROGRAMS`, so a new mode gets no warm effect row, no requested-follow-up eligibility and no nurture or promotional enrollment merely because it shares the get-started route; warm admission refuses it with `SOURCE_NOT_IN_LANE`. Every existing v2/v3 source policy is untouched and a stored occurrence replays under the contract it was claimed under (proven in the API cert). Consumers keyed by source type were updated: the contact-writer valid-source set, receipt labels in the acknowledgement service, Lead Ops request labels, the public form payload allowlists, and the sales recovery source list. Support is intentionally **not** in the sales recovery list (it has its own executor, section 8).

**Fingerprint version.** New statement requests are claimed under a **plain 64-hex v2 semantic fingerprint**. The version label is hashed into the digest, so a v2 value can never equal a legacy value. The fingerprint covers normalized business name, contact name, email, phone digits, industry, current provider, the two checkbox answers, notes, text-permission answers, the authorized existing contact and deal target, and the file digest. It excludes observational metadata (UTM, landing page, click ids, referrer), so an incidental attribution change on a retry is the same request while a changed name, notes, consent, offer or file conflicts before any effect. `claimInboundRequest` accepts a list of legacy fingerprints: a stored occurrence created under an older build still replays instead of conflicting, and a new occurrence is always stored under v2.

**Implementation lesson recorded.** A `v2:`-prefixed value failed the existing `inbound_requests.request_fingerprint` CHECK (64 lowercase hex only). It was caught by the first real-handler run and fixed by hashing the version label into the digest rather than prefixing it; no constraint was changed.

## 5. Owned route inventory

| Surface | Path | Notes |
| --- | --- | --- |
| Pages | `/free-smart-terminal`, `/get-started` (with `?offer=free-terminal` and `?terminal=yes`), `/upload-statement` (anchors `#upload-form`, `#statement-review-form`), `/about-contact#inquiry`, `/support`, `/thanks-support` | All old URLs, query and hash targets preserved |
| Public API | `POST /api/public/get-started` (modes `equipment_inquiry`, `general_inquiry`; no mode = generic), `POST /api/public/support`, `POST /api/public/statement-upload`, `GET /api/public/inbound-requests/:receipt/status` | New handler modules: `server/routes/public-inquiry.ts`, `server/routes/public-support.ts` |
| Operator API | `GET /api/operator/statement-chain` (admin and manager), Lead Ops inbound request list and detail (extended with intent, business, lease, band, document access) | `/api/lead-ops/inbound-requests/*` role gates unchanged (admin/manager; recovery and resume unchanged) |
| Booking | `/book` | Preserved, not edited |
| Not touched | `MerchantApplication.tsx`, the unrelated AI rate-estimate endpoint, the founder portrait, CSRF middleware | |

## 6. Consent and marketing

No marketing opt-in, nurture or promotional enrollment exists on the new modes, on support or on the statement form. An absent or false checkbox grants nothing; text-message permission is available only with a valid phone and is recorded once through the existing permission authority; a known true disclosure records exactly once; support saves without any optional opt-in; no silent withdrawal.

## 7. Asset and fallback decision

Every entry in `client/src/lib/public-imagery.ts` still has provenance `unverified`, and a filename is not rights or accuracy proof. **No image was invented, generated or newly published.** `/free-smart-terminal` keeps the two existing product derivatives and shows an honest note beside them: "Models shown are examples of equipment options. Which model is available for your business is confirmed during review." The contract's safe equipment-options fallback is therefore in effect. The approved full-touchscreen hardware depiction (LB-A05) and the founder portrait (LB-A04) remain **owner evidence items**; adopting a verified image later is a content change, not a rework.

## 8. Per-effect retry ownership

| Effect | Owner | Identity / replay behavior |
| --- | --- | --- |
| Equipment and general inquiry (contact, deal, PEWC, notification, review item, task) | Existing sales occurrence executor (`public-sales-occurrence.ts`), recovery list now includes the two modes | One notification per occurrence under `inbound:<id>:sales-notification`; recovery claim is lease-fenced |
| Support (ticket, factual comment, notification) | New resumable executor (`public-support-occurrence.ts`), recovery claim limited to `support_form` | Ticket by request-derived command key; one factual comment checked under a ticket-level lock; one notification under `inbound:<id>:support-notification` that links to Inbound Operations (`/dashboard/lead-ops?tab=pipeline&ref=<REF>`) and carries **no typed contact or ticket target**; final acceptance last. A retry with the same key after a fault at any step returns the original receipt with exactly one ticket, one comment and one notification |
| Statement (store, queue handoff, notification, chain) | Existing statement occurrence path (retained repair, regressed not rebuilt) | Deferred handoff stays `review_required` with a stable code; 202 with the reference |
| Client | Per-form intent storage (`lb:public-intake:<form>`), including the statement form | The key is never auto-rotated after an ambiguous response, reload, or caller-scope change; a direct confirmed save clears intent; a status-check-confirmed save persists as `saved`. Only a refusal issued before the server claims anything (field validation, file required, size, type) releases the key. A server fault (`STATEMENT_UPLOAD_FAILED`), a key conflict (409), an unreadable body, a lost answer and a network failure all keep the key as unconfirmed. If the visitor then changes a detail or picks a different file while an earlier upload is unconfirmed, the page sends nothing, keeps the original key and offers "Start a new request"; only that action clears the intent. The same rule already governed the JSON forms. |

## 9. Staff handoff and operator truth

- Each mode and the statement route produce one request, one task or ticket with a deadline, an owner or management-review state and a correctly addressed notification. Public-occurrence notifications, support notifications included, carry no typed contact or ticket target and are visible to admin and manager only (the notification-authority code recognizes the event for those two roles). Every one of them links to the inbound review `/dashboard/lead-ops?tab=pipeline&ref=<REF>`, so an unclassified contact never hides a management alert. An earlier version of this record described support notifications as carrying a typed ticket link; that was wrong for the current `public-support.ts` and is corrected here.
- Lead Ops request details show the frozen intent, business, business type, lease answer and volume band, and give protected document access through `/api/documents/download/:id` **without a deal**; no deal is auto-created.
- Role evidence. Exercised at runtime (real local sign-in on the disposable stack): anonymous callers get 401 and agents get 403 on the Lead Ops request list and on the statement handoff view; admin and manager read the request rows, the protected-file link and the statement handoff list; admin and manager see the request notifications and agents do not; the browser suite repeats this for admin, manager and agent in a real browser (an agent sees no handoff panel). The protected file route (`/api/documents/download/:id`) is the existing admin/manager-only gate and is asserted from source, not re-exercised for every role. The original certs did not run merchant, partner or affiliate sessions as separate actors; the closure pass does (section 17.4): each is refused by the request list, the lookup by reference, the summary, the statement handoff view, resume and statement recovery (with a valid token, so the refusal is the role guard), and none sees the management notifications. Recovery and resume routes, their admin-only gating, and CSRF handling were not changed. A short reference never authorizes access (the status read needs the receipt, the original Idempotency-Key and the same caller scope).
- **Statement chain read model.** The earlier view filtered audit actions that are never written (`statement_chain_complete`, `statement_chain_partial_failure`), and held steps were recorded as `success:true`. The new read model (`server/services/statement-chain-read-model.ts`, `shared/statement-chain-state.ts`) derives held, manual-review and unavailable truth from durable state: the exact-`true` setting, the `statement_review` inbound effect state, request lifecycle and terminal reason, and command-result steps (the result payload now stores normalized steps). Held, skipped and handed-off never count as complete. `StatementChainPanel` renders held, manual review, unavailable and denied states with a Retry control and as-of text; an HTTP failure shows unavailable and never an empty "all clear". The panel is mounted on the authorized Lead Ops surface; it had been imported but never rendered on the Operator Dashboard.
- `getSystemSetting` string `"true"` quirk: the setting is read through the exact-`true` rule so a string never counts as enabled.

## 10. Verification (this tree, final build)

All commands run from the repository root. Browser suites require a fresh `npm run build` first; both browser runs below used the final build. These are the originally published build's numbers; the closure pass re-ran every row on the corrected tree and the current counts are in section 17.3.

| Check | Command | Result |
| --- | --- | --- |
| W-C API/handler cert (actual handlers, real multipart, disposable DB and Redis, fake transports) | `npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/certification/test-public-wc-intake.ts` | **PASS, 169 checks** |
| W-C browser acceptance (production build, disposable backend, customer and authenticated fixtures; 320/390/768/1024/1440, light and dark, keyboard, **native 200% browser zoom**, Back/Forward, reload, request to task to document, no-phone and double-submit) | `NODE_ENV=production npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/certification/test-public-wc-intake-browser.ts` | **PASS, 231 checks** (final build; run after the last source and script change) |
| Existing website intake handoff cert | `... --only scripts/certification/test-website-intake-handoff.ts` | PASS, 116 checks |
| Existing website intake handoff browser | `NODE_ENV=production ... --only scripts/certification/test-website-intake-handoff-browser.ts` | PASS, 140 checks (assertions coupled to moved code were updated, not loosened) |
| Public claims contract | `npx tsx scripts/test-public-claims-contract.ts` | PASS, 960 assertions, 93 negative controls |
| Static and contract suites | `test-cro05a-static` (21), `test-consent-unchecked-not-optout` (4), `test-public-route-validation` (13), `test-cro05a-nonpublic-static`, `test-stage3-c3-contracts` (211), `test-stage3-d-r2-contracts` (58), `test-stage4a-retired-pilot-routes` (8 groups), `test-public-shell-contract`, `test-sfp-ready-held-consumer-contract` | PASS |
| Regressions through the disposable runner | `test-inbound-acknowledgement`, `test-statement-upload-queue-capability`, `test-stage5-fresh-inbound`, `test-stage5-intake-recovery`, `test-stage3-b-intake`, `test-stage3-a-authority`, `test-merchant-outbox-handoff`, `smoke-role-guards` | PASS (1/1 each) |
| Suite manifest and roster | `npx tsx scripts/ci-suite-manifest.ts --check` | valid (261 mandatory suites classified; the two new suites are registered in the pre-deploy roster and the manifest) |
| API coverage | `npx tsx scripts/check-api-coverage.ts` | no new client endpoint without a server handler (882 client endpoints, 1,807 handlers) |
| SEO audit | `npx tsx scripts/seo-audit.ts` | PASSED (424 routes). It caught a 166-character `/support` description (limit 165) introduced by this work; shortened to 150 in both `shared/seo-routes.ts` and `Support.tsx` |
| Diff hygiene | `git diff --check` | clean |
| Production build | `npm run build` | succeeds |
| Editor diagnostics | language-server diagnostics on every changed source file | none |

**Negative controls.** The browser suite's Menu focus check was proved against a deliberately mutated build (Menu focus restoration removed): the "Menu then Escape: focus returns to the Menu button" check failed for the intended reason; the file was restored and the build repeated. The API cert holds negative controls for forged mode, offer and disclosure, unknown fields, wrong volume codes, altered fingerprint inputs (conflict before effects), consent-true without a phone, and replay after injected faults after the ticket, after the comment, after the notification and before final acceptance.

**Browser journeys covered** (no screenshots or customer data are committed; run output is under the git-ignored `generated-artifacts/`): the terminal short flow with exact heading, fields and bands; generic quiz preservation; statement form-first layout with both anchors; native file picker, remove and retry; optional phone and industry; consent unchecked by default; field and summary errors; busy, confirming, saved, deferred, unresolved and denied states; Contact inquiry; Support; staff request to task to protected document for admin, manager and agent; Back and Forward (the general inquiry shows the unresolved notice; Lead Ops `ref=` URLs restore); no second request after reload or "start another".

**Retry and key-retention coverage (statement form).** The browser suite proves, against the real server: a lost answer then a changed detail sends nothing, keeps the original key and creates no second request or stored file; the same for a different file; "Start a new request" clears the intent and the next submission is a second request under a new key; a failure answer for an upload the server saved keeps the key, is not worded as a validation problem, and the same key later finishes the one request with its original reference; a key-conflict answer keeps the key and a retry replays the one request. The API cert proves the 202-with-receipt answer, no failed lifecycle, an operator audit record and a single-request replay for a fault in each optional write after acceptance (audit write via a faulted storage call, timeline write via a database trigger that raises for a marked subject, removed afterward).

**Native 200% zoom.** A separate anonymous Chromium session starts with the persisted default zoom set to 200% (no window resize and no metrics emulation). The suite asserts a device pixel ratio of 2 and a 720 CSS px layout viewport, then, for `/free-smart-terminal`, the terminal inquiry, the contact inquiry, `/support` and `/upload-statement`: no horizontal page overflow, exactly one page heading, and the submit action reachable and not covered by the header, banner or assistant (hit test at its centre). Browser zoom narrower than 720 CSS px (for example 400%) was not run; 320 px is covered by the emulated width checks.

**Not covered by the suite.** Safari/WebKit and real devices (WebKitGTK cannot start in this environment; Chromium is not Safari).

## 11. Performance

Harness: `scripts/check-public-perf.ts`, production build in the isolated disposable preview (`start-stage3-c1-cloud-preview.ts --reuse-build`, synthetic data, providers denied), 390×844 at DPR 2, CPU ×4, 1.6 Mbps / 150 ms, cold cache, 5 runs per route, medians. Fixture lab timings, **not production field performance**. Candidate: the working tree described in section 1 built as `fe4ae7f8`. Baseline: `git archive` of `fe4ae7f8` in a throw-away directory outside the workspace (a separate throw-away Git repository, linked `node_modules`), built and served by the same harness on the same port, one after the other, never concurrently.

| Route | Candidate LCP | Baseline LCP | Candidate CLS | Baseline CLS | Transfer (both) | Images (both) | Budget (LCP 2.5 s, CLS 0.1) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/free-smart-terminal` | 1044 ms | 1008 ms | 0.045 | 0.0001 | 944 KB | 68 KB (5) | within |
| `/get-started?offer=free-terminal` | 980 ms | 884 ms | 0.0126 | 0.0003 | 891 KB | 16 KB (4) | within |
| `/upload-statement` | 980 ms | 1168 ms | 0.0105 | 0.0023 | 891 KB | 16 KB (4) | within |
| `/support` | **3020 ms** | **3084 ms** | 0.0012 | 0.0012 | 997 KB | 121 KB (4) | **over budget (LCP) in both builds** |
| `/about-contact` | 916 ms | 712 ms | 0.0001 | 0.0001 | 1027 KB | 16 KB (4) | within |

0 invalid samples in either matched run. The harness reports the same transfer and image totals for candidate and baseline on every route; its byte totals are coarse (the two builds' entry bundles differ by a few hundred bytes), so that is recorded as observed and is not used as proof of payload parity.

**Dispositions.**
- `/support` is over the LCP budget identically in the baseline (3084 ms) and the candidate (3020 ms); the miss is not task-caused and is not relabelled green. It is carried to the owner of that route's first-paint work (it is not part of W-C scope).
- Candidate CLS on `/free-smart-terminal` is 0.045 against 0.0001 at baseline (budget 0.1, so within budget). It is the one noticeable movement, probably the added hero copy and offer section; **the cause was not isolated**. Six later single-load probes with a layout-shift observer recorded no shift entries, but they were taken under degraded conditions (next paragraph) and are not a valid comparison.
- LCP moved by under 200 ms in either direction on the other routes, inside run-to-run noise for this harness.

**Later reruns were invalid for both builds.** After the matched pair, repeated runs on the same host produced pages that were not rendered within the 4 s settle (`page was not ready`), including a single throttled load of `/free-smart-terminal` on the **baseline** build served the same way (not rendered after 13 s). They are failed measurements, not passes, and are excluded. The matched pair above was taken first, one build after the other, with no other load on the host. `/free-smart-terminal` is server-rendered only for crawlers; the measured load is the hydrated page a visitor gets.

## 11a. Grep, census and clean-diff gates

Run on the candidate tree (HEAD `fe4ae7f8` plus the working tree). `git diff --check`: clean. `git diff --stat`: 39 tracked files changed (1,344 insertions, 1,622 deletions) plus 12 new files; the `.replit` file is byte-identical to the base (the isolated preview added a port mapping while it ran; it was removed and re-read afterward, and the final tree shows no `.replit` difference). Match counts are line counts from `rg -n`.

| Gate | Scope | Matches | Disposition |
| --- | --- | --- | --- |
| Public-term sweep (`month.to.month\|long.term\|termination\|48 hours\|48h\|business day\|never.*shar\|PCI\|certif\|guarantee`) | `client/src shared server/ssr server/ssrShared.ts` | 762 | Reviewed in the files W-C changed (Support, UploadStatement, FreeSmartTerminal, AboutContact, GetStarted, ThanksSupport, `ssr/pages.ts`, shared content): no retired equipment, contract, timing or data-handling assertion was added; the claims contract (960 assertions) is the enforcing gate. The remainder are in files W-C did not touch (W-A/W-B and long-tail pages) and are unchanged. |
| Retired numbers (`2\.6%\|0\.10\|0\.15\|55,000\|serves\|Video coming soon\|Above benchmark\|Reducible`) | `client/src shared server/ssr` | 189 | None in W-C-owned copy; matches are existing calculators, glossary and long-tail content outside W-C. |
| Shell and image components (`marketing-theme\|public-contract\|PublicThemeShell\|PublicImage\|ssrNavbar\|ssrFooter`) | `client/src server` | 155 | W-C adds no global CSS, shell token or new shell component; the shell contract suite passes. |
| Offer and statement identifiers (`offer=free-terminal\|statement_auto_analysis_enabled\|STATEMENT_AUTO_ANALYSIS_NOT_ENABLED\|statement-upload`) | `client/src server .replit` | 86 | `.replit` has no match. The setting is only read (exact `true`), never written. Old URLs are preserved. |
| Warm-lane identifiers (`WEBSITE_LANE_SOURCE_PROGRAMS\|requested_followup\|nurture\|emailMarketingOptIn`) | `client/src shared server/services server/routes` | 218 | `WEBSITE_LANE_SOURCE_PROGRAMS` is unchanged and does not list the two new sources (asserted by the API cert); no new nurture or opt-in path. |
| Navbar (`SheetTrigger\|mobileOpen\|onCloseAutoFocus\|button-mobile-menu\|aria-expanded\|aria-controls`) | `client/src/components/Navbar.tsx` | 9 | All reviewed; the public trigger carries the ref, `aria-expanded` and `aria-controls`. |
| Intake client (`checkIntakeStatus\|loadIntent\|clearIntent\|intentFor\|IntakeForm`) | `client/src/lib/public-intake.ts client/src/hooks/use-public-intake.ts` | 22 | All reviewed; the receipt is kept until the status read confirms it. |
| Anchors and offer routes (`statement-review-form\|upload-form\|offer=free-terminal\|terminal=yes`) | `client/src server shared` | 16 | All reviewed; both anchors and both query forms are preserved. |
| Support (`consentSms\|ackMessages\|within.*hours\|24/7\|support`) | `Support.tsx`, `server/routes/public.ts` | 26 | All reviewed; no response-time or 24/7 promise remains in the owned files. |
| Fingerprint and recovery (`computeRequestFingerprint\|requestFingerprint\|fingerprint\|recoverable\|inbound-support`) | public route, idempotency and sales occurrence modules | 46 | All reviewed; see section 4. |
| Chain panel (`AI analysis held\|data.state\|!res.ok\|Every.*upload\|Each upload fires`) | `StatementChainPanel.tsx`, `statement-upload-chain.ts` | 2 | Reviewed; the retired success wording no longer exists. |
| Formats (`any format\|PDF\|JPEG\|PNG\|STATEMENT_MAX_BYTES`) | shared, `statement-upload-file.ts`, `UploadStatement.tsx` | 10 | Reviewed; PDF, JPEG, PNG, 10 MiB. |

Retired response-time wording still present **outside** W-C ownership (listed, not changed): `client/src/pages/AssetPage.tsx` ("Support Available 24/7"), `client/src/components/HelpCenter.tsx` ("Instant answers 24/7"), `client/src/components/ChatWidget.tsx` (Liberty AI availability and human hours), `client/src/pages/AffiliateProgram.tsx` and `ThanksEstimate.tsx` (savings and timing lines), `client/src/pages/dashboard/SettingsIntegrations.tsx` and `MerchantPortal.tsx` (internal staff-facing text), `server/ssr/pages.ts` ("24 business hours" and a gift-card line on the free-analysis page), and internal AI knowledge text in `server/services/business-vault.ts`. These belong to W-D long-tail ownership.

Kill-line review: no change to GHL control or runtime, outbound pause, background selection, the consent writer's authority rules, package or lock files, CRM or global styles, CSRF middleware, `.replit`, the migration journal or any setting.

## 12. Baseline failures (reproduced at the base commit; not introduced by W-C)

The base commit was extracted with `git archive`, given a throw-away Git repository and linked `node_modules`, and each failing suite was re-run there.

| Suite | Failure | Reproduced at base |
| --- | --- | --- |
| `scripts/test-statement-acquisition.ts` | Two assertions ("Upload-chain GHL projection remains held with no projection request", "Upload-chain merchant confirmation is held without external delivery") expect step 7 `held` / `statementStatusProjectionRequested`; the chain already records `handed_off` with a handoff key | Yes (same two assertions fail) |
| `scripts/test-crm-operator-experience.ts` | `crm-operations.ts` missing an expected string | Yes |
| `scripts/test-task2056-crm-ui-contracts.ts` | `ContactBusinessReconciliationPanel` regex | Yes |
| `scripts/test-lead-ops-budget-removal.ts` | `AUTHORIZE PAID PILOT` regex | Yes |
| `scripts/test-consent-field-protection.ts` | `contact_identity_observations` foreign-key cleanup error on the shared development database | Yes |

Not run: `test-forms` (needs the GHL fail-fast server; outside the kill lines). Whole-project `tsc` was not run (kill line); changed files show no editor diagnostics. `scripts/check-public-shell-design.ts` against the Vite development server reports `/` with no h1 or main at the default 1200 ms settle; a 6 s settle shows h1 and main present on `/` at 1440 and 390 px. Home is not changed by W-C (it only shares the unchanged intake hook API), so this is development-server hydration timing, not a regression. Other `usePublicIntake` callers (contact bubble, Help Center, Home callback form, Estimate, Get Started) use the unchanged hook API.

## 13. Not verified (no claim)

- CSRF for signed-in public submits: `/api/public/` remains a blanket exempt prefix and the middleware is unchanged. The original certs had no signed-in public-submit case; the closure pass added isolated coverage (section 17.4) on the disposable stack. No signed-in public form was submitted to production, by design.
- The corrected build's deployed UI (the corrections are unpublished) and any real submission. The original build's `/api/health` and signed-in Lead Ops, task, notification and file-metadata read-back for one existing request are recorded in section 17.5.
- Receipt delivery (inbox arrival), native booking receipt and routing, GHL behavior, advertising and outbound activation: untouched and not exercised. The receipt capability and cutoffs were not read from production.
- Safari/WebKit, real iPhone or Android devices, field performance.
- Copy outside the owned scope that still contains response-time wording: Help Center, the chat widget and FAQ copy ("within a few hours" in places) belong to W-D long-tail ownership; listed here, not changed.

## 14. Superseded earlier statements (kept for history)

- W-B (section 7c and the ledger "W-B Public Shell and Hubs" section): "About and Contact server render with a stable `#inquiry` anchor, **no form**" and "`#inquiry` mount point" handoff. W-C adds the short inquiry form at `#inquiry`; the anchor, phone, email and booking links remain.
- W-A and W-B statements that `/free-smart-terminal` call-to-action paths lead to `/upload-statement?offer=free-terminal`, that the eligibility starts with a statement upload, and the shared claim text "any processor, any format": superseded by the no-statement equipment inquiry path and by "PDF, JPG or PNG up to 10 MB" everywhere (including the assistant knowledge in `server/services/business-vault.ts`).
- Any earlier statement that `/support` promises a response window (4 hours, 1 hour, 24/7): retired from the page, React and server metadata, thank-you page and the generated ticket comment.
- Earlier descriptions of `StatementChainPanel` as showing "all statement uploads completed successfully": replaced by the held-aware read model (section 9).

## 15. Concrete read-only release checklist (for after the owner's normal Publish)

1. Read `/api/health`; compare the served source commit and publish build identity to the tested candidate (for the corrections, the digest and base in section 17.1; a build containing only docs need not match).
2. Public pages at 390 and 1440 px: `/free-smart-terminal` (equipment-options note and terms beside the CTA; every primary CTA opens the short terminal inquiry), `/get-started?offer=free-terminal` (short inquiry, exact heading and bands) and `/get-started` without a query (generic six-step quiz), `/about-contact#inquiry` (form, application link), `/upload-statement` (form-first layout; both `#upload-form` and `#statement-review-form` reach and focus the form; PDF, JPG or PNG up to 10 MB; phone and industry optional), `/support` (no attachment picker, no SMS requirement, no response-time promise), `/book` (first-party redirect or the 503 page).
3. Server HTML check with a plain `curl` for the same routes (one h1, the same copy as the hydrated page, native anchors).
4. Menu: open and close with keyboard and tap; focus returns to the Menu button.
5. Signed-in readback with existing authorized sessions and GET requests only: Lead Ops request list and details, `/api/operator/statement-chain` (admin or manager), and the real correlated request, task or ticket, notification and protected-file state of any already-existing request. **If no authorized fresh submission exists, state that production end-to-end acceptance is pending; do not create a customer submission, resend receipts or recover historical commands to produce evidence.**
6. Read (do not change) the outbound pause, receipt capability and cutoff, incoming and outgoing GHL controls, the AI analysis switch, worker selection and relevant operation totals; compare to a fresh baseline, not old counts. State honestly anything that cannot be read.

## 16. Rollback

Revert the changed source files (section 1) to the tested prior release (`fe4ae7f8`) and redeploy. No schema, data, setting or dependency change is involved, so nothing is reversed in the database. **Never delete submissions, tasks, tickets, notifications, receipts or protected objects.** Known compatibility notes: (a) `equipment_inquiry` and `general_inquiry` occurrences created while W-C is live keep their stored source and frozen context; an older build does not know those sources, so staff can still see them in the database but the older request views and recovery would not label or resume them; do not run the old build's recovery over them; (b) occurrences stored with a v2 fingerprint will not replay under an older build's fingerprint comparison (the client's saved intent would conflict rather than replay); (c) rollback would restore the filename-only support attachment picker, the 4-hour promise and the statement-first terminal path.

## 17. Closure correction pass (2026-11-09 to 2026-11-10): WC-PV01 to WC-PV05

Source of the work: `attached_assets/Liberty-W-C-Post-Publish-Audit-2026-11-09_1794268754498.md`. W-C was already merged and live; this pass repairs the five audited defects and does not rebuild the intake system. Source, schema, migrations, dependencies, settings, the CSRF middleware and `.replit` are unchanged apart from the files listed in 17.1.

### 17.1 Identity

| Item | Value |
| --- | --- |
| Serving source (read from `/api/health` at audit time and again on 2026-11-10 during this pass) | `532a8b56015127ffb31ef9dd2d4bd1d0ddba7ac9`, built 2026-11-09T21:27:55.713Z, publish build `70e570f7-a89e-407c-8943-29a4752e057d` (unchanged between the two reads) |
| Base the corrections were made on | `63b9e6f7a2edacaff4b4dea7770d9ea472b31772`, the later "Published your App" checkpoint whose tree is identical to the serving commit |
| Candidate | Working tree on top of `63b9e6f7`: 15 tracked source and test files modified, 2 new source files, plus this record, the ledger, spec and roadmap sections and agent-memory notes. **No commit was created by this pass**: the checkpoint commit is made by the platform when the work closes and a commit cannot name itself. The tested tree is identified by the base above and the digest below. |
| Tested-tree digest | `2cd4d65cee8b5b3ecd7170c76d6506f98814f053bd75a78947f0bc19e7fa7aa5` = SHA-256 of `git diff HEAD --binary -- client server shared scripts` followed, for each untracked file in those roots in sorted order, by a line `== <path>` and the file's bytes (the two new files are `client/src/hooks/use-anchor-target.ts` and `shared/public-terminal-inquiry.ts`). Docs and memory are outside the candidate-identity inputs, so editing them did not require a rebuild. |
| Tested vs serving | Every suite below ran against the candidate tree after a fresh `npm run build`, **not** against the serving commit. The serving build does not contain these corrections. |
| Production, settings, providers | Read-only. No send, setting change, auto-analysis enablement, GHL write, new submission, historical-command recovery, reclassification, schema or dependency change. Tests used disposable databases and Redis, fake transports and denied egress. `statement_auto_analysis_enabled` stays off. |
| Whole-project TypeScript check | Not run (standing instruction); language-server diagnostics were read for every changed file and are clean. |

### 17.2 What each correction does and how it was proved

| Finding | Defect in the serving build | Correction | Failing before (at the base source, same tests) | Passing after |
| --- | --- | --- | --- | --- |
| WC-PV01 statement deep links | The page renders lazily, so a cold entry, reload or link to `#statement-review-form` did not end with the form under the fixed header and focused; `#upload-form` was not in the first HTML; the original browser cert never asserted either | Server HTML carries both targets and a focusable form heading (`h2#statement-form-heading`, `tabindex="-1"`). One shared helper (`client/src/hooks/use-anchor-target.ts`) aligns the region to its own computed scroll margin under the fixed header, focuses the heading, repeats briefly while lazy content settles and stops as soon as the visitor types or clicks. Native hash behavior and history are untouched | Browser suite, four anchor sections failed (cold entry and reload, links from other pages with Back and Forward, same-page links and both fragments, visitor keeps control). Live first HTML (read with `curl` on 2026-11-10) has `statement-review-form` only: no `upload-form`, no heading id, so the added first-HTML section fails against it too | Both fragments, at 1280 and 390 px: cold entry, reload, links from general inquiry, terminal inquiry and support, Back and Forward (one history entry added by a link, none by Forward), hero and closing links, switching fragments, and a visitor who has started typing keeps their field |
| WC-PV02 terminal-query copy parity | `/get-started?offer=free-terminal` returned the generic "Start Accepting Payments" page in the first HTML and became the terminal inquiry only after scripts ran | Heading, intro, title and description live in one dependency-free module (`shared/public-terminal-inquiry.ts`) read by the server renderer and the React page; the server recognizes `?offer=free-terminal` and `?terminal=yes` exactly as the client does and keeps the generic page for anything else (`?offer=unsupported`, `?terminal=no`) | API cert: the first-HTML behavior section failed on the heading and the contract section on the missing module. Live `curl` shows the generic H1. Browser suite: the hydrated-parity step could not even load the shared contract | First HTML and hydrated page agree on heading, intro, title, description and canonical for three query shapes; unsupported entrances keep the quiz; one h1 |
| WC-PV03 pending upload on reload | A reload during an upload lost the stored intent, so the page offered a fresh submission with a fresh key | A stored `pending` intent is restored as an unresolved request with the same key; changed details or file stay blocked until the visitor explicitly starts a new request; the key is never rotated | Browser suite: "Reload during an upload", the reload did not restore an unconfirmed notice | Reload mid-transfer restores the unconfirmed notice, the same key; a later retry finishes the single request; "Start a new request" is the only way to a new key |
| WC-PV04 occurrence-bound analysis | A deal's analysis status is overwritten by whichever upload last queued work, yet every upload sharing the deal was labelled with it, so an upload whose own step was held could read "Analysis completed" | `shared/statement-chain-state.ts` derives analysis only from the upload's own evidence: a held own step is held; a failed enqueue is "could not be queued"; the shared deal status counts only for the upload that last queued work; an overwritten earlier attempt, and a finished command with no recorded steps, read "Analysis result not recorded for this statement"; a document-bound completion audit row is the only direct completion proof. Inbound Operations and the handoff panel use the same states | API cert: five failing sections (pure derivation, historical command, occurrence-bound analysis, plus the two PV02 sections). Browser suite: a held step on a deal marked complete read "Analysis completed" | Every state in the cert, and the two surfaces' wording in the browser, with the deal status shared across several uploads |
| WC-PV05 control sizing | Fields were 36 to 44 px tall and actions varied by form | `.public-form-field` (48 px) and `.public-form-action` (52 px) in `client/src/styles/public-contract.css`, scoped to `.marketing-theme` and used by the terminal, general, support and statement forms; the action rule is doubled in specificity so the global narrow-viewport touch-target floor cannot shrink it. This is the agreed public-form design target, not a WCAG claim, and it does not touch CRM `Input` or `Button` | Browser suite: terminal inquiry at 320 px, fields measured 36 and 44 px | Every field and the choose-file control 48 px and the primary action 52 px, on all four forms at 320, 390, 768, 1024 and 1440 px, each reachable by a pointer and not covered, including short viewports (390x420, 320x380, 1024x460) |

Failing-before runs used the unmodified base source with the new tests: the API cert reported 169 checks passed and five failed sections; the browser suite reported eight failed sections (the four anchor sections, the hydrated terminal step, control sizing, reload during an upload, analysis wording). The first-HTML anchor section of the API cert was added after that API run, so its failing-before evidence is the live HTML above rather than a base run.

### 17.3 Final candidate results

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | succeeds (fresh, after the last script edit) |
| W-C API/handler cert | `npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/certification/test-public-wc-intake.ts` | **PASS, 294 checks** |
| W-C browser acceptance (Chromium) | `NODE_ENV=production ... --only scripts/certification/test-public-wc-intake-browser.ts` | **PASS, 404 checks** |
| Website intake handoff cert / browser | `... --only scripts/certification/test-website-intake-handoff.ts` and `...-browser.ts` | PASS, 116 / 140 checks |
| Public claims contract | `npx tsx scripts/test-public-claims-contract.ts` | PASS, 960 assertions, 93 negative controls |
| Static, shell and route suites (rerun after the last edit) | `test-public-shell-contract`, `test-cro05a-static`, `test-public-route-validation`, role-guard smoke through the disposable runner | PASS: 113 assertions and 21 negative controls, 21 checks, 13 checks, role guards 1/1 |
| Suite manifest | `npx tsx scripts/ci-suite-manifest.ts --check` | valid, 267 suites classified, 261 mandatory (no new suite file: the new cases extend the two existing W-C suites) |
| API coverage | `npx tsx scripts/check-api-coverage.ts` | 882 client endpoints against 1,807 handlers, no new gap |
| SEO audit | `npx tsx scripts/seo-audit.ts` | PASSED, 424 routes, 0 failed |
| Diff hygiene | `git diff --check`; `.replit`, `package.json`, `package-lock.json` | clean; unchanged |

### 17.4 Isolated coverage added (test wording corrected)

The original record said signed-in public submissions and merchant/partner actors were not exercised. The API cert now runs, on the disposable stack with the real session layer and the real CSRF middleware and no policy change, six signed-in actors (admin, manager, agent, merchant, partner, affiliate):

- Each submits a public support request with no CSRF token and with a valid one: accepted, labelled exactly like an anonymous one, one request, one ticket, one management notification, an exact replay returns the same receipt, a changed payload under the same key is a 409. A wrong token on the public form does not block it (the public prefix stays exempt).
- Negative control: for each actor, a non-public mutation without a token is 403 `csrf_missing`, with a wrong token 403 `csrf_mismatch`, and with a valid token passes the CSRF layer; with no session the same probe is not blocked by CSRF.
- Merchant, partner and affiliate sessions are refused (403) by the request list, the lookup by reference, the summary and the statement handoff, and by resume and statement recovery with a valid token; anonymous callers get 401.
- Management notifications are invisible to agent, merchant, partner and affiliate, and visible to admin (negative control). A session is never a read capability for another visitor's public status.

Corrected wording about support notifications: they carry no typed contact or ticket target and link to Inbound Operations (sections 8 and 9 above were corrected in place). The existing cert already asserted this; only the record was wrong. The protected-file download route is not mounted in these fixtures and remains asserted from source.

### 17.5 Read-only production walkthrough (2026-11-10, about 00:51 UTC)

- **Health and first HTML.** `/api/health` served the commit and publish build in 17.1. The public first HTML still shows the generic H1 for `/get-started?offer=free-terminal` and lacks `id="upload-form"` and the heading id on `/upload-statement`, which is the audited state: the corrections are not published.
- **Session.** One standard sign-in with the configured administrator account (credentials from the workspace secrets, not displayed) returned 200 as admin with no second factor requested, and two session reads, immediately and about three seconds later, both returned 200; every later request returned 200. That is an API-level session, not a browser navigation, so it does **not** reproduce or explain the audit's bounce to the login page when navigating to the request; that observation stays unresolved. The line confirming sign-out was not captured, so the session was left to expire normally.
- **Request `269B66AF`** (accepted 2026-11-07 20:21 UTC; one row from the reference lookup): source class sales request, website form, statement upload; lifecycle and assignment `review_required`, unassigned (assignment effect held, `UNASSIGNED_POLICY_MISSING`); review due 2026-11-11 17:00 UTC; receipt accepted and the acknowledgment effect already sent; statement block available, analysis `held`, automatic analysis off, protected download link to document 1077. The chain list shows it as `unrecorded` with no recorded steps. It has no deal, so under the corrected rule its analysis wording stays "held"; **no production row exercises the deal-bound wording**, which is proved only by the disposable cert.
- **Correlated task.** Task 7072, pending, normal priority, due 2026-11-11 17:00, unassigned, produced by the inbound request for the request's own contact, linked to the request by its work link; no ticket.
- **Management notification.** Notification 5002, an unread internal alert with no individual recipient, bound to the request and to command key `...:sales-notification`; created 2026-11-08 13:40 UTC; audience admin and manager; link `/dashboard/lead-ops?tab=pipeline&ref=269B66AF`; the stored processing state is `queued` (a creation-time value). It is in the signed-in administrator's list.
- **Protected-file metadata** (production read replica, metadata only; the file route was not requested and nothing was downloaded): document 1077, type merchant statement, category "Processing Statement", internal access scope, status `pending`, created 2026-11-08 13:40 UTC, a storage key present, belonging to the request's contact. Its `file_size` and `mime_type` are empty; this was observed and not investigated.
- **Handoff list and today view.** The statement handoff returned four occurrences, three needing attention (`0A900C02` queue unavailable, `237D0831` and `7BF25C5D` upload failed), automatic analysis off. The summary matched the audit: 7 received in 7 days, 5 needing review, 3 statement items needing attention, none due today or overdue.

### 17.6 Closure status and evidence limits

W-C is **not** labelled fully closed. Open items:

1. The five corrections were later published as `87159c74cb4ca9bfb6ed88fc263e44fd09600dad` (read from `/api/health` on 2026-11-10, about 03:22 UTC). Read-only `curl` of the first HTML on that date confirmed the terminal heading for `/get-started?offer=free-terminal`, the generic heading for `/get-started`, and `id="upload-form"`, `id="statement-review-form"` and `id="statement-form-heading"` on `/upload-statement`; the real-browser, analysis-wording and control-height read-backs below were not repeated in the section 18 pass. As originally written, after the owner's Publish: read `/api/health` and compare the commit with the candidate; `curl` the first HTML of `/get-started?offer=free-terminal` (terminal heading) and `/upload-statement` (both targets and the heading id); open both statement fragments cold and from the other pages in a real browser at 390 and 1440 px; read the new analysis wording for `269B66AF` and the other occurrences through Inbound Operations and the handoff panel; measure control heights on the four forms.
2. The audit's browser navigation bounce for the request reference is unreproduced and unexplained.
3. No production statement row has a deal, so the occurrence-bound wording is not observable on live data.
4. Not exercised: WebKit and real devices (Chromium only); the upload-hold fault simulates an in-flight transfer by never sending the bytes rather than aborting a real mid-transfer connection; production receipt delivery; native booking.
5. Superseded by section 18: the confirmed direct-save behavior (reload showing a blank form, an identical resubmission minting a new key) is repaired there, and the remaining WC-PV04 completion fallback is closed there. The statement in 17.2 that the shared deal status counts for the upload that last queued work is also superseded by section 18.

### 17.7 Rollback

Revert the 15 modified files and remove the two new files (section 17.1) to return to the serving commit's content. No schema, data, setting or dependency is involved. Never delete submissions, tasks, tickets, notifications, receipts or protected objects.

## 18. Second closure correction (2026-11-10): WC-PV04 completion fallback and confirmed-save restoration

Source of the work: `attached_assets/Liberty-W-C-Closure-Verification-2026-11-09_1794278816886.md`. WC-PV01, WC-PV02, WC-PV03 and WC-PV05 are kept as repaired in section 17 and were re-run (nothing in them was edited). Only two items were finished: (A) the remaining WC-PV04 blueprint-versus-statement completion fallback, and (B) the confirmed JSON-intake key and receipt restoration with an explicit new-request choice. #2150 and W-D are separate and untouched.

### 18.1 Identity

| Item | Value |
| --- | --- |
| Serving source (read from `/api/health` on 2026-11-10, about 03:22 UTC) | `87159c74cb4ca9bfb6ed88fc263e44fd09600dad`, built 2026-11-10T01:57:58.106Z, publish build `612af1d2-8f51-4dc9-b97e-c3e294d51c2d`. This is the build that carried section 17 and did **not** carry section 18; it was replaced by the published identity below |
| Base the work was made on | GitHub `main` / `HEAD` `b5c01724791bd403b8285d6054e13bef73e0233d`, tree `b84351eb32eb911cb7986599c3ce16fe79ba5633` |
| Candidate | Working tree on top of the base, **not committed by this work** (the platform checkpoint makes the commit when the work closes, and a commit cannot name itself): 18 tracked source and test files modified and 1 new source file (`client/src/components/intake/SavedIntakeConfirmation.tsx`), plus this record, the ledger, spec and roadmap sections and an agent-memory note. No schema, migration, dependency, lockfile, `.replit`, setting or CSRF change |
| Tested-tree digest | `59791cd576fa5315a3c0d38909b6d2b10903536a6ccdfecc3a1428666dc1a607` = SHA-256 of `git diff HEAD --binary -- client server shared scripts` followed, for each untracked file in those roots in sorted order, by a line `== <path>` and the file's bytes. It replaces the section 17.1 digest (`2cd4d65c...`), which described the earlier candidate. It was recomputed after the last suite run and did not change |
| Published identity | **Published.** `/api/health` (read after the owner's Publish, 2026-11-10) returns `sha` `8dd9e26ca0b03a7f76230847ddba98d4510325dc`, built 2026-11-10T03:59:21.987Z, publish build `f1a030be-5ae4-419a-8413-5bc77efaf32d`. That commit is the platform checkpoint "Update intake forms and documentation with improved public inquiry handling" (2026-11-10T03:35:37Z) made from the candidate; the later "Published your App" commit `8198ab1ec2a0aaa506999b462cfa3d76c9dae3ae` (2026-11-10T03:59:50Z) has an identical tree (`f85cac8aef4bab1550cbd716d99300a54013cd01`). **Candidate = published, proved:** `git diff b5c01724... 8dd9e26c... --diff-filter=M` over `client server shared scripts` plus the added file's bytes, in the digest rule above, reproduces `59791cd5...1a607` exactly, and the same range lists exactly the 19 files named above (18 modified, 1 added). The only other changes in the range are this record, the ledger, spec and roadmap sections and two agent-memory files |
| Tested vs serving | Every suite below ran against the candidate tree after a fresh `npm run build`. At the time they ran the serving commit was `87159c74`; the candidate has since been published and its tree is the one now serving (see Published identity) |
| Production, providers | Read-only. No live submission, provider call, analysis enablement (`statement_auto_analysis_enabled` stays off), send, GHL or booking write, historical recovery, reclassification, schema or dependency change. Tests used disposable databases and Redis, loopback fake transports and denied egress |
| Whole-project TypeScript check | Not run (standing instruction); language-server diagnostics were read for every changed file and are clean |

### 18.2 Repair A: WC-PV04 blueprint-versus-statement completion fallback

**Defect left after section 17.** The deal's analysis status is set to `complete` when the deal **blueprint** finishes, before the structured statement extraction runs, and an extraction failure does not revert it. Section 17 stopped the status from completing uploads that did not own it, but the upload that last queued work still read "Analysis completed" from it. So a structured-analysis failure after blueprint completion still showed as completed, and a retry, a second upload or an out-of-order completion could not be told apart.

**Rule now.** Blueprint or deal completion never means this statement's analysis completed. Only an analyzer result record that names this upload's document does:

- `statement_analysis_complete` audit rows carry the analysed document id (already true) and mark that upload completed;
- `statement_analysis_failed` rows now also carry the document id (the analyzer's own failure rows and the worker's catch row; the worker learns the id from the error the analyzer throws, `analysisErrorDocumentId`) and mark that upload failed, even though the deal status stays `complete`;
- the newest row per deal and document decides, so a retry that succeeds after a failure is completed and a later failure after a success is failed; the order of two uploads' completions on one deal does not matter because each reads only its own document's rows;
- a failure row with no document (written before documents were named, or a deal-level fault) is not attributable to any upload and is not counted;
- with no own record, a queued upload reads "Analysis result not recorded for this statement" whoever owns the deal status; held, failed-to-queue and still-pending-or-processing wording is unchanged.

No stored row is rewritten and no historical row is reclassified. Existing completions, which already named their document, keep reading as completed.

Files: `shared/statement-chain-state.ts` (the derivation), `server/services/statement-chain-read-model.ts` (reads document-bound outcomes), `server/services/statement-analyzer.ts` (names the document on failure rows and on the error), `server/services/queue-manager.ts` (the worker records the document on its failure row, awaits that write, and the blueprint job is exported for the cert).

**Observed and intentionally unchanged** (outside the stated scope): `analyzeStatement` returns normally after recording a failure, so the worker still runs its post-analysis step; the analyzer builds its OpenAI client without an explicit base URL; the blueprint generator swallows errors and the worker still marks the deal `complete`. None of these can now make a statement read completed, because only a document-bound result record does.

**Proof.** The API cert section "WC-PV04 worker-bound analysis" runs the real worker job (`runStatementBlueprintJob`) against the disposable database with a fake OpenAI endpoint on loopback that answers failure and success on demand. It covers: structured-analysis failure after blueprint completion in four ways (provider error, unparseable output, empty output, schema failure) with the deal left `complete` and the failure row naming the document, a blueprint that produced nothing, a thrown analyzer fault recorded once by the worker with its document, the newest outcome per document deciding (failed, completed after a retry, failed again), and two uploads on one deal where the older upload's job finishes late. A failure row with no document id is not attributed to any upload by the read-model query (it selects the document id from the row's details and ignores rows without one); that rule is read from source and has no dedicated certified case. The pure-derivation section covers each state. The browser suite word-checks both staff views for six cases: held, failed to queue, queued on a blueprint-complete deal with no record ("not recorded"), no recorded steps, queued with a result record for the document ("Analysis completed"), and a later document-bound failure ("Analysis failed").

### 18.3 Repair B: confirmed JSON-intake restoration and explicit new request

**Defect.** After a confirmed direct save, `submitPublicIntake()` cleared the stored intent. A reload showed a blank form with no reference, and an identical resubmission minted a new idempotency key and a duplicate occurrence.

**Behavior now.** A confirmed save is retained in the tab's session storage as identity and state only: key, request fingerprint (a hash), receipt, whether the server reported it pending review, and two once-per-receipt claims (`tracked`, `thankYouTracked`). It never holds a name, email, phone, note, business name or file bytes. A reload, Back or Forward restores the original reference and the truthful pending-review wording (no response-time promise) instead of an empty form, and sends nothing. The same details replay under the same key. A failed replay of a saved request stays confirmed; a lost answer on a replay keeps the same key. Only the visitor's explicit **Send another** (`clearIntent`) starts a new request, and then the same details create exactly one new occurrence under a new key and a new reference. Unconfirmed states keep section 17's rules: the key is never rotated after an ambiguous answer, and changed details wait for an explicit new request.

**Conversions.** Conversion events fire once per receipt: the submit path marks the receipt claimed and returns `fresh`, and callers record the conversion only when it is fresh; the support and estimate thank-you pages claim their page view once per saved receipt (`claimThankYouView`). A restore, a replay and a reload record nothing again. A request confirmed only through the status read still records no conversion (unchanged). With storage unavailable or no retained save, a thank-you page counts as it did before.

**Callers.** One shared confirmation component (`SavedIntakeConfirmation`, no heading element, 8-character reference) serves Estimate, Get Started, Support and the callback widgets; the general and equipment inquiry forms use their existing confirmations with the same restore and start-another behavior; the home callback form restores its full receipt. Closing the floating callback bubble counts as acknowledging and clears its saved request. The help-center callback panel gets the same behavior. `MerchantApplication.tsx` is untouched.

Files: `client/src/lib/public-intake.ts`, `client/src/hooks/use-public-intake.ts`, `client/src/components/intake/SavedIntakeConfirmation.tsx` (new), `GeneralInquiryForm.tsx`, `TerminalInquiryForm.tsx`, `client/src/pages/Support.tsx`, `Estimate.tsx`, `GetStarted.tsx`, `ThanksSupport.tsx`, `ThanksEstimate.tsx`, `client/src/components/home/HomeCallbackForm.tsx`, `ContactBubble.tsx`, `HelpCenter.tsx`.

### 18.4 Isolated coverage added

- **API/handler cert, section "WC-RESTORE confirmed-save restoration".** Imports the real client library under Node with an in-memory session store, a cookie shim and a wrapped `fetch` that records every POST path and idempotency key (and a mode that performs the real request, then throws, to model a lost answer), against the real handlers. For each of equipment inquiry, general inquiry, support, home callback, bubble callback and help-panel callback (each as a separate caller address, because the public lead limiter allows ten submissions per address): the first save is fresh and retained with key, receipt, claim and review state; the stored record holds identity and state only; an identical replay returns the same key and receipt, is not fresh and leaves one occurrence; a lost answer on replay stays saved and claimed; the status read keeps the same identity; clearing and resubmitting the same details gives exactly one new occurrence, a new key, a new receipt and a fresh conversion; a lost answer on that new request finishes under the same key with one fresh conversion and none afterwards. The support thank-you claim is checked once per receipt.
- **Browser suite (Chromium, production build), step group "Confirmed save".** A recorder replaces `window.gtag` before the app loads (no analytics provider is contacted) and counts every public POST the tab sends. Real flows: general inquiry, equipment inquiry, support (including its `/thanks-support` page) and the home callback each save, reload, navigate away and use Back, Forward and Back again, then press Send another and send the same details. Asserted from outside the page code: the shown reference equals the stored occurrence's reference, the POST and conversion counts, the stored key, one notification per occurrence, stored tickets, and that the browser's stored record has no personal details. Estimate and Get Started restore a placed confirmed save with its reference and pending-review wording, send nothing, and leave only through Send another (the seeded record is a stand-in for a save made earlier in the tab; those two forms' own submission paths share the library flow proved by the API cert).
- Because the production-mode browser reaches the app from one loopback address and the lead limiter allows ten submissions per address, the suite's fixture app takes a named caller address per step (a test-fixture middleware only; no product behavior changes).

### 18.5 Failing-before and passing-after

Failing before: the repaired client and server sources were replaced by the base versions (`git show HEAD:<path>`; the repaired files were saved to a tarball and restored with their checksums verified), rebuilt, and the **same new tests** were run.

| Run | Before (base sources) | After (candidate) |
| --- | --- | --- |
| API cert, confirmed save | failed at its first check for the first form: the confirmed save is not reported as fresh and retained (the section stops at its first failed check) | 415 checks passed |
| API cert, WC-PV04 worker-bound analysis | earlier run with the base analysis files restored: three failed sections (a negative control run before the client work; the failing section names were not retained in this record) | passes (included in the 415) |
| Browser suite | six failed steps: general inquiry, equipment inquiry, support and home callback (the confirmed save was not retained: no stored key to read after the save), the Estimate / Get Started restore (the saved view was not restored), and the analysis wording (a queued upload on a blueprint-complete deal read "Analysis completed") | 440 checks passed |

### 18.6 Final candidate results

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | succeeds (fresh, after the last source and script edit) |
| W-C API/handler cert | `npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only scripts/certification/test-public-wc-intake.ts` | **PASS, 415 checks** |
| W-C browser acceptance (Chromium) | `NODE_ENV=production ... --only scripts/certification/test-public-wc-intake-browser.ts` | **PASS, 440 checks** |
| Website intake handoff cert / browser | `... --only scripts/certification/test-website-intake-handoff.ts` and `...-browser.ts` | PASS, 116 / 140 checks |
| Public claims contract | `npx tsx scripts/test-public-claims-contract.ts` | PASS, 960 assertions, 93 negative controls |
| Shell, CRO-05A static, route validation, role guards | `test-public-shell-contract`, `test-cro05a-static`, `test-public-route-validation`, role-guard smoke through the disposable runner | PASS: 113 assertions and 21 negative controls, 21 checks, 13 checks, 1/1 |
| Suite manifest | `npx tsx scripts/ci-suite-manifest.ts --check` | valid, 261 mandatory suites classified (no new suite file: the cases extend the two existing W-C suites) |
| API coverage | `npx tsx scripts/check-api-coverage.ts` | 882 client endpoints against 1,807 handlers, no new gap |
| SEO audit | `npx tsx scripts/seo-audit.ts` | PASSED |
| Diff hygiene | `git diff --check`; `.replit`, `package.json`, `package-lock.json` | clean; unchanged |

### 18.7 Evidence limits and status

- **Published read-back (2026-11-10, read-only, public requests only).** (1) `/api/health` identity as in 18.1. (2) The live entry document references exactly the same two entry assets as the fresh local production build of the tested tree, and the three lazy chunks that carry the confirmed-save wording (`AboutContact-CZ8SBswE.js`, `GetStarted-Crd8_gZs.js`, `Home-vVJAWoVe.js`) are served and contain the new text ("follow-up is pending review"). (3) First HTML: `/get-started?offer=free-terminal` has the terminal H1; `/get-started` keeps the generic H1; `/upload-statement` has `id="upload-form"`, `id="statement-review-form"` and `id="statement-form-heading"`. The audited defects are repaired in the published build, proved by the 18.6 suites on the identical tree.
- **Not observed live (open evidence limits, not code defects):** the restore behavior after a real submission (this pass is not authorized to submit); the live real-browser fragment, focus and control-height checks at 390 and 1440 px; the staff analysis wording for `269B66AF` and the other occurrences through Inbound Operations and the handoff panel (no production row has a deal, so the deal-bound wording is observable only on the disposable stack, and a held step reads "held" as before); the audit's browser bounce to the login page stays unreproduced. No signed-in session was opened for this read-back. W-C is therefore published and verified at the level above, and is not described as fully observed in production until those items are checked.
- Not exercised: WebKit and real devices (Chromium only); the lost answer is simulated in the page by performing the real request and then failing the response, not by cutting a real connection; production receipt delivery; native booking. Real analysis with a live provider was not run and cannot be (no provider call, no enablement).
- Not browser-tested: the help-center callback panel (signed-in dashboard only) and the floating callback bubble (the component exists but is not mounted on any page); both are covered through their own storage slots in the API cert and by source.
- A request confirmed only through the status read records no conversion (unchanged); the retry path records exactly one.
- The earlier unresolved observation (the audit's browser bounce to the login page for a request reference) and #2150 / W-D items are unchanged and separate.

### 18.8 Rollback

Revert the 18 modified files and remove `client/src/components/intake/SavedIntakeConfirmation.tsx` to return to `b5c01724` content. No schema, data, setting or dependency is involved. Rows written by the analyzer with a document id on failure records stay readable by the older build (extra detail key). Never delete submissions, tasks, tickets, notifications, receipts or protected objects.
