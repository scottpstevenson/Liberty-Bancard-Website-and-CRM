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


## 8. Handoffs (not edited here)

**W-B.** Consume the shared equipment/contract disclosure in the shared footer and navigation without rewriting wording; place Home sample findings, the program block and proof sections with the corrected text; keep "Illustrative review layout. No customer results shown." on the worksheet.

**W-C.** Quiz flow and terminal flag behavior; offer router and the free-terminal offer wording; visible manual-review and analysis-held states for statement uploads; consent and disclosure placement beside the inquiry submit control; the statement-analysis hold stays as is.

**W-D.** Help Center article list and article bodies ("Setting Up Next-Day Funding" and similar, in the help-center data), `/merchant-application` stepper contrast and tap targets; Testimonials Review schema and VideoObject ("$4,200", "Video coming soon"); case-study figure mismatch between React and server HTML and publication gating; free-analysis guarantee page ("$50 gift card", "3,200+ statements", guarantee timing, "same day", "month-to-month", "No Contract Required" card on the server-rendered guarantee page); welcome popup "$4,200"; location and industry pages (next-day funding and savings ranges, location statistics, hard-coded "5,000+"); server "Merchant Savings Snapshots"; hard-coded statistics duplicates including the rate-comparison trust strip; case-study historical Square-rate facts; glossary and asset-page worked examples with invented costs; competitor switch-from narrative about third-party contracts and termination fees (Helcim, Gravity); partner-page and affiliate-training talking points ("free terminal equipment", "next-day funding", "no long-term contracts"); Home quiz line "Most merchants in your vertical…"; Shopify fee claims; blog, help-center and glossary timing and rate long tail; Why Liberty "Next-Day Funding" card and estimate-page savings ranges; Savings Calculator pricing and "no hidden fees" cards; industries editorial "POS lock-in" line; security-page PCI claims; sitemap route census and compare-slug reconciliation; internal-only Square rate mentions (non-public); the small tap targets on `/integrations` and `/beat-square-stripe`.

## 9. Rollback

Revert the changed source files to `f20104fa` and redeploy; there is no schema, data, setting or route change. Reverting restores the contradictory and unsupported claims described above (month-to-month and no-ETF assertions beside a footer that says early termination fees may apply, 48-hour and same-day windows, invented Liberty markups and savings ranges, the retired Square rate, "never shared" handling text). Never delete submissions, tasks, receipt history or protected objects as part of a rollback.

## 10. Remaining gates (not claimed)

Supply the owner evidence in section 4 so held claims can be approved; WebKit/Safari and real-device check; W-B, W-C and W-D handoffs above. This record does not assert that the whole website, Stage 5, AI readiness, advertising or automatic email activation is complete.
