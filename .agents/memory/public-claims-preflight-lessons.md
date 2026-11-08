---
name: Public claims preflight lessons
description: Tooling and roster quirks found while preflighting the public truth/terms (W-A) task; useful for any public-copy or suite-registration work.
---

- A new test suite must be registered in BOTH the pre-deploy mandatory-suite list and the CI suite manifest (the manifest has a `--check` self-validation). Mobile, fonts and overlay public checks are registered in both; the public perf check and the route-validation DTO check are not and are run by hand.
- Workbook `.xlsx` files here have inline strings and no shared-strings part and no spreadsheet library is installed: parse with python `zipfile` plus XML.
- Plan Mode: `git fetch` is blocked and can leave `.git/index.lock` protection errors; rely on the last-fetched origin ref and re-fetch at build start. Plan-mode checks of live health work with plain curl.
- Every public page has a hand-written server-rendered body that duplicates (and can differ from) the React copy, so a claim fix must change both emitters; the React comparison pages also emit hand-written Review/AggregateRating schema client-side.
- Claim census must scan wider than the owned routes: retired contract/timing/funding claims were also hard-coded in Get Started, Free Analysis, Help Center, Merchant Application, Why Liberty, the shared SEO component's site-wide Organization JSON-LD (description and an "offer" name) and per-page schema descriptions. After fixing, scan hydrated text + meta + every JSON-LD block of ~20 routes in Chromium, not just source grep.
- Public `/shop` (TerminalShop) once showed internal margin/payback/approval-tier tables; scan for `liberty margin|auto-approve|mgr approval` on public pages.
- Static contract suites can import the SSR HTML builders under tsx for parity checks; strip claim-id strings before scanning the claim module, and allowlist per site (e.g. an optional `aggregateRating?:` prop type on SEO.tsx).
- Baseline perf/CLS comparison: `git archive` HEAD into a throwaway dir with its own `git init` (build needs a repo for artifact identity; symlink node_modules/attached_assets), build, serve with the C1 preview script on another port. Never `git worktree add` (the .git guard blocks it and leaves an empty `.git/worktrees/*` dir). Perf numbers taken while the machine is busy (preview just started, tsserver) can show LCP 3-5x slower; repeat before calling it a regression.
- The C1 preview script on a new port makes the platform add a `[[ports]]` mapping to `.replit`; remove it afterward by writing a full TOML to a temp file and calling verifyAndReplaceDotReplit (direct edits are refused), then confirm `git diff .replit` is empty.
- Fonts check on `/industries/retail-payment-processing` flaps (CLS ~0.23 single shift at ~4.7s) with the HEAD page too: baseline. `/integrations`, `/beat-square-stripe` small tap targets and `/merchant-application` stepper contrast are baseline; the mobile gate route list excludes them.

**Why:** these cost extra rounds during the preflight and are not visible from reading one file.
**How to apply:** when planning or building any public-content change, check both renderers, register suites in both rosters, and treat the legal pages (Terms, Privacy) as read-only evidence.
- SEO audit measures raw HTML title length, so `&amp;` costs five characters; keep titles under the limit after escaping and write contrast-sensitive CSS colors as shared tokens (light-blue #3b82f6 on white is 3.7:1, below AA).
