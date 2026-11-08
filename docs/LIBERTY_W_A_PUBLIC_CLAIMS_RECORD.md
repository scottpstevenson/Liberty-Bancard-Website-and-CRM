# Liberty W-A Public Truth and Terms — Claims Record

Date: 2026-11-08
Scope: LI-W03 (equipment and contract terms), LI-W06 (statement fee explanation and data handling), LI-W09 (timing and funding), LI-W10 (zero-percent program), LI-W12 (integration compatibility), LI-W13 (competitor pricing).
Routes owned: `/free-smart-terminal`, `/upload-statement`, `/0-percent-processing`, `/integrations`, `/compare/square` (and the other comparison, alternatives, switch-from, rates and Square-versus pages that read the same records).
Governing contract: `attached_assets/Liberty-W-A-Truth-and-Terms_1794148597077.md`.
Status: source and fixture work complete. Published by the owner on 2026-11-08; the live site serves source commit `1a90e734` (the tested candidate) and a read-only read-back of 18 live routes found none of the retired assertions (section 7a).

## 1. Identity of what was tested

| Item | Value |
| --- | --- |
| Base commit | `f20104fa` (main) |
| Candidate | Working tree on top of `f20104fa`, not committed by this work; 43 tracked files changed plus 8 new files (`shared/public-claims.ts`, `shared/public-disclosures.ts`, `shared/competitor-pricing.ts`, `shared/compare-content.ts`, `shared/integrations-content.ts`, `shared/zero-percent-content.ts`, `server/data/public-claim-evidence.ts`, `scripts/test-public-claims-contract.ts`). The built artifact reports `f20104fa` because the build identity records HEAD, not the dirty tree. |
| Baseline for performance | A `git archive` snapshot of `f20104fa` built and served from a throw-away directory outside the workspace (no change to the workspace Git data), same isolated-preview harness and disposable database as the candidate. |
| Schema, migrations, journal, lockfile, dependencies, theme, settings | Unchanged. No `statement_auto_analysis_enabled` or other setting was written. No GHL, provider, paid, Gmail or message call was made. |
| Routes and parameters | All route URLs, `offer=free-terminal`, `?terminal=yes` and the "Free Smart Terminal" navigation label and URL are unchanged. |

## 2. What changed

A typed claim register (`shared/public-claims.ts`) now holds every governed statement. A claim shows wording only when its disposition is `approved` and it names an evidence key held in the server-only register (`server/data/public-claim-evidence.ts`). `withheld` and `retired` claims carry no wording and resolve only to an approved fallback or to nothing. React pages, server-rendered pages, navigation, footers, route metadata and structured data read the same selectors, so the two renderers cannot drift.

Register contents: 53 claims — 21 approved, 2 withheld (`equipment.placement.no-upfront`, `equipment.volume-threshold`), 30 retired. 12 dated competitor price records. 21 integration records, all inquiry-required. 10 owner-evidence items (OE-01 to OE-10) in the server-only register; the evidence register is verified absent from the built client bundle.

| Area | Result for the visitor |
| --- | --- |
| Equipment and contract (LI-W03) | No visible "free", "no upfront" or "month-to-month / no early termination / you own the equipment" assertion. Wording: the written processing agreement and equipment arrangement set fees, term, cancellation and return; equipment availability and processing costs are confirmed during review; models named only as options. Footer, Terms-consistent disclosure typed once and read by both footers. Eligibility is phrased as the questions Liberty will ask; numeric thresholds removed. |
| Timing and funding (LI-W09) | No 48-hour, same-day, one-business-day, 2–3 / 3–5 day or "next-day funding" windows on any page in scope. A staged vocabulary is used (received, review, approval, availability, shipping, setup, activation) and funding is described as dependent on product, eligibility, cutoffs, and bank and risk conditions. |
| Statement review (LI-W06) | Fee taxonomy of at least three categories (interchange, network assessments and fees, processor and Liberty charges), a stated effective-cost definition, and handling text limited to traced facts (stored in encrypted form, retrieved through authorized access; use described by the Privacy Policy). Removed: "never sold or shared", "team-only", confidentiality badge, any retention or deletion promise, any statement that analysis is automatic or AI, industry rate ranges, savings benchmarks. |
| Zero-percent program (LI-W10) | Cash discount and surcharging presented as two different programs, credit/debit/prepaid treated differently, remaining costs and requirements stated, no legality opinion, no "legal in all 50 states", no uniform fee, no dollar math, no "pay $0". |
| Integrations (LI-W12) | Every record "tell us your platform and version; we'll confirm supported options and limitations". No platform count, no "0 lock-in", no fee-bypass claim, no active check marks. |
| Competitor pricing (LI-W13) | Only published list rates with plan, channel, source URL and check date (section 5). Toast shows no rate (none published). Liberty prices, markups, savings and contract terms are never stated; the statement review supplies the comparison. No Review or AggregateRating schema on the owned routes. |
| Long-tail copies of the same claims | Hard-coded duplicates of the retired equipment, contract and timing statements were replaced with the shared selectors on: Get Started (quiz terminal step and contract strip), Merchant Application (contract strip), Free Analysis (FAQ, trust strip, 48-hour lock-in line, badge), Help Center FAQ (contract and approval timing), Why Liberty, About and Contact meta, Terminal Shop (free-placement copy, 24-hour and one-business-day windows, and the internal margin, payback and "Auto-approve / Rep discretion / Mgr approval" tables that were publicly visible were removed), Partner Branded page, Savings Calculator (equipment card, upload FAQ), Home, FAQ, Industry pages, Testimonials ("same day" line), Asset page and glossary entries that restated the retired Square rate, the site-wide Organization schema on every public page ("Wholesale pricing, next-day funding" description and a "Next-Day Funding" service offer, now neutral wording), the Why Liberty schema description, the Help Center funding FAQ ("next-day … instead of 2-3 days", now the shared funding-availability statement), and the Free Analysis "Next-Day Funding" badge. |

## 3. LI-W evidence table

| LI-W row | Verified now (source) | Build commit | Route | Test | Verifier / date | Unresolved input |
| --- | --- | --- | --- | --- | --- | --- |
| LI-W03 terminal terms | Source complete: both renderers read one agreement/options record; "free"/no-upfront withheld | Working tree on `f20104fa` (uncommitted) | `/free-smart-terminal`, footer, Get Started | Contract suite (inventory scan, parity, selector suppression), mobile gate | Public-site build agent, 2026-11-08 | Executed agreement, equipment inventory and placement entitlement, fees, minimums, return and termination terms |
| LI-W06 fee explanation and data handling | Source complete: taxonomy, effective-cost definition and traced-fact handling text | same | `/upload-statement`, thank-you and merchant upload pages | Contract suite, parity, mobile gate | same | Retention and deletion policy, processor terms, approved human/AI disclosure |
| LI-W09 fulfillment timing | Source complete: no windows on any in-scope page; staged vocabulary | same | `/free-smart-terminal`, `/upload-statement`, Home, Get Started, Help Center, Free Analysis | Contract suite (timing patterns), parity | same | Fulfillment and support capacity; funding availability per product, cutoff and risk |
| LI-W10 zero-percent program | Source complete: two-program wording, no opinion or math | same | `/0-percent-processing`, quiz program card | Contract suite, parity, mobile gate | same | Acquirer rules for cash discount and surcharging by state and card type |
| LI-W12 compatibility | Source complete: 21 inquiry-required records | same | `/integrations` | Contract suite, parity, mobile gate | same | Per-product version and path test evidence |
| LI-W13 competitor pricing | Source complete: 12 dated, sourced records; Toast omitted | same | `/compare/*`, `/compare-rates`, `/beat-square-stripe`, `/alternatives/*`, `/switch-from/*` | Contract suite (price record validator, Square record negative controls) | same | Liberty pricing intentionally not stated |

A row is source-complete only. None is "Done" until the owner publishes, the live site is read back, and the unresolved inputs are supplied.

## 4. Owner-evidence register (safe fallbacks in force)

| Evidence needed | Status | Fallback implemented (holds only the affected claim) |
| --- | --- | --- |
| Current processing and equipment agreement (term, ETF, minimums, ownership, loaner vs lease-to-own, return, non-return and replacement fees) | Not in repository; Terms page is a public summary | "Your written processing agreement and equipment arrangement set the applicable fees, term, cancellation and return requirements." No month-to-month, no-ETF or ownership assertion |
| Equipment inventory and placement rights | Not in repository | "Explore equipment options for your business. Availability, processing costs and equipment terms are confirmed during review." Models named only as options |
| Fulfillment and support capacity | Not in repository | Staged statement with no windows |
| Funding availability per product, cutoff and risk | Not in repository | Funding depends on product, eligibility, cutoff and bank/risk; no universal next-day claim |
| Acquirer program rules for cash discount and surcharge | Not in repository; Visa and Mastercard sources differ | Two distinct options needing business-specific review; no legal opinion, registration promise or fee cap |
| Supported integration product, version and path | Not in repository | Every record inquiry-required; none shown as active |
| Statement retention, deletion, processor terms, approved AI disclosure | Not in repository; code shows encrypted storage, no deletion caller, no retention period, analysis held | Handling text limited to traced facts and the Privacy Policy |
| Case releases and consent for LB-CS-01/02 and current cases | Not in repository | Private records only; publication stays with W-D; unreleased cases not called verified |
| Image, logo, portrait and device rights | Not in repository; all registered images unverified | Registers stay unverified/withheld; text-led fallback for unfilled slots |
| PCI DSS attestation for the server-footer badge | Not in repository | Server footer matches the React footer wording; no certification claim |
| Official prices for non-Square competitors | Re-verified at build (section 5) | Dated records, or no rate when none is published |
| Liberty markup, monthly charge, per-item fee, ticket mix | No source | Not stated anywhere |
| Company statistics (years, merchants served, volume) | No evidence | Labelled by actual evidence state; hard-coded duplicates handed to W-D |

## 5. Competitor price re-verification (checked 2026-11-08)

| Provider / channel | Published rate used | Source |
| --- | --- | --- |
| Square Free, in person | 2.6% + 15¢ | squareup.com/us/en/pricing |
| Square Free, online | 3.3% + 30¢ | squareup.com/us/en/pricing |
| Stripe Payments, online | 2.9% + 30¢ | stripe.com/pricing |
| Stripe Terminal, in person | 2.7% + 5¢ | stripe.com/pricing |
| Clover, lowest advertised plan | "as little as" 2.3% + 10¢ | clover.com/pricing |
| PayPal Point of Sale, card present | 2.29% + 9¢ | paypal.com/us/business/paypal-business-fees |
| PayPal payment links | 2.99% + 49¢ (cards) / 3.49% + 49¢ (checkout) | paypal.com/us/business/paypal-business-fees |
| Helcim interchange-plus, $0–$50K monthly | in person: interchange + 0.40% + 8¢; keyed: + 0.50% + 25¢ | helcim.com/pricing |
| Authorize.net All-in-One | 2.9% + 30¢ plus monthly fee | authorize.net pricing page |
| Authorize.net Gateway Only | 10¢ per transaction plus monthly fee and daily batch fee | authorize.net pricing page |
| Toast | No published rate; omitted with an inquiry note | n/a |

The former Square figure "2.6% + 10¢" is retired everywhere in scope; the validator rejects any Square record that is not the checked rate, or that lacks a source or date.

## 6. Census (TypeScript/TSX under client, server and shared; blog data, help-center data and seed data excluded)

| Pattern | Before | After | Remaining matches (classification) |
| --- | --- | --- | --- |
| "0.15-0.40%" | 11 | 0 | — |
| "0.20% markup" | 6 | 0 | — |
| "$2,000–$6,000" | 10 | 0 | — |
| "$600–$3,200" | 2 | 0 | — |
| "$0.07" | 7 | 1 | Case studies historical customer fact (W-D) |
| "2.6% + $0.10" | 27 (preflight scope) | 17 on the post-change command, which also includes blog server data (4) and internal prompts (3) | Internal non-public: business vault 3, workflow prompts 3, seed campaigns 1; historical case studies 3 (W-D); Asset page 2 and glossary 1 worked examples with invented figures (W-D); blog server data 4 (W-D) |
| Free-terminal-type phrases | Preflight list: competitor SSR 15, comparison page 9, server compare 9, Terms 8, terminal shop 4, advertising disclosure 4, sales one-pager 3, merchant policies 2, others | Owned and public marketing surfaces: 0 current claims; label "Free Smart Terminal" (navigation, breadcrumb) retained by decision | Policy pages (Terms 8, Advertising Disclosure 4, Merchant Policies 2, Refund 1) read-only legal text; glossary 8, blog server 4, sales one-pager 3, internal sales/voice/email/seed services, dashboards and offer router are non-public or W-D; partner pages ("no upfront cost" to join) are not equipment claims |

The preflight command text was not preserved verbatim, so before and after counts are comparable by direction and by file, not as an exact reproduction.

## 7. Verification results

Each layer is reported separately.

**Source and fixture.**
- Contract suite `scripts/test-public-claims-contract.ts`: 14 families, 664 assertions, 31 negative controls, 0 failures. It is static (no server, database, provider or network), also passes with database and Redis variables unset, and with `PUBLIC_CLAIMS_REQUIRE_BUNDLE=1` against a freshly built client (the server-only evidence register is absent from the bundle). Registered in `scripts/pre-deploy.ts` (mandatory suites) and `scripts/ci-suite-manifest.ts` (deterministic-static); `scripts/ci-suite-manifest.ts --check` valid.
- Production build succeeds (only the existing `import.meta` warning in `email-pre-filter.ts`).
- Focused type check over every modified TypeScript and TSX file and the suite: no errors in changed code. Remaining unused-import warnings are present at `f20104fa`. **A whole-project type check was not run.** `git diff --check` clean.

**Rendered-output scan (Chromium, dev server, 390 px).** After hydration, the page text, title, meta description and every JSON-LD block of 22 public routes (the five owned routes, the other comparison, rates and Square-versus pages, Home, FAQ, Get Started, Shop, Free Analysis, About and Contact, Why Liberty, Savings Calculator, Merchant Application, two industry pages, the statement thank-you page, and a switch-from page) were searched for the retired assertions (month-to-month, no-ETF, ownership, no-lock-in, 48 hours, same-day, one-business-day, all-50-states, never-shared, the retired Square rate, invented Liberty markups and savings ranges, free/no-upfront equipment, contract-term assertions, next-day funding, internal margin tables). The scans and a follow-up search of the sources found five places still carrying a universal next-day funding claim (the site-wide Organization schema description and its service offer, the Why Liberty schema description, the Help Center funding FAQ and the Free Analysis funding badge); all were fixed, the contract suite was extended to cover them (with a negative control), and the second pass was clean except the Help Center article list (see handoffs). This scan was run once with a temporary script that is not kept in the repository; it is not a repeatable gate. FAQ answers were opened before scanning; text hidden behind other interactions was not.

**Browser (Chromium only, lab).**
- Mobile gate (`check-public-site-mobile.ts`; 390 and 1440, light and dark, owned routes; then 390 and 1440 light and dark for Free Analysis, Help, About and Contact, Why Liberty, Savings Calculator, Shop, Merchant Application and Get Started; then 320, 768 and 1024 light for all of those plus the owned routes and FAQ): no horizontal overflow and no failures in changed markup. The only findings outside the baseline items below are on `/merchant-application` (contrast ratios 4.0 to 4.44 on small muted step labels and the form footer, and small tap targets on the step buttons): these come from the form's existing stepper and muted-text styling, my edit changed only the wording of one paragraph that already used the same classes, and the route is not in the gated list, so it is recorded as baseline and handed off, not changed here. One contrast defect on `/integrations` (caused by this work) was fixed and re-verified. Small tap targets (<44 px) on `/integrations` (filters, "Learn more"; also at 320) and `/beat-square-stripe` (two comparison links) at 390 are unchanged markup present at `f20104fa` on routes outside the gated list — baseline, not widened into scope.
- Overlay check (`check-public-overlay.ts --strict`): 22 probes, 0 failed.
- Fonts check (`check-public-fonts.ts --strict`): 25 of 26 routes ok. `/industries/retail-payment-processing` failed on the web-font-swap shift (0.2336). The same total layout shift (0.2339, one shift about 4.7 s after load) appears with the `f20104fa` version of the Industry page, appears intermittently as a font shift (three reruns passed), and the route measures CLS 0 in the production-profile performance run — baseline and intermittent, not introduced here.
- Performance (`check-public-perf.ts`, isolated production preview on port 6100, 390×844, DPR 2, CPU ×4, 1.6 Mbps / 150 ms, cold cache, 5 runs, medians): median LCP (ms) / CLS, baseline `f20104fa` versus candidate (final build). `/faq` 1168 / 0.0157 → 1096 / 0.0157; `/get-started` 768 / 0.0002 → 752 / 0.0017; `/` 1636 / 0 → 1772 / 0; `/upload-statement` 1316 / 0.0254 → 1052 / 0.0023; `/0-percent-processing` 948 / 0.0367 → 1052 / 0; `/free-smart-terminal` 880 / 0 → 1020 / 0; `/integrations` 820 / 0.0028 → 848 / 0.0025; `/compare/square` 896 / 0.0023 → 996 / 0.0049 (total transfer 1134 KB → 1001 KB). All eight routes are within the 2.5 s LCP and 0.1 CLS budgets on both builds; image bytes and request counts are unchanged (the 2.1 MB on `/free-smart-terminal` and `/0-percent-processing` is the existing hero image). Earlier candidate run on the previous build: `/compare-rates` 808 / 0.0073, `/industries/retail-payment-processing` 920 / 0. That earlier run also reported `/faq` at 5204 and 3832 ms and `/get-started` at 4200 ms with CLS about 0.1 while the machine was busy; the repeat on the rebuilt candidate, with the same profile, returned the values above, so the slow figures are recorded as a loaded-machine measurement, not a regression. Baseline and candidate were measured one after the other in the same session on the same host, not simultaneously.
- Not exercised: Safari/WebKit and real iPhone (WebKit cannot run here); Chromium cannot load port 6000. Lab results are not field performance. Keyboard, 200% zoom, 320/768/1024 widths and Back/Forward were covered by the existing gates only where those gates test them.

- Route validation check (`test-public-route-validation.ts`): 12 passed, including the Get Started submission checks.

**Deployed UI.** See section 7a.

**Data and schema.** No schema, migration or data change; nothing to verify.
**Receipt delivery, native booking, GHL, advertising and outbound activation.** Not touched and not verified; all outbound controls remain as found.

## 7a. Post-Publish read-back (2026-11-08)

The production health endpoint reported source commit `1a90e734`, built 2026-11-08 17:52 UTC (`env: production`, publish build `f8e627db`), an ancestor of the current main head that contains the full candidate. Read-only, unauthenticated, Chromium with analytics and third-party scripts blocked: the hydrated text, title, meta description and JSON-LD of 18 public routes (the five owned routes, the other comparison and rates pages, Home, FAQ, Get Started, Shop, Free Analysis, About and Contact, Why Liberty, Savings Calculator, Merchant Application and the retail industry page) contain none of the retired assertions, no Review or AggregateRating schema and no evidence-register marker. The raw server HTML of `/why-liberty-bancard` still includes a "Next-Day Funding" card that hydration replaces (W-D). `/free-smart-terminal` and `/shop` are served as the client shell. Not read back: the production outbound pause, receipt capability and provider controls; Safari/WebKit and real devices; field performance.


## 7b. Post-Publish review corrections and W-B design (2026-11-08)

Follows 7a. The external post-Publish review (`attached_assets/Liberty-W-A-Post-Publish-Review-2026-11-08_*.md`) found three consumer gaps (R01–R03), asked for this record to be updated (R04) and listed W-B design priorities (B1–B5). All of it is below. Earlier dated evidence in sections 7 and 7a is unchanged; those measurements were taken on the builds named there and are not restated as measurements of this tree.

**Source and build identity.** Base `2a3671a6` (the commit that contains the published `1a90e734` tree plus later memory notes) with the working-tree changes described here, uncommitted at the time of writing. Production build from that tree: publish artifact build `a60d049d-cf77-4d8a-a995-72b5aa84ddd0` (after the last source edit; earlier builds in the same session were superseded). Node v22.23.4 and npm 10.9.9 were used; the project pins npm 10.9.4 (not changed, recorded because the lockfile-sensitive steps were run on 10.9.9). No dependency, schema, migration, setting or data change.

**R01 (shop/promotion claims).** The promotion banner/list/inline/card variants, their Free Analysis and shop consumers and the retained shop equipment/fee assertions now read the approved shared claims and fallbacks. Free-processing, no-lease, zero-monthly and "eliminate processing fees" wording is gone from them; with no owner evidence the wording is a qualified inquiry. `FREE30` stays only in the call-to-action link and attribution; the routes, the offer id and intake behavior are unchanged. Retired-claim entries for the old promotion wording were added to the register.

**R02 (comparison qualifiers).** Every comparison table, FAQ, JSON-LD block and server summary keeps the product, plan, channel and rate qualifier with its rate (including wording that precedes a rate, such as "as little as"). Authorize.net All-in-One and Gateway Only are separate records; no Liberty no-gateway-layer assurance is shown without a confirmed path; PayPal's point-of-sale payment-link price stays tied to that product context and is not shown as a generic Pay Later price. Price records still carry the 2026-11-08 check date.

**R03 (debit and prepaid).** The shared statement, the program FAQ, schema and Home/program consumers say that credit-card surcharging does not apply to debit or prepaid cards and keep cash discount separate. No universal legal claim and no uniform rate were added. The evidence register has an official-source entry for the card-network position (read 2026-11-08).

**B1 (server-only comparison and switch pages).** Cause: these pages called the shared server navigation and footer, but the stylesheet that sizes the logo was not on the page, so the logo rendered at its intrinsic 3,360 px width. One shared server-shell stylesheet (`SSR_CHROME_CSS` in `server/ssrShared.ts`) is now emitted inline by every server page, including the competitor families, so there is no extra request and no content-security-policy change. The shell uses a no-script disclosure menu with a 44 px toggle, the same groups, hub link, Support link and call to action as the React shell (single model in `shared/public-navigation.ts`), and Merchant login is omitted until the owner supplies the URL. No overflow is hidden. While verifying, the comparison pages' light-blue links and buttons (3.5 to 3.7:1) were moved to the shared navy/red tokens and a darker link blue (at least 4.5:1), and the audit helper was corrected to ignore content inside a closed `<details>` element (it measured collapsed, unrendered menu links as small targets).

**B2 (`/free-smart-terminal` at 320 px).** The call-to-action buttons wrap (`h-auto`, `whitespace-normal`, `max-w-full`) instead of extending past the column; the label wording and offer attribution are unchanged.

**B3 (tap targets).** The Integrations category filters and Learn-more links and the Beat Square/Stripe comparison links now have a minimum height of 44 px; the selected, hover and focus styling is unchanged.

**B4 (design).** Liberty navy `#071D57`, red `#C8102E` and the light surface `#F4F6FA` extend the palette (the existing primary token is untouched) with contrast asserted in the suite. New shared React and server navigation with a compact mobile header, a new `/industries` hub (React and server render; sitemap and SEO entries), Home rebuilt around one hierarchy (hero with a primary path to the payment solutions and the shared call to action; starting points that lead to the free statement review and the equipment inquiry; a sample review layout labelled illustrative; solutions; industries; programs; a text-only founder note; FAQ), and a rebuilt About and Contact page with intent-based paths and no stated hours, response time or address. Home copy is shared between React and the server render (`shared/public-home-content.ts`). No new promotion, price or Liberty term was written; commercial wording stays in the shared contracts.

**B5 (responsive imagery).** The five public pages that imported raw 0.7 to 1.1 MB terminal PNGs (`/free-smart-terminal`, `/0-percent-processing`, `/beat-square-stripe`, `/get-started`, `/shop`) now use the existing derivative pipeline: six product sources with 320 and 640 px AVIF/WebP/JPEG (JPEG flattened on white), about 5 to 10 KB (320) and 10 to 26 KB (640) in AVIF, declared dimensions, lazy loading below the first screen, and registry records marked illustrative and unverified (they do not assert that a device is free or included). Existing derivatives are byte-identical. The shared header and footer logos (3360 by 697 px PNGs of about 75 KB each, which the server shell inlined as base64 twice per page) now ship as 420 px derivatives of about 8 KB (`logo-blue-420.png`, `logo-white-420.png`) in the React shell and inline in the server pages; the originals stay for emails and dashboards. The `/alternatives/square` document went from 218,909 bytes (baseline preview) to 47,804 bytes.

**Verification (this tree).**
- Contract suite: 18 families, 938 assertions, 90 negative controls, 0 failures; also with `PUBLIC_CLAIMS_REQUIRE_BUNDLE=1` against the fresh build. New family `w-b-design-consumers` covers navigation/home/contact/industries models, rendered server output of the shared shell, contrast tokens, raw-PNG imports, derivative budgets (60 KB), shell logo derivatives and server-shell weight, comparison-page colors and call-to-action wrapping, each with negative controls. `ci-suite-manifest.ts --check` valid; `build-public-images.ts --check` ok (13 sources); `test-public-route-validation.ts` 12 passed; `npm run build` succeeds; a focused type check of the changed files shows only errors that exist at `2a3671a6` (a Router children typing in the suite and `getTransactionConfigSQL` in `server/db.ts`). A whole-project type check was not run.
- Isolated production-profile preview (port 6100, disposable database and Redis; the platform adds a port mapping to `.replit` for it, removed afterward). Chromium only.
  - `check-public-wb-design.ts --strict` (new): 320 probes, 0 failed: initial no-JavaScript HTML of `/`, `/industries`, `/alternatives/square` and `/switch-from/square` (one h1, shared shell and footer, inline shell stylesheet, hub link, no login link); header, logo, menu and hydration/CSP console checks for eight routes at 320/390/768/1440; the terminal call to action at 320 px and at an emulated 200% zoom (640 CSS px, DPR 2) including keyboard Tab focus and the loaded product derivative; all FAQ/accordion triggers expanded at 320 and 390 on five pages.
  - `check-public-site-mobile.ts --strict`, 320/390/768/1440, light: the 27 gated routes (including `/industries`), 108 page states, 0 with findings; plus `/integrations`, `/beat-square-stripe`, `/compare/stripe`, `/compare-rates` and every `/alternatives/*` and `/switch-from/*` slug (28 routes), 112 page states, 0 with findings (before the contrast and closed-menu corrections the 24 server-only pages reported contrast and target findings; they are the ones fixed under B1).
  - `check-public-overlay.ts`: 22 probes, 0 failed. `check-public-fonts.ts --strict`: 27 routes ok, CLS 0. `seo-audit.ts`: passed (a title and a description that exceeded their length limits at `2a3671a6` were shortened: the program page title and the Home meta description).
- Performance: see the table below (matched baseline `2a3671a6` versus candidate).

**Performance (matched).** `check-public-perf.ts` against two isolated production-profile previews built and served one after the other on the same host (never concurrently): baseline is a `git archive` of `2a3671a6` (build `aa47bfdc-7b67-4f87-9da3-c67f1a61be2f`), candidate is build `a60d049d-cf77-4d8a-a995-72b5aa84ddd0`. Profile: 390 by 844, DPR 2, CPU x4, 1.6 Mbps / 150 ms, cold cache, 5 runs, medians. LCP in ms / CLS; transfer is the sum of network responses (inline data URIs are not counted).

| Route | Baseline LCP / CLS | Candidate LCP / CLS | Total transfer | Image bytes |
|---|---|---|---|---|
| `/` | 1640 / 0 | 1800 / 0.0159 | 1154 KB → 1022 KB | 168 KB → 36 KB |
| `/upload-statement` | 1012 / 0.0023 | 1108 / 0.0023 | 1001 KB → 869 KB | 148 KB → 16 KB |
| `/faq` | 5176 / 0.0002 | 4672 / 0.0002 | 1001 KB → 869 KB | 148 KB → 16 KB |
| `/0-percent-processing` | 880 / 0 | 916 / 0 | 2997 KB → 869 KB | 2144 KB → 16 KB |
| `/free-smart-terminal` | 1088 / 0 | 1080 / 0 | 3006 KB → 922 KB | 2151 KB → 66 KB |
| `/shop` | 920 / 0.0115 | 952 / 0.0001 | 1648 KB → 900 KB | 792 KB → 45 KB |
| `/get-started` | 992 / 0.0002 | 880 / 0.0002 | 1001 KB → 869 KB | 148 KB → 16 KB |
| `/integrations` | 1020 / 0.0025 | 792 / 0.0025 | 1001 KB → 869 KB | 148 KB → 16 KB |
| `/beat-square-stripe` | 1000 / 0.0128 | 752 / 0.0134 | 2997 KB → 869 KB | 2144 KB → 16 KB |
| `/compare/square` | 808 / 0.0049 | 744 / 0.005 | 1001 KB → 869 KB | 148 KB → 16 KB |
| `/alternatives/square` | 356 / 0 | 212 / 0 | 3 KB → 3 KB | 0 KB → 0 KB |
| `/switch-from/square` | 244 / 0 | 192 / 0 | 3 KB → 3 KB | 0 KB → 0 KB |
| `/about-contact` | 6816 / 0.0015 | 788 / 0 | 1289 KB → 878 KB | 434 KB → 22 KB |
| `/industries/restaurant-payment-processing` | 824 / 0 | 876 / 0 | 1022 KB → 890 KB | 169 KB → 37 KB |
| `/industries/retail-payment-processing` | 1032 / 0 | 788 / 0 | 1020 KB → 888 KB | 167 KB → 35 KB |

Candidate: 15 routes, 1 over the 2.5 s LCP / 0.1 CLS budget (/faq). On an initial load (below-the-fold images are lazy and not requested) image bytes on `/0-percent-processing`, `/free-smart-terminal` and `/beat-square-stripe` fall from about 2.1 MB to 16-66 KB, `/shop` from 792 KB to 45 KB, and every page sheds about 130 KB of logo PNG. Home CLS is 0.0159 against 0 at baseline (inside the 0.1 budget; not investigated further). `/industries` has no baseline (the route is new). The server pages (`/alternatives/square`, `/switch-from/square`) show a few KB of transfer because the logo is an inline data URI and the document is not counted by the harness; the document is measured separately (218,909 bytes at baseline, 47,804 bytes now for `/alternatives/square`). **`/faq` is over the LCP budget on both builds in this session and is not fixed here:** candidate 4672 ms (a seven-run repeat gave 8720 ms; CLS 0.0002), baseline 5176 ms (repeats 3508 and 2804 ms, CLS 0.1036). Single-load probes of both builds show the same spread (first paint 2.5-8 s, largest paint 4-12 s) behind the same render-blocking stylesheet and the hydrated FAQ block, while the earlier W-A session and the first candidate run measured about 1.0-1.1 s, so the figure tracks host load and is not caused by this change; it is carried to W-D. The baseline `/about-contact` first run read 6816 ms and two repeats captured no paint (a blank measurement, not a result), so that baseline figure is not used for a before/after claim; the candidate value (788 ms) was stable across both candidate runs. Lab measurement on Chromium; not field performance and not Safari or a real device.

**Not exercised.** Safari/WebKit and real iPhone/Android devices (WebKit cannot run here); the dark color scheme beyond the default gates; field performance; signed-in screens; live form submission, receipt delivery, native booking, GHL and advertising behavior; the production outbound pause and provider controls (not touched). Chromium cannot load port 6000, so the preview used port 6100.

**Deployed UI (post-Publish).** Pending. The owner Publish had not happened when this section was written, so nothing here is a deployed-UI observation. After Publish, read `/api/health` for the source commit and re-read, read-only, `/shop`, the comparison pages, the program FAQ and the server-rendered `/alternatives/*` and `/switch-from/*` shell (logo size, menu, no console errors) at 390 px and 1440 px, then append the result here.

## 8. Handoffs (not edited here)

**W-B.** Delivered in 7b (shared server and React shell, `/industries` hub, Home, About and Contact, responsive product imagery, tap targets, call-to-action wrapping). Open items inside the W-B surfaces: Merchant login is omitted from the navigation until the owner supplies the URL; `/payment-processing` and `/pricing-and-programs` are not built (the navigation points to existing pages); the founder note is text only until an approved portrait asset exists; the glossary and learn pages (`/learn`) keep their legacy navy chrome and are not on the shared shell; Safari/WebKit and real devices are not exercised; the retail-industry CLS flap and the `/merchant-application` stepper contrast and targets are baseline items that were not changed; the SSR Home statistics ("10+", "5,000+") are carried to W-D with the other hard-coded statistics.

**W-C.** Quiz flow and terminal flag behavior; offer router and the free-terminal offer wording; visible manual-review and analysis-held states for statement uploads; consent and disclosure placement beside the inquiry submit control; the statement-analysis hold stays as is.

**W-D.** Help Center article list and article bodies ("Setting Up Next-Day Funding" and similar, in the help-center data), `/merchant-application` stepper contrast and tap targets; Testimonials Review schema and VideoObject ("$4,200", "Video coming soon"); case-study figure mismatch between React and server HTML and publication gating; free-analysis guarantee page ("$50 gift card", "3,200+ statements", guarantee timing, "same day", "month-to-month", "No Contract Required" card on the server-rendered guarantee page); welcome popup "$4,200"; location and industry pages (next-day funding and savings ranges, location statistics, hard-coded "5,000+"); server "Merchant Savings Snapshots"; hard-coded statistics duplicates including the rate-comparison trust strip; case-study historical Square-rate facts; glossary and asset-page worked examples with invented costs; competitor switch-from narrative about third-party contracts and termination fees (Helcim, Gravity); partner-page and affiliate-training talking points ("free terminal equipment", "next-day funding", "no long-term contracts"); Home quiz line "Most merchants in your vertical…"; Shopify fee claims; blog, help-center and glossary timing and rate long tail; Why Liberty "Next-Day Funding" card and estimate-page savings ranges; Savings Calculator pricing and "no hidden fees" cards; industries editorial "POS lock-in" line; security-page PCI claims; sitemap route census and compare-slug reconciliation; internal-only Square rate mentions (non-public); the `/faq` first-paint and largest-paint spread on a loaded host (render-blocking application stylesheet plus hydrated FAQ block; over the 2.5 s lab budget on both the baseline and the W-B candidate in the 7b session); the free-analysis testimonial and quiz math; the unmounted `WelcomePopup` component (still carries the retired figure; left untouched); "near zero" and "eliminate fees" wording in blog, glossary, sales and help-center content; `SalesOnePager` and `CostQuiz` copy; the unused stale `SITE_H1` constant in `client/src/lib/site-content.ts`. (The tap-target gaps on `/integrations` and `/beat-square-stripe` were closed in 7b.)

## 9. Rollback

Revert the changed source files to `f20104fa` and redeploy; there is no schema, data, setting or route change. To undo only the 7b work, revert the 7b source files to `2a3671a6` (this also removes the `/industries` route and the 420 px logo and product-image derivatives; no schema, data or setting change). Reverting restores the contradictory and unsupported claims described above (month-to-month and no-ETF assertions beside a footer that says early termination fees may apply, 48-hour and same-day windows, invented Liberty markups and savings ranges, the retired Square rate, "never shared" handling text). Never delete submissions, tasks, receipt history or protected objects as part of a rollback.

## 10. Remaining gates (not claimed)

Supply the owner evidence in section 4 so held claims can be approved; WebKit/Safari and real-device check; owner Publish of the 7b build and its read-only post-Publish read-back (7b, last paragraph); W-C and W-D handoffs above. This record does not assert that the whole website, Stage 5, AI readiness, advertising or automatic email activation is complete.
