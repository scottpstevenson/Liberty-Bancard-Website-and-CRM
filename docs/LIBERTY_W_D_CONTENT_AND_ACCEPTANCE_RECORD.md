# Liberty W-D Public Content, Media and Acceptance — Record

Date: 2026-11-10
Scope: WD-R01 to WD-R12 and WD-P01 to WD-P09 (the preflight findings); LI-W11, LI-W14 to LI-W20 and LI-W24 as primary owner, with the other LI-W rows reconciled as regressions (section 9); the 15 design sections (section 10) and the five asset briefs (section 11).
Governing contract: `attached_assets/Liberty-W-D-Content-and-Acceptance_1794335430673.md` (verbatim copy in `.local/tasks/wd-public-content-media-acceptance.md`).
Status: **candidate prepared, not committed, not published.** Nothing in this record is a deployed-UI, data, receipt, native-booking, tracking or advertising verdict. Publication alone is not acceptance; the read-back in section 17 is the owner's step after the normal Publish.
Earlier records are not rewritten. `docs/LIBERTY_W_A_PUBLIC_CLAIMS_RECORD.md` and `docs/LIBERTY_W_C_INTAKE_AND_HANDOFF_RECORD.md` keep their receipts; where a sentence in them is no longer the current state it is listed in section 14.

## 1. Identity of what was tested

| Item | Value |
| --- | --- |
| Serving (read at preflight, 2026-11-10) | `/api/health` sha `8dd9e26ca0b03a7f76230847ddba98d4510325dc`, built 2026-11-10T03:59:21.987Z, publish build `f1a030be-5ae4-419a-8413-5bc77efaf32d` (W-C second closure correction) |
| GitHub main at the contract | `8198ab1ec2a0aaa506999b462cfa3d76c9dae3ae`, tree `f85cac8aef4bab1550cbd716d99300a54013cd01` ("Published your App") |
| Base of this work | local `main` HEAD `b821c9d6dd91e7e5b190358bf567c51174bd6627`, tree `3c8ac43fbfafc7e3c31313799a3eadfe674c71c1`. Two local commits above `8198ab1e`; they change only `docs/` records and `.agents/memory/` notes, so the application source equals the serving source. The plan was written against `6f9baa4a` (same application source). |
| Candidate | A **working tree on `b821c9d6`, not committed by this work**: 91 modified and 39 deleted tracked paths (36 of the deletions are superseded image derivatives; the other three are the source files listed in section 2) plus 139 new paths (115 image files: 102 generated derivatives and the 13 imported masters; 24 other files, listed in section 2, including this record). Counts are `git status --porcelain -uall` excluding `.agents/memory/` and `.replit`. The built artifact records HEAD (`b821c9d6`), not the dirty tree. |
| Tested build | **`d7848507-8c92-4af0-b230-f0e77eb1b7e8`** (production build of the final candidate working tree, `NODE_ENV=production npm run build`) served by the isolated disposable preview (`start-stage3-c1-cloud-preview.ts --reuse-build`, synthetic data, providers denied). Earlier builds of the same work, kept because some measurements were taken on them: `445fae34-3c1a-4c00-8dd4-2617ad94aabf` (first candidate), `cbfd5173-cb0a-447c-88e9-03793f70435d` (perf and the first 186-state browser run), `7d64d854-2a24-457f-b46f-c49afeb955de` and `68d28fae-c00b-4da3-9b5a-e73c815ca6f6` (after the two mobile-target and heading fixes). The differences between `cbfd5173` and the final build are, in full: the `/areas-served` link classes, the `/free-analysis` heading full stop, and the location page title rule in section 13.5. |
| Tested-tree digest | `ba2121f325382745444e0db22004a08cce8f4998fb2b94170184e21b86a17d74` = SHA-256 of `git diff HEAD --binary -- client server shared scripts` followed, for each untracked file in those roots in sorted order (C locale), by a line `== <path>` and the file's bytes. It was computed before the disposable and legacy-suite runs and again after them, and did not change. Docs, memory and generated working files are outside the candidate-identity inputs, so editing them needs no rebuild. |
| Matched baseline | `git archive b821c9d6` extracted outside the workspace into a throw-away repository (committed once there so the build can read a HEAD; its build SHA is therefore `b4bc9f72…`, not `b821c9d6`), linked `node_modules`, built as `354d7459-dc53-4e82-a939-843750ea76ba` and served by the same harness on the same port, one after the other, never concurrently |
| Schema, migrations, dependencies | **Unchanged.** Journal still 386 entries, last index 385 `0382_website_email_lifecycle`; `package.json`, `package-lock.json`, `migrations/` and `shared/schema.ts` have no diff; no startup DDL. |
| Settings and controls | No production setting written. Outbound pause, GHL controls, background selection and the worker profile untouched. No provider, paid, GHL, Gmail, SMS, email or appointment call; no production write. `scripts/public-ux-audit.ts` (paid) was never run. |
| Toolchain | Node v22.23.4, npm 10.9.9 (project pin Node `>=22.22.0 <23`, npm `10.9.4`) |
| Asset pack | `liberty-wd-asset-pack-2026-11-10.zip`, SHA-256 `794578e2c76e013d0a0eb79fe1f28a457a996d333f496445b5665ca2f97e823b` (equals the contract). All 13 master hashes in the pack manifest equal the repository copies (asserted by `scripts/test-wd-media-contract.ts`). |
| Not touched | W-A, W-B and W-C behavior (the shell, the statement and inquiry forms, the CRM handoff) except where section 15 lists an intentional test update; underwriting, e-sign, bank fields and application state; the migration journal; the paid UX audit script. |

## 2. Requirement crosswalk (preflight findings)

| ID | Result in this tree | Where | Proof |
| --- | --- | --- | --- |
| WD-R01 330 location URLs hydrate to 404 | One shared module (`shared/public-locations.ts`: 30 cities, 10 verticals, 330 paths) feeds the server documents, the client hubs and details, the sitemap and `/areas-served`; client routes `/locations/:city` (new `LocationHubPage`) and `/locations/:city/:industry`; an unknown key is the same truthful 404 in both renderers | `shared/public-locations.ts`, `client/src/pages/LocationHubPage.tsx`, `client/src/pages/LocationIndustryPage.tsx`, `server/ssr/locations.ts`, `server/ssr/areas-served.ts` | `test-wd-locations-contract` (18 assertions, 24 negative controls: every one of the 330 documents in source and rendered); census (section 13) |
| WD-R02 invented local counts, rates, funding, headquarters | Every business count, population, average rate, typical-savings, next-day-funding, office and `addressLocality` claim removed from the three emitters, metadata, FAQ and schema; copy is the verified place name plus neutral payment-workflow questions; dead renderers in `server/ssr/location-html.ts` deleted (`isValidLocationCombination` now lives in the shared module) | same files; `server/ssr/location-data.ts` reduced to the shared re-export | same suite (forbidden-claim scan over all 330 rendered documents; negative control with an invented count) |
| WD-R03 / R04 invented case studies, demo video, five-star review | Shared proof projection (`shared/public-proof.ts`, `server/data/public-proof-register.ts`); the shipped register is **empty**, so every surface renders the fallback "Understand your processing costs before you decide."; `GET /api/public/testimonials/approved` is gated through the projection (an approved-and-published row without evidence stays absent); `Review`, `AggregateRating` and `VideoObject` schema removed everywhere, including `SEO.tsx` helpers; `WelcomePopup.tsx` (unused, carried the guarantee) deleted | `shared/public-proof.ts`, `client/src/components/public/ProofPageView.tsx`, `client/src/pages/CaseStudies.tsx`, `client/src/pages/Testimonials.tsx`, `server/ssr/pages.ts`, `server/routes/public.ts`, `client/src/components/SEO.tsx` | `test-wd-content-contract` (38 assertions, 24 negative controls) |
| WD-R05 six industries without server content | All 14 industries read one content contract (`shared/public-industry-content.ts`) in both renderers; `/industries/:slug` serves each document, an unknown slug is a 404 with no fall-through; healthcare "2.6%", "$4,100" and "99.9% uptime SLA" removed | `shared/public-industry-content.ts`, `server/ssr/industries.ts`, `client/src/pages/IndustryPage.tsx` | `test-wd-industries-contract` (15 assertions, 24 negative controls), `test-stage3-d-r2-contracts` (59) |
| WD-R06 competitor assertions | `server/ssr/competitor-ssr.ts` no longer states what a named provider charges, how long its contracts run, what it holds or how its support performs; provider lines are questions to check against the visitor's own agreement; the dated, sourced list prices stay in `/compare/*` (W-A). The attributed Square "2.6% + $0.10" examples were removed from the server blog emitter and `blog-data-6/7`. **No new competitor fact was introduced, so there was nothing new to verify against a primary source**; nothing was independently re-verified. | `server/ssr/competitor-ssr.ts`, `server/ssr/all-blog-posts-server.ts`, `client/src/lib/blog-data-*.ts` | `test-wd-content-contract` superseded-figure scan; `test-public-claims-contract` (1023 assertions, 93 negative controls) |
| WD-R07 guaranteed analysis and Liberty target-rate calculator | `$50` promise, "3,200+" benchmark and the 1.95% Liberty target rate removed in all three emitters (React, server, SEO registry); `/free-analysis-guaranteed` stays a **self-canonical explainer** (URL, durable intake and links kept; it points to `/upload-statement` as the one statement-review route); the calculator is `shared/public-cost-calculator.ts`: user-entered inputs only, blank is not zero, NaN, negative and overflow rejected, a per-transaction fee needs a ticket, a saving is shown only when every material figure is entered, a higher quote reads as higher, annual is monthly x 12 | `shared/public-cost-calculator.ts`, `shared/public-free-analysis.ts`, `client/src/pages/SavingsCalculator.tsx`, `FreeAnalysis.tsx`, `FreeAnalysisGuaranteed.tsx` | `test-wd-content-contract` |
| WD-R08 editorial reconciliation | Triage in section 7 | `client/src/lib/help-center-data.ts`, `server/data/glossary-terms.ts`, blog data files, `FAQ.tsx`, `server/ssr/pages.ts` | `test-wd-content-contract`, `test-public-claims-contract` |
| WD-R09 Why Liberty | Text-led (`shared/public-why-liberty.ts`): the review process and a genuine founder note; "5,000+", "$2B+", "99.9%" and "PCI DSS Level 1" removed from the three emitters; staff-labelled generic photos removed; asset 10 is on the page as an **illustrative** inset. Route stays `/why-liberty-bancard`; no certification claim | `shared/public-why-liberty.ts`, `client/src/pages/WhyLiberty.tsx`, `server/ssr/pages.ts`, `shared/seo-routes.ts` | `test-wd-content-contract` |
| WD-R10 imagery provenance and budget | `generated` provenance state; 13 masters imported through the existing builder; budget selector (`scripts/lib/public-image-budget.ts`) points at the file the Home hero really renders; rights register records every generated asset as `owner-review-pending` | `client/src/lib/public-imagery.ts`, `scripts/build-public-images.ts`, `scripts/lib/public-image-budget.ts`, `server/data/public-claim-evidence.ts` | `test-wd-media-contract` (23 assertions, 41 negative controls); `build-public-images.ts --check` (17 sources) |
| WD-R11 FAQ first-paint | Reproduced on matched builds (baseline 4540 ms, first candidate 4576 ms) and **repaired**. The hero wrappers of `/faq`, `/help` and `/support` used the scroll-reveal fade (opacity 0, then a transition), so Chrome did not count the heading as the largest paint until the web font swapped in (about 4.5 s on this lab profile); the wrappers no longer use it (below-the-fold sections keep it). `/support` also loaded a decorative 118 KB hero photograph under an overlay of at least 85% whose alt text claimed a customer support team; it is replaced by a solid dark gradient and `client/src/assets/images/hero-support.jpg` is deleted. Final candidate: `/faq` 1048 ms, `/help` 860 ms, `/support` 936 ms, CLS under 0.002 | `client/src/pages/FAQ.tsx`, `HelpCenter.tsx`, `Support.tsx` | `check-public-perf.ts` (section 12); causal probes in 12.2 |
| WD-R12 stale documents | Appended, not rewritten: dated W-C publication receipt in the three canonical documents and a W-D section in each; this record | `docs/` | section 14 |
| WD-P01 Home server renderer had no pictures | `server/ssr/picture.ts` is the one picture emitter; `PublicImage` and the server emit the same `<picture>` (asserted by parsing both) | `server/ssr/picture.ts`, `client/src/components/public/PublicImage.tsx` | `test-wd-media-contract` parity cases |
| WD-P02 asset pack | Section 11 | — | — |
| WD-P03 suites that stayed green while pages were wrong | Four new suites; literal-copy assertions replace tests that compared the page to the same constants | section 15 | — |
| WD-P04 sitemap duplicate | `/blog` is listed once (541 URLs from 541 entries) | `server/routes/ssr-routes.ts`, `shared/seo-routes.ts` | content suite; census |
| WD-P05 #2150 | Results recorded in section 16; not fixed or widened | — | section 16 |
| WD-P06 W-A/W-B/W-C regressions | Re-run in section 13 | — | section 13 |
| WD-P07 partner "30% lifetime residual" | Observed only; not changed (partner-program terms, outside W-D) | `shared/seo-routes.ts` | census row |
| WD-P08 Merchant Application contrast | Not reproduced as a W-D defect in the browser gates (section 13); no change made | — | section 13 |
| WD-P09 Home hero and cards | Exact contract copy and two actions; five image cards; eight placements; both renderers | section 8 | `test-wd-media-contract`, `test-public-claims-contract` |

New files (non-image): `client/src/components/home/HomePaymentContexts.tsx`, `client/src/components/public/LocationActions.tsx`, `client/src/components/public/ProofPageView.tsx`, `client/src/pages/LocationHubPage.tsx`, `scripts/lib/public-image-budget.ts`, `scripts/test-wd-{content,industries,locations,media}-contract.ts`, `server/data/public-proof-register.ts`, `server/ssr/areas-served.ts`, `server/ssr/picture.ts`, `shared/public-{cost-calculator,free-analysis,home-visuals,industry-content,locations,proof,why-liberty}.ts`, `docs/media/w-d-asset-pack-2026-11-10/` (pack manifest, generation record, quality receipt, handoff). Deleted source: `client/src/components/WelcomePopup.tsx`, `server/ssr/location-html.ts`, `client/src/assets/images/hero-support.jpg` (the decorative Support photograph, WD-R11). Edited since the first candidate, beyond the table above: `client/src/pages/AreasServed.tsx` (touch-target classes), `shared/public-free-analysis.ts` (heading), `shared/public-locations.ts`, `server/ssr/locations.ts`, `client/src/components/SEO.tsx` and the two location pages (title rule, 13.5).

## 3. Location contract and keep, improve or consolidate table

There is **no traffic, search-console, lead or call evidence in the repository or in this environment**, so no URL is recommended for removal, redirect or `noindex`, and none was changed. All 330 location URLs stay in the sitemap and all of them work. The table records what each group is, what was improved, and the evidence a later keep-or-consolidate decision needs.

| Group | URLs | Decision now | Why | What would justify consolidating later |
| --- | --- | --- | --- | --- |
| South Florida hubs and details (10 cities: Miami, Fort Lauderdale, Miami Beach, Boca Raton, West Palm Beach, Pompano Beach, Hollywood, Coral Springs, Plantation, Hialeah) | 10 hubs + 100 details | **Keep and improve** (listed first on `/areas-served`; contract focus) | The only geography the business describes as its own; hubs now work after JavaScript loads | — |
| Other Florida (10 cities: Tampa, Orlando, Jacksonville, Sarasota, St. Petersburg, Clearwater, Cape Coral, Fort Myers, Gainesville, Pensacola) | 10 hubs + 100 details | **Keep, claim-free** | A place name proves no office or team, so the copy states only the place and the payment workflow | 90 days of search impressions and any lead source by city; pages with none become candidates |
| Nationwide (10 cities: Houston, Dallas, Austin, Atlanta, Las Vegas, Phoenix, Nashville, Charlotte, Denver, Chicago) | 10 hubs + 100 details | **Keep, claim-free; coverage note states nationwide service without an office** | Same as above; "nationwide" is listed second on `/areas-served` | Same; also consider folding into the industry page |
| Overlapping verticals (salon and barbershop both point to `/industries/salon-spa-payment-processing`; healthcare and dental overlap) | 60 of the 300 details | **Keep; distinct neutral workflow text per vertical** | Different buyer wording, one industry destination | Merge only on evidence that one of each pair draws no traffic |
| Industry and location link graph | 14 industry pages each link to matching location hubs and the inquiry | Improve | Previously the details linked to a global "talk to us" page | — |

The shared module forbids, and `test-wd-locations-contract` asserts across all 330 rendered documents, any business count, population, average rate, typical-savings figure, funding promise, headquarters, street address, local testimonial or local-office wording.

## 4. Proof, case studies and Why Liberty

- **Decision:** no existing record qualifies. `testimonial_submissions` has no release, permission, evidence, reporting-period or calculation-basis column and no schema change is authorized, so an `approved` and `publish` row is not proof. The projection requires every basis field, recorded permission naming the surface and, for a quote, its own evidence; each missing field blocks it. The shipped register is empty, so **every proof surface shows the fallback** ("Understand your processing costs before you decide.") with a link to the statement review. A permission-positive fixture appears and an approved row without evidence stays absent (tested).
- The two supplied case narratives (contract Appendix D) stay **private drafts in the task record and are not in any importable module, bundle, document or schema**. They remain distinct from one another and are not aggregated.
- No `Review`, `AggregateRating` or `VideoObject` schema is emitted on any page (scan over the server emitters, the registry and the built client).
- `/testimonials-disclosure` is kept as it was.
- Missing founder portrait and withheld case: accepted truthful fallbacks (contract section 20); they do not hold the presentation work open.

## 5. Editorial review summary (glossary, help, blog, FAQ)

See section 7 for the rule and counts.

## 6. Imagery and media

Thirteen masters from the asset pack are in `client/src/assets/images/` (about 26 MB, **source only, never served as page images**); the existing builder (`scripts/build-public-images.ts`, 17 sources) produces the AVIF, WebP and JPEG derivatives under `client/public/images/public/` and the manifest `client/src/lib/public-imagery.manifest.json`. The terminal keeps real alpha (PNG with transparency, no JPEG fallback). Each master's SHA-256 equals the pack manifest.

| Asset | Where it renders | Provenance and approval state |
| --- | --- | --- |
| 01 merchant hero | Home hero, mobile and desktop crops (eager, high priority, the only eager public image) | `generated`, `owner-review-pending` |
| 02 restaurant, 03 dental, 04 med spa, 05 automotive, 06 retail | Home industry cards (lazy) and each industry page | same |
| 07 field services | Construction industry page (the field-services reserve) | same |
| 08 ecommerce, 09 professional services | Their industry pages | same |
| 10 review process | Why Liberty process inset (illustrative caption) | same |
| 11 statement anatomy | Rebuilt as **live responsive text** on Home (sample review card, labelled Illustrative, no invented figures); the SVG master is kept as source | `authored-for-this-pack`, `owner-review-pending` |
| 12 payment contexts | Rebuilt as shared static SVGs for the Mobile and Online blocks of the Home payment-setup section | same |
| 13 upright terminal | Home payment-setup section, upright, no transform, transparent frame; illustrative equipment only, **not catalog-model proof** | `generated`, `owner-review-pending` |

- Not adopted: asset 11 on `/upload-statement` and asset 12 on `/payment-processing` (their pages already carry the same information as text; adding the picture would duplicate it).
- Eight industry pages carry an illustrative photograph (`INDUSTRY_HERO_IMAGES`: restaurant, retail, auto repair, dental, med spa, construction, ecommerce, professional services). The other six (healthcare, salon and spa, legal, accounting, fitness, hospitality) are text-led, with no placeholder. The healthcare page lost its previous photograph: that staff-style image could not be kept without implying staff, and no healthcare asset was supplied.
- Generated imagery is recorded as `generated` plus `owner-review-pending` in the image registry and the rights register. **No image is labelled licensed.** Only the six `product-*` entries stay `unverified`. Pages that carry a generated photograph keep the caption "Photos are illustrative and do not show Liberty customers."
- The Home server document now emits the same `<picture>` markup as the React tree (`server/ssr/picture.ts`); a parity case parses both. First HTML for Home contains the hero picture (eager, `fetchpriority="high"`) and five lazy card pictures; the payment-setup block carries the terminal.
- Budget: the selector in `scripts/lib/public-image-budget.ts` reads the file the Home hero actually renders (the 720 px mobile crop) and the 260 KiB per-file cap applies to every derivative; the builder `--check` passes for all 17 sources. The largest shipped photo derivative is within the cap (asserted).

## 7. Editorial reconciliation rule and counts

Rule: keep evergreen education; replace any Liberty commitment with "the written agreement or quote confirms" wording or with an approved `claimText(...)` string; remove a figure that has no source; never weaken a test to pass. Surfaces and result:

| Surface | Result |
| --- | --- |
| Glossary (`server/data/glossary-terms.ts`, 61 terms) | Education retained; the Liberty section is written from approved claims only; "zero-cost processing" and "legal in all 50 states" style statements removed or conditioned on state law and program rules |
| Help Center (`client/src/lib/help-center-data.ts`) | Timing, fees, funding, support-hour and contract statements rewritten as "depends on / confirmed in your agreement"; superseded figures removed |
| Blog (14 posts plus pillars, React data and the server emitter) | Superseded figures and the attributed Square example removed; evergreen explanations kept; both renderers agree |
| FAQ (`FAQ.tsx`, `server/ssr/pages.ts`) | Same answers in both renderers; the deposit, termination and approval answers carry no promise |
| Home FAQ and the industry, location, compare, alternatives and switch families | Covered by sections 2 and 3 |

`test-wd-content-contract` scans the emitters, the glossary, the Help Center and the blog for each superseded figure (a guaranteed $50, 3,200+/5,000+ statement counts, $2B, 99.9%, PCI Level 1, the attributed Square 2.6% + $0.10 rate, "legal in all 50 states", zero-cost processing) and has a negative control for each family. No post was deleted, redirected or unpublished.

## 8. Home hero (WD-P09)

Eyebrow `PAYMENTS FOR YOUR BUSINESS`; H1 `Know what you’re paying. See your options.`; primary action `Get a free statement review` to `/upload-statement#statement-review-form`; secondary `Find the right payment setup` to `/about-contact#inquiry`; helper lines `No obligation to switch.` and `Details are confirmed during review.` (visible from the `md` breakpoint, hidden on phones). Phones: copy, then both full-width actions, then the photograph, with the actions inside the first viewport; wide screens: copy left, inset photograph right with a text gutter. Five industry cards (Restaurant, Dental, Med spa, Automotive, Retail) link to existing industry pages. Both renderers read `shared/public-home-content.ts` and `shared/public-home-visuals.ts`. The `HOME_SECTION_ORDER` keeps hero, solutions, industries, starting points, founder, process, FAQ, final.

## 9. LI-W reconciliation (24 rows)

Status words: **source** (code and static suites), **fixture** (disposable stack), **browser** (Chromium, section 13). Nothing here is deployed-UI, data, receipt, booking or tracking verdicts.

| Row | Owner | State in this tree | Evidence | Open input |
| --- | --- | --- | --- | --- |
| LI-W01 Home offer hierarchy | W-B | Updated to the owner's exact hero copy and two paths (section 8) | source, fixture, browser | Deployed read-back |
| LI-W02 Terminal visual | W-C | Upright terminal concept on Home; `/free-smart-terminal` unchanged | source, browser | Owner approval of the exact hardware model and image rights |
| LI-W03 Qualification and equipment terms | W-A | Regression only | claims contract | — |
| LI-W04 Ad-click terminal intent | W-C | Regression only (not re-opened) | W-C suites | Paid-traffic landing check belongs to the ads owner |
| LI-W05 Statement review offer | W-C | Home primary action targets `#statement-review-form`; regression of the form | W-C suites, browser | — |
| LI-W06 Fee explanation and data handling | W-A | Statement anatomy as live illustrative text; calculator rewritten (section 2) | source, browser | Retention wording stays W-A owner evidence |
| LI-W07 Booking | W-C | Regression only | existing suites | Native booking acceptance (separately authorized) |
| LI-W08 Contact consistency | W-B | Location pages now read the shared contact lines | census, claims contract | — |
| LI-W09 Fulfillment timing | W-A | Editorial pass removed unconditional timing | content contract | — |
| LI-W10 Zero-percent | W-A | Editorial pass removed zero-cost statements | content contract | — |
| LI-W11 Overlapping analysis landing pages | W-D | `/upload-statement` is the one statement-review route; `/free-analysis` and `/free-analysis-guaranteed` kept as distinct pages; the guaranteed page is a self-canonical explainer with the promise removed | source, census | Owner decision whether to consolidate later |
| LI-W12 Compatibility claims | W-A | Industry pages carry no unsupported platform or uptime claims | industries contract | — |
| LI-W13 Competitor pricing examples | W-A | Attributed Square rate removed from blog emitters; compare pages keep dated sourced list prices | content and claims contracts | — |
| LI-W14 Savings proof | W-D | Proof projection, empty register, fallback everywhere | content contract | Evidence-backed cases (owner) |
| LI-W15 Merchant video | W-D | No video, no play call to action, no `VideoObject` | content contract | — |
| LI-W16 Location claims | W-D | All invented local claims removed | locations contract | — |
| LI-W17 330 location pages | W-D | All 330 render in both renderers | locations contract, census, browser | — |
| LI-W18 Industry pages | W-D | All 14 render on the server and the client | industries contract, census | — |
| LI-W19 Compare / alternatives / switch families | W-D | Coherent, no unsourced competitor fact | content and claims contracts, census | — |
| LI-W20 Imagery | W-D | Section 6 | media contract, builder check, browser | Owner image-rights review |
| LI-W21 Support | W-C | Regression only | W-C suites | Owner-approved support hours |
| LI-W22 Mobile menu | W-B | Regression only | shell contract, browser | — |
| LI-W23 General inquiry | W-C | Regression only | W-C suites | — |
| LI-W24 Acceptance | W-D | This record and section 17 | — | Owner Publish and read-back |

The external workbook was not available; this is the repository crosswalk, ready to reconcile. No remote sheet was updated.

## 10. The 15 design sections

1 Home hero: implemented (section 8). 2 Industry cards: implemented (five cards, section 8). 3 Payment-setup section (Mobile, Online, terminal): implemented as `HomePaymentContexts`. 4 Statement review anatomy: implemented as live text. 5 Industry page template: implemented from one shared content contract (14 pages). 6 Location hub and detail: implemented (330 URLs). 7 Proof surfaces: implemented as the fallback with a gated projection. 8 Why Liberty: implemented (text-led plus process inset). 9 Savings calculator: implemented. 10 Free analysis family: implemented. 11 Compare, alternatives, switch: implemented as three non-overlapping questions. 12 Glossary, Help, blog: reconciled (section 7). 13 Areas served: implemented from the shared locations module. 14 Footer and header links to the new routes: unchanged from W-B (links already present). 15 Imagery system: implemented (section 6). A section is "implemented" here only in source, fixture and Chromium terms; the deployed state is not claimed.

## 11. The five asset briefs

Briefs 01 to 05 (Home hero, restaurant, dental, med spa, retail) are implemented with the pack masters 01 to 06; briefs for field services, ecommerce, professional services and the review process use masters 07 to 10 on their reserve pages. Brief 11 (statement anatomy) and brief 12 (payment contexts) are implemented as described in section 6. Because the pack covers ten photographs, two illustrations and one terminal, no new brief remains unfilled; the missing healthcare photograph and a founder portrait are the two truthful fallbacks recorded in section 4 and section 6.

## 12. Performance (WD-R11)

Method: `scripts/check-public-perf.ts` (lab Chromium, 390x844 at DPR 2, CPU x4, 1.6 Mbps and 150 ms round trip, cold cache, five runs per route, median) against production builds served by the isolated preview, baseline and candidate one after the other, never together. Budgets: LCP 2.5 s, CLS 0.1. The route list is the ten W-A routes plus the W-D routes; `scripts/public-ux-audit.ts` (paid) was never run. A lab run is not a field measurement and not Safari or a real iPhone.

Builds: baseline `354d7459-dc53-4e82-a939-843750ea76ba` (base commit, throw-away copy), first candidate `445fae34-3c1a-4c00-8dd4-2617ad94aabf`, **measured candidate `cbfd5173-cb0a-447c-88e9-03793f70435d`** (the first candidate plus the hero change in section 12.2). Every number in this section was taken on that build. The final build (`d7848507-8c92-4af0-b230-f0e77eb1b7e8`) differs from it by three small edits only: the touch-target classes on the `/areas-served` links, a trailing full stop in the `/free-analysis` heading, and the location page title rule (13.5); none changes what the measured routes load or how their first screen is built, and the performance runs were not repeated on the final build. The first-candidate column is kept because it shows the FAQ, Help and Support misses before the change.

### 12.1 Matched table (LCP ms / CLS; total KB and image KB where they changed)

| Route | Baseline | First candidate | **Final candidate** |
| --- | --- | --- | --- |
| `/` | 1688 / 0.0163 | 1212 / 0.0007 | **1232 / 0.0007** |
| `/payment-processing` | 896 / 0.0002 | 820 / 0.0002 | **1036 / 0.0002** |
| `/pricing-and-programs` | 796 / 0.0001 | 876 / 0.0001 | **884 / 0.0001** |
| `/about-contact` | 944 / 0.0001 | 888 / 0.0001 | **932 / 0.0001** |
| `/industries` | 764 / 0.0159 | 772 / 0.0157 | **852 / 0.0157** |
| `/upload-statement` | 1020 / 0.0108 | 992 / 0.0107 | **1016 / 0.0108** |
| `/faq` | **4540 / 0.0014 over** | **4576 / 0.0002 over** | **1048 / 0.0014** |
| `/0-percent-processing` | 1016 / 0.0001 | 1056 / 0.0001 | **1140 / 0.0001** |
| `/industries/restaurant-payment-processing` | 944 / 0.0001 | 1196 / 0.0002 | **1116 / 0.0002** |
| `/industries/retail-payment-processing` | 920 / 0.0001 | 1036 / 0.0126 | **992 / 0.0126** |
| `/why-liberty-bancard` | **7172 / 0.0008 over** (2556 KB, images 1702 KB) | 980 / 0.0001 (816 KB, images 30 KB) | **904 / 0.0001** (816 KB, images 30 KB) |
| `/industries/dental-payment-processing` | 892 / 0.0003 | 1296 / 0.0002 | **944 / 0.0002** |
| `/industries/healthcare-payment-processing` | 968 / 0.0224 | 1628 / 0.0423 | **980 / 0.0415** |
| `/locations/miami` | **INVALID** (hydrated 404, no h1) | 976 / 0.0003 | **828 / 0.0009** |
| `/locations/miami/restaurant` | 992 / 0.0001 | 992 / 0.0002 | **960 / 0.0002** |
| `/help` | **3908 / 0.0012 over** | **3856 / 0.0013 over** | **860 / 0.0013** (878 KB) |
| `/support` | **3028 / 0.0012 over** (973 KB, images 118 KB) | **3040 / 0.0012 over** | **936 / 0.0012** (878 KB, images 22 KB) |
| `/areas-served` | 900 / 0.0008 | 1036 / 0.0165 | **972 / 0.0165** |
| `/alternatives/square` | INVALID (harness) | INVALID (harness) | **INVALID (harness)** |
| `/compare/stripe` | 944 / 0.0051 | 1008 / 0.0043 | **964 / 0.0051** |
| `/savings-calculator` | 984 / 0.0206 | 1004 / 0.0077 | **940 / 0.008** |
| `/case-studies` | 1172 / 0.0222 (1401 KB) | 872 / 0.0209 (669 KB) | **744 / 0.0209** |
| `/testimonials` | 1020 / 0.046 (959 KB) | 768 / 0.0228 | **796 / 0.0228** |
| `/free-analysis` | 824 / **0.1083 over** | 764 / 0.011 | **756 / 0.011** |

Totals: baseline 24 routes, 5 over budget, 2 invalid; first candidate 24 routes, 3 over, 1 invalid; **final candidate 24 routes, 0 over budget, 1 invalid (a harness limitation, below)**.

- Differences of a few hundred milliseconds between the columns on routes that do not change (for example `/payment-processing` 820 against 1036 on the same code) are run-to-run variation of this lab setup; only the large, repeatable differences are claimed: `/why-liberty-bancard` (a 1.7 MB photograph replaced by 30 KB of responsive derivatives), `/case-studies`, `/testimonials`, `/free-analysis` layout shift, `/locations/miami` (the baseline hydrates to a 404), and `/faq`, `/help`, `/support` (12.2).
- `/industries/healthcare-payment-processing` is slower in the first candidate (1628 ms) and equal in the final run (980 ms against 968 ms); its CLS is 0.0415 against 0.0224, both inside the 0.1 budget. Its photograph was removed (section 6), so this route is not a candidate for an image-related explanation; the difference was not isolated further.
- **`/alternatives/square` (and `/switch-from/square`) read INVALID in both builds** because the harness counts a sample only when the page has an `h1` inside `main`, and these SSR-only competitor documents have no `<main>`. A throw-away copy of the harness that accepts any `h1` measured them: baseline LCP 220 ms and 200 ms, final candidate 184 ms and 200 ms, CLS 0 for both. That is a measurement of documents with no client app; the harness was not changed.

### 12.2 FAQ, Help and Support diagnosis and change

Observed on the base commit and on the first candidate (identical, so not caused by W-D): `/faq` 4540 / 4576 ms, `/help` 3908 / 3856 ms, `/support` 3028 / 3040 ms, while comparable pages (`/upload-statement`) are about 1000 ms.

Evidence, in order:

1. Timeline of `/faq` (calm run, base build): the navigation button and logo are the first LCP candidates at about 1.0 to 1.15 s (React has mounted); the **final** candidate is the hero subtitle (`p.text-muted-foreground.text-lg`, the largest text block) at 4.53 to 4.60 s, at the moment the four IBM Plex files (about 800 KB, requested from about 0.25 s) finish and the `load` event fires. The `/upload-statement` hero paragraph is a candidate at about 1.0 s with no later one.
2. The FAQ hero is wrapped in `.reveal` (opacity 0 and a 24 px offset until `useScrollReveal` adds `revealed`, then a 0.7 s transition). A sampler showed the wrapper gets `revealed` at 1.2 to 1.4 s and reaches opacity 1 by about 1.9 s, yet Chrome registered no hero text candidate in that window.
3. Causal checks (same profile, one browser per run, injected CSS only, no code change): forcing `.reveal` to opacity 1, no transform and no transition moved the FAQ final LCP to **1048 and 1168 ms**; `/help` moved from 3.9 s to 0.86 to 1.38 s. Blocking the IBM Plex files produced no hero-text candidate at all (LCP was the logo at about 1.0 s), and forcing the already loaded serif face did the same. The text is registered only when it is repainted by the font swap, not when the reveal transition ends. The exact Chrome rule behind this is not documented in this record; the effect is what was measured.
4. `/support` has the same hero wrapper and an additional cause: its LCP element was the hero background photograph (97 KB source, 118 KB transferred), shown under an overlay of 85 to 97 % opacity, competing with the 800 KB of font files for the throttled bandwidth (3.0 s). Its `alt` text read "Liberty Bancard customer support team ready to help", which the picture (an unidentified stock image) does not show.

Change (owned, minimal): the scroll-reveal class was removed from the **above-the-fold hero** wrappers in `FAQ.tsx`, `HelpCenter.tsx` and `Support.tsx` (lower sections keep it), and on Support the decorative photograph was replaced by a solid dark gradient base, with the unused import and the unused source file `client/src/assets/images/hero-support.jpg` removed. Nothing else changed in those pages.

Result on build `cbfd5173…`, five runs per route, median: `/faq` **1048 ms** (was 4576), `/help` **860 ms** (was 3856), `/support` **936 ms** (was 3040; total 878 KB, was 973 KB). The remaining 21 routes were measured on the same build and are in 12.1.

Measurement-environment observations, recorded as evidence and not as blame for the original numbers: in this workspace the lab runs were repeatable only when started as background tasks; started in the foreground, the same scripts landed in a slow regime where the first navigation took 5 to 10 s. The site registers `/sw.js` at `load`; once the worker controls the page, the document, scripts and stylesheets are served from the worker and bypass the page-level network throttle while fonts and images stay throttled, so the first run in a fresh browser is not comparable with later ones. The harness already discards such runs as invalid; the runs reported here were taken after that regime was understood, and the base-build numbers (4540 ms) were reproduced in the same regime as the candidate.

Not changed and still open: the four IBM Plex Sans files (about 200 KB each, TrueType) remain the largest transfer on every page. Subsetting or re-encoding them is a modification of the font under its licence (the licence file reserves the name "Plex"), so it is an owner decision, not a W-D change.

## 13. Browser, census and regression results

Environment: Chromium only, driven by the repository's own gate scripts, against the production build of the candidate served by the isolated preview on port 6100 (Chromium refuses port 6000). The sitemap and the first HTML were read from the full dev application on port 5000, because the isolated preview registers only the server-rendered public route set (no glossary routes). WebKit is not available in this environment and no real device was used, so none of this is a Safari or iPhone verdict. No form was submitted, no file uploaded, no booking made and no message sent.

### 13.1 Census of all 541 sitemap URLs

| Check | Result |
| --- | --- |
| Sitemap | 541 entries, 541 unique paths (core 105, blog 14, locations 330, compare 31, glossary 61); `/blog` appears once |
| First HTML | 541 of 541 answer 200; none is `noindex`; 457 are server-rendered documents with exactly one `h1`, 84 are client-shell routes whose first HTML has no title, canonical or `h1` (the client app sets them; this is how those routes were built in W-B and is not changed here) |
| Hydrated (a real browser after JavaScript) | 541 of 541 end with exactly one `h1`; the 330 location URLs have **no** problem of any kind (on the base commit a city hub such as `/locations/miami` hydrated to a not-found page, section 12) |
| Glossary, 62 URLs (`/learn` and 61 terms) | Hydrated to the client not-found page **on the preview only**. The preview does not register the glossary routes, so the request fell to the client shell. On the full application the same URLs return the standalone glossary document with no client bundle (checked with a request: 41 glossary markers, no module script; and in the browser at 390 px) and the mobile gate on the full application passes `/learn` and `/learn/interchange-plus-pricing` at 390, 768 and 1440 px in both colour schemes (12 states, 0 findings). This is a limit of the preview, not a defect of the application; section 17 includes the deployed read-back. |
| Server and hydrated text differ | Observed, not caused by W-D, not changed: `/0-percent-processing`, `/affiliate`, `/beat-square-stripe` and `/get-started` carry a different `h1` in the server document and in the hydrated page (the files were not changed by W-D); `/affiliate`, `/upload-statement`, `/compare/clover` and `/compare/square` differ in the title (the client appends the site name). `/free-analysis` differed only by a trailing full stop in the `h1`, which W-D introduced in the shared copy and removed. **Closed after W-D (task 2153):** the four pages, `/upload-statement` and all five compare pages (every compare page differed in the title, not only Clover and Square), and the `/get-started` title, now read one shared headline and title on both sides (`shared/zero-percent-content.ts`, `shared/public-affiliate.ts`, `shared/compare-content.ts`, `shared/public-get-started.ts`; `/upload-statement` and the compare pages use their existing shared title with `brandSuffix={false}`). The server-rendered wording was kept as the reviewed text, so the hydrated headline and title on those pages changed to it. `scripts/check-public-server-hydrated-parity.ts` (registered in `scripts/pre-deploy.ts`) fails on any title or `h1` difference between the server document and the hydrated page for these routes. |
| Glossary markup | Observed, not caused by W-D, not changed: the standalone glossary document escapes each paragraph as plain text, so a definition written with `**bold**` or a leading `- ` list marker shows those characters literally. Read on the full application: 33 of the 60 term pages (matched by their slug in `server/data/glossary-terms.ts`; the 61st uses a different slug form and was not read) contain a literal `**`, and 4 contain a paragraph that begins with a list marker. The base commit renders the same way (the data and `paragraphs()` are unchanged in kind; W-D changed one heading in the file). |
| Titles over 65 characters | 169 of 541 (observed; length alone is not a defect and none was shortened) |

### 13.2 Home, industry, proof, location and navigation probe (78 checks on the final build, 0 failed)

For Home at 390, 768, 1024 and 1440 px: exactly one `h1` with the contract text and the eyebrow; no horizontal overflow; the hero picture is loaded, eager and high priority, uses the mobile crop below the desktop breakpoint and the desktop crop above it, and is inset at about half the hero width with a text gutter on wide screens; both actions have the contract labels and links; the actions are full width on phones with the picture after them and the actions inside the first viewport; the helper lines are hidden on phones and visible from the `md` breakpoint; seven public images load and only the hero is eager; the terminal is taller than wide with no transform; five industry cards link to existing pages; the Mobile and Online illustrations are present. With images blocked the hero frame keeps its size and nothing overflows (390 and 1440 px). The terminal derivative decoded in the browser has transparent corners and an opaque body. The restaurant, dental, healthcare, construction and Why Liberty pages each have one `h1`, one `main`, their images loaded and no overflow, and the illustrative caption where a photograph is present (healthcare has none). Client navigation from a Home card to the Dental page, Back and Forward; a city hub opened directly, its links to the detail pages, client navigation to a detail page and a reload of it; the query string and fragment survive on `/get-started?offer=free-terminal#inquiry`, `/upload-statement#statement-review-form` and `/about-contact#inquiry`; the server title and the hydrated title agree, and fit 70 characters, on the two longest location titles, a short detail page and a hub; an unknown location key, an unknown city and an unknown industry slug each answer HTTP 404 (an empty body, so the browser shows its own error page; none is a soft 200).

### 13.3 Layout, contrast, targets, overlays and fonts

| Gate | Result |
| --- | --- |
| Mobile visibility (`check-public-site-mobile --strict`, 31 routes, 390, 768 and 1440 px, light and dark; 186 states) | No contrast failure, nested interactive control, horizontal overflow or heading problem on any of the pages W-D touched. Two findings were real and are fixed: on `/areas-served` at 390 px the 30 city links and the 8 industry links were shorter than 44 px (28 and 20 px); they now use the shared touch-target class. The other 12 findings are the glossary preview limit above. After the fixes, on the final build `d7848507-8c92-4af0-b230-f0e77eb1b7e8`, the same strict gate over `/areas-served`, `/locations/miami`, `/locations/miami/restaurant`, `/locations/miami/contractor`, `/industries/healthcare-payment-processing`, `/free-analysis`, `/support`, `/help` and `/faq`: 54 states, 0 findings (the intermediate build `68d28fae-c00b-4da3-9b5a-e73c815ca6f6` gave 48 states and 0 findings over eight routes, and 74 of 74 probe checks). The first 186-state run was on build `cbfd5173-cb0a-447c-88e9-03793f70435d`; section 1 lists everything that changed after it. |
| Shell design (`check-public-shell-design`, 78 page states, auth pages included) | 58 clean; the other 20 are the same glossary preview limit (the preview serves the client not-found page for `/learn`, which has no navigation shell). Not re-run on the full application because the mobile gate covers the same pages there. |
| Public-site browser design checks (`check-public-wb-design --strict`, includes the first-HTML, expanded-FAQ and overflow probes) | 390 probes, 0 failed |
| Overlay (`check-public-overlay --strict`) | 22 probes, 0 failed |
| Fonts (`check-public-fonts --strict`) | 31 routes clean: the public surface renders its headings in Source Serif 4 and the sign-in and glossary documents in IBM Plex Sans, with zero layout shift from the font swap on every route |
| Merchant Application contrast (WD-P08) | Not reproduced; no change made |

### 13.4 Regression suites on the final candidate

The disposable-stack regressions (public shell browser suite, website intake handoff and its browser suite, Stage 5 public journey, role guards) and the focused static suites are in section 16 with their counts.

### 13.5 Search-audit finding fixed during acceptance

`scripts/seo-audit.ts` crawls every location URL on the running application and accepts a title of at most 70 characters including the brand suffix. On the first full run of the final-stage candidate it failed **75 of 430 routes**: the W-D location titles added " | Liberty Bancard" to every detail page, so the longest industry names ("Contractor and Home Services", "Hotel and Hospitality", "Fitness and Gym", "Salon and Spa", "Auto Repair") combined with the longer city names reached 71 to 88 characters. The base commit emitted detail titles without the suffix (70 characters at most), so this was introduced by W-D, not inherited. Fix: one shared rule, `locationDocumentTitle()` in `shared/public-locations.ts`, adds the suffix only when the whole title fits 70 characters; both server emitters use it, and the two React pages pass the same decision to `SEO` through a new optional `brandSuffix` prop (default unchanged for every other page). `test-wd-locations-contract` now asserts the rule and the 70-character limit (one new negative control, 25 in total) and the browser probe compares the server and hydrated titles. Result: `seo-audit` 430 routes, 0 failed; the 12 advisory warnings are length notes on `noindex` sign-in and thank-you routes and are unrelated.

## 14. Statements in earlier records that are no longer current

Earlier records are not edited. These are the sentences a reader could take as current today; every other sentence in them is unchanged.

| Earlier record, statement | Current state |
| --- | --- |
| W-A record, rights table: "all registered images unverified" and "text-led fallback for unfilled slots" | Six `product-*` images stay `unverified`. Thirteen entries from the W-D asset pack are `generated` (or `authored-for-this-pack`) with approval state `owner-review-pending`; none is labelled licensed (section 6). |
| W-C record, imagery paragraph: "Every entry in `client/src/lib/public-imagery.ts` still has provenance `unverified` ... No image was invented, generated or newly published" | True of the W-C tree. In the W-D tree the pack-derived entries are `generated`; the caption "Photos are illustrative and do not show Liberty customers." accompanies them. |
| W-A record, performance (7b and the final table): "`/faq` is over the LCP budget" | Measured again on matched builds (section 12): the base commit and the first W-D candidate were both over (4540 and 4576 ms); the final W-D candidate is 1048 ms after the hero change in section 12.2. `/help` and `/support` had the same miss and are now 860 and 936 ms. |
| W-A record, claim census rows that reserve "Case studies historical customer fact (W-D)" and the "2.6% + $0.10" rows that count blog server data | The case-study customer facts are no longer on any public page (the proof register is empty, section 4) and the attributed Square rate is removed from the server blog emitter and blog data (section 2, WD-R06). |
| W-A record, deferral list: "W-D. Help Center article list and article bodies ... `/merchant-application` stepper contrast and tap targets" | The Help Center statements were reconciled (section 7). The Merchant Application contrast was not reproduced in the browser gates (section 13) and no change was made. |
| W-A record, Home paragraph: "the equipment slot and the hero follow the claim-backed wording. The field-services industry slot is now an icon tile instead of a photograph." | The Home hero uses the owner's exact copy (section 8); the five Home industry cards are registered photographs with no icon-tile branch (asserted in `test-public-shell-contract`); the field-services photograph is on the Construction industry page; the equipment slot is the upright terminal concept (section 6). |
| W-A record, the list of items deferred to W-D (Testimonials Review schema and VideoObject, case-study figure mismatch and publication gating, free-analysis guarantee page, welcome popup, location and industry statistics, hard-coded statistics, switch-from narratives, glossary and asset-page worked examples) | Handled under WD-R02 to WD-R09 (section 2) and section 7; the claims and content contracts scan the emitters for the superseded figures. Open owner inputs are in section 9. |
| Any earlier statement that the location pages state business counts, average rates, funding times or offices | Removed everywhere (WD-R02); the pages state the place and neutral workflow questions. |
| Any earlier statement that `/free-analysis-guaranteed` promises a result or a $50 payment, or that `/case-studies`, `/testimonials` or `/why-liberty-bancard` carry figures, ratings or a video | Removed (WD-R03, WD-R04, WD-R07, WD-R09). |

## 15. Existing-suite updates (intentional, recorded)

No existing test was weakened to pass. Each edit follows a deliberate content change, and every replaced assertion is at least as specific as the one it replaced.

| Suite | Edit | Why |
| --- | --- | --- |
| `test-cro05a-static` | The slice that bounds the free-analysis submit handler ends at `const focusLines =` instead of `const results =` | The page's result block was renamed when the guaranteed-result copy was removed; the assertion still reads the same submit handler |
| `test-public-claims-contract` | Owned-document registry covers all 14 industry pages and `/areas-served` (it covered one); the registry of shared modules and source files names the new W-D modules; the Home h1 comparison reads the whole `<h1>` with its colour spans stripped and requires exactly one h1; the review-worksheet check also scans each row's heading; the allowlist entry for the dental "orthodontics can run" ticket-size example is **removed** (the sentence is gone); competitor SSR no longer imports `competitor-pricing` | The four changes widen what the suite reads; the one removal deletes an exception for text that no longer exists |
| `test-public-shell-contract` | The Home industry-card assertions read the imagery registry and forbid an icon-tile branch; the registry assertion keeps `unverified` for the `product-*` images and adds `generated` with `owner-review-pending` | Home cards now render registered photographs; provenance has a new state |
| `test-security-controls` | The reviewed list of server emitters that must escape output names `server/ssr/locations.ts`, `areas-served.ts` and `industries.ts` in place of the deleted `location-html.ts` | The deleted renderer's responsibilities moved into those files, which are now under the same escaping check |
| `test-stage3-d-r2-contracts` | The assertion that a listed industry page falls through to the client app is replaced by two: the industry route answers 404 only for an unknown slug and never falls through, and all 14 listed industries return server HTML while an unknown slug returns none | All 14 industries now have server content |

Registration: the four new suites (`test-wd-content-contract`, `test-wd-industries-contract`, `test-wd-locations-contract`, `test-wd-media-contract`) are in `scripts/ci-suite-manifest.ts` and `scripts/pre-deploy.ts`. Each has negative controls that prove the assertion fails on a known-bad input.

## 16. Suite results on the final candidate, and the five legacy suites

All runs below are on the final working tree (build `d7848507-8c92-4af0-b230-f0e77eb1b7e8`) unless stated. Logs are under `generated-artifacts/public-site/` (`wd-suites2`, `wd-disp`, `wd-accept3`, `wd-2150`); they are working files and are not part of the candidate.

### 16.1 Isolated disposable stack (own database, own Redis, provider calls denied)

| Suite | Result |
| --- | --- |
| `smoke-role-guards` | 171 of 171 guarded routes and tests passed |
| `test-stage5-public-journey` | 34 checks passed |
| `certification/test-public-wc-intake` | 415 checks passed |
| `test-public-shell-browser` | 16 receipt groups passed (Chromium only; not a Safari or real-iPhone pass) |
| `certification/test-public-wc-intake-browser` | 440 checks passed |

### 16.2 Static suites and gates

| Suite | Result |
| --- | --- |
| `test-wd-locations-contract` | 18 assertions, 25 negative controls, 0 failures |
| `test-wd-industries-contract` | 15 assertions, 24 negative controls, 0 failures |
| `test-wd-content-contract` | 38 assertions, 24 negative controls, 0 failures |
| `test-wd-media-contract` | 23 assertions, 41 negative controls, 0 failures |
| `test-public-claims-contract` | 1023 assertions, 93 negative controls, 0 failures |
| `test-public-shell-contract` | 114 assertions, 21 negative controls, 0 failures |
| `test-security-controls` | passed (CSP, CORS and JSON-LD controls) |
| `test-stage3-d-r2-contracts` | 59 checks passed |
| `test-cro05a-static` | 21 checks passed |
| `build-public-images --check` | 17 sources, every derivative matches its master |
| `ci-suite-manifest --check` | manifest valid (four new suites registered) |
| `check-api-coverage` | 882 endpoints, 1807 handlers; no gap |
| `seo-audit` against the development application | 430 routes, 0 failed, 12 advisory warnings on `noindex` routes. **The first run failed 75 routes**; see 13.5 for the cause (location titles over 70 characters) and the repair |

The 12 advisory warnings are title and description length notes on `noindex` sign-in, reset and thank-you routes; none is a W-D page.

### 16.3 Focused diagnostics and whitespace

Type diagnostics were run on the 82 changed or new `.ts` and `.tsx` files in `client/src`, `server`, `shared` and `scripts` (a whole-project type check was not run, by standing instruction). Three errors are reported, all three on the base commit as well (checked on a clean copy of `b821c9d6`; only the line numbers differ): `scripts/test-public-claims-contract.ts` (no matching overload, line 748 here and 731 on the base), `server/db.ts` line 174 (`getTransactionConfigSQL` is not a member of the transaction type) and `server/routes/public.ts` line 456 (`user` is not a property of `Request`). `git diff --check` is clean. The `.replit` file, `package.json`, the lock file, the migrations and the schema have an empty diff.

### 16.4 The five legacy suites (#2150), recorded and not repaired

The task that owned these five suites is archived and unmerged; the work here neither merges nor repairs it. Each suite was run on the final tree and, where it could run, on a clean copy of the base commit (`b821c9d6`), so the result is attributed to the base and not to W-D.

| Suite | Final tree | Base commit | Cause | Release implication |
| --- | --- | --- | --- | --- |
| `test-task2056-crm-ui-contracts` | Fails on the first assertion: the Lead Ops page source no longer matches `user?.role === "admin" && <ContactBusinessReconciliationPanel />` | Same failure | A stale source-text assertion against `LeadOpsCenter.tsx`, which W-D did not change | Not caused by W-D. The suite does not guard anything the public site or W-D uses |
| `test-lead-ops-budget-removal` | Fails on `AUTHORIZE PAID PILOT` being absent from the same page's source | Same failure | The Lead Ops page no longer contains that wording anywhere under `client/src/pages` or `client/src/components/lead-ops`; the assertion still expects it | Not caused by W-D. It asserts text that no longer exists, so a pass would not prove the budget removal either |
| `test-crm-operator-experience` (isolated stack) | Fails on its first source assertion: `server/routes/crm-operations.ts` must contain `db.select().from(tasks).where(eq(tasks.contactId, contactId))` | Same failure | A stale source-text assertion: the route now builds the task query with extra selected columns and a further filter, so the exact old text is absent | Not caused by W-D |
| `test-statement-acquisition` (isolated stack) | 64 passed, 2 failed: "Upload-chain GHL projection remains held with no projection request" and "Upload-chain merchant confirmation is held without external delivery", after `STATEMENT_ANALYSIS_QUEUE_UNAVAILABLE` | Same 64 passed, 2 failed | The analysis step reports `STATEMENT_ANALYSIS_QUEUE_UNAVAILABLE` in the isolated stack, so the chain records a failed step and the two assertions that need the later steps do not hold; the cause inside the stack was not investigated further | Not caused by W-D: identical on the base commit. The two failing assertions concern held projection and confirmation after an upload; the W-C intake suites in 16.1 pass |
| `test-consent-field-protection` | **Not run.** The isolated runner refuses it (`Unknown pre-deploy suite script path`) because it is not in the suite manifest | Not run | Not registered. Running it directly would use the shared development database and the live GHL client (the suite exercises the post-commit GHL sync), which this work is not permitted to call | Unverified. Registering it in the isolated roster is the repair for the legacy task; it was not done here |

Nothing was relaxed, skipped or deleted to get a pass, and no guard protection, fixture key or cleanup order was touched. The affected release implication is limited to these suites being red in any gate that includes them; none exercises a surface W-D changed, and the public regressions that do (16.1, 16.2) pass.


## 17. Post-Publish read-back (the owner's step after the normal Publish; read-only; not performed)

Nothing below has been done against the deployed site: this work did not publish, and no deployed URL was opened. Publication alone is not an acceptance verdict. Every item is a read: no submission, recovery, send, booking, upload or setting change.

| # | Read | Expected |
| --- | --- | --- |
| 1 | `GET /api/health` | The `sha` and build time of the published checkpoint; compare it with the candidate identity in section 1 and with the tree of the commit that Publish records. Allow for the two cache lifetimes before judging a page (static assets are fingerprinted; documents carry short public cache headers). |
| 2 | Home, first HTML and after JavaScript | The `h1` "Know what you’re paying. See your options."; eyebrow "PAYMENTS FOR YOUR BUSINESS"; actions "Get a free statement review" (`/upload-statement#statement-review-form`) and "Find the right payment setup" (`/about-contact#inquiry`); one eager `<picture>` with `fetchpriority="high"` and five lazy card pictures; the upright terminal in the payment-setup section |
| 3 | `/locations/miami` and `/locations/miami/restaurant` | Both hydrate to their own hub and detail (one `h1`, one `main`), never the not-found page; `/locations/not-a-city` answers 404 |
| 4 | All 14 `/industries/<slug>` pages | Each first HTML carries its own content; healthcare has no "2.6%", "$4,100" or "99.9% uptime SLA"; eight pages carry an illustrative photograph with the caption, six are text-led |
| 5 | `/sitemap.xml` and the child sitemaps | 541 URLs, each once (core 105, blog 14, locations 330, compare 31, glossary 61) |
| 6 | `/case-studies`, `/testimonials`, `/why-liberty-bancard` | The fallback "Understand your processing costs before you decide."; no `Review`, `AggregateRating` or `VideoObject` in any JSON-LD block; `GET /api/public/testimonials/approved` returns no entry |
| 7 | `/free-analysis-guaranteed`, `/free-analysis`, `/savings-calculator` | No "$50", "3,200+" or Liberty target rate; the guaranteed page is self-canonical; the calculator shows no saving until every material figure is entered |
| 8 | `/faq`, `/help`, `/support` | A real-browser first paint well under the 2.5 s budget on the deployed URL (the lab figures are in section 12; a field measurement is the only thing that settles it) |
| 9 | `/learn` and `/learn/ach-payment` | The glossary document remains after JavaScript loads (the isolated preview could not show this, section 13.1) |
| 10 | `/upload-statement#statement-review-form`, `/about-contact#inquiry`, `/get-started?offer=free-terminal#inquiry` | Fragments and query strings survive the first load and a reload |
| 11 | Operator reads, only if an authorized signed-in session exists | None was opened here; none is claimed |

## 18. Content tracker note (no workbook was available or edited)

`Content tracker!H4` counts the literal `Ready`, which column V (rows 7 to 18) never produces, so the cell cannot move. The bounded correction from the contract: set H4 to `=COUNTIF(V7:V1000,"Approved final - release checks remain")` and relabel it "Approved final, destination recorded". The "destination required" state and "Published" should be counted separately, so the cell is never read as deployment or advertising readiness. After the change, check five transitions by hand: no final asset; approval without a destination; destination recorded; revision; publication. Empty cached formula values or `fullCalcOnLoad` do not show that a formula is broken. No remote sheet was changed and the 29-tab marketing workbook was not rebuilt; these are the exact amendments for the owner or the workbook's maintainer.

## 19. Not verified and classified baseline failures

Not verified here: any deployed page or response; Safari, WebKit and any real phone, tablet or screen reader; field (real-user) performance; Google Search Console, traffic or lead data (none exists in the repository, which is why no location URL was removed, redirected or set to `noindex`); the rights or the likeness accuracy of any generated image (owner review is pending); the exact terminal hardware model; the founder portrait; evidence for any customer case; the partner-program "30% lifetime residual" wording (observed, not changed); signed-in operator surfaces; receipt delivery, native booking, GHL, tracking, advertising and outbound activation (untouched and not claimed).

Baseline failures, present on the base commit and not caused by this work: the focused diagnostics of the changed files report three errors that exist unchanged on the base commit (a whole-project type check was not run, by standing instruction); the three errors are named in 16.3, and the legacy suites that fail identically on the base commit (and the one that cannot run in the isolated stack) are listed in 16.4 with their cause.

## 20. Verdicts by layer, rollback, rights and provenance

Verdicts are kept separate; one layer does not stand in for another, and none of the 24 LI-W rows is marked Done from a template test (section 9 states each row's state and open input).

| Layer | Verdict |
| --- | --- |
| Source | **Complete for the assigned scope.** All WD-R and WD-P findings, the 15 design sections and the five asset briefs are implemented or recorded as an owner-input fallback (section 2, 10, 11). The four new suites and the changed existing suites pass (section 13.4 and 16). |
| Fixture (disposable stack) | **Passed** on the final tree: public shell role-flow browser suite, website intake handoff and its browser suite, Stage 5 public journey and role guards (section 16). |
| Browser (Chromium) | **Passed on the final build** for the census, the 78-check probe, the layout, target, contrast, overlay and font gates (section 13). Two real findings found by those gates were fixed (touch targets on `/areas-served`; a trailing full stop in a heading). Chromium only. |
| Deployed UI | **Not verified.** Nothing was published. The read-back is section 17; publication alone is not acceptance. |
| Data and schema | **Unchanged.** No migration, no production read or write; the proof register is empty by design, so no data-backed proof exists to verify. |
| Receipt delivery | **Untouched and not claimed.** The W-C intake suites pass in the fixture only. |
| Native booking and GHL | **Untouched and not claimed.** |
| Tracking | **No configuration changed and not verified live.** The new location action component calls the existing statement-upload and phone-call tracking helpers; no event name was added. |
| Ads and outbound activation | **Untouched and not claimed.** No send, no activation, no setting. |

Accepted truthful fallbacks (they do not hold unrelated presentation work open): no founder portrait, no healthcare photograph, no customer case or testimonial evidence.

**Rollback.** Application and assets only; there is no schema change. Revert to the serving tree (`8198ab1e`, tree `f85cac8a`) by restoring this working tree's differences from `b821c9d6`, or use the platform's previous checkpoint. Do not revert with a broad old release: that would also undo the W-C repairs. Submissions, tasks, files and receipts are not touched by this work and need no restoration. The removed image derivatives and the added masters are in the same change; the builder (`scripts/build-public-images.ts`) regenerates every derivative from the masters.

**Rights and provenance.** The 13 masters come from `liberty-wd-asset-pack-2026-11-10.zip` (SHA-256 in section 1). They are recorded as `generated` (or `authored-for-this-pack` for the live-text rebuilds) with approval state `owner-review-pending` in `client/src/lib/public-imagery.ts` and the claim-evidence rights register; no image is labelled licensed. The pack's own generation record and quality receipt are kept under `docs/media/w-d-asset-pack-2026-11-10/`. Pages with a generated photograph carry the caption "Photos are illustrative and do not show Liberty customers." The four IBM Plex Sans files and the Source Serif 4 files are unchanged; re-encoding or subsetting them is an owner decision because the licence reserves the font name.


## 21. Post-Publish correction pass WD-PV01 to WD-PV09 (2026-11-11; candidate prepared, then published by the owner and read back in 21.7)

Source: `attached_assets/Liberty-W-D-Post-Publish-Audit-and-Corrections-2026-11-11_1794397511125.md` (sections WD-PV01 to WD-PV09) and the instruction `attached_assets/Pasted-Audit-and-implement-WD-PV01-through-WD-PV09-from-this-r_1794397501060.txt`. Sections 1 to 20 above are history and are not rewritten; section 21.5 lists the sentences in them that are no longer the current state. The published W-A, W-B, W-C and W-D work is preserved: the changes below are bounded to the nine findings.

### 21.1 Identity of what was tested

| Item | Value |
| --- | --- |
| Serving (read 2026-11-11T13:57:56Z, before any Publish of this work) | `/api/health` sha `2361f342984e5b8dba2a4c3d7ef987b51db017e0`, built 2026-11-11T00:04:22.465Z, publish build `881f7a78-379a-44f6-bb06-de2d109d6cb8`. `GET /learn/ach-payment` on that build still prints `**ACH credit**`, `**ACH debit**` and `**Cost**`, as the audit reported. |
| GitHub main | `d55710658885d9da3c136e8bb6b2d97edfcae120` ("Render glossary definition bold text and lists on /learn term pages…"), the existing glossary repair. |
| Base of this work | local `main` HEAD `966994f29c50fe321671f644202a6331955b57ca`: `d5571065` plus two local commits that were already present when this pass began: `5d3f9283` (title and `h1` parity for `/0-percent-processing`, `/affiliate`, `/beat-square-stripe`, `/get-started`, with the parity script) and `966994f2` (a ZeroBounce spend-gating and provider-readiness change that is **not part of this pass**, was not reviewed or changed here, and is included in any Publish of this tree: the owner should know it rides along). |
| Candidate | An **uncommitted working tree on `966994f2`, not committed by this work**: 23 modified tracked files (1,330 insertions, 274 deletions) and 5 new files: `scripts/check-wd-pv-browser.ts`, `scripts/probe-public-perf-causes.ts`, `server/ssr/not-found.ts`, `shared/blog-document-titles.ts`, `shared/public-not-found.ts`. Docs, memory and generated working files are outside the identity inputs. |
| Tested-tree digest | `26c453386594fcd4a1d212ced5306560935ba1f107cbf2c815bad7235c7034f6`, same rule as section 1 (SHA-256 of `git diff HEAD --binary -- client server shared scripts`, then for each untracked file in those roots in C-locale order a line `== <path>` and its bytes). It was recomputed after the last source edit and again after the final build, and did not change. |
| Final production build | `npx --yes npm@10.9.4 run build` on Node v22.23.4: build `c8e37ef8-9487-4f6a-9a50-30d88d21339f`, `artifactSha` `966994f29c50fe321671f644202a6331955b57ca` (the artifact records HEAD, not the dirty tree). The workspace npm is 10.9.9 and the project pin is 10.9.4, so the pinned npm was run through `npx`. |
| Production-profile preview builds | `1e0c8711-1b51-4451-b6db-b98e58c98423` served the performance, parity and font runs; it was built from the tree before the last edit to `scripts/check-wd-pv-browser.ts` (a test script; no application file differs from the final tree). `0c412a53-4fc3-44e5-b0ed-6d48ef0ad0d8` was built from the final tree and served the final run of the new browser check (111 ok). Both previews are isolated, synthetic-data, providers denied, on port 6100 (Chromium refuses port 6000). |
| Matched baseline (PV08) | `git archive` of HEAD extracted to `/tmp`, committed once in a throw-away repository (artifact sha `a0f6c285…`), built and served by the same harness and port, sequentially, never concurrently with the candidate. |
| Schema, migrations, dependencies | **Unchanged.** `package.json`, `package-lock.json`, `migrations/` and `shared/schema.ts` have no diff; no startup DDL. `.replit` has no diff (a preview adds a `[[ports]]` mapping for 6100 while it runs; it was restored through the supported replace and re-read clean after each stop). |
| Settings and controls | No production setting written. Outbound pause, GHL controls and background selection untouched. No provider, paid, GHL, email, SMS or booking call; no submission; no old-submission recovery. `scripts/public-ux-audit.ts` (paid) was not run. |

### 21.2 What was delivered or corrected

**WD-PV01, Home hero.** The two hero actions are held inside the copy column at the intermediate widths: they wrap and stack until the column has room, with no smaller targets, so the photograph can no longer sit over the second action. The Home `h1` is painted with IBM Plex Sans (the existing Home treatment) in the React hero and in both server emitters; no other page heading changed (`/faq` and `/industries` still paint Source Serif 4). Both destinations are unchanged. Source: `client/src/components/home/HomeHero.tsx`, `server/ssrShared.ts`.

**WD-PV02, calculator.** The visitor now chooses what the quote is: an all-in effective rate, a processor markup over pass-through costs, or not sure/tiered. Nothing is preselected. A markup quote asks for the card-network costs as a separate figure; no average is estimated. Incomplete or "not sure" input shows "Comparison incomplete", names what is missing, and shows no quoted total and no saving. An all-in rate ignores a stale pass-through figure, so nothing is counted twice. A complete quote still totals once (a 0.3% + $0.10 markup quote with $180 of network costs gives $230 a month, $840 a year of difference). The explanatory copy is one shared module (`CALC_BASIS_COPY`) used by the page and the server renderer. Source: `shared/public-cost-calculator.ts`, `client/src/pages/SavingsCalculator.tsx`.

**WD-PV03, glossary.** No new formatter. The existing repair (`d5571065`: escaped paragraphs, `<strong>` and lists, no client bundle) is in the base of this tree and therefore in the next Publish. Published identity must be read back (section 21.6). Record, for the owner: the serving build lacked the change, which is why `/learn/ach-payment` still printed markers; a stale cached response is judged only after the document cache lifetime.

**WD-PV04, public application.** The page's own wrapper (`.public-application`) scopes 48 px text fields and select triggers, 52 px Back/Next/Submit actions, 48 px Yes/No and device choices, checkbox rows of at least 44 px with a 24 px box, and 14 px status text. The shared Input, Select and Checkbox components are unchanged, so CRM forms keep their compact controls. The open select option list belongs to the shared Select and was not changed or measured. Validation, state, underwriting, bank fields, e-sign and API contracts are untouched. Source: `client/src/pages/MerchantApplication.tsx`, `client/src/styles/public-contract.css`.

**WD-PV05, first-HTML and client identity; cache variation.** The four routes carry the same title and `h1` before and after hydration (`5d3f9283`, re-verified here). The hydrated titles that differed from the first HTML were corrected: Help article titles, the Merchant Policies title, a shared rule that never doubles the site name, and a blog-title override map (`shared/blog-document-titles.ts`) used by the blog page and both server data files. `/free-smart-terminal`, `/blog` and `/blog/:slug` answer a crawler with a publicly cacheable document and a browser with the React shell, so each now sets `Vary: User-Agent` (added to any existing `Vary`, for example `Origin`). Chosen over one consistent document because the repository holds no CDN or cache configuration (the app is served by the Reserved VM), and a header is correct with or without a shared cache; a single document would have been an SSR rewrite the audit excluded. `scripts/check-public-server-hydrated-parity.ts` now covers 18 routes, compares the crawler response with the hydrated page, checks the `Vary` header, and has 11 self-test controls. About 100 first responses remain intentionally client-rendered shells (help 43, blog 15, partners 4, legal, support, shop, merchant application and others); they are classified, not repaired.

**WD-PV06, unknown dynamic URLs.** Unknown industry, city, city+industry, compare, alternatives and switch-from URLs answer 404 with a branded document: one `h1`, Home, Industries, Areas Served, About/Contact and Support links, the shared header and footer, `noindex` in the meta tag and `X-Robots-Tag`, `Cache-Control: no-store`, and no echo of the requested path (the earlier in-file helper that interpolated a caller-supplied message is gone). The React not-found page and the server document read one copy module (`shared/public-not-found.ts`), so client navigation shows the same words. An unknown glossary term still redirects to `/learn` (unchanged, outside this finding).

**WD-PV07, SEO acceptance.** `scripts/seo-audit.ts` is now driven by the emitted sitemap: all 541 URLs (core 105, blog 14, locations 330, compare 31, glossary 61) plus 16 code-defined routes, 557 in all: 457 first-HTML documents and 100 client-rendered shells, of which 88 indexable shells are checked after hydration (one retry) and 16 are crawler representations. A decoded title over 70 characters, brand suffix included, fails; description length and the duplicate static default description on shells are advisory only. The five over-budget titles are shortened without changing URLs or `h1`s (`/switch-from/*` now "Switching From <name>: Agreement Questions | Liberty Bancard"; `/learn` "Payment Processing Glossary: Terms Merchants Need | Liberty Bancard"), and the audit now rejects an over-budget title in a family it used to omit (self-test). It also found and fixed missing `og:image` and Twitter tags on alternatives and switch-from pages, over-long glossary descriptions, and over-70 hydrated titles. No city page was removed or set to `noindex`; the sitemap still has 541 unique URLs.

**WD-PV08, performance.** Investigated, **not reproduced, nothing repaired** (section 21.3). A speculative Plex Sans 700 preload added during the investigation showed no benefit and was removed; `server/ssr/home.ts` equals HEAD and the `preloadFonts` option no longer exists.

**WD-PV09, competitor copy.** The Worldpay page uses "Worldpay (a Global Payments company)" and the glossary says "Worldpay (now part of Global Payments)", following the sources the audit cites. Gravity is categorized "Flat-Rate or Custom-Priced Processor" with questions about the visitor's own plan and fee lines; the monthly-flat-fee division is removed. No new price is stated.

### 21.3 Evidence

Each layer is recorded separately; none stands in for another.

- **Source / contract (development application, then final tree):** `scripts/test-wd-content-contract.ts` 60 assertions, 46 negative controls, 0 failures (includes the first-HTML glossary check: no literal `**`); `scripts/test-public-claims-contract.ts` 1,023 assertions, 93 negative controls, 0 failures; `scripts/check-public-server-hydrated-parity.ts` 18 of 18 routes, 11 self-test controls; `scripts/seo-audit.ts` passed, 557 routes; `scripts/check-public-fonts.ts` exit 0 (31 ok).
- **Browser (Chromium only), final tree, development application and production-profile preview `0c412a53`:** `scripts/check-wd-pv-browser.ts` 111 ok, 0 failures, with a negative control per family. PV01: containment, overlap and centre hit-test at 320, 390, 768, 1024, 1100, 1180, 1280 and 1440 px, and with the root text size doubled at 320, 390, 768, 1024 and 1280 px (the cookie notice is answered first in the enlarged runs, because it legitimately grows with text size and covers the page centre until answered); painted font IBM Plex Sans; two negative controls, one of them the reported non-wrapping row. PV02: ten checks including the reported $50 / $3,000 defect predicate. PV04: sizes and no horizontal overflow on steps 1, 4, 5, 6 at 320, 390, 768 and 1280 px, and steps 1 and 6 in the dark scheme and with doubled text, from a clearly synthetic local draft with every `/api/` request aborted (nothing saved or submitted). PV06: six unknown URL families, three valid controls, three negative controls, and client navigation.
- **Glossary first HTML and rendered:** on the development application, all 61 documents (hub and 60 terms) contain no literal `**` in the first HTML and none in rendered text; 54 of the 61 documents contain list items and every document contains `<strong>`; `/learn/ach-payment` has two `<strong>` and no client bundle reference; one `h1` and one `main` on each. Observed and left as authored: 55 terms have an "example" block that is deliberately preformatted (`<pre>`) and keeps its hyphen-prefixed lines; it is not the definition formatter's output.
- **Performance, production-profile preview, final application code (Chromium, 10 routes):** 0 over budget, 0 invalid. Home LCP 1,148 ms, CLS 0.0001; `/faq` 980 ms, CLS 0.0014; `/industries` CLS 0.0159, `/upload-statement` 0.0108, a retail industry page 0.0129. Missing or invalid measurements still fail the check.
- **PV08 controlled comparison (390 x 844, DPR 2, CPU x4, 1.6 Mbps / 150 ms, cold cache, one discarded warm-up, baseline and candidate run one after the other):** Home LCP medians: baseline 1,188 ms (1,164 to 1,408); candidate with the preload 1,328 ms; candidate without it 1,348 ms (seven runs, one outlier at 2,040); baseline with third-party widgets allowed 1,228 ms. The hero image is the LCP element; no run fetched the hero URL twice (only third-party widget endpoints repeated when widgets were allowed). FAQ CLS 0.0014 to 0.0015 in every profile (throttled phone, widgets on and off, unthrottled 390, desktop 1280); Help and Support were also small. The audit's FAQ CLS 0.118, Home LCP 4,988 ms and duplicate hero entry **did not reproduce**, so their cause is unestablished and no cause-specific repair was made. Reports: `generated-artifacts/public-site/perf/` (`causes-*.json`, `final-candidate.json`); the probe is `scripts/probe-public-perf-causes.ts`.

### 21.4 Not run, and not claimed

No whole-project type check (standing instruction). Chromium only: no WebKit, Safari or real device, no screen reader. The select option list of the application, the application's later steps with real data, and real submissions were not exercised. No deployed page was measured; no real-user or field performance statement is made, and the audit's field numbers stay unverified. The provider facts in WD-PV09 rest on the sources the audit cites. Signed-in operator surfaces, receipt delivery, native booking, GHL, tracking and advertising were not touched and are not claimed.

### 21.5 Statements in earlier sections that are no longer current

- Section 2 (WD-R05, "an unknown slug is a 404 with no fallback") and the W-D ledger, specification and roadmap entries ("unknown keys stay an empty-body 404"): an unknown industry, city, detail, compare, alternatives or switch-from URL still answers 404 and now carries the branded not-found document (21.2, WD-PV06).
- Section 13.1, row "Server and hydrated text differ" (four routes carry a different `h1`): repaired and covered by the 18-route parity script (21.2, WD-PV05).
- Section 13.1, row "Glossary markup", and the ledger/specification/roadmap sentence "33 of the 60 glossary term pages show literal `**`": repaired by `d5571065`; the correction takes effect on the deployed site only when that build is published (21.2, WD-PV03).
- Sections 13.5 and 16 ("the SEO audit passes, 430 routes"): the audit now covers the 557-route roster in 21.2, WD-PV07; the 430 figure was a smaller roster, not a complete sitemap check.
- Section 17, row 7: "the calculator shows no saving until every material figure is entered" is now stronger: it also requires the visitor to choose what the quote is.
- Section 1 lists npm 10.9.9; this pass built with the pinned npm 10.9.4.

### 21.6 Published read-back (owner step after the normal Publish; read-only; not performed) and verdicts

Publication alone is not an acceptance verdict, and this work did not publish or activate anything.

| # | Read | Expected |
| --- | --- | --- |
| 1 | `GET /api/health` | `sha` and build time of the Publish checkpoint; it must include `d5571065` (compare the commit and tree Publish records with section 21.1; the serving sha today is `2361f342`). |
| 2 | `/learn/ach-payment` and a sample of other terms, first HTML and in a browser | No literal `**`; `<strong>` and lists present; no client bundle. If an old response appears, compare `Date` and `Age` with the document cache lifetime before calling it a failed build. |
| 3 | Home at 1024 px, in a browser | Both actions inside the copy column, the second not under the photograph, heading painted in IBM Plex Sans, destinations unchanged. |
| 4 | `/savings-calculator` with 0.3% + $0.10 and no choice, "markup" without network costs, "not sure" | "Comparison incomplete" and no saving in all three; $230 a month with $180 network costs entered. |
| 5 | `/merchant-application` at 390 px | Fields 48 px, actions 52 px (read only; do not submit). |
| 6 | Titles and `h1` of the four PV05 routes, crawler against browser, and `Vary` on `/free-smart-terminal`, `/blog`, `/blog/<slug>` | Same identity; `Vary` contains `User-Agent`. |
| 7 | `/locations/not-a-city`, `/locations/miami/not-an-industry`, `/industries/not-an-industry` | 404 with a branded body, `noindex`, no path echo. |
| 8 | `scripts/seo-audit.ts` against the published base | Titles of the five routes within 70 characters; every family represented. |
| 9 | `/alternatives/worldpay`, Gravity pages | New copy as in 21.2. |
| 10 | Field performance for Home, `/faq`, `/help`, `/support` | Only real-user or repeated deployed measurements can settle PV08; none exists here. |

| Layer | Verdict |
| --- | --- |
| Source | **Complete for the nine findings** as scoped (PV08 as an investigation with no demonstrated cause). Suites in 21.3 pass. |
| Fixture / disposable | Isolated production-profile preview only; no database, role-flow or intake certification was re-run because no such code changed. |
| Browser (Chromium) | **Passed on the final tree** (111 checks, 10-route performance gate). |
| Deployed UI | **Not verified.** Nothing was published. |
| Data, schema, receipt delivery, native booking and GHL, tracking, ads, outbound | **Unchanged and not claimed.** |

**Rollback.** Application only, no schema change. Restore this working tree's differences from `966994f2`, or revert to the platform's previous checkpoint (the serving tree is `2361f342`). Do not revert with a broad old release. The accepted truthful fallbacks (no founder portrait, healthcare photograph or customer case) and the owner-review-pending image rights from section 20 are unchanged.

### 21.7 Published read-back (2026-11-11, read-only, Chromium and HTTP; performed after the owner's Publish)

The owner reported "Published". Everything below is a read of `https://libertybancard.com` and changes nothing: no form was submitted, no provider, GHL, email, SMS or booking call was made, no production setting was written, and nothing was activated, unpaused or recovered by this work. Sections 21.1 to 21.6 above are the pre-Publish record; 21.1 ("not published") and the "Deployed UI: Not verified" verdict in 21.6 are superseded by this section.

**Identity.** `GET /api/health` at 2026-11-11T15:53:29Z returned `sha` `5f72226c36c4c0ad310bb23d58f18a87f2d7042c`, `builtAt` 2026-11-11T15:51:34.926Z, `env` production, `publishBuildId` `f3a76517-3f65-4f7a-9671-73ab43cb7505`. The Publish committed the working tree as `5f72226c` ("Update SEO metadata and merchant application components", 2026-11-11T14:15:38Z; the commit also carries this work's documents and memory note) on `966994f2`, then recorded `e45266b6` ("Published your App", no file changes; HEAD, same tree). `d5571065` is an ancestor of `5f72226c`. The source roots of the committed tree reproduce the tested-tree digest in 21.1 exactly: SHA-256 of `git diff 966994f2 HEAD --binary --diff-filter=M -- client server shared scripts` followed, for each added file in those roots in C-locale order, by `== <path>` and its bytes is `26c453386594fcd4a1d212ced5306560935ba1f107cbf2c815bad7235c7034f6`. The ZeroBounce commit `966994f2` is part of what is now live, as disclosed in 21.1. The Publish records the commit, not the build id of the preview or the local production build in 21.1; the served build is the platform's own.

| # (21.6) | Read on production | Result |
| --- | --- | --- |
| 1 | `/api/health` | Pass: serving sha `5f72226c`, which contains `d5571065`. |
| 2 | Glossary: hub and 60 terms from `sitemap-glossary.xml` (61 documents), first HTML and rendered text | Pass: no literal `**` in any first HTML or rendered text; `<strong>` in every document; one `h1` in every document. `/learn/ach-payment` serves `Cache-Control: public, max-age=3600` and no application bundle (only the vendor loader, `/ssr-shell.js` and the platform analytics script). The 55 preformatted "example" blocks keep their hyphen lines, as in 21.3. |
| 3 | Home hero, `scripts/check-wd-pv-browser.ts --base` production | Pass (25 PV01 checks): containment, no overlap and centre hit-tests at 320, 390, 768, 1024, 1100, 1180, 1280 and 1440 px and at doubled text size; heading painted in IBM Plex Sans; negative controls rejected. |
| 4 | Calculator | Pass (10 PV02 checks): no basis preselected; no choice, "markup" without network costs, and "not sure" each show "Comparison incomplete" with no total and no saving; $230 a month and $840 a year with $180 network costs entered. |
| 5 | Public application | Pass (61 PV04 checks) at 320, 390, 768 and 1280 px, dark scheme and doubled text, from a synthetic local draft with every `/api/` request aborted: nothing was saved or submitted. |
| 6 | Titles, `h1`, `Vary` | Pass: `scripts/check-public-server-hydrated-parity.ts` against production, 18 of 18 routes, 11 self-test controls, public cacheability asserted for crawler responses; `Vary: Origin, User-Agent` on `/free-smart-terminal`, `/blog` and `/blog/<slug>` for both a browser and a crawler user agent; the SEO audit reports 16 of 16 branched routes with the crawler document, the shell for browsers and `Vary: User-Agent`. |
| 7 | Unknown dynamic URLs | Pass (15 PV06 checks plus a direct read): `/locations/not-a-city`, `/locations/miami/not-an-industry`, `/industries/not-an-industry`, `/compare/not-a-vendor`, `/alternatives/not-a-vendor`, `/switch-from/not-a-vendor` and `/locations/miami-florida` each answer 404 with one `h1`, `X-Robots-Tag: noindex, follow`, a `noindex` meta tag, `Cache-Control: no-store`, and no echo of the requested path. |
| 8 | `scripts/seo-audit.ts` against production | Pass on the second run (557 routes, 541 of 541 sitemap URLs, 457 first-HTML documents, 88 of 88 hydrated pages, 16 crawler representations). The first run failed one check: `/data-processing-agreement` reported an empty hydrated title, no canonical and only the shell description. The page was then loaded in Chromium three times (settle times 0.8 s, 0.8 s and 4 s) and carried the correct title, one canonical, one `h1` and its own description every time; a full second audit passed. The same route also hydrates late on the development application (empty at 0.8 s, correct at 4 s), so the first-run result is read as a settle-time miss on a lazily loaded route, not a content defect. It was observed once and is recorded here so a later failure of the same check is not treated as new. No repair was made. |
| 9 | Competitor copy | Pass: `/alternatives/worldpay` contains "Worldpay (a Global Payments company)"; `/learn/payment-processor` contains "Worldpay (now part of Global Payments)"; `/alternatives/gravity-payments` contains "Flat-Rate or Custom-Priced Processor". The Worldpay and Gravity pages are byte-identical to the tested tree's rendering except for the platform analytics script tag that production adds. |
| 10 | Performance | Lab only (Chromium, 390 x 844, DPR 2, CPU x4, 1.6 Mbps / 150 ms, cold cache, 3 runs per route): the 10-route gate reports 0 over budget, 0 invalid; CLS at most 0.0157; Home LCP 2,360 ms (budget 2,500) and the other routes 600 to 1,880 ms. The cause probe (5 runs; the first column blocks vendor widgets, the second lets them load): Home LCP median 2,024 ms and 2,160 ms, CLS 0.0001; `/faq` LCP 700 and 860 ms, CLS 0.0013 in both; `/help` 1,764 and 1,624 ms; `/support` 1,732 and 1,872 ms, all CLS 0.0001. The Home LCP element is the mobile hero image and it was fetched once in every run; with widgets on, only the vendor chat-config and geo-location requests repeat (as in the pre-Publish baseline). The audit's FAQ CLS 0.118, Home LCP 4,988 ms and duplicate hero entry were again **not observed**, so PV08 stays an investigation with no demonstrated cause and no repair. Home LCP from this container to production is 0.7 to 0.9 s above the local isolated preview in 21.3 (the network path differs); it is within budget and was not investigated further. Real-user or repeated deployed field data is still absent, so no field claim is made. |

Reports: `generated-artifacts/public-site/wd-pv/published-report.json`, `generated-artifacts/public-site/perf/published-lab.json`, `causes-published-widgets-off.json`, `causes-published-widgets-on.json`.

**Not verified here.** WebKit, Safari, real devices and screen readers; the application select option list and later application steps with real data; real submissions; field performance; signed-in surfaces. CRM, outreach, outbound sending, GHL, receipts and booking were not touched and are **not claimed active or changed** by this publication of this work (the Publish also carried the ZeroBounce change in 21.1, which was neither reviewed nor changed here). Any startup or hand-off behaviour of the platform's Publish itself was not inspected.

**Workspace note.** After the Publish, starting a Chromium-based check made the platform re-add a `[[ports]]` mapping for local port 6100 to the workspace `.replit` each time; it was restored through the supported replace, and `.replit` has no diff from the published commit at the end of this pass.

| Layer | Verdict after the read-back |
| --- | --- |
| Source and published identity | **Confirmed**: serving sha `5f72226c`; source roots match the tested-tree digest. |
| Deployed UI (Chromium, lab) | **Passed** for 21.6 items 1 to 9; one first-run hydration-timing miss on the data-processing-agreement check, not reproduced in three loads or the second full audit. |
| Field performance | **Not established**; PV08 has no demonstrated cause and no repair. |
| Data, schema, receipts, native booking, GHL, tracking, ads, outbound | **Unchanged by this work and not claimed.** |
