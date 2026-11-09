# Liberty W-C Forms and CRM Handoff — Intake and Handoff Record

Date: 2026-11-09
Scope: LI-W02, LI-W04, LI-W05, LI-W07, LI-W21, LI-W23; LB-FT-01 to LB-FT-03, LB-SR-01 to LB-SR-05, LB-C-01 (intake behavior); WB-PV01 (mobile Menu focus) carried forward as checkpoint C0.
Governing contract: `attached_assets/Liberty-W-C-Forms-and-CRM-Handoff_1794235783150.md` (verbatim copy in `.local/tasks/w-c-forms-and-crm-handoff.md`).
Status: source and disposable-fixture work complete; Chromium browser acceptance complete. **Not published.** The owner's Publish has not happened, so no deployed-UI read-back exists (section 12).
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
| LI-W05 / LB-SR-01 to SR-05 | Short hero then the real form; clear deliverable and fields; no savings guarantee | Hero then form; `#upload-form` and `#statement-review-form` both reach and focus the form below the fixed header; phone and industry optional end to end; Quick AI estimate removed; formats stated as PDF, JPG or PNG up to 10 MB everywhere | `/upload-statement` | W-C API cert (real multipart), W-C browser suite | Retention and deletion wording remains W-A owner evidence |
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
| Support (ticket, factual comment, notification) | New resumable executor (`public-support-occurrence.ts`), recovery claim limited to `support_form` | Ticket by request-derived command key; one factual comment checked under a ticket-level lock; one notification under `inbound:<id>:support-notification` with a typed ticket target; final acceptance last. A retry with the same key after a fault at any step returns the original receipt with exactly one ticket, one comment and one notification |
| Statement (store, queue handoff, notification, chain) | Existing statement occurrence path (retained repair, regressed not rebuilt) | Deferred handoff stays `review_required` with a stable code; 202 with the reference |
| Client | Per-form intent storage (`lb:public-intake:<form>`), including the statement form | The key is never auto-rotated after an ambiguous response, reload, or caller-scope change; a direct confirmed save clears intent; a status-check-confirmed save persists as `saved`. Only a refusal issued before the server claims anything (field validation, file required, size, type) releases the key. A server fault (`STATEMENT_UPLOAD_FAILED`), a key conflict (409), an unreadable body, a lost answer and a network failure all keep the key as unconfirmed. If the visitor then changes a detail or picks a different file while an earlier upload is unconfirmed, the page sends nothing, keeps the original key and offers "Start a new request"; only that action clears the intent. The same rule already governed the JSON forms. |

## 9. Staff handoff and operator truth

- Each mode and the statement route produce one request, one task or ticket with a deadline, an owner or management-review state and a correctly addressed notification. Public-occurrence notifications carry no typed targets and are visible to admin and manager only; support notifications carry the typed ticket link. Unclassified-contact notifications link to the inbound review `/dashboard/lead-ops?tab=pipeline&ref=<REF>`.
- Lead Ops request details show the frozen intent, business, business type, lease answer and volume band, and give protected document access through `/api/documents/download/:id` **without a deal**; no deal is auto-created.
- Role evidence. Exercised at runtime (real local sign-in on the disposable stack): anonymous callers get 401 and agents get 403 on the Lead Ops request list and on the statement handoff view; admin and manager read the request rows, the protected-file link and the statement handoff list; admin and manager see the request notifications and agents do not; the browser suite repeats this for admin, manager and agent in a real browser (an agent sees no handoff panel). The protected file route (`/api/documents/download/:id`) is the existing admin/manager-only gate and is asserted from source, not re-exercised for every role. Merchant and partner fixtures were not run as separate actors in the new certs; they are refused by the same admin/manager gates (the existing role-guard smoke passed), so no claim is made beyond that. Recovery and resume routes, their admin-only gating, and CSRF handling were not changed and not re-certified in W-C. A short reference never authorizes access (the status read needs the receipt, the original Idempotency-Key and the same caller scope).
- **Statement chain read model.** The earlier view filtered audit actions that are never written (`statement_chain_complete`, `statement_chain_partial_failure`), and held steps were recorded as `success:true`. The new read model (`server/services/statement-chain-read-model.ts`, `shared/statement-chain-state.ts`) derives held, manual-review and unavailable truth from durable state: the exact-`true` setting, the `statement_review` inbound effect state, request lifecycle and terminal reason, and command-result steps (the result payload now stores normalized steps). Held, skipped and handed-off never count as complete. `StatementChainPanel` renders held, manual review, unavailable and denied states with a Retry control and as-of text; an HTTP failure shows unavailable and never an empty "all clear". The panel is mounted on the authorized Lead Ops surface; it had been imported but never rendered on the Operator Dashboard.
- `getSystemSetting` string `"true"` quirk: the setting is read through the exact-`true` rule so a string never counts as enabled.

## 10. Verification (this tree, final build)

All commands run from the repository root. Browser suites require a fresh `npm run build` first; both browser runs below used the final build.

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

- CSRF for signed-in public submits: `/api/public/` remains a blanket exempt prefix and the middleware is unchanged; no new case that submits a public form with a signed-in session and a CSRF token was added.
- Deployed UI (owner Publish pending), production `/api/health`, signed-in production CRM and any real submission.
- Receipt delivery (inbox arrival), native booking receipt and routing, GHL behavior, advertising and outbound activation: untouched and not exercised. The receipt capability and cutoffs were not read from production.
- Safari/WebKit, real iPhone or Android devices, field performance.
- Copy outside the owned scope that still contains response-time wording: Help Center, the chat widget and FAQ copy ("within a few hours" in places) belong to W-D long-tail ownership; listed here, not changed.

## 14. Superseded earlier statements (kept for history)

- W-B (section 7c and the ledger "W-B Public Shell and Hubs" section): "About and Contact server render with a stable `#inquiry` anchor, **no form**" and "`#inquiry` mount point" handoff. W-C adds the short inquiry form at `#inquiry`; the anchor, phone, email and booking links remain.
- W-A and W-B statements that `/free-smart-terminal` call-to-action paths lead to `/upload-statement?offer=free-terminal`, that the eligibility starts with a statement upload, and the shared claim text "any processor, any format": superseded by the no-statement equipment inquiry path and by "PDF, JPG or PNG up to 10 MB" everywhere (including the assistant knowledge in `server/services/business-vault.ts`).
- Any earlier statement that `/support` promises a response window (4 hours, 1 hour, 24/7): retired from the page, React and server metadata, thank-you page and the generated ticket comment.
- Earlier descriptions of `StatementChainPanel` as showing "all statement uploads completed successfully": replaced by the held-aware read model (section 9).

## 15. Concrete read-only release checklist (for after the owner's normal Publish)

1. Read `/api/health`; compare the served source commit and publish build identity to the tested candidate (`fe4ae7f8` plus the working tree; a build containing only docs need not match).
2. Public pages at 390 and 1440 px: `/free-smart-terminal` (equipment-options note and terms beside the CTA; every primary CTA opens the short terminal inquiry), `/get-started?offer=free-terminal` (short inquiry, exact heading and bands) and `/get-started` without a query (generic six-step quiz), `/about-contact#inquiry` (form, application link), `/upload-statement` (form-first layout; both `#upload-form` and `#statement-review-form` reach and focus the form; PDF, JPG or PNG up to 10 MB; phone and industry optional), `/support` (no attachment picker, no SMS requirement, no response-time promise), `/book` (first-party redirect or the 503 page).
3. Server HTML check with a plain `curl` for the same routes (one h1, the same copy as the hydrated page, native anchors).
4. Menu: open and close with keyboard and tap; focus returns to the Menu button.
5. Signed-in readback with existing authorized sessions and GET requests only: Lead Ops request list and details, `/api/operator/statement-chain` (admin or manager), and the real correlated request, task or ticket, notification and protected-file state of any already-existing request. **If no authorized fresh submission exists, state that production end-to-end acceptance is pending; do not create a customer submission, resend receipts or recover historical commands to produce evidence.**
6. Read (do not change) the outbound pause, receipt capability and cutoff, incoming and outgoing GHL controls, the AI analysis switch, worker selection and relevant operation totals; compare to a fresh baseline, not old counts. State honestly anything that cannot be read.

## 16. Rollback

Revert the changed source files (section 1) to the tested prior release (`fe4ae7f8`) and redeploy. No schema, data, setting or dependency change is involved, so nothing is reversed in the database. **Never delete submissions, tasks, tickets, notifications, receipts or protected objects.** Known compatibility notes: (a) `equipment_inquiry` and `general_inquiry` occurrences created while W-C is live keep their stored source and frozen context; an older build does not know those sources, so staff can still see them in the database but the older request views and recovery would not label or resume them; do not run the old build's recovery over them; (b) occurrences stored with a v2 fingerprint will not replay under an older build's fingerprint comparison (the client's saved intent would conflict rather than replay); (c) rollback would restore the filename-only support attachment picker, the 4-hour promise and the statement-first terminal path.
