---
name: Public-site verification lessons
description: Durable environment limits for verifying public-site work here (browser ports, WebKit, clean-clone baselines, lab performance noise, isolated-preview side effects).
---

- Chromium in this container cannot open port 6000, and the isolated cloud preview defaults to it. Start the preview on another `--public-port` before collecting any browser or performance evidence; numbers from an unreachable port look absurdly fast.
- WebKit/iPhone cannot be exercised here (WebKitGTK's web process aborts on EGL in every configuration tried, and it is not iOS Safari anyway). Report it as not exercised instead of retrying.
- A clean clone of a prior commit needs `attached_assets/` (symlink it, with `node_modules`) before it builds. Use such a clone for before/after baselines and compare suite failures with it before widening scope.
- Lab LCP/CLS: use 5-run medians, never run builds or suites at the same time, and treat routes that wait for hydration as unstable rather than as before/after evidence. Take the matched baseline/candidate pair back-to-back; later invalid reruns on both are environment, proven by loading the baseline the same way.
- Server-only SSR routes can serve the SPA shell to non-crawler user agents; check with `curl` byte counts before trusting a browser run.
- The isolated preview appends a port mapping to `.replit` while it runs. Restore `.replit` and re-read its diff afterward, then rebuild: candidate build identity covers config files, so a later browser suite fails with "inputs changed; rebuild required".
- Background servers must be started as background tasks (a shell `&` subshell dies when the call returns), and `pkill -f <name>` inside a shell whose own command line contains `<name>` kills that shell; kill by task id instead.
- Real browser zoom is `privateStage3Browser(..., { zoom })`; never also set device-metrics emulation in that session or the proof becomes emulation again.

**Why:** each cost real time and none is visible in the code.
**How to apply:** before browser, performance or baseline work on public pages.
