---
name: tsx hot-reload stale route registration
description: New Express routes appended to large route files can return 404 until a full server restart, even though tsx is watching for changes.
---

## Rule
After adding new Express routes at the end of a large route file (e.g. `server/routes/admin.ts` > 2500 lines), always do a full `restart_workflow("Start application")` before running smoke tests against those new routes.

**Why:** tsx `--watch` sometimes holds a partially-compiled in-memory module. The new `app.get(...)` registrations at the end of the file may not take effect. The symptom is that anon requests to the new path return **404** (not 401) — meaning auth middleware never ran, so the route was never registered. A clean restart resolves it immediately (confirmed by curl returning 401 after restart).

**How to apply:**
1. After editing `server/routes/admin.ts` or any other large route file, restart the server.
2. Probe the new route with `curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/...` — expect 401 for an auth-protected route (not 404).
3. Only then run role-guards or other smoke tests that cover the new endpoints.
