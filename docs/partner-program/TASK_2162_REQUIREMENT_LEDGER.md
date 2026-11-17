# Task 2162 — Liberty Partner Platform Upgrade: requirement ledger and Fix Effectiveness Matrix

Spec: `attached_assets/LIBERTY_PARTNERSHIPS_FINAL_MASTER_PREFLIGHT_BUILD_TASK_2026-11-_1794874324406.md` (sections 5, 6, 9, 28, 29, 50).
The pre-build VFC table and first Fix Effectiveness Matrix are in `.local/tasks/liberty-partner-referral-sales-agent-upgrade.md` ("PREFLIGHT RESULTS", items 4 and 7). This file is the final, post-build version: every row says what exists, which test or run proves it, and what was not proven.

Status words: **PASS** = built and proven by the named test or run. **PARTIAL** = built, but part of the required proof was not run. **NOT RUN** = not run. **OWNER** = needs an owner action, not engineering.
All runs below used disposable databases/Redis or the offline dev app. Nothing was published, emailed, texted or sent to a provider.

## A. Requirement ledger (LB-P01 – LB-P34)

| ID | Status | Evidence | Not proven / limit |
|---|---|---|---|
| LB-P01 baseline, schema head, collisions | PASS | Plan-file preflight: audited SHA, journal head 0383, production serving identity, collision review. Build base `70baaffd`; migration 0384 / journal idx 387. `check-migration-integrity` PASS | No standalone report file; it lives in the plan file |
| LB-P02 route and offer census | PARTIAL | Pre-build census table with counts and dispositions is in the plan file (section 11: e.g. commission/partner_approved readers 91 matches / 29 files, all readers reviewed; one enrollment hook at the approval flow) | The post-build re-count of those greps was not run, so final counts are not recorded |
| LB-P03 hub with two paths and correct CTAs | PARTIAL | `ISOPartnerProgram.tsx` rebuilt; its CTAs use `PARTNER_ROUTES`; automated overflow and tap-target check: 0 findings at 390 and 1440 (light and dark) and at 320 and 768, across all partner routes | No browser click-through of each hub CTA |
| LB-P04 referral journey, direct entry | PARTIAL | Route `/partners/referrals` (`App.tsx`), SEO entry; direct load checked; real HTTP submit through `/api/partner-apply` returns 201 with a receipt (`smoke-role-guards.ts`, new block) | Form was not filled and submitted through the browser UI |
| LB-P05 sales-agent journey, direct entry | PARTIAL | Same as P04 for `/partners/sales-agents`; HTTP submit 201 | Same limit |
| LB-P06 profession pages: approved terms, shared math | PASS | `PartnerCPA.tsx`, `PartnerBookkeeper.tsx` and `PartnerInsurance.tsx` now render the shared `components/public/PartnerProfessionPage.tsx` (no 30% text remains in the three page files); `test-public-claims-contract` PASS (1023); built-bundle scan found no unapproved referral percentages | |
| LB-P07 affiliate reconciled; existing accounts survive | PARTIAL | Affiliate page copy and CTAs aligned; `/api/affiliate/signup` retired (410); existing affiliate/partner login and reset kept (lifecycle cert: credentialed legacy partner can still reset); contracts suite checks the retired route writes nothing | No live affiliate-session regression through the affiliate login route |
| LB-P08 referral rate gated beyond UI hiding | PASS | Rate exists only as a server projection of an admin-approved policy version; anonymous `/api/public/partner-policy` returns `written_agreement`; policy lifecycle checks in the lifecycle cert; production-bundle scan | Referral 25%/strategic 30% are not approved; no numeric referral rate is live |
| LB-P09 agent 50% qualified; no stacking | PASS | Shared copy states qualifying self-sourced full-cycle business only; `partner_approved` enrollment hook fails closed unless the application opted in | |
| LB-P10 historical terms preserved | PARTIAL | Migration is additive (no change to existing partner rows); column default kept; lifecycle cert: an existing partner mailbox is refused and its historical 10% is unchanged (checks at lines 83-86) | No before/after payout fixture diff (no payout engine was touched) |
| LB-P11 public tokens, fonts, spacing | PARTIAL | Existing public tokens/components reused | Design/fonts/computed-style scripts not run |
| LB-P12 mobile/tablet/desktop | PARTIAL | Automated overflow and tap-target check: 0 findings at 390 and 1440 (light and dark) and at 320 and 768, across all partner routes | No human visual sign-off; no screenshots attached to this ledger; no physical phones |
| LB-P13 keyboard, screen reader, zoom, motion | PARTIAL | Tap-target fixes; Public Shell contract (114) PASS | No dedicated keyboard/screen-reader/zoom/reduced-motion run |
| LB-P14 shared calculator | PASS | `test-partner-residual-calculator` 129/129 (zero, blank, error, rate states); old 50%/15%/zero-rejection assertions rewritten | |
| LB-P15 applications password-free and pending | PASS | Lifecycle cert (pending, null password, null terms, no login); real HTTP submit stores a pending row with no password, no terms, no user, no session cookie (role-guards) | |
| LB-P16 path, profession, company, scope distinct | PASS | `shared/partner-application.ts` schema; contracts suite (157): other path's fields never sent, bodies naming rate/actor/status refused | |
| LB-P17 contact permission vs marketing evidence | PASS | Server-resolved consent wording stored with its hash; marketing off by default and requires a known disclosure; acceptance never grants marketing (lifecycle cert) | |
| LB-P18 durable occurrence under retry/crash/concurrency | PASS | Resume, crash-boundary and approval-delivery certs PASS; six concurrent applications for one mailbox create exactly one | |
| LB-P19 identity and re-application conflicts | PARTIAL | `createPartnerApplication` refuses an existing partner, an existing login, an open application and any prior application (separate internal reasons); the public answer is one uniform 409 (HTTP-verified); the precise reason stays on the occurrence. Lifecycle cert covers existing partner and open application | A prior-application and an existing-login refusal have no dedicated test of their own. There is no self-service re-apply after a decline and no built staff re-open flow (a `superseded` status exists but nothing sets it) |
| LB-P20 CRM review shows accurate state | PARTIAL | Review list/detail/decision API and role matrix verified (admin/manager read, admin decide); panel built | Signed-in browser view of the review panel not run |
| LB-P21 acceptance, authorization, account permission distinct | PASS | Decision is compare-and-set on revision; accept needs typed terms and a schedule reference; admin only; one concurrent accept wins | |
| LB-P22 invitation via existing delivery and token authorities | PASS | Invite intent queued in the decision transaction; approval-delivery cert PASS; token consumption re-checks eligibility | No real invitation email sent (outbound paused) |
| LB-P23 introductions: partner identity from session, permission captured | PASS | Real approved-partner session over HTTP: list 200, submit 201, replay 200, missing key 400; response carries no contact details or commission (role-guards) + lifecycle cert | Added after completion review found the route was blocked (see section C, F8) |
| LB-P24 known merchant / competing referrer, no duplicate or stacking | PASS | Lifecycle cert: second partner introducing the same business goes to review; one contact, one referral, one notification | |
| LB-P25 actor/object/CSRF boundaries | PASS | 10 partner cases in the `smoke-role-guards` matrix plus approved-partner session and public-application cases PASS; the contracts suite asserts `/api/partner-apply` is the only new CSRF-exempt entry | |
| LB-P26 analytics minimal | PARTIAL | Funnel allowlist drops unknown events, unknown properties and any value that is not a short slug (`tracking.ts`); contracts checks | No browser network-interception run |
| LB-P27 SSR/client/metadata parity | PARTIAL | SSR affiliate/hub copy and SEO route entries updated; public-claims contract PASS | Hydrated-parity script not run |
| LB-P28 ref/UTM attribution | PARTIAL | Attribution is allowlisted; real submit stored `utm_source` without personal or commercial fields | Not tested across multi-page navigation in a browser |
| LB-P29 migrations additive with proof | PARTIAL | `0384` is `CREATE … IF NOT EXISTS` plus indexes; journal/hash integrity PASS; applied fresh in every disposable suite database | Not applied to production; replay-twice and production-copy upgrade not separately run |
| LB-P30 suites wired into real gates | PASS | Registered in `ci-suite-manifest` and `pre-deploy`; manifest check fails only on 20 gaps that predate this work | Full pre-deploy roster not run |
| LB-P31 performance budgets | NOT RUN | | Perf lab not run |
| LB-P32 no outbound/provider authority widened | PASS | Every certification ran under the provider-deny boundary; outbound stayed paused; no send path added | |
| LB-P33 staging and production acceptance | OWNER | | Publish, schema apply, controlled email, signed-in production CRM check, real-phone check all outstanding |
| LB-P34 rollback preserves application/consent evidence | NOT RUN | Migration is additive, so a code rollback leaves the new tables intact | No rollback rehearsal |

## B. Final VFC table (VFC-01 – VFC-20)

| ID | Preflight verdict | Outcome in the build | Evidence |
|---|---|---|---|
| VFC-01 hub shows agent 50% / referral 15% | CONFIRMED | Hub rebuilt; referral rate approval-gated; 50% qualified | `ISOPartnerProgram.tsx`, `partner-public-policy.ts`, bundle scan |
| VFC-02 child routes missing | CONFIRMED | Both routes added with SEO entries | `App.tsx:527-528` (`PartnerReferralApplication`, `PartnerSalesAgentApplication`), `seo-routes.ts:73-74` |
| VFC-03 affiliate 10% / agent CTA to /get-started | CONFIRMED | Copy aligned; the agent CTA no longer points at `/get-started` (`AffiliateProgram.tsx` has no such link); CTAs use shared route constants | `AffiliateProgram.tsx` |
| VFC-04 application required password, saved 50%/10% | CONFIRMED | Replaced by a password-free pending application with null terms | `routes/partner-program.ts`, `partner-application.ts` (the only `/api/partner-apply` handler is now in `routes/partner-program.ts`) |
| VFC-05 affiliate signup active at 10% | CONFIRMED | Signup retired (410); existing accounts untouched | `routes/imports.ts`, contracts suite |
| VFC-06 occurrence/replay/contact/notification services exist | CONFIRMED | Extended, not duplicated | `partner-application-intake.ts`, `partner-application.ts`, resume cert |
| VFC-07 invitation path exists | CONFIRMED | Reused; eligibility re-checked on consumption | `partner-approval-delivery.ts`, `partners.ts` |
| VFC-08 profession pages 30% + own calculators | CONFIRMED | One shared page and calculator; claims removed | `components/public/PartnerProfessionPage.tsx`, claims contract |
| VFC-09 shared calculator correct | CONFIRMED | Kept; range 25–150 bps | calculator suite 129/129 |
| VFC-10 zero rejected | CONFIRMED | Zero handled; assertion rewritten | calculator suite |
| VFC-11 company name in analytics | CONFIRMED | Removed; allowlist added | `tracking.ts`, contracts suite |
| VFC-12 SSR compensation wording | PARTIAL (corrected) | SSR copy replaced | `server/ssr/pages.ts` |
| VFC-13 public tokens exist | CONFIRMED | Reused | design script not run (LB-P11) |
| VFC-14 hero right column hidden below lg | CONFIRMED | Essential content kept outside that slot | mobile check |
| VFC-15 no public introduction flow | CONFIRMED | Authenticated, idempotent introduction route into canonical contact/referral writers | role-guards session cases, lifecycle cert |
| VFC-16 approval fires enrollment hook | CONFIRMED | Hook skips unless the application opted in; pause intact | `partners.ts` |
| VFC-17 mailbox binding in account transaction | CONFIRMED | Preserved | resume/crash certs |
| VFC-18 nullable terms, default 10, readers fall back to 10 | CONFIRMED + EXTENDED | Explicit null on applications; `?? 10` readers corrected; column default kept for legacy | lifecycle cert, `partner-welcome.ts`, `partner-notifications.ts` |
| VFC-19 portal earning copy | CONFIRMED | No-guarantee wording | `PartnerPortal.tsx` |
| VFC-20 production acceptance unproven | CONFIRMED | Still unproven; see LB-P33 | — |

## C. Fix Effectiveness Matrix

| # | Finding / root cause | Change site and competing paths closed | Failure behavior | Failing-before / passing-after |
|---|---|---|---|---|
| F1 | New application created a password and a rate (`POST /api/partner-apply` wrote both) | `createPartnerApplication` via `routes/partner-program.ts`; old handler removed from `partners.ts`; `/api/affiliate/signup` → 410; legacy password body → 410; admin create keeps explicit terms | Refusals are one uniform 409; unknown consent wording → 400 | After: lifecycle cert + HTTP receipt. Before: not re-run against the old code (that route no longer exists) |
| F2 | Affiliate active at signup | Signup retired; welcome only for existing flows | 410, nothing written | After: contracts suite. Before: not run |
| F3 | Null terms read as 10% | `partner-welcome.ts`, `partner-notifications.ts`, the CRM partner form in `dashboard/ReferralProgram.tsx` (no 10 default), portal copy in `PartnerPortal.tsx` | "Terms pending" instead of a number | After: lifecycle cert + contracts. Before: not run |
| F4 | Conflicting public rates and claims | One content contract for React and SSR | Referral rate absent unless an approved policy version exists | After: claims contract, bundle scan. Before: not run |
| F5 | Zero handling; three calculators | Shared calculator only | Invalid input shows an error state | After: 129/129 with negative controls |
| F6 | Applicant data in analytics | `tracking.ts` allowlist + page change | Unknown events/properties dropped | After: contracts suite |
| F7 | **Password reset and login bypass for pending/declined applicants** (found by completion review): reset token issued for any partner row; consuming it set a partner login | `partnerMayHoldCredential` in `partner-account.ts`, used by both reset-request routes, the shared token consumer (reset and invitation), both partner login routes and the affiliate login | Same generic reset answer as an unknown address; stale tokens refused (400); login 401 | **Before: probe with the check forced open fails at the first credential assertion ("A pending applicant may not hold a credential"). After: 109/109 lifecycle checks**, covering pending and declined applicants, forged reset and invite tokens, planted credential cannot sign in, accepted and legacy credentialed partners keep invite/reset |
| F8 | **Introductions unreachable for approved partners** (found by completion review): the central partner allowlist in `server/routes.ts` returned 403 for `/api/partners/me/introductions` before the handler ran | Added exactly `/partners/me/introductions` to the allowlist; handlers still authenticate the partner session and require an active partner | Other partner/CRM routes still 403, including a sibling path | **Before: with the line removed, approved-partner GET and POST return 403 (4 failing checks). After: GET 200, POST 201, replay 200, no key 400, six CRM paths refused (403)** — `smoke-role-guards.ts` |

## D. Status of the separate release items

| Item | Status |
|---|---|
| Code complete | Yes (F7 and F8 added after completion review) |
| Checks passed | Contracts 157; lifecycle 109; route order 19; resume, crash-boundary, approval-delivery, auth-actions; calculator 129; public-claims 1023; public-shell 114; migration integrity; api-coverage; role-guards (incl. new partner session and application blocks); build; mobile checks; Public Shell and Stage 3 D-V partner browser suites |
| Merged | Task 2162 shows merged; the F8 allowlist line and the two new role-guards blocks are uncommitted in the working tree at the time of writing |
| Schema applied | Disposable and dev databases only; **not production** |
| Deployed / serving identity | No / none |
| Referral percentage approval recorded | No (owner decision) |
| Controlled email, signed-in production CRM, real phones | Not done |
| Outbound enabled | No |

## E. Not run
Full pre-deploy roster; whole-project type check; WebKit; performance lab; fonts, design and hydrated-parity checks; keyboard/screen-reader/zoom/reduced-motion checks; browser form submit; signed-in CRM review panel in a browser; analytics network interception; physical iOS/Android; production schema apply; rollback rehearsal.
