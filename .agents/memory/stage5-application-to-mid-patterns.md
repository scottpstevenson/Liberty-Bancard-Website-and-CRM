---
name: Stage 5 application-to-MID patterns
description: Non-obvious rules and traps from repairing the application → underwriting → boarding → MID chain
---
- Provider sends: write a dispatch-started marker BEFORE network I/O; a marker without sent/skipped evidence = held for operator, never re-sent. Resolved `{success:false}` is not "sent"; only provably-unsent (`outcome:"unsent"`) retries.
- Processor contract: snapshot base URL exactly `https://{testapi|api}.payarc.net/v1`; never follow redirects; 429 retryable, other 4xx permanent, 5xx/408/3xx/network on POST ambiguous.
- MIDs: `merchant_mids.mid` globally unique; many per deal; `deals.mid` is only the primary alias; closed MIDs are history. Policy matrix unrecorded → boarding fails closed; certs use a synthetic recorded policy.
- Underwriting override: pin to the reviewed revision, one tx for decision+stage+audit+durable effect intents; GHL tasks run in the effect worker behind the pause authority (no GHL call in the route; allowlist entries removed).
- Chases: pin recipient/obligation versions at claim; durable next_check_at cursor so a stuck head cannot starve the batch.
- **Strict DTO + browser tracking record:** finalize is `.strict()`; the wizard must send only the five utm* fields. Spreading `getStoredUTMParams()` (landingPage, gclid, *Present) made every real submission a 400 while HTTP certs passed because they sent no tracking data. Add a cert with a realistic stored record.
- Public wizard raw fetches need `getCsrfToken()` header (signed-in operators 403 otherwise); autosave must omit null booleans (zod rejects null).
- E-sign request is refused for any not-yet-submitted status (draft AND in_progress).
- Source-pattern security asserts (`test-merchant-application-security`) break when worker code is refactored to template strings; update them to the new shape, don't loosen. That suite is DB-less: run it directly with NODE_ENV=test and a random 64-hex MERCHANT_DATA_ENCRYPTION_KEY (not registered in the disposable runner).
- Changing where a GHL/SMTP call lives requires updating `scripts/ghl-route-mutation-allowlist.ts` / `scripts/compliance-scan.ts` lineContains entries; run compliance-scan after moving send code.
- `scripts/test-forms.ts` fails in the disposable harness for environment reasons (statement upload 503, estimate queue manager, outbox worker not started) — do not count it as a pass.
- Any edit under scripts/ invalidates the browser-suite candidate identity: rebuild (background, log with EXIT=) before rerunning. Confirmation page test ids are `text-thanks-application-*` (ThanksApplication.tsx), not the in-wizard success section.
