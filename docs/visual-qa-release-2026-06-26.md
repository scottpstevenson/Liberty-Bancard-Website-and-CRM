# Cross-Surface Visual QA & Release Gate — Public Marketing Surface

**Date:** 2026-06-26
**Scope:** Home + the 10 rolled-out public marketing pages
**Type:** Verification-and-fix gate (NOT a redesign)
**Design system of record:** "Statement Intelligence" — `client/src/index.css`; reference page `client/src/pages/Home.tsx`

## Pages audited
- `client/src/pages/Home.tsx`
- `client/src/pages/GetStarted.tsx`
- `client/src/pages/FreeAnalysis.tsx`
- `client/src/pages/FreeAnalysisGuaranteed.tsx`
- `client/src/pages/SavingsPage.tsx`
- `client/src/pages/FreeSmartTerminal.tsx`
- `client/src/pages/FAQ.tsx`
- `client/src/pages/ISOPartnerProgram.tsx`
- `client/src/pages/RateComparison.tsx`
- `client/src/pages/LocationIndustryPage.tsx`
- `client/src/pages/IndustryPage.tsx`

Shared shell also reviewed: `client/src/components/Navbar.tsx`, `client/src/components/Footer.tsx`, and the fixed overlays (`StickyMobileCTA`, `ChatWidget`, `ContactBubble`, `CookieConsent`, `ExitIntentPopup`, `WelcomePopup`).

---

## 1. Findings by severity

### Critical
None found.

### High → FIXED
| ID | File:line | Finding | Resolution |
|----|-----------|---------|------------|
| H1 | `GetStarted.tsx:387` | Main hero `h1` capped at `md:text-4xl` while 8 of 10 sibling heroes reach `lg:text-5xl` — ~33% smaller on desktop (cross-page type-scale drift). | Normalized to `text-3xl md:text-4xl lg:text-5xl`. |
| H2 | `GetStarted.tsx:258` | Results-view hero `h1` had the same capped scale. | Normalized to `text-3xl md:text-4xl lg:text-5xl`. |
| H3 | `FreeAnalysis.tsx:486` | Results-view hero `h1` had the same capped scale. | Normalized to `text-3xl md:text-4xl lg:text-5xl`. |

### Medium → FIXED
| ID | File:line | Finding | Resolution |
|----|-----------|---------|------------|
| M1 | `FreeAnalysis.tsx:114` | FAQ accordion toggle `<button>` did not announce expand/collapse state to assistive tech (the sibling pattern in `FreeAnalysisGuaranteed.tsx:72` already sets `aria-expanded`). | Added `aria-expanded={open === idx}` to match the established pattern. |

### Low → DEFERRED (proposed as follow-ups, out of fix-gate scope)
| ID | File:line | Finding | Disposition |
|----|-----------|---------|-------------|
| L1 | `FAQ.tsx:295`, `FreeAnalysis.tsx:482` | Hero content not wrapped in the `accent-rule pt-5` device used by 7 of 10 heroes — minor accent-line consistency drift. | Proposed as a follow-up task. |
| L2 | `SavingsPage.tsx:183-200` | Comparison table leans on red/emerald fills for "current vs Liberty" good/bad meaning; headers carry text labels but per-row cells are color-led. | Proposed as a follow-up task (pair color with a non-color cue per WCAG). |

### False positives (verified, no action)
- `SavingsPage.tsx:130-131` — reported as a logo link missing `aria-label`. Reality: line 130 is a plain `<span>` (not a link); line 131 is a link with visible text "Get My Free Analysis" + decorative icon — not icon-only, no label needed.
- `GetStarted.tsx` results section — reported as an `h1 → h3` heading-order break. Reality: order is `h1` (258) → `h2` (277) → `h3` (283), sequential.
- `ISOPartnerProgram.tsx:115` — `h3` appears before the page `h1` by line number only; it is a card title inside the `PartnerIncomeEstimator` sub-component defined above the main component, rendered under an `h2` in DOM order. No break.

---

## 2. Accessibility sweep

- **Contrast (AA 4.5:1):** Token pairs in `client/src/index.css` verified.
  - `--foreground` (222 47% 11%) on `--background` (40 33% 98%) ≈ 16:1 — pass.
  - `--muted-foreground` (215 16% 47%) on `--background` ≈ 4.6:1 — pass for normal text.
  - `--accent` (221 78% 48%) used for links/accents — passes for medium/large text and UI accents.
  - Dark mode: `--muted-foreground` (215 20% 65%) on `--background` (222 47% 11%) — pass.
- **Focus rings:** No global `outline: none` reset exists in `index.css`; shadcn controls carry `focus-visible:ring-*`, and custom `<button>`/`<a>` elements retain the native UA focus outline. No missing-focus regression.
- **Icon-only controls:** No `size="icon"` buttons on the 10 pages. Navbar mobile menu toggle has `aria-label` (`Navbar.tsx:313`); decorative icons across the surface carry `aria-hidden`. No icon-only control lacks a label.
- **Heading order:** Each page renders exactly one `h1` per active render branch (loading / not-found / main branches are mutually exclusive on the pages reporting 2 `h1`s). Heading levels descend sequentially (`h1 → h2 → h3`) on every page checked.
- **Color-only meaning:** Status/affordances pair color with icon + text on Home and most pages; the one color-led surface (SavingsPage comparison table) is logged as L2 follow-up.

## 3. Responsive + overlay matrix

Breakpoints reviewed: mobile (375), tablet (768), desktop (≥1024).

- **Type scale:** All 10 heroes now reach `lg:text-5xl` on desktop (after H1–H3 fixes), consistent with the suite. Mobile heroes start at `text-3xl`/`text-4xl` with no horizontal overflow.
- **Overlay z-index stack (no overlap):**
  - `StickyMobileCTA` — `fixed bottom-0 z-40 md:hidden`, 56px tall; global `<main>` has bottom padding (4.5rem <1024px / 3.5rem <768px) reserving space so it never covers content.
  - `ChatWidget` — `fixed bottom-24 right-4 md:bottom-6 md:right-6 z-50`; sits above the 56px sticky CTA on mobile (bottom-24 = 96px clearance).
  - `ContactBubble` — `fixed bottom-4 left-4 z-50 hidden lg:block`; desktop-only, left side — no conflict with the right-side chat.
  - Modals `ExitIntentPopup` / `WelcomePopup` — `z-[100]`; `CookieConsent` — `z-[9999]` (top, transient, dismiss-once).
  - Stack order is coherent: `40 < 50 < 100 < 9999`. No overlap found.

## 4. Consistency sweep (Statement Intelligence)

- **Accent / color:** `text-white` / `bg-white/*` usages are confined to intentional `bg-primary` navy CTA blocks; no dark/glass color leakage onto light sections.
- **Effects:** No `opacity-15`-style silent-no-op Tailwind utilities, no arbitrary HSL-with-alpha gradient stops, no leftover `glass` / `backdrop-blur` / `glow-blob` hero remnants on any page.
- **Spacing rhythm:** Hero sections use the `py-14/py-16/py-20` family; a few use `py-20 lg:py-24/28` — within the established rhythm, not drift.
- **Remnants / broken grids / unsupported claims:** None found (no dark-gradient heroes, TODO/placeholder/lorem markers, or empty grids).

## 5. CTA destinations & tracking preservation

- The only code changes in this gate are 3 hero `h1` class strings + 1 `aria-expanded` attribute (see git diff). **No CTA `href`, route target, `CALENDAR_URL`, `buildAttributedBookingUrl(...)` call, or `track*` call was modified.**
- Tracking helpers (`trackCalendarBooking`, `trackBookingCtaClick`, `trackPhoneCtaClick`) and booking-URL attribution remain intact across the surface; navbar/footer booking CTAs unchanged.

## 6. Operational/portal surfaces

Untouched. The serif heading treatment is scoped via `marketing-surface :is(h1,h2,h3)` and is not applied to CRM/dashboard/operator/merchant/partner surfaces, which remain sans-serif.

---

## Release verdict

**PASS.** All critical and high findings are resolved; one medium a11y parity fix applied. Two low-severity consistency items are logged as follow-up tasks (#635, #636). No old-template remnants, broken grids, unsupported claims, overlay overlaps, contrast failures, missing focus rings, or icon-only-label gaps remain on the public surface. CTA destinations, tracking, and booking-URL attribution are preserved. Operational surfaces are unaffected.

### Validation
- Desktop screenshots of `/get-started` and `/free-analysis` confirm the enlarged, light-first heroes render cleanly with no overflow.
- `api-coverage` and `role-guards` workflows pass (no new unmatched routes; 40 guarded routes correct).
