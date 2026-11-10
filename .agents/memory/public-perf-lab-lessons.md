---
name: Public-site lab performance lessons
description: How to get valid, comparable check-public-perf numbers here, and the LCP cause behind the old FAQ/Help/Support misses.
---

- **Above-the-fold `.reveal` is an LCP trap.** A hero wrapper using the scroll-reveal class (opacity 0 + transition) kept Chrome from counting the hero text as an LCP candidate until the web font swapped (about 4.5 s under the harness). Removing the class from the hero (FAQ, Help) and removing a near-invisible stock photo plus hero reveal (Support) took those routes from 3.0-4.6 s to about 0.9-1.0 s. Keep `.reveal` for below-the-fold sections only.
  **Why:** a disable-`.reveal` probe moved FAQ LCP 4.5 s -> 1.1 s; blocking fonts alone did not show the text as a candidate.
  **How to apply:** any new public page with a slow LCP on a text element: probe with `.reveal` forced visible before blaming fonts or the host.
- **Run perf and probes with ShellExec `run_in_background`, not in the foreground call.** Foreground runs repeatedly landed in a slow/INVALID regime (first-load DCL 5-10 s) while the same scripts in a background task gave calm, repeatable numbers. The page registers `/sw.js` at `load`; once it controls the page, document/JS/CSS bypass the CDP throttle while fonts/images stay throttled, so the first run per fresh browser is not comparable. Warm with one `/` run.
- **The harness needs `main h1` to treat a sample as ready.** SSR-only documents with no `<main>` (competitor alternatives/switch-from pages) read INVALID on both baseline and candidate; a copy of the harness with readiness = any `h1` measures them.
- **Matched baseline build:** `git archive <HEAD>` into a throw-away dir, commit once there (the build reads a HEAD), create `.local/tasks`, link `node_modules`, build, serve on a different port; run baseline and candidate one after the other, never together.
- **Platform side effect:** starting a preview that binds a port adds a `[[ports]]` mapping to `.replit`; remove it before any disposable run, because the build identity covers `.replit`.
- Chromium cannot open port 6000 (blocked); use 6100 for previews. React 18 needs lowercase `fetchpriority` on `<img>`.
- **`.replit` edits go through the temp-file tool.** Direct edits are refused; write the full TOML to `.replit.new` and call `verifyAndReplaceDotReplit`.
- **The isolated C1 preview registers only the SSR public routes, not the glossary routes.** `/learn` and the 61 glossary terms hydrate to the client not-found page there (a harness artifact); the full dev app on port 5000 serves them as standalone documents. Check `/learn*` on 5000 (or the deployed URL), not on 6100.
- **Preview readiness:** port 6100 answers 200 with a "Preparing the isolated test candidate" page before the stack is ready; wait for "isolated candidate ready" in the preview log before starting any gate.
- **The SEO audit enumerates all 330 location URLs from the shared location data and fails a title over 70 characters including " | Liberty Bancard".** The longest industry names with the longest city names exceed it, so a location title may take the brand suffix only when the total fits. Run `scripts/seo-audit.ts` against the dev app (restart it first) after any change to location, industry or title rules; it caught a 75-route regression that no W-D static suite saw.
- **Touch targets:** an inline `<a>` with the `public-tap` class does not get its minimum height; use `inline-flex items-center` as well.
