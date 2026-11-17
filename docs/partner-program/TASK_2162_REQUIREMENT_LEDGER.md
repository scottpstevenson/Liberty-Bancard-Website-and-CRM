# Task 2162 — Liberty Partner Platform Upgrade: requirement ledger, Fix Effectiveness Matrix and post-build repair record

Specs: the original build task `attached_assets/LIBERTY_PARTNERSHIPS_FINAL_MASTER_PREFLIGHT_BUILD_TASK_2026-11-_1794874324406.md` and the post-build audit and repair task `attached_assets/LIBERTY_TASK_2162_POST_BUILD_LIVE_AUDIT_AND_REPAIR_TASK_2026-11_1794895487055.md` (findings F01–F11).
The pre-build VFC table and first Fix Effectiveness Matrix are in `.local/tasks/liberty-partner-referral-sales-agent-upgrade.md`. This file is the current record: every row says what exists, which test or run proves it, and what was not proven.
Attribution rules are in `ATTRIBUTION_PRECEDENCE.md` (same folder).

Status words: **PASS** = built and proven by the named test or run. **PARTIAL** = built, but part of the required proof was not run. **NOT RUN** = not run. **OWNER** = needs an owner action, not engineering.
**Dating.** Sections A–E were written before publication and describe the tree as it stood then. Section F (2026-11-17, after Publish) records the actual identities, the production read-back, the closeout changes and the reruns on the closeout artifact; where F and an earlier row differ, F governs. Rows below that named a superseded fact were corrected in place and say so.

Every run below used disposable databases and Redis, an isolated preview of the compiled build, the offline dev app, or read-only requests to the production database. Nothing was emailed, texted or sent to a provider, outbound stayed paused, and no application was submitted to production. Browser results are Chromium only.

## Release identities (code, schema, publication and live acceptance are separate)

| Item | State |
|---|---|
| Live (published) commit | **`109b60b7`** serves production (`/api/health` read 2026-11-17 14:28 UTC: sha `109b60b7…`, built 2026-11-17T12:47:24Z, publish build id `e83f9ee0-45ff-4675-b090-94fde44bb3a2`). It contains the F01–F11 repair. The earlier live commit was `a6938255` |
| Repository HEAD | **`389d4169`** ("Published your App"), child of `109b60b7`; its git tree (`5850d0e1f6a0…`) is byte-identical to the tree of `109b60b7`, so the published source and main are the same source. Before the repair, HEAD was `49b5f39a` (the pre-repair baseline used for roster comparison) |
| This repair (F01–F11) | **Published** in `109b60b7` / `389d4169`. At the time sections A–E were written it was uncommitted; its new files include `server/ssr/partners.ts`, `server/routes/partner-pages.ts`, `shared/partner-page-seo.ts`, `shared/partner-page-media.ts`, `shared/partner-program-guide.ts`, `server/services/partner-review-events.ts`, `migrations/0385_partner_review_decisions_and_introduction_completion.sql`, the new test suites listed below and the 99 derivative image files (7 heroes and 4 body images, 3 widths, AVIF, WebP and JPEG). The closeout changes made after publication are separate: see section F |
| Schema | **Production does not have 0385 as of 2026-11-17 14:28 UTC (section F2).** Migration 0385 is additive (one new table, new columns on `partner_introductions`, two NOT VALID checks, one bounded checkpoint backfill). Applied and proven on disposable databases (migration suite). **Production, read-only check on 2026-11-17:** `partner_applications` and `partner_introductions` exist with their 0384 indexes (including the unique open-mailbox index) and hold 0 rows; `partner_review_events` and the 0385 columns do not exist yet; the migration journal's latest row is `1800000013301` and has no rows for 0382–0385 (the 0384 tables were created without a journal row). Publish is expected to create the new table, columns, indexes and both checks from the schema file, as it did for 0384 (those tables exist in production with no journal row). The one-time checkpoint backfill has nothing to update in production, which holds 0 introductions. Not done by me and not yet confirmed: after Publish, read production `information_schema` for `partner_review_events`, the twelve new `partner_introductions` columns and the two checks, because a past Publish started new code without its new columns |
| Referral percentage approval | Not recorded (owner decision). The public policy answer is `written_agreement`; no referral percentage is live and none was hardcoded |
| Outbound | Paused, unchanged |
| Controlled real email, signed-in production CRM check, real phones | Not done |

## A. Requirement ledger (LB-P01 – LB-P34)

| ID | Status | Evidence | Not proven / limit |
|---|---|---|---|
| LB-P01 baseline, schema head, collisions | PASS | Build base `70baaffd`; pre-repair HEAD `49b5f39a`; published `109b60b7` (tree identical to main `389d4169`). Journal head is now 0385 (idx 388); `check-migration-integrity` PASS earlier in this work; production state recorded above | No standalone report file; the original preflight lives in the plan file |
| LB-P02 route and offer census | PARTIAL | Pre-build and first post-build counts (search matches): applicant and credential writers 32/16; commission readers 119/34; public rate wording 125/52; analytics events 48/23; partner routes 276/62; canonical writers 70/29; send/enroll/cron calls in partner code 30/6; consent and password references 165/9; `getPartnerByEmail` callers 16. F09 reconciled the CRM guide, embed widget, invitation email and branded page (row F09) | The counts were not repeated after the F01–F11 repair; the line-by-line reading was done before the build. `/partner-login` still says "commission reports" (existing-account page, unchanged) |
| LB-P03 hub with two paths and correct CTAs | PASS | PAB-02/PAB-03: all six hub calls to action clicked with a real pointer, each lands on the right path with one h1 and keeps ref/UTM. Shell-design on the isolated preview: 7 partner routes x 6 widths x light/dark = 84 states, 0 findings. Computed visual checks: 42 states, 0 findings (row F10) | Chromium; disposable database |
| LB-P04 referral journey, direct entry | PASS | PAB-04/05: empty submit shows the error summary, moves focus, saves nothing; the filled form stores one pending application with no password, commission, login or marketing permission; the confirmation does not claim approval or pay. Direct load and HTTP submit also in role-guards | Disposable database and Chromium; no real production submission |
| LB-P05 sales-agent journey, direct entry | PASS | PAB-07: whole application by keyboard only (39 Tab stops, native select by arrow keys, Space on the permission box, Enter to submit), visible focus, no trap, focus moves to the confirmation; stored pending | Same limits |
| LB-P06 profession pages: approved terms, shared math | PASS | One shared page component and calculator for CPA/bookkeeper/insurance; `test-public-claims-contract` PASS (1023 assertions, 93 negative controls) after the last copy edits; no referral percentage in the pages or the raw HTML | |
| LB-P07 affiliate reconciled; existing accounts survive | PASS | `/api/affiliate/signup` retired (410). `smoke-role-guards` (PASS in this run): a legacy affiliate with a stored credential signs in and reads its own session; wrong password, inactive account and a pending applicant are refused. Lifecycle cert: credentialed legacy partner can still reset | Disposable fixtures, not production accounts |
| LB-P08 referral rate gated | PASS | Rate exists only as a server projection of an admin-approved policy version; anonymous policy answer is `written_agreement`; the six server-rendered pages carry no percentage (SSR suite negative controls); lifecycle cert covers the policy lifecycle | Referral 25% / strategic 30% are not approved |
| LB-P09 agent 50% qualified; no stacking | PASS | Shared copy states qualifying self-sourced full-cycle business only; the approval enrollment hook fails closed unless the application opted in | |
| LB-P10 historical terms preserved | PASS | Migration suite (154 checks): legacy partner rows byte-identical after the upgrade, historical rates 10/50/10/15, partial and replay cases. Payout and residual engines unchanged between `70baaffd` and the tree. Lifecycle: an existing partner mailbox is refused and its 10% is unchanged | Fixtures, not production data |
| LB-P11 public tokens, fonts, spacing | PASS | Shell-design 84 states, 0 findings; computed checks: h1 and every section heading (`public-h2`) in Source Serif 4, navy section inverse text contrast at least 11.3:1 at every width; textareas auto-height (min 8rem) | Chromium lab, not a human visual review |
| LB-P12 mobile/tablet/desktop | PARTIAL | 320, 375, 390, 768, 1024, 1440 on all seven routes: no horizontal overflow, no control outside the viewport or clipped by its card (checked on child rectangles, not just document width), decoded visible hero image in every state. Screenshots: hero and full page at 390, 768 and 1440 for all seven routes in `generated-artifacts/partner-visuals/` (not committed) | No human visual sign-off; no physical phones; no Safari/WebKit. `/partner-login` (unchanged since `70baaffd`) has no main/h1 and 5 tap targets under 44px at 390 |
| LB-P13 keyboard, screen reader, zoom, motion | PARTIAL | Keyboard-only application (PAB-07); error-summary focus and `aria-invalid` (PAB-04); native 200% zoom: no horizontal scrolling and an application submitted (PAB-09); reduced motion (PAB-08); review panels at 390 px keep 44px targets (PRB-08) | **No screen-reader run.** Chromium only |
| LB-P14 shared calculator | PASS | `test-partner-residual-calculator` 129/129; local layout (7/5 desktop grid, stacked phone, larger result amounts) checked in the visual run | |
| LB-P15 applications password-free and pending | PASS | Lifecycle cert; real HTTP submit stores a pending row with no password, no terms, no user, no session cookie (role-guards) | |
| LB-P16 path, profession, company, scope distinct | PASS | Schema and contracts suite (216): other path's fields never sent; the review table says "Company not provided" instead of falling back to the person's name (PRB-01) | |
| LB-P17 contact permission vs marketing evidence | PASS | Server-resolved consent wording stored with its hash; marketing off by default; acceptance never grants marketing; reopen keeps the stored consent, answers and acquisition unchanged (review-workflows cert) | |
| LB-P18 durable occurrence under retry/crash/concurrency | PASS | Resume, crash-boundary and approval-delivery certs PASS (approval-delivery re-run after the invitation wording change); six concurrent applications for one mailbox create one; introductions: crash-boundary cases in the review-workflows cert (row F04) | Recovery runs where the existing application-resume sweep runs; not observed in production |
| LB-P19 identity and re-application conflicts | PASS | Four distinct internal refusal reasons, one uniform public 409, nothing created. **Recovery now exists** (row F05): audited staff reopen of a declined, withdrawn, superseded or needs-information application, with history preserved | No self-service re-apply, by design: an email match alone never lets an anonymous applicant replace an earlier decision |
| LB-P20 CRM review shows accurate state | PASS | PAB-10 and PRB-01..09 in a real browser with a real login: status, path and terms pending; owner shown by name or the policy gap named; Liberty business time with a zone label; canonical request link and URL-backed selection (deep link survives reload); history lists actor, time, note and transitions; no credential material | Disposable database. The signed-in production CRM check is LB-P33 (owner) |
| LB-P21 acceptance, authorization, account permission distinct | PASS | Decision is compare-and-set on revision; accept needs typed terms and a schedule reference; admin only; one concurrent accept wins | |
| LB-P22 invitation via existing delivery and token authorities | PASS | Invite intent queued in the decision transaction; approval-delivery cert PASS; token consumption re-checks eligibility | No real invitation email sent (outbound paused). Isolated capture proves routing, not inbox delivery |
| LB-P23 introductions: session identity, permission, staff resolution | PASS | Real approved-partner session over HTTP (role-guards): list 200, submit 201, replay 200, missing key 400; response carries no contact details or commission. Staff detail and decisions: review-workflows cert and PRB-06/07 (row F03) | |
| LB-P24 known merchant / competing referrer, no duplicate or stacking | PASS | Same-contact cases plus business-identity cases (row F03a): same business with a different person, another partner's earlier introduction at the same domain; held for review, never merged or reassigned; concurrent introductions from two partners | Shared-phone-only and multi-location cases give no domain evidence and are not treated as the same business (by design: strong identifiers only) |
| LB-P25 actor/object/CSRF boundaries | PASS | `smoke-role-guards` PASS in this run (partner matrix, approved-partner session, public application, review routes); contracts suite asserts `/api/partner-apply` is the only new CSRF-exempt entry; manager is read-only on decisions (PRB-07) | |
| LB-P26 analytics minimal | PARTIAL | Allowlist drops unknown events and properties and any non-slug value; with analytics refused no funnel event is queued and the queue holds no name, email, phone, company, referral code or UTM value (PAB-01/06) | **The build has no analytics measurement id**, so the consent-granted path could not run: NOT EXERCISED. Needs an owner decision to set the id at build time |
| LB-P27 SSR/client/metadata parity | PASS | Row F01. Raw HTML for all six `/partners*` routes under a browser and a Googlebot user agent: one title, one h1, one canonical, FAQ structured data, hero and body images, no JavaScript needed. Title and h1 parity before and after hydration: 7/7 routes (with `/affiliate`) | Isolated preview, not production |
| LB-P28 ref/UTM attribution | PASS | Row F02 and `ATTRIBUTION_PRECEDENCE.md`: current touch wins, else the session's first touch, allowlisted keys only; persisted snapshot read from the exact occurrence for every journey | Chromium; disposable database |
| LB-P29 migrations additive with proof | PASS | Migration suite (154 checks): fresh apply; 0384 and 0385 hash and parity; negative controls; upgrade from an emulated 0383 database with legacy partners untouched; replay twice; rollback rehearsal and roll-forward; journal/hash integrity | Upgrade ran on an emulated database, not a copy of production; production schema arrives with Publish and is read back afterwards |
| LB-P30 suites wired into real gates | PARTIAL | New suites registered in `pre-deploy.ts` and `ci-suite-manifest.ts`. Full roster result: see section E | The first full roster (291 suites, mid-repair) did not contain the SSR-pages, page-media and hub-React-media suites. **A second full roster ran on the closeout artifact (294 suites) and those suites passed inside it.** The 60 suites that did not pass are reconciled one by one in section F4 and `TASK_2162_ROSTER_RECONCILIATION.json`; the first roster is in section E |
| LB-P31 performance budgets | PASS | Pre-closeout run (the closeout build was measured again: section F5), isolated production-build preview, phone profile, 4x CPU, 1.6 Mbps, cold cache, `--enforce`, the seven partner routes: 0 over budget, 0 invalid. LCP: hub 1.26 s, referrals 0.92 s, sales-agents 1.00 s, cpa 1.66 s, bookkeeper 1.69 s, insurance 1.46 s, affiliate 0.94 s. CLS at most 0.016. Budgets (LCP 2.5 s, CLS 0.1) unchanged. Hero image is eager with high priority; body images lazy | Lab, not field data; Chromium. An earlier run on the same routes (before the last rebuild) had hub 1.25 s and cpa 1.63 s; the earlier base run showed hub 1.32 s, so no regression |
| LB-P32 no outbound/provider authority widened | PASS | Every cert ran under the provider-deny boundary; outbound stayed paused; the repair adds no send path (needs-information is status only; reopen sends nothing; introduction decisions send nothing) | |
| LB-P33 staging and production acceptance | OWNER | | Publish, schema apply, controlled email, signed-in production CRM check, real-phone check all outstanding |
| LB-P34 rollback preserves application/consent evidence | PASS | Rollback rehearsal in the migration suite: code at `70baaffd` against the migrated database leaves the new tables, columns and all application, consent, introduction and review-history rows intact; roll-forward restores the new behavior | **Caveat:** the old code re-opens the old password-at-application route (saves a password and the old default rate), so a code rollback re-opens the original defect until rolled forward |

## B. Verification of the audit findings (VFC for F01–F11)

Each finding was confirmed in source (or by the audit's live observation) before the repair. "Reproduced before" means the failing behavior was demonstrated here before the change; where the capability did not exist at all (no decision route, no writer for `superseded`), the "before" is the absent code.

| ID | Audit verdict | Current state | Evidence |
|---|---|---|---|
| F01 six routes lacked SSR | CONFIRMED | Fixed: one server renderer shares copy, FAQ, SEO record and image manifest with React | `test-partner-ssr-pages` 258/258 (incl. negative controls); raw-HTML curl for six routes x two user agents; parity 7/7 |
| F02 attribution dropped | CONFIRMED (hub clicks fixed earlier; first-touch/direct-load gap closed here) | Current touch wins, else session first touch | PAB suite, contracts suite, lifecycle persisted-snapshot block (171) |
| F03 introductions had no decision workflow | CONFIRMED | Staff detail and admin decision commands with revision check, reason, atomic history; manager read-only | review-workflows cert 133, PRB-06/07 |
| F03a introduction identity | CONFIRMED (gap) | Website/email-domain evidence from the existing registry; ambiguity held for review | review-workflows cert, PRB-06 |
| F04 completion stranded after acknowledgment | CONFIRMED | Durable checkpoints per step; recovery sweep resumes without a browser retry; notification repair independent of `contactId`; the completion step increments the partner's referral total in the same transaction as its checkpoint, so a replay cannot count twice. The one-time backfill does **not** repair totals recorded before 0385, and no production mismatch was observed (production holds 0 introductions) | review-workflows cert (crash cases), migration suite |
| F05 no safe recovery | CONFIRMED | Audited reopen in place; history preserved | review-workflows cert, PRB-04 |
| F06 "request information" implied a message | CONFIRMED | Labeled "Mark as needing information", states no message is sent; transition evidence written in the same transaction | review-workflows cert, PRB-03 |
| F07 320 px CTA clipping | CONFIRMED live | Card CTAs wrap inside the card | visual run: 6 widths x 7 routes, 0 clipped controls |
| F08 review workspace | CONFIRMED | Owner name, exact occurrence link, business time, company state, deep links, history, invitation state | PRB-01/02/05, review-workflows cert |
| F09 CRM guide and inherited copy | CONFIRMED | Audience-specific guide from shared approved content; embed widget, invitation email and branded page reconciled | contracts suite, claims contract, approval-delivery cert |
| F10 visual delivery | CONFIRMED | Hero image on every route, page rhythm, navy section before the footer | page-media suite 141/141, visual run, screenshots |
| F11 release evidence | CONFIRMED | This ledger and section E | section E |

## C. Fix Effectiveness Matrix (post-build repairs)

| # | Root cause | Change site and competing paths closed | Failure behavior | Proof, before and after |
|---|---|---|---|---|
| F01 | `shared/seo-routes.ts` had partner entries but `ssr-routes.ts` had no partner handlers | `server/ssr/partners.ts` + `server/routes/partner-pages.ts` registered through `registerSsrRoutes`; one SEO record (`shared/partner-page-seo.ts`) read by the document and the client | Unknown partner path falls through; the six `/partners*` documents are `no-cache` so a policy change cannot be served stale (`/affiliate` is served with the site's existing public cache header, `public, max-age=300, s-maxage=3600, stale-while-revalidate=3600`, read from the live site on 2026-11-17; the six `/partners*` documents are `no-cache` there); the server module imports no database or policy service (policy arrives as a projection) | **Before:** audit live observation and the earlier parity run (1 of 7 passed). **After:** 258 SSR checks, parity 7/7, raw HTML under browser and bot agents |
| F02 | Plain links and a payload that read only the current query string | `resolvePartnerAttribution` (shared) used by every link, the form and the server re-filter | Anything outside the allowlist is dropped; no allowlisted value means nothing stored | **After:** PAB suite incl. a zoomed session that lands on the hub with extra keys and a token, then submits from a page with no query string and stores only the allowlisted first touch. The new first-touch assertion was not run against the old code |
| F03 | Only a read-only list existed | `partner-introductions.ts` decision commands; admin-only routes; `partner_review_events` | Stale revision 409; wrong role 403; a decision creates no referral, moves no attribution, merges no company | **Before:** no decision command existed. **After:** review-workflows cert and PRB-06/07 |
| F03a | Matching used only contact email/phone | `gatherBusinessEvidence` reuses registry business and domain evidence; `duplicate_review` / `competing_referrer` reasons | Weak evidence (phone only) holds nothing as "same business" | review-workflows cert; PRB-06 resolves both held cases |
| F04 | Completion errors were swallowed; `completeLocked` returned early once `contactId` was set | Per-step checkpoints (migration 0385) and `recoverPartnerIntroductions` inside the existing recovery sweep | Each step idempotent; repeated reconciliation changes nothing; held state shown truthfully | **Before:** no checkpoint existed. **After:** crash after contact, after referral, around linkage, notification failure, repeated reconcile, same-key replay |
| F05 | No writer for `superseded`; no reopen | `reopenPartnerApplication` | Refused for accepted applications, accounts with a credential or terms, and while another open case holds the mailbox; one concurrent reopen wins | review-workflows cert (stale, race, legacy states, takeover refused) |
| F06 | Wording and non-transactional audit | Label and toast; `appendReviewEvent` in the decision transaction | Repeated needs-information keeps every actor/time/note | review-workflows cert; PRB-03 |
| F07 | Inherited `white-space: nowrap` on the card CTA | Local wrap and `min-width: 0` in `PartnerPageSections` | Icon stays; minimum height kept | Visual run measures child rectangles at six widths (not document width) |
| F08 | Owner shown as "Assigned"; re-identified by mutable email; browser-locale dates | Panels read exact occurrence/contact links, staff display names, business-time formatter | Unassigned shows the policy gap | PRB-01/02/05 |
| F09 | Guide contradicted the program | `shared/partner-program-guide.ts`; widget/email/branded copy | No percentage, bonus or payout promise | Contracts + claims + approval-delivery suites |
| F10 | Optional-imagery wording allowed image-free heroes | `PartnerHeroMedia`, `partner-page-media` manifest, derivative pipeline | Missing manifest entry throws at build/test time | page-media suite; visual run |
| F11 | Evidence not recorded | This file | | Section E |

Earlier-build fixes (F1–F9 of the original matrix: password-at-application, affiliate signup, null terms, conflicting rates, calculator, analytics, credential bypass for pending applicants, introductions blocked by the central allowlist, in-site attribution loss) remain proven by the lifecycle (171 checks), contracts (216), role-guards and PAB suites; the F7 and F8 entries are unchanged.

### F10 asset manifest (route, source, provenance, crop, alt, loading)

Source of truth: `shared/partner-page-media.ts`; derivatives cut by `scripts/build-public-images.ts` (480/720/960 px hero, 320/480/640 px body; AVIF, WebP, JPEG); asserted by `scripts/test-partner-page-media.ts`.

| Route | Hero source | Fit | Body image |
|---|---|---|---|
| `/partners` | professional-services scene (two adults over plans) | scene | restaurant (lazy), set beside the path-explanation heading from 768 px (closeout) |
| `/partners/referrals` | med-spa scene (two adults over a booklet) | scene | none |
| `/partners/sales-agents` | automotive scene (mechanic and customer, work order) | scene | none |
| `/partners/cpa` | process-review (hands, checklist, calculator) | **approximate** | e-commerce (lazy) |
| `/partners/bookkeeper` | generated closeout scene `partner-bookkeeper-review` (two adults going over a printed report in a bakery's back office; replaced the dental front desk, which did not support the audience) | scene | retail (lazy) |
| `/partners/insurance` | generated closeout scene `partner-insurance-advice` (two adults going over a printed summary in an open binder in a flooring showroom; replaced the field-services technician, which did not support the audience) | scene | professional-services (lazy) |
| `/affiliate` | retail counter (owner and customer) | scene | none |

Provenance: five of the seven heroes and all four body images are W-D generated editorial scenes already registered in `client/src/lib/public-imagery.ts` (approval status `owner-review-pending`; master, prompt and checksum in `docs/media/w-d-asset-pack-2026-11-10`). The bookkeeper and insurance heroes are two new scenes generated for the closeout in the same W-D style (exact prompts, originals, crop windows and checksums in `docs/media/partner-program-scenes-2026-11-17/`; masters in `client/src/assets/images/partner/`). **All of them are synthetic illustrations, not photographs of real people, customers, partners or Liberty staff**, and a visible caption says so. Nothing was purchased or hot-linked. The alt text of the two new scenes says only what is visible (a printed report in a bakery back office; a printed summary in a flooring showroom); it does not say the people are a bookkeeper or an insurance agent, because a picture cannot show that. **Named asset gap:** a cleared photograph of an accountant and a business client reviewing business figures (CPA). The CPA page still uses the closest cleared scene (hands and a checklist), and its alt text and caption describe what the picture shows, not the profession. The owner has not approved any of the generated set.

## D. Check results in this repair (disposable or isolated; exit 0 unless the row says otherwise)

These are the pre-publication results, with the counts that were corrected afterwards. Reruns on the closeout artifact are in section F4.

| Check | Result |
|---|---|
| `test-partner-program-contracts` | 216 |
| `test-partner-program-lifecycle` (certification) | 171 |
| `test-partner-program-migration` | 154 |
| `test-partner-review-workflows` (certification) | 133 |
| `test-partner-ssr-pages` | 258 |
| `test-partner-page-media` | 141 |
| `test-partner-residual-calculator` | 129 |
| `test-partner-route-order` | 19 |
| `test-public-claims-contract` | 1023 assertions, 93 negative controls |
| `test-partner-approval-delivery` | PASS |
| `test-partner-application-browser` (PAB) | 11 checks |
| `test-partner-review-browser` (PRB) | 10 checks (the tenth, dark-theme contrast of the shared review links, was added in the closeout) |
| `smoke-role-guards` | PASS |
| Hydrated parity (`check-public-server-hydrated-parity`, pre-closeout build) | 7/7 partner routes: same title and h1 before and after hydration |
| `check-public-fonts` (disposable runner, pre-closeout build) | exit 0: 36 checks, 0 failures; partner section headings are an accepted display moment |
| `test-partner-application-browser` and `test-partner-review-browser` (last build) | both exit 0 again after the final rebuild |
| `check-contact-merge-manifest` | `partner_introductions.contact_id` classified; 11 other unclassified relationships remain, identical on clean HEAD (exit 1 from those) |
| `check-migration-seed-registration` | 0385 registered as a historical one-time seed; 3 other failures (0360, 0376, 0381) identical on clean HEAD (exit 1 from those) |
| `seo-audit` | 559 routes, 0 failed; the six partner routes server HTML, 0 failing; exit 1 only from `/support` and `/blog` hydrated-title errors that also fail on clean HEAD |
| `test-canonical-identity-merge` | exit 0 |
| `server/tests/auth-actions.integration.test.ts` (explicit run) | exit 0 |
| `test-partner-ssr-pages`, `test-partner-page-media` and `test-partner-hub-react-media` | registered in `pre-deploy.ts` (mandatory) and `ci-suite-manifest.ts`; each exit 0 when run singly. The launcher ran 294 suites on the closeout artifact, and these three passed inside it (section F4) |
| `check-public-shell-design` (isolated preview, pre-closeout build) | The 12 hydrated public routes (hub, five journeys, affiliate, home, payment-processing, pricing, industries, about-contact) and both sign-in pages: all 128 states clean at 320, 390, 768, 1024 and 1440 wide in light and dark. 20 findings on the two static `/learn` pages: see section E |
| `capture-partner-visuals` (isolated preview, pre-closeout build) | 42 page states, 0 findings; screenshots written |
| `check-public-perf --enforce` (isolated preview, pre-closeout build) | 7 partner routes, 0 over budget, 0 invalid (see LB-P31); the default-route run also passed: 10 routes, 0 over budget |
| Whole-project `tsc --noEmit` | 41 errors on the working tree and 41 on a clean export of HEAD `49b5f39a`: identical set, none in a file this repair touched (`server/routes/statement-review.ts` 32, `live-chat.ts` 2, `admin.ts` 2, `merchant-application-outbox-worker.ts` 1, `deal-boarding-outbox-worker.ts` 1, `server/db.ts` 1, `MerchantApplicationsList.tsx` 1, `SelectedTaskPanel.test.tsx` 1) |
| `npm run build` | exit 0 (final tree, after the last edit to `client/src/App.tsx`) |

Populated end-to-end lifecycle, as run in isolation: a real browser submits the referral and the sales-agent applications (PAB) and the exact stored rows are read back (status, null terms, no credential, consent hash, attribution); an administrator signs in through the real login page, declines, reopens and declines again with history intact (PAB-10, PRB-04); the decision, invitation intent, credential eligibility and set-up are covered by the lifecycle and approval-delivery certs on the same database design; an approved partner session submits and replays an introduction over HTTP (role-guards) and staff resolve two held introductions in the browser (PRB-06). The chain is covered by these suites together, not by one continuous browser session.

## E. Not run, and what could not be exercised

- **Superseded by the roster on the closeout artifact (section F4 and `TASK_2162_ROSTER_RECONCILIATION.json`).** What follows is the pre-publication record. **Full pre-deploy roster (one run, mid-repair): 291 mandatory suites, 235 passed, 56 failed.** Every partner suite in the roster passed. The 56 were then each rerun alone on a clean export of HEAD `49b5f39a` (same disposable runner) to separate old failures from ones this repair caused:
  - **46 fail with the same message on clean HEAD** (not caused by this repair, not fixed here): the CRO-03 family, sequence-compliance and contactability, the SFP certifications (the diff-isolation ones also fail on any uncommitted tree), stage3 c5-mounted, wd-industries and wd-locations contracts, the outbound-pause toolkit checks, `test-ghl-route-pause-gates-1629`, `test-forms` (needs environment), release-artifact gate, dependency audit, cr06 inventory, website-email migration, and the d-v contact-actor browser suite (it pins a serving commit that differs from HEAD by 537 client/shared files, so it fails on any current tree).
  - **4 were caused by this repair; fixed and rerun:** the public font check (partner section headings use the display serif on purpose; the check now accepts exactly `H2.public-h2` inside `.marketing-theme .partner-page`; rerun exit 0, 36 checks, 0 failures); the SEO audit (the `/partners/insurance` description was 169 characters against a 165 limit, now 139; rerun: 559 routes, 0 failed, the six partner routes all server HTML with 0 failing; the audit still exits 1 because `/support` and `/blog` hydrated-title errors exist on clean HEAD); the migration seed-registration check (0385's checkpoint backfill is now registered as a historical one-time seed; the three remaining failures, 0360, 0376 and 0381, are on clean HEAD); and the contact-merge manifest (`partner_introductions.contact_id` is now classified `manual_block` because introductions are append-only review evidence; 12 unclassified relationships became 11, all on clean HEAD).
  - **Browser suites that failed in the roster, rerun alone:** `test-stage3-b-browser` fails at the same selector (`button-compose-email-contact`) on clean HEAD. `server/tests/auth-actions.integration.test.ts` passes when run explicitly. `test-stage3-c1-browser` fails the 61-row useful-list timing limit (2.5 s) on clean HEAD (2.7 s) and on this tree (2.9–3.1 s on three runs); the first runs on this tree were slower because the main bundle had grown by about 82 KB from a static import of the partner client module, which I then moved to a lazy import (main bundle 917 KB to 836 KB, clean HEAD 835 KB). It is a timing assertion on a shared machine, so the remaining 0.2–0.4 s difference is not conclusive either way. `test-stage3-c2-browser` fails on this tree with colour-contrast defects (blue link on dark background, 3.46:1 against 4.5) on `/dashboard/contacts/601` and `/dashboard/tasks-appointments`; I could not get a clean-HEAD run past `/login` to compare, so it is **not proven pre-existing**, but this repair touches no CRM page and the new CSS is scoped to `.marketing-theme`.
  - **Not run by the roster (opt-in):** c5-performance and 4d-calendar-performance.
  - **Shell-design check, two static pages:** `/learn` and `/learn/interchange-plus-pricing` (served as static pages with no site header or main landmark) produce 20 findings at the five widths and two colour schemes. The same 20 findings appear on a clean export of HEAD, so they are not from this repair and were not changed. Every hydrated public route, including the seven partner pages, and both sign-in pages are clean.
  - The roster and the single reruns rewrote files under `docs/certification`; I restored them from HEAD, so none of them is changed in the working tree.
  - The certification-fixture suites (lifecycle, review-workflows, approval-delivery, resume, crash-boundaries, program-migration) are not in the roster and run only by name; each was run on its own (section D).
- Safari/WebKit; physical iOS and Android phones; a screen reader.
- Analytics with consent granted (the build carries no measurement id).
- Controlled email delivery (isolated capture is not inbox-delivery proof); the signed-in production CRM review; real submissions to production. The post-Publish readback was done read-only on 2026-11-17 (section F1 and F2): the serving identity matches, and **production does not have migration 0385**. Not yet done on the live site: the closeout changes (they are unpublished), a signed-in review, and parameter-preserving navigation on the live pages after the closeout publish.
- Human visual review of the new heroes and owner approval of the generated image set; a cleared photograph for the CPA page (the one scene that is still an approximation).
- The F02 first-touch assertion and the new F01–F10 suites were not run against the pre-repair code (their "before" is the audit's observation or the absent capability), except where a row says otherwise.
- `/partner-login` (unchanged) has no main/h1 and five tap targets under 44px at 390 wide; `PartnerLogin.tsx` still says "commission reports".
- The embed collateral and branded page were reconciled, but no census re-count was repeated after the repair.

## F. Post-publication closeout (2026-11-17, after Publish)

Everything in this section was run after the F01–F11 repair was published. It governs where it differs from sections A–E. All runs used disposable databases and Redis, isolated previews of a compiled build, or read-only requests; nothing was sent to a provider and no application was submitted to production. Chromium only.

### F1. Identities and serving parity

| Item | State |
|---|---|
| Live commit | `109b60b7`, built 2026-11-17T12:47:24Z, publish build id `e83f9ee0-45ff-4675-b090-94fde44bb3a2` (live `/api/health`, re-read 14:28 UTC) |
| Repository HEAD | `389d4169`; its tree (`5850d0e1…`) equals the tree of `109b60b7` |
| What is live | The F01–F11 repair. **Not live:** the closeout changes in F3 (they are uncommitted and unpublished); the live pages still carry the earlier headlines and no hub body figure |
| Referral percentage | Not approved. Public answer remains `written_agreement` |

### F2. Production schema read-back (read-only): migration 0385 is not in production

Read on 2026-11-17 at 14:28 UTC through read-only queries (no DDL, no writes, journal untouched):

- `partner_review_events` does not exist.
- `partner_introductions` has only the 0384 columns (review state and review reason); the twelve 0385 columns do not exist.
- The only constraints are the 0384 reach and state checks (plus keys); the two 0385 checks do not exist.
- The only indexes are the 0384 ones.
- Production holds 0 applications, 0 introductions and 6 active partners, so no data is stranded.
- The recovery heartbeat (`partner_application_recovery_heartbeat`) reports outcome `ok` once a minute but its `introductions` entry is `{"error":"Error"}` every minute (read at 14:28:37 UTC). I do not know the cause; code that expects the 0385 objects is running against a database that lacks them, which fits but is not proven. The approval-delivery heartbeat is healthy (3 waiting).

**Re-read at 17:32 UTC the same day:** `partner_review_events` still does not exist, `partner_introductions` still has the same 20 columns and 2 check constraints, and the heartbeat's `introductions` entry still reads `{"error":"Error"}` (stamped 17:32:37 UTC).

**What this means.** Publish started the new code without creating the 0385 objects. Introduction recovery and the review-history features cannot work in production until they exist. The remedy is the owner's re-Publish; I do not apply schema changes to production. After the re-Publish I will read production again, read-only: the table, the twelve columns, both checks (including their validation state), the indexes, and a heartbeat `introductions` entry without an error. The signed-in production walk is blocked until then.

### F3. What changed in the closeout (unpublished)

- Hero scenes: the bookkeeper and insurance pages have new generated scenes (bakery back office, flooring showroom) in place of the dental front desk and the field-services technician; the 18 derivative files of the two replaced heroes are removed. See the manifest in section C.
- The hub has its body image (restaurant scene) beside the path-explanation heading from 768 px, in both the server renderer and React; `test-partner-hub-react-media` asserts both.
- Shorter headlines on the hub and the profession pages.
- Dark theme: the shared review-panel links use a colour with enough contrast on the dark background; PRB-08 checks it.
- The performance script records every sample, not only the median.

### F4. Reruns on the closeout artifact

**Full roster** (launcher on the closeout build, 2026-11-17 14:41–16:18 UTC): 294 suites, **234 passed, 60 child failures** (56 failed and 4 explicit opt-in suites the launcher counts as failures). Every partner and public suite passed: route order, contracts (216), SSR pages (258), page media (141), hub React media, residual calculator (129), claims contract, W-D media contract, PAB, PRB (10 checks), role guards, the two D-V partner suites, fonts, overlay and hydrated parity (24 of 24 routes, including the seven partner routes).

**Reconciliation** (`TASK_2162_ROSTER_RECONCILIATION.json`, built by `build-roster-reconciliation.mjs`; one record per suite with the failure lines and a log hash): of the 60, **52 match the pre-repair export** (same failure lines when run alone on an export of `49b5f39a`), **4 were transient** (passed when rerun alone on a final-tree export), **4 are explicit opt-in**, **0 unclassified**.

- Transient: `test-stage3-c3-browser-sequences`, `test-serper-gateway`, `check-public-shell-design` (browser target closed once in the roster), and `check-public-site-mobile` (in the roster the hub and the CPA, bookkeeper and insurance pages showed no main landmark inside the 1.2 s settle window; rerun twice alone: 144 states, none flagged; the pre-repair single run had the same symptom on `/partners`, `/partners/cpa`, `/estimate` and `/support`, so the suite is load-sensitive).
- Matched by reviewed note: the D-V contact-actor browser suite (pins a serving commit; the pre-repair commit differs from it in 538 client/shared/migration/package inputs and the closeout working tree in 625, so it fails on any current tree), `seo-audit` (only `/support` fails on both trees; the roster's extra `/help/...` hydration failure did not reproduce; the pre-repair `/partners/insurance` description defect was fixed by the repair), and the C1 browser suite.
- **C1 browser is not a clean signal on either tree.** In the roster it stopped on a missing derivative file because it lists tracked files and the 18 replaced hero files are deleted in the uncommitted tree; that disappears when the deletion is committed. Run alone ten times per tree on clean exports, it fails at the same assertion and call site (the contact editor input has no stable pointer target): the pre-repair tree passed 3 of 10 and the final tree 2 of 10, and both diagnostic variants occur on both. Main bundle: 835,142 bytes before, 835,615 after. I treat it as a flaky pre-existing failure, not a pass.
- Opt-in: `test-stage3-c5-performance` and `test-stage4d-calendar-performance` (need prebuilt baseline client builds; not run), `test-stage3-b-browser` (run explicitly: fails at the same selector as the pre-repair tree) and `server/tests/auth-actions.integration.test.ts` (run explicitly: passes on both).
- The SFP diff-isolation certification fails on any uncommitted tree by design; it matches the pre-repair result.

**Certification-fixture suites** (not in the roster; run by name on the closeout tree, each exit 0): lifecycle 171 checks, review workflows 133, program migration 154, approval delivery 26, application resume 15, application crash boundaries 20.

### F5. Performance, visuals, parity (closeout build)

- Performance (isolated production-build preview, phone profile, 4x CPU, 1.6 Mbps, cold cache; seven partner routes, three samples each, `--enforce`): 0 over budget, 0 invalid. Median LCP: hub 1.76 s, referrals 0.99 s, sales-agents 1.22 s, CPA 1.59 s, bookkeeper 1.02 s, insurance 1.73 s, affiliate 1.12 s; CLS at most 0.032. Budgets (LCP 2.5 s, CLS 0.1) unchanged. **The first hub sample in that set measured 12.7 s** (2.47 MB transferred, against 0.96 MB for the other two). A second set of five runs on hub, CPA and insurance put the hub at 1.24–1.91 s (its first sample again transferred 2.47 MB, at 1.24 s), CPA at 1.60–1.72 s and insurance at 0.96–1.79 s. The 12.7 s sample did not reproduce and I did not find its cause beyond a cold first load on a loaded machine; the gate reads the median. Samples are in `evidence-2026-11-17/`.
- Visual capture of the seven routes at six widths: 42 states, 0 findings.
- Shell-design (isolated preview, closeout build): 148 states, 20 findings, all on the two static `/learn` pages, the same as the pre-repair export. The disposable launcher run on the final-tree export reported 148 states, 0 findings.
- Hydrated parity: 24 of 24 routes show the same title and h1 before and after hydration.

### F6. Stated separately

- **Referral percentage:** 25% referral and 30% strategic are not approved; nothing in the code, pages or tests states them.
- **Real email delivery:** not tested. Outbound stayed paused; isolated capture proves routing only.
- **Owner decisions outstanding:** re-Publish (schema and closeout changes); approval of the generated images; a cleared CPA photograph; the analytics measurement id; the referral percentage policy.
- **Not run:** Safari/WebKit, real phones, a screen reader, analytics with consent granted, a signed-in production review, real production submissions, the mobile chat launcher, and the notification deep link `?tab=introductions&introduction=<id>`.
- **Observed, not fixed:** the staff introduction detail shows the raw text `partner_introduction_permission@1` where a readable label belongs.
