---
name: Website intake certification harness lessons
description: Fixture and browser-suite pitfalls hit while certifying website intake, statement uploads and CRM review surfaces
---
- `contacts.phone` is NOT NULL, so every fixture upload needs a unique phone per mailbox or fixtures merge.
- The upload rate limiter and idempotency caller scope derive from the client address; give each key its own forwarded address (with trust proxy on) or keep a browser run under the per-address limit.
- `setupAuth` installs the CSRF guard and needs cookie-parser mounted first.
- Candidate build identity hashes `scripts/` too: editing any script (including the cert itself) needs a full rebuild before the browser suite will run. Batch cert edits and make sections soft-fail so one run reports every broken surface.
- Narrow-screen cards and the wide table are both in the DOM; `querySelector(...).getClientRects()` finds the hidden copy first. Test visibility across all matches.
- Dark mode is `localStorage["liberty-theme"]` plus a reload; narrow widths need `prefer_desktop`.
- A Radix dialog that contains a sandboxed preview iframe auto-focuses the iframe (first tabbable), and keys typed there never reach the dialog, so Escape intermittently failed to close it; fix is `onOpenAutoFocus` that focuses the dialog itself. A flaky Escape in a cert usually means focus moved into an iframe: log `document.activeElement`.
- Overview shows nothing but "Today unavailable" unless the real `/api/kpi/summary` (registerAnalyticsRoutes) is registered in the fixture app.
**Why:** each of these cost a failed or misleading run.
**How to apply:** start any new intake/browser cert from the existing website-intake certs and these rules.
