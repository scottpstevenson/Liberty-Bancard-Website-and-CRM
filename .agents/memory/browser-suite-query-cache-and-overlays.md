---
name: Browser suite query-cache and overlay pitfalls
description: Why filter/failure controls in browser suites need a fresh page load, and the floating assistant covering bottom-right controls.
---
Tanstack Query caches per key with long staleTime: toggling a UI filter back to a key already read never refetches, so a server-state change or injected failure is invisible until a full navigation. Drawers whose data changes after webhooks/commands set `staleTime: 0, refetchOnMount: "always"`.

**Why:** the 4C2 browser suite saw cached "configured" data after the fixture env changed, and a cached drawer detail ignored an injected read failure.

**How to apply:** in browser suites, reload the page (navigate) after changing fixture env/config before asserting the new state. A floating assistant button covers the bottom-right of dashboard pages; end-of-page controls need bottom padding (pager uses pb-16) or real-pointer clicks fail with "hit: svg".
