---
name: Post-Publish public-site correction pass lessons
description: Reproduction discipline, preview/.replit handling and verification pitfalls from the post-Publish audit correction of the public site
---
- Field spot numbers from an audit (FAQ CLS 0.118, Home LCP ~5 s, duplicate hero fetch) did NOT reproduce in a matched Chromium lab (390px, CPU x4, 1.6 Mbps/150 ms, cold cache, warm-up discarded, baseline and candidate run sequentially). Record "not reproduced" and repair nothing undemonstrated; a speculative font preload showed no benefit and was removed.
  **Why:** audit explicitly forbade universal field-performance claims and unmeasured repairs.
  **How to apply:** build a baseline from `git archive HEAD` into /tmp (git init + empty commit, symlink node_modules, mkdir .local/tasks) and compare on the same port, never concurrently.
- The isolated C1 preview adds a `[[ports]]` mapping for its port to `.replit` and the mapping can reappear after the process stops. Restore with `verifyAndReplaceDotReplit` (absolute temp path), wait ~45 s, re-diff, and do the final production build AFTER the file is clean (build identity covers `.replit`). `--reuse-build` fails the identity check after a plain build; start without it. Chromium cannot open port 6000; use 6100.
- Background `( ... &)` children die when ShellExec returns; use run_in_background for previews and long runs.
- Pinned npm 10.9.4 is not the workspace npm (10.9.9): run `npx --yes npm@10.9.4 run build` and disclose it.
- Text-enlargement browser checks: the cookie notice grows with text size and covers the page centre, so hit-tests fail for a reason unrelated to the layout. Store consent first in those sessions.
- A crawler-vs-browser split on the same URL needs `Vary: User-Agent` (res.vary appends); no repo CDN config exists, the app runs on the Reserved VM.
- Glossary `example` blocks render in `<pre>` and keep authored hyphen lines; only definitions use the bold/list formatter, so a hyphen-line scan must skip `<pre>`.
- A docs-only edit does not change the tested-tree digest; recompute it after any script edit, because `scripts/` is in the digest.
- After the owner's Publish, the platform re-adds the 6100 `[[ports]]` mapping to `.replit` whenever a Chromium-based script starts (and it can reappear a few seconds after a restore). Run all browser checks first, then restore once at the very end and re-diff against the published commit's `.replit`.
  **Why:** four restores in a row were undone by the next Chromium launch.
- Publish commits the whole working tree (docs and memory included) as a normal commit. Prove the published tree equals the tested one by reproducing the digest from `git diff <base> HEAD --diff-filter=M` plus added files, not by trusting the commit message.
- The SEO audit's hydrated-metadata stage can miss a lazily loaded route once (empty title/canonical at the settle time) while the page is fine. Reload it a few times with a longer settle and rerun the audit before calling it a defect; record the flake so a repeat is not read as new.
- Deployed-lab Home LCP from this container is 0.7 to 0.9 s above the local isolated preview (network path); compare deployed-to-deployed baselines only.
