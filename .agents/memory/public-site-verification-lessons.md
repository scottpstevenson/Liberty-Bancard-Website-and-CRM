---
name: Public-site verification lessons
description: Environment limits and baseline failures hit while verifying public-site mobile work (browser ports, WebKit, clean-clone builds, lab perf noise).
---

- Chromium in this container cannot open port 6000 (shows connection refused, not an unsafe-port label), and the C1 isolated cloud preview defaults to 6000. Forward it (`node` TCP forwarder started with a background ShellExec, not a `&` subshell) or start the preview with another `--public-port` before any browser or perf evidence. Numbers from an unreachable port look absurdly fast.
- WebKit/iPhone cannot be exercised here: WebKitGTK 2.50 (`MiniBrowser` + `WebKitWebDriver`) is in the nix store and X display :0 exists, but the web process aborts with `EGL_BAD_PARAMETER` (also with compositing off and Mesa swrast). Three configurations failed; do not spend more time, report NOT EXERCISED. WebKitGTK is not iOS Safari anyway.
- A clean clone of the pre-change HEAD needs `attached_assets/` copied in before it builds (untracked imports). Use it for before/after baselines; compare suite failures against it before widening scope.
- Lab LCP/CLS: use 5-run medians, never run builds or suites concurrently, and expect LCP to jump when the largest element changes from the server-streamed first paint to a hydrated image. Single runs vary by seconds under load.
- Baseline failures unrelated to public-site work: `test-public-route-validation` (stale `GetStarted.tsx` assertions), `test-stage3-b-browser` (contact compose-email click), and a one-off `test-stage3-a-authority` terminal-recommendation flake (`0 !== null`, passes on rerun).
- `pkill -f <name>` inside a ShellExec whose own command line contains `<name>` kills that shell (exit 143); use `pgrep -f "[n]ame"` style patterns or kill by task id.

**Why:** each cost real time in the public-site mobile work; none is visible in the code.
**How to apply:** before browser, perf or baseline work on public pages.
