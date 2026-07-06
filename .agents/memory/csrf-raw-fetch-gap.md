---
name: Raw fetch CSRF gap
description: Frontend code that bypasses apiRequest() and calls fetch() directly for mutating requests silently drops CSRF protection.
---

`client/src/lib/queryClient.ts`'s `apiRequest()` automatically attaches the `X-CSRF-Token` header (via `getCsrfToken()`, reading the `csrf_token` cookie) for any non-GET/HEAD/OPTIONS request. Server-side `csrfProtection` middleware (`server/middleware/csrf.ts`) rejects authenticated mutating requests with 403 if that header is missing or mismatched.

Some pages bypass `apiRequest` and call `fetch()` directly — typically for endpoints that need non-JSON responses (e.g. blob downloads) or custom headers. These calls silently omit the CSRF header and work fine in dev/test tooling that doesn't enforce CSRF, but will 403 for real logged-in users in production.

**Why:** discovered while adding a bulk-delete feature (`client/src/pages/dashboard/DocumentVault.tsx`) — the pre-existing sibling bulk-download handler used raw `fetch` without a CSRF header, which would break for real users despite looking fine in smoke tests.

**How to apply:** whenever you see a raw `fetch()` call for a POST/PATCH/DELETE to an internal `/api/` route, check whether it attaches `getCsrfToken()` as `X-CSRF-Token`. If not and the route isn't in `EXEMPT_PATH_PREFIXES`/`EXEMPT_PATHS_EXACT`, add the header manually since `apiRequest` can't be reused for that call.
