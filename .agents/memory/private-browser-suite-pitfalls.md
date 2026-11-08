---
name: Private browser suite pitfalls
description: Running mounted-browser suites on the disposable launcher (candidate identity, narrow viewports)
---
Browser suites verify candidate identity against `dist/`, and the identity covers `scripts/`: rebuild with `npm run build` after ANY script or client edit, then run with `NODE_ENV=production npx tsx scripts/run-sfp2060-predeploy-disposable.ts --only <suite>`.
**Why:** a stale build fails identity verification before the suite starts.
Narrow viewports (<768px) redirect `/dashboard` to the mobile shell; set `localStorage.prefer_desktop="true"` (the app's own Switch-to-desktop preference) before testing desktop layouts at 320/390.
Wait on specific test IDs, not on generic text, when a failure is injected with `failRead`; counting right after a loose text match flakes.

## Service worker hides /api/contacts from fault injection
The app's sw.js answers /api/contacts, /api/deals, /api/tasks and /api/appointments itself once it controls the page (second navigation onward), so b.failRead never fires and the request shows status 200. Call Network.setBypassServiceWorker {bypass:true} before such tests. Editing any script (even the suite) requires a rebuild before the browser suite because build identity covers scripts/.

## Closed <details> content measured as visible
Content inside a closed `<details>` keeps stale zero-width boxes, so the generic audit reported menu links as 24 px-wide tap targets and white-on-white text. `scripts/lib/public-site-browser.ts` now skips anything inside a closed details except its summary; keep that helper when editing the audit.
