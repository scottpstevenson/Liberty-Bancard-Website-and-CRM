# LIBERTY BANCARD - PREFLIGHT + BUILD MODE

## GL-02 - Stage 2 Public Website & Inbound Acquisition Repairs

**Mode:** PREFLIGHT + BUILD  
**Priority:** P0/P1 go-live closure  
**Repository:** `scottpstevenson/Liberty-Bancard-Website-and-CRM`  
**Audit evidence baseline:** `main` at `8bf8318762963eb2298aad386b136c7361de54e0` on 2026-09-28  
**Audit-baseline migration journal:** 312 entries, high-water mark `0307_serper_canonical_control_reconciliation`  
**Dependency:** GL-01 should be merged first; re-pin this task against the new `main` before editing.  
**Build boundary:** code/repository only. Do not publish/deploy, submit real production forms, create real production leads, send real email/SMS, call paid providers, change ad accounts, import conversions, or claim final browser/runtime certification in this task.

This is one owning task for Stage 2. Do not split the verified website/inbound findings into follow-up tasks. Keep claims/legal, consent/privacy, attribution, and inbound reliability inside this task because they meet at the same public acquisition boundary.

---

## MODE

PREFLIGHT + BUILD. Verify against the current repository after GL-01, correct stale assumptions, then implement the smallest safe end-to-end fix set in the same run.

The exact `file:line` references below are verified at `8bf8318762963eb2298aad386b136c7361de54e0`. They are evidence anchors, not permission to skip re-pinning if `main` moved.

Required sequence:

baseline -> VFC -> full public-route/form census -> greps -> root cause -> content/consent/attribution/inbound ownership -> blast radius -> schema/migration check -> corrected plan -> build -> disposable/browser-safe tests -> gates -> post-build greps -> diff -> final VFC -> merge verdict.

---

## 1. REPOSITORY BASELINE

Before mutation, capture:

- current branch;
- HEAD SHA and `origin/main` SHA;
- working-tree status;
- migration journal count/high-water mark;
- whether GL-01 is present on current `main`;
- current public route/form inventory;
- unrelated changes to preserve.

Audit-baseline public surface facts:

- 67 static SEO routes were registered in `shared/seo-routes.ts`;
- React had 244 total routes, many authenticated and therefore not part of this Stage 2 build;
- current public acquisition code includes estimate, support, get-started, integration request, callback, statement upload, free analysis, equipment order, testimonial and newsletter flows plus merchant application and public booking CTAs.

Do not reopen authenticated CRM navigation/role UX in this task; that is Stage 3.

---

## 2. VERIFIED FROM CURRENT CODE - PREFLIGHT FINDINGS

Produce and update this VFC table before editing.

| ID | Audit claim | Audit-baseline evidence | Required preflight verdict |
|---|---|---|---|
| WEB-01 | Customer-facing contract/ETF claims directly contradict the Terms/Refund/footer disclosures. | `client/src/pages/GetStarted.tsx:349-355`; `client/src/pages/MerchantApplication.tsx:1653-1660`; `client/src/pages/Terms.tsx:91-100`; `client/src/pages/RefundPolicy.tsx:60-66`; `client/src/components/Footer.tsx:305-313` | CONFIRMED / FALSE / OUTDATED |
| WEB-02 | Merchant application requires PEWC/TCPA marketing consent even though the disclosure says consent is not required to obtain services. | `client/src/pages/MerchantApplication.tsx:535-539,1594-1597` | CONFIRMED / FALSE / OUTDATED |
| WEB-03 | Free Analysis requires marketing calls/text/email consent to finish the requested free analysis. | `client/src/pages/FreeAnalysis.tsx:343-354,962-973` | CONFIRMED / FALSE / OUTDATED |
| PRIV-01 | Cookie preferences are stored but do not govern GA4/Meta loader initialization; no Google Consent Mode call was found. | `client/src/components/CookieConsent.tsx:29-62`; `client/src/lib/tracking.ts:14-52` | CONFIRMED / FALSE / OUTDATED |
| CONS-01 | Existing-contact public-form merge interprets explicit `false` as an opt-out, so an unchecked optional box can become a withdrawal instead of no new consent. | `server/services/public-form-submission.ts:97-108`; `server/services/consent-merge.ts:39-61,65-88`; statement route `server/routes/public.ts:451-464`; support route `:816-829` | CONFIRMED / FALSE / OUTDATED |
| ATTR-01 | Click-ID attribution is incomplete/inconsistent: raw GCLID is stored, FBCLID/MSCLKID are only presence booleans, booking URLs omit click IDs, and Free Analysis reads `utmParams.gclid` from state that only captures UTM keys. | `client/src/lib/utm.ts:41-49,105-117`; `client/src/pages/FreeAnalysis.tsx:335-340,385-416`; `shared/schema.ts:92-98,6973-6981` | CONFIRMED / FALSE / OUTDATED |
| INB-01 | Callback intake always creates a new contact with empty email and has no canonical phone-based match/review path. | `server/routes/public.ts:1202-1223`; `client/src/components/ContactBubble.tsx:18-24`; `client/src/pages/Home.tsx:136-143`; `client/src/components/HelpCenter.tsx:172-177` | CONFIRMED / FALSE / OUTDATED |
| INB-02 | Common JSON public forms generate a new idempotency key inside each `apiRequest()` call, unlike statement upload/free analysis which retain a key for the logical submission/retry. | `client/src/lib/queryClient.ts:48-60`; good patterns at `client/src/pages/UploadStatement.tsx:206-236` and `client/src/pages/FreeAnalysis.tsx:385-416` | CONFIRMED / FALSE / OUTDATED |
| INB-03 | Server-side hostile-input validation is inconsistent across public endpoints. | estimate `server/routes/public.ts:661-668`; support `:804-813`; get-started `:910-918`; contrast with strict Zod integration request `:1101-1109` and newsletter `:1535-1543` | CONFIRMED / FALSE / OUTDATED |
| WEB-04 | `[Bank Partner]` placeholder ships in merchant-application copy. | `client/src/pages/MerchantApplication.tsx:875-881,1570-1575,1664-1667` | CONFIRMED / FALSE / OUTDATED |
| WEB-05 | Public commercial/statistical content has a declared canonical source but multiple pages still hard-code parallel values/copy. | canonical contract `client/src/lib/site-content.ts:1-45`; hard-coded home counters `client/src/pages/Home.tsx:131-134`; additional hard-coded marketing/SSR references must be censused | CONFIRMED / FALSE / OUTDATED |
| WEB-06 | Current accessibility/performance/browser certification evidence is missing; historical visual QA is not current truth. | repo has no current `axe-core`, Lighthouse or Pa11y gate; existing `scripts/mobile-screenshots.ts` / historical docs are not current certification | CONFIRMED EVIDENCE GAP / OUTDATED |
| INB-E01 | Code fails safely if inbound assignment policy is missing, but GitHub cannot prove production `INBOUND_ASSIGNMENT_POLICY_JSON` contains current reps/capacity. | `server/services/inbound-request-authority.ts:393-423,584-599` | RUNTIME EVIDENCE REQUIRED / OUTDATED |

Do not treat WEB-06 or INB-E01 as reasons to invent architecture. They are certification/evidence items unless preflight finds a concrete code defect.

---

## 3. REQUIRED PUBLIC SURFACE CENSUS

Before editing, enumerate the current public website and acquisition surfaces from current code, including:

- homepage/navigation/footer;
- `/get-started`;
- `/upload-statement`;
- `/free-analysis` and guaranteed/quiz variants;
- `/estimate`;
- `/support`;
- merchant application and public application confirmation;
- public callback controls on Home, ContactBubble and HelpCenter;
- booking/calendar CTAs;
- compare/rate/savings pages that repeat trust, contract, pricing or merchant-count claims;
- industry/location pages that reuse claims;
- affiliate/partner public forms;
- equipment/shop order entry;
- testimonial/newsletter forms;
- legal/privacy/cookie/TCPA/SMS/advertising/refund/merchant-policy pages;
- public SSR renderers and SEO metadata that duplicate claims.

Produce a form/CTA matrix with frontend owner, POST/redirect target, server route, idempotency strategy, attribution fields, consent fields, contact/deal/ticket effects, and confirmation/error state.

Do not include authenticated dashboard routes except where a public form hands work into an authenticated CRM owner.

---

## 4. REQUIRED SEARCH / GREP CHECKS

Search current code for:

- `Cancel Anytime`, `No Early Termination Fee`, `No Penalty`, `month-to-month`, `1-3 years`, `early termination`, `$295`, `$595`, contract length and MPA language;
- `[Bank Partner]`, `registered ISO`, bank/acquirer/processor naming;
- all merchant-count, years-in-business, annual-volume, savings, funding, free-terminal and zero-percent claims;
- `SITE_STATS`, `SAVINGS_RANGE`, `site-content.ts`, SSR copies and SEO descriptions;
- `PewcCheckbox`, `pewcConsent`, `consentSms`, `consentEmail`, TCPA/PEWC disclosure copy, `recordPewcDecision`, `applyConsentCommand`, `processExistingPublicFormSubmission`, `mergePersistedConsentState`;
- cookie consent storage keys, GA/Meta loaders, `gtag`, `fbq`, `analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`, Consent Mode calls;
- `utm_source`, `gclid`, `fbclid`, `msclkid`, landing page, referrer, booking tracking IDs, attribution persistence, offline export consumers;
- every public `POST` route and its Zod/schema/manual validation;
- every `Idempotency-Key` producer/consumer and replay/conflict response;
- phone normalization, email normalization, contact identity matching and callback creation;
- `INBOUND_ASSIGNMENT_POLICY_JSON`, `orchestrateInboundRequest`, assignment evidence, SLA task creation;
- public-form, consent, attribution, CRO-05A/inbound, SEO and browser/mobile tests.

Inspect implementations. Do not equate string presence with correctness.

---

## 5. SOURCE-OF-TRUTH CHECK

Preserve or extend existing canonical owners:

- public content claim contract: `client/src/lib/site-content.ts` where applicable;
- legal/merchant terms: current Terms, Refund Policy, merchant agreement disclosures and the signed MPA hierarchy already documented in source;
- public contact writer/provenance: existing contact-writer and public-form merge services;
- consent authority: existing consent authority/evidence services - no parallel boolean-only system;
- public inbound occurrence/idempotency authority: current inbound request authority plus statement-upload command authority;
- UTM/click-id helper: `client/src/lib/utm.ts` plus existing contact/acquisition/analytics attribution fields;
- analytics event writer: existing analytics event service/schema;
- inbound assignment/SLA authority: `server/services/inbound-request-authority.ts`;
- merchant application service/security architecture: current merchant-application service/routes; do not rebuild it.

Do not create a second CRM lead writer, second consent ledger, second attribution table, second assignment system or new public-form framework unless preflight proves the canonical owner cannot be extended safely.

---

## 6. BLAST RADIUS

### In scope

- reconcile customer-facing contract/ETF claims;
- remove forced marketing/automated-contact consent from service acquisition;
- make unchecked optional marketing consent a no-op, not an implicit withdrawal;
- wire cookie choices to actual tag/Consent Mode behavior;
- make UTM/click-ID capture and handoff coherent;
- fix callback identity/deduplication behavior;
- make retry idempotency stable per logical submission;
- add strict server-side public-form validation;
- remove `[Bank Partner]` placeholder safely;
- reduce public content-authority drift for the verified claims in scope;
- add focused public/browser-safe tests and evidence hooks;
- preserve inbound assignment/task/SLA authority.

### Out of scope

- authenticated CRM role-by-role UX audit/fixes (Stage 3);
- actual production form submissions;
- production lead creation/backfill;
- outbound campaign enrollment/sending;
- paid enrichment/provider activation;
- Google Ads/Meta account changes, budgets or live conversion uploads;
- final Enhanced Conversions/Data Manager certification (later Ads lane);
- final Cloud Browser/browser certification against the deployed SHA;
- processor boarding/underwriting changes beyond keeping the existing merchant application compatible;
- broad site redesign unrelated to verified findings.

---

## 7. COMMERCIAL / LEGAL CLAIM RECONCILIATION - WEB-01

Audit-baseline contradiction:

- `GetStarted.tsx:349-355` says `Cancel Anytime. No Early Termination Fee. No Penalty.` and `No lock-in, no cancellation fees`;
- `MerchantApplication.tsx:1653-1660` repeats the blanket claim;
- `Terms.tsx:91-100` says contract terms may be 1-3 years and an ETF may apply;
- `RefundPolicy.tsx:60-66` says ETFs may be $295-$595 and only some programs are no-ETF;
- `Footer.tsx:305-313` also says contract terms/ETFs may apply.

Required correction:

- establish one evidence-backed customer-facing contract/ETF claim;
- do not invent a universal no-ETF promise if current legal/merchant-agreement sources do not support it;
- if the signed MPA/program catalog proves a specific no-ETF offer, scope the claim to that qualifying program and state the signed MPA controls;
- otherwise replace blanket `cancel anytime/no fee/no penalty` copy with accurate conditional language consistent with the current Terms/Refund/footer authority;
- update repeated SEO/FAQ/help/SSR copies in the same task so contradictory claims are not left elsewhere;
- add a static claim-consistency test or canonical-claim import so future pages cannot reintroduce the contradiction.

Do not rewrite legal terms based on marketing copy. Do not give legal conclusions beyond reconciling the repository's own governing source hierarchy.

---

## 8. MERCHANT APPLICATION CONSENT REPAIR - WEB-02

Audit-baseline defect:

- final-step `canProceed()` requires `reviewConfirmed && pewcConsent` at `MerchantApplication.tsx:535-539`;
- disclosure at `:1594-1597` explicitly says this consent `is not required to obtain services`.

Required behavior:

- the applicant can submit with required application review/underwriting acknowledgments even when PEWC marketing/automated-contact consent is false;
- PEWC remains an optional affirmative checkbox, default false;
- only an affirmative true creates PEWC evidence/outbox consent effects;
- false/unselected does not create marketing permission and does not block the application;
- the merchant application remains idempotent and its protected-data/security behavior is preserved;
- do not merge background/credit-check authorization with marketing/TCPA consent.

Add a regression test proving a valid application can finalize with `pewcConsent=false` while the consent event is absent and all required application acknowledgments remain enforced.

---

## 9. FREE ANALYSIS CONSENT REPAIR - WEB-03

Audit-baseline defect:

- `FreeAnalysis.tsx:343-354` requires `consent` at the final step;
- `:970-972` describes calls, texts and email marketing communications.

Required behavior:

- receiving the requested free analysis cannot depend on granting marketing calls/text/email consent;
- marketing/automated-contact consent must be optional, affirmative and unbundled;
- transactional acknowledgement for the requested submission must remain governed separately by the repository's existing contactability/transactional-response policy;
- unchecked does not create consent and does not create an opt-out/withdrawal;
- checked consent maps to the correct canonical channel/purpose evidence and never broadens beyond the disclosure.

Prefer the shared PEWC/consent component if it accurately represents the channels/purpose. Otherwise keep a dedicated disclosure but make semantics explicit and tested.

---

## 10. UNCHECKED IS NOT OPT-OUT - CONS-01

Audit-baseline issue:

- `public-form-submission.ts:97-108` sends any defined boolean to `applyConsentCommand`, where `false` becomes `kind: "opt_out"`;
- `consent-merge.ts:39-61,65-88` also persists defined false values;
- statement upload passes `parseBool(consentSms)` at `public.ts:457`, which can be false;
- support passes `consentSms === true` at `public.ts:822`, which is false when unchecked.

Required correction:

- distinguish three states: affirmative opt-in, explicit withdrawal/opt-out, and no new consent decision;
- optional public lead/application forms with an unchecked box must pass `undefined`/no command unless the UI explicitly represents an opt-out action;
- STOP/unsubscribe/dedicated preference controls remain explicit opt-out authorities and must not be weakened;
- existing prior consent must not be silently revoked because a user submits another form without checking an optional marketing box;
- existing DNC/opt-out cannot be silently re-enabled by a new public form.

Add regression tests for both existing-contact directions:

1. previously consented + new form unchecked -> prior consent preserved/no new opt-out;
2. previously opted out + new form checked -> re-enable remains blocked per existing authority;
3. explicit unsubscribe/STOP -> opt-out still works.

Do not solve this by making every false value globally ignored; preserve explicit opt-out commands in their actual owners.

---

## 11. COOKIE ENFORCEMENT / CONSENT MODE - PRIV-01

Audit-baseline issue:

- `CookieConsent.tsx:29-62` only stores local preferences;
- `tracking.ts:14-52` immediately initializes GA4 and Meta when IDs exist, before consulting those preferences;
- no `gtag('consent', ...)` implementation was found in the audit.

Required correction:

- necessary-only/reject state must prevent non-essential analytics/marketing processing until consent where required by the chosen policy;
- implement Google Consent Mode using the current supported fields (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization`) and a clear default state before GA config/events;
- Meta Pixel must not initialize/fire marketing events when marketing consent is denied;
- accept-all enables the appropriate categories;
- custom preferences enable only selected categories;
- changing preferences updates tag behavior without duplicate initialization or duplicate events;
- first-load behavior must be deterministic before tags fire;
- preserve necessary functionality independent of marketing consent;
- expose no PII in the consent store.

Use one consent preference reader/event API shared by `CookieConsent.tsx` and `tracking.ts`; do not create two unsynchronized stores.

Add browser-level or DOM/network-mocked tests for reject, accept, custom and preference-change paths.

Final deployed browser/network certification still happens after merge/deploy; this task proves the implementation and deterministic tests.

---

## 12. CLICK-ID / ATTRIBUTION REPAIR - ATTR-01

Audit-baseline issues:

- `utm.ts:41-49` preserves raw `gclid` but only booleans for `fbclid` and `msclkid`;
- `buildAttributedBookingUrl()` at `utm.ts:105-117` forwards UTM + booking tracking ID but no click IDs;
- `FreeAnalysis.tsx:335-340` builds local state from only `utm_*` keys, then `:410-414` tries to read `utmParams.gclid`, so GCLID is not coherently populated through that local path;
- contact schema currently has `utm*`, `landingPage`, raw `gclid` at `shared/schema.ts:92-98`;
- analytics events currently have `gclid_present`, `fbclid_present`, `msclkid_present` booleans at `shared/schema.ts:6973-6981`.

Required correction:

1. use `getStoredUTMParams()` or one canonical attribution helper across public forms instead of page-specific UTM state;
2. preserve landing page and referrer consistently;
3. preserve raw GCLID across forms and booking handoff;
4. preserve FBCLID/MSCLKID to the smallest existing canonical attribution owner if current requirements need later offline/server-side matching;
5. if raw FBCLID/MSCLKID storage is still absent after re-pin, extend the existing contact/acquisition attribution representation with the smallest additive migration rather than creating a parallel attribution subsystem;
6. pass safe click IDs into attributed booking URLs where the destination supports transparent query passthrough;
7. record presence booleans/events consistently;
8. never place email/phone/contact ID in booking query strings;
9. preserve first-touch landing/click attribution according to the current repository policy; do not overwrite good first-touch values blindly on repeat visits.

If a schema migration is required, re-pin after GL-01 and use the next valid migration. Do not assume `0308`; choose the actual next slot.

This task does not perform live Google/Meta conversion imports.

---

## 13. CALLBACK IDENTITY / DEDUPE REPAIR - INB-01

Audit-baseline issue:

- callback route comments explicitly exempt it from the existing email-based merge and directly calls `writeContact()`;
- `public.ts:1206-1223` creates a contact with `email: ""` on every new callback occurrence;
- Home/ContactBubble/HelpCenter all submit name + phone to this route.

Required correction:

- normalize the callback phone using the repository's canonical phone normalization/identity evidence;
- do not silently auto-merge ambiguous phone identities;
- if exactly one safe canonical contact match is supported by current identity authority, attach the inbound occurrence to that contact while preserving a new source/request occurrence;
- if phone maps to multiple contacts or confidence is insufficient, route to durable review rather than creating an uncontrolled duplicate or merging incorrectly;
- if no match exists, create exactly one new contact through the canonical writer;
- repeated delivery of the same logical submission must replay, not create another contact/deal/task;
- distinct legitimate callback requests from the same person remain distinct inbound occurrences while sharing the canonical contact when safely resolved;
- preserve inbound assignment/task/SLA behavior.

Do not create a callback-only identity subsystem.

---

## 14. LOGICAL-SUBMISSION IDEMPOTENCY REPAIR - INB-02

Audit-baseline issue:

- `queryClient.ts:48-60` generates a fresh UUID inside every qualifying `apiRequest()` POST call;
- statement upload already demonstrates the desired stable key pattern at `UploadStatement.tsx:206-236`;
- Free Analysis retains a key with `useRef` across retries at `FreeAnalysis.tsx:385-416`.

Required correction:

- every user-visible public mutation must retain one idempotency key for the logical submission across transport retry, button retry, timeout recovery and replay-status polling;
- generate a new key only when the user intentionally starts a new logical submission or after the prior submission is durably accepted/reset;
- do not hide this inside `apiRequest()` where a retry creates a new occurrence;
- keep the server claim/replay/conflict authority unchanged;
- support timeout-after-commit: retry with the same key must return the prior receipt/status instead of duplicating contacts/deals/tasks/tickets/orders;
- prevent double-click races client-side as a UX layer, but do not rely on disabled buttons as idempotency.

Prefer a small reusable public-submission hook/helper if it reduces duplication without creating a second request authority.

---

## 15. STRICT SERVER VALIDATION - INB-03

Audit-baseline contrast:

- estimate `public.ts:661-668`, support `:804-813`, and get-started `:910-918` destructure raw request bodies before meaningful strict validation;
- integration request already uses a bounded Zod schema at `:1101-1109`;
- newsletter uses a schema at `:1535-1543`;
- testimonial has partial manual guards at `:1445+`.

Required correction:

Add/centralize strict bounded schemas for all public lead mutations in scope. At minimum validate:

- required fields;
- string types;
- reasonable max lengths;
- email format;
- normalized phone length/format where phone is required;
- enums/allowlists for best time, issue type, priority, vertical/goal where appropriate;
- numeric/range or bounded string handling for volumes/fees;
- booleans strictly, without truthy string confusion;
- UTM/click IDs/referrer/landing URLs with bounded length;
- arrays such as pain points with item/count bounds;
- unexpected keys under an explicit policy (`strict` or deliberate strip), not accidental pass-through;
- file upload MIME/size remains enforced by existing multer policy.

Return stable client-safe 4xx errors for hostile/invalid input. Do not echo raw payloads or sensitive values in logs.

Add negative tests for oversized strings, malformed email/phone, invalid enum, unexpected object/array types, duplicate/replay cases and hostile HTML/script strings. Rely on output escaping as well; validation is not HTML sanitization theater.

---

## 16. BANK PARTNER PLACEHOLDER - WEB-04

Audit-baseline issue:

`MerchantApplication.tsx` renders `registered ISO of [Bank Partner]` at `:879`, `:1572`, and `:1665`.

Required correction:

- do not invent a bank/acquirer name;
- first locate a current verified canonical bank/acquirer identity in repository configuration or governed business/legal content;
- if a named partner is verified and approved for public display, use the canonical source;
- if no verified named partner exists, remove the placeholder and use truthful generic wording consistent with `Footer.tsx:305-313` such as acquiring bank partner(s)/processor subject to underwriting;
- no brackets/placeholders may remain in production-visible merchant-application copy;
- add a static scan for public placeholder tokens such as `[Bank Partner]` in customer-facing source.

---

## 17. PUBLIC CONTENT AUTHORITY - WEB-05

Audit-baseline reality:

- `client/src/lib/site-content.ts:1-45` explicitly declares itself the canonical public-site content contract for claims/statistics;
- `Home.tsx:131-134` still hard-codes 10, 5000 and 2400 counters;
- multiple public/SSR/SEO pages repeat `5,000+`, `10+`, `$2B+`, contract and savings claims outside the canonical contract.

Required correction:

- make current React and SSR renderers consume the existing canonical claim/stat objects where practical;
- extend the canonical content contract only for claims actually in current public scope and backed by a documented source/measuredAs/qualifier;
- do not manufacture evidence for `$2B+`, `$2.4B+`, merchant count, savings or other claims;
- if a repeated claim lacks an auditable source, remove or qualify it rather than hard-coding it again;
- keep React, SSR and SEO descriptions semantically consistent;
- add a focused static claim-authority test for the most material trust/commercial claims.

Do not turn this into a full copywriting redesign.

---

## 18. INBOUND ASSIGNMENT / SLA PRESERVATION - INB-E01

Current code already has a strong fail-safe model and must not be replaced:

- policy env owner at `server/services/inbound-request-authority.ts:393-403`;
- missing policy -> `unassigned_policy_missing` at `:415-423`;
- request-owned follow-up task and assignee at `:584-599`;
- SLA due date at `:590-606`.

Build requirements:

- preserve deterministic assignment, request-owned task, work link and SLA evidence;
- do not silently invent a default rep when the policy is absent;
- add a safe configuration/readiness check that reports only policy presence/validity/version/counts needed for operators, never the secret/raw JSON if an equivalent current status endpoint does not already exist;
- if such readiness evidence already exists, reuse it and add tests instead of adding another endpoint.

Production proof of the actual current rep/capacity policy remains a runtime verification item after deployment. Do not hard-code production reps into source just to make this task pass.

---

## 19. ACCESSIBILITY / PERFORMANCE EVIDENCE - WEB-06

This is primarily an evidence gap, but the build must leave a repeatable certification path.

Before adding dependencies, inspect current Playwright/browser/test tooling. Prefer existing tooling.

Required merge-ready evidence where feasible:

- public route crawl has no unexpected 404/500 for the static public route set;
- keyboard/focus basics for primary navigation and forms;
- labels/error association for repaired forms;
- no obvious horizontal overflow at supported mobile widths in existing screenshot tooling;
- no console-error regression in available browser tests;
- current production build/asset-size evidence.

If the repository lacks an accessibility engine and adding one is a small justified dev-only dependency, add it deliberately and lock it portably. Otherwise document WEB-06 as `RUNTIME/BROWSER CERTIFICATION PENDING` rather than faking a Lighthouse/axe result.

Do not mark final accessibility/performance certification complete solely from source review.

---

## 20. DATA / SCHEMA / MIGRATION CHECK

A migration is not expected for claims/consent/idempotency/callback validation fixes.

A small additive migration MAY be required for ATTR-01 if current `main` still lacks raw FBCLID/MSCLKID or another required canonical attribution field and no current attribution owner already stores them.

If migration is needed:

- re-pin the current journal after GL-01;
- use the next valid migration slot;
- update the real Drizzle journal/metadata;
- never edit historical migrations;
- never use `db push`;
- no broad production backfill;
- existing rows remain valid/null;
- add indexes only for proven query paths;
- preserve rollback/read compatibility.

Do not create a new attribution table merely to avoid extending the existing canonical owner.

---

## 21. CONCURRENCY / RETRY / FAILURE CHECK

Prove these cases:

- double-click on each repaired public form;
- network timeout after server commit, then retry with same idempotency key;
- same key/same payload replay;
- same key/different payload conflict;
- callback repeat with same logical key;
- callback same phone as one canonical contact;
- callback ambiguous phone -> review, no unsafe merge;
- existing opted-out contact submits form with unchecked optional consent;
- existing consented contact submits form with unchecked optional consent;
- cookie preference changed after initial load;
- page loaded with analytics/marketing rejected before tag initialization;
- malformed/oversized public input;
- attribution first-touch/repeat navigation behavior;
- booking CTA preserves safe attribution without PII.

Partial failure must surface truthfully. Do not show a success state if the server response is an unhandled failure or an inbound request is left failed/review-required without the user-facing contract being understood.

---

## 22. EXTERNAL SIDE-EFFECT CHECK

All build verification must be isolated.

Do not:

- submit forms to production;
- create production contacts/deals/tasks/tickets/applications;
- send GHL email/SMS;
- enroll sequences;
- call paid enrichment providers;
- call processor APIs;
- fire real ad conversions/imports;
- change Google/Meta/GA4 accounts;
- publish/deploy.

Use disposable test DB/Redis where stateful tests require them and existing fail-fast/provider-deny boundaries from GL-01.

Browser tests should stub/block external marketing/provider endpoints unless a read-only public fetch is explicitly safe.

---

## 23. PREFLIGHT VERDICT

Return one of:

- BUILD-READY;
- BUILD-READY WITH CORRECTIONS;
- NOT BUILD-READY;
- NOT NEW TASK;
- WATCH.

Continue immediately for either build-ready verdict.

A missing live browser session is not a reason to stop the code repair. It is a reason to leave final deployed browser certification pending.

---

## 24. CORRECTED BUILD PLAN

Before editing, print a concise implementation plan grouped exactly into these task-owned workstreams:

1. commercial/legal claim authority;
2. consent/PEWC + unchecked/no-op semantics;
3. cookie enforcement/Consent Mode;
4. attribution/click IDs;
5. inbound callback identity + idempotency + validation;
6. public content authority/placeholders;
7. tests/evidence.

For each workstream list current files, exact intended changes, tests and whether a migration is required.

Then build it. Do not create follow-up tasks for an in-scope defect discovered while tracing these flows.

---

## 25. KILL LINES

- KILL LINE: If a merchant application still requires marketing/automated-contact consent to obtain services, the task has FAILED.
- KILL LINE: If Free Analysis still requires marketing consent to receive the requested analysis, the task has FAILED.
- KILL LINE: If leaving an optional form consent box unchecked can silently opt out a previously consented contact, the task has FAILED.
- KILL LINE: If rejecting non-essential cookies still initializes/fires marketing analytics as though consent were granted, the task has FAILED.
- KILL LINE: If retrying one logical public submission after timeout can create duplicate contact/deal/task/ticket/order effects, the task has FAILED.
- KILL LINE: If callback phone identity is auto-merged ambiguously or uncontrolled duplicates remain the normal path, the task has FAILED.
- KILL LINE: If blanket `no ETF/no penalty` marketing claims still contradict the repository's governing Terms/MPA disclosures, the task has FAILED.
- KILL LINE: If `[Bank Partner]` or another customer-visible placeholder remains, the task has FAILED.
- KILL LINE: If public-form server validation still accepts unbounded hostile types/lengths on repaired routes, the task has FAILED.
- STOP if an existing explicit unsubscribe/STOP path is weakened while fixing optional consent semantics.
- STOP if real production leads, provider sends, ad conversions or processor calls are triggered.
- STOP if a parallel consent, attribution, contact-writer or inbound-assignment authority is introduced.
- STOP if `db push` is used or a historical migration is edited.

---

## 26. IMPLEMENTATION RULES

- Smallest safe diff; no broad site redesign.
- Preserve premium current UI styling unless a verified UX defect requires change.
- Keep consent language readable and clearly optional where optional.
- Do not bury material contract qualifiers only in a distant footer while a nearby component makes an absolute opposite claim.
- Prefer canonical imports/data objects over repeated hard-coded claims.
- Use strict server validation even if the client already validates.
- Client disabled buttons are UX only, not security/idempotency authority.
- Keep existing local-first/contact provenance and CRO-05A inbound ownership intact.
- No production data cleanup/backfill.
- No follow-up tasks for scope-owned defects.

---

## 27. TEST REQUIREMENTS

### Public forms / validation

Extend the current public-form suite to cover every repaired endpoint with:

- happy path;
- missing required fields;
- malformed email/phone;
- oversized strings;
- wrong JSON types;
- invalid enums;
- unknown fields according to policy;
- same-key replay;
- same-key conflict;
- double-click/retry simulation;
- no duplicate durable effects.

### Consent

Prove:

- merchant application submit with PEWC false succeeds when all required non-marketing acknowledgments are complete;
- no PEWC consent evidence is created when false;
- Free Analysis submits without marketing consent;
- affirmative consent creates only intended evidence;
- unchecked repeat form preserves prior consent state;
- prior opt-out cannot be re-enabled by a public form;
- explicit STOP/unsubscribe remains effective.

### Cookie / tracking

Prove with browser/DOM/network mocks or the current equivalent:

- default/reject does not initialize unauthorized GA/Meta behavior;
- accept enables configured categories;
- custom preferences map correctly;
- preference changes update behavior without duplicate init/event storms;
- Consent Mode default/update calls occur in correct order;
- no PII is written into cookie-consent storage.

### Attribution

Prove:

- UTM + landing page survive navigation to each primary form;
- GCLID survives form submit and booking link;
- FBCLID/MSCLKID behavior matches the corrected canonical contract;
- Free Analysis uses the same attribution helper as the rest of the site;
- no email/phone/contact ID in booking query params;
- repeat visit does not accidentally destroy intended first-touch attribution.

### Callback / inbound

Prove:

- same logical callback replay produces no duplicate effects;
- single safe phone match reuses canonical contact while creating a new inbound occurrence;
- ambiguous phone match does not auto-merge;
- new phone creates one contact;
- assignment/task/SLA authority remains intact;
- missing assignment policy remains review-required, not fake success.

### Claims/placeholders

Add a static test that fails on:

- `[Bank Partner]` in customer-facing code;
- known blanket no-ETF/no-penalty strings outside an explicitly approved canonical claim;
- material public stats hard-coded where the canonical claim contract should be used.

---

## 28. SMOKE / INTEGRATION / REQUIRED GATES

Discover the current canonical scripts first. At minimum run the current equivalents of:

- `npx tsc --noEmit`;
- `npm run build`;
- `npx tsx scripts/test-forms.ts` using the corrected zero-egress server boundary from GL-01;
- `npx tsx scripts/test-cro05a-static.ts`;
- `npx tsx scripts/test-consent-authority.ts` or `npm run test:consent-authority`;
- `npx tsx scripts/test-consent-writer-dominance.ts` or the package script;
- `npx tsx scripts/test-consent-field-protection.ts`;
- merchant application security tests (`npm run test:merchant-app-security` if still current);
- `npx tsx scripts/seo-audit.ts`;
- current mobile/public screenshot/browser smoke where supported;
- focused new cookie/Consent Mode tests;
- focused callback/idempotency/attribution tests;
- migration validation only if ATTR-01 legitimately adds a migration;
- `git diff --check`.

Use disposable DB/Redis for stateful tests. No production form submissions.

If Playwright/browser tooling cannot run in the Replit build environment, report that as an environment limitation and keep final deployed browser certification pending. Do not fabricate a pass.

---

## 29. POST-BUILD GREP CHECKS

Prove:

- no `[Bank Partner]` remains in customer-facing code;
- no unconditional `reviewConfirmed && pewcConsent` application gate remains;
- no Free Analysis submit gate requires marketing consent;
- optional form false/unselected values do not become opt-out commands;
- tracking initialization consults the canonical consent state and Consent Mode is wired;
- booking attribution includes the approved click-ID contract and no PII;
- page-specific Free Analysis UTM drift is gone;
- repaired JSON forms no longer rely on a new UUID per transport attempt;
- callback path no longer blindly creates a new empty-email contact for every occurrence;
- strict schemas exist for all repaired public lead routes;
- blanket contract/ETF contradictions have been removed or made program-conditional;
- public material claims use the canonical claim source where required;
- no historical migration changed.

Report actual commands and results.

---

## 30. DIFF REVIEW

Run and report:

- `git status --short`;
- `git diff --stat`;
- `git diff`;
- `git diff --check`.

Confirm:

- only Stage 2 public/inbound files and justified tests/migration changed;
- no secrets/PII/test production records;
- no broad UI redesign;
- no accidental lockfile churn unless a justified dev-only browser/a11y dependency was added and GL-01 portability remains green;
- no publish/deploy;
- no production provider/ad/processor configuration mutation.

---

## 31. FINAL VFC TABLE

Return at least:

| ID | Requirement | Final evidence | Test/gate | Status |
|---|---|---|---|---|
| WEB-01 | Contract/ETF claims reconciled | `file:line` | claim scan | PASS/FAIL |
| WEB-02 | Merchant application PEWC optional | `file:line` | application test | PASS/FAIL |
| WEB-03 | Free Analysis marketing consent optional | `file:line` | form test | PASS/FAIL |
| CONS-01 | Unchecked optional consent is no-op, not opt-out | `file:line` | existing-contact tests | PASS/FAIL |
| PRIV-01 | Cookie preferences enforce tag/Consent Mode behavior | `file:line` | browser/mock test | PASS/FAIL |
| ATTR-01 | Attribution/click-ID path coherent | `file:line` | attribution tests | PASS/FAIL |
| INB-01 | Callback identity/dedupe safe | `file:line` | callback tests | PASS/FAIL |
| INB-02 | Logical-submission idempotency stable | `file:line` | replay/timeout tests | PASS/FAIL |
| INB-03 | Strict server validation on public routes | `file:line` | negative tests | PASS/FAIL |
| WEB-04 | No bank-partner placeholder | `file:line` | static scan | PASS/FAIL |
| WEB-05 | Material public claims use canonical authority | `file:line` | claim-authority test | PASS/FAIL |
| WEB-06 | Repeatable browser/a11y/perf evidence path exists | test evidence | browser gate | PASS/PENDING |
| INB-E01 | Assignment authority preserved; production config proof separated | `file:line` | assignment tests | PASS/RUNTIME PENDING |

Every Done Looks Like requirement and kill line needs evidence.

---

## 32. FINAL RESPONSE FORMAT

Return:

1. VERDICT;
2. starting branch/SHA and ending implementation SHA;
3. migration head before/after and migration name if any;
4. current public form/CTA census summary;
5. verified root cause for every retained finding;
6. exact changed files with `file:line` summary;
7. tests/gates with real commands/results;
8. disposable/provider-denial proof;
9. post-build grep proof;
10. kill-line proof;
11. explicit list of deployment/browser/runtime checks still pending;
12. final status: `SAFE TO MERGE`, `SAFE TO MERGE - RUNTIME/BROWSER VERIFICATION PENDING`, or `DO NOT MERGE`.

Do not claim Stage 2 CERTIFIED from this build alone. Final deployed browser/network/form canaries happen after merge and deployment of the exact release candidate.

---

# TASK TO PREFLIGHT + BUILD

## What & Why

The current public/inbound architecture is materially stronger than the September preliminary audit: durable inbound occurrences, request-owned tasks, SLA evidence, protected existing-contact merges and statement-upload idempotency already exist. The remaining Stage 2 blockers are concentrated at the public boundary: contradictory merchant terms, forced marketing consent, cookie preferences that do not govern tags, incomplete click-ID attribution, callback identity duplication risk, per-attempt idempotency on common JSON forms, inconsistent hostile-input validation, customer-visible placeholder copy, and public claim-authority drift.

Fix those within the existing authorities. Do not rebuild the funnel.

## Done Looks Like

- Public contract/ETF claims are truthful and internally consistent with governing terms/MPA hierarchy.
- Merchant application and Free Analysis work without requiring marketing/TCPA consent.
- Optional unchecked consent does not revoke prior consent and affirmative public forms cannot override prior opt-outs.
- Cookie reject/custom/accept choices actually control analytics/marketing behavior and Google Consent Mode state.
- UTM, landing page and click-ID attribution use one coherent path through forms and booking handoff.
- Callback requests reuse safe canonical identity or enter review rather than blindly creating duplicates.
- Every public logical submission uses stable retry idempotency.
- Public lead routes use strict bounded server validation.
- No `[Bank Partner]` placeholder remains.
- Material public claims come from a canonical documented source rather than scattered hard-coded copies.
- Inbound assignment/task/SLA behavior remains fail-safe and unchanged in authority.
- No real production lead, outreach, provider, ad or processor side effect occurs during build.
- Final deployed browser certification remains explicitly pending after merge.

## FINAL DIRECTIVE

Re-pin after GL-01, verify first, then build every still-valid Stage 2 correction in this one task. Do not message the owner with a new list of follow-up tasks. Do not publish. Do not submit real production forms. Finish with a clean, tested, merge-ready implementation and exact evidence, leaving only genuine deployed-browser/runtime verification for the later certification pass.
