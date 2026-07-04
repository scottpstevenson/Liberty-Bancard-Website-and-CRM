---
name: CSRF token required for manual mutation testing
description: How to exercise a POST/PATCH/DELETE route manually via curl against the dev server (session + CSRF header)
---

Mutating routes (POST/PATCH/DELETE) are protected by CSRF middleware (`server/middleware/csrf.ts`). A logged-in session cookie alone returns `403 {"code":"csrf_missing"}`.

**How to apply:** To manually test a mutation route with curl:
1. Log in: `POST /api/auth/login` with `-c cookies.txt` to save the session cookie.
2. Fetch a token: `GET /api/csrf-token` (reuse `-b`/`-c cookies.txt`) — response is `{"token": "..."}` (not `csrfToken`).
3. Send the mutation with header `x-csrf-token: <token>` plus the same cookie jar.

Also: the Approval Gate's PEWC checklist predicate (`server/routes/activation.ts`, `evaluateChannelChecklist`) requires a `consent_audit_logs` row with `consentType = "express_written"` AND both `disclosureVersion` and `consentedPhone` non-null — not just `consented = true`.
