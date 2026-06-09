---
name: GHL token ops
description: What happens when the GHL Private Integration Token is invalid and how to fix it.
---

## The Rule
When `GHL_PRIVATE_INTEGRATION_TOKEN` is expired or invalid, every GHL API call returns 401. The system continues to run — contact sync, opportunity updates, workflow enrollment, and calendar bookings all silently fail.

## Detection
- `/api/ghl/health` → `authTest: false` (calls `fetchCalendars()` which throws on 401)
- ActivationPanel System Status tab shows `Auth: N/A` badge (destructive styling)
- A prominent amber warning banner now appears at the top of the ActivationPanel whenever `ghlHealth.configured && !ghlHealth.authTest`

## Fix
1. GHL → Settings → Integrations → Private Integrations
2. Regenerate the token (pit-...) with all required scopes
3. Set the new value as `GHL_PRIVATE_INTEGRATION_TOKEN` env var in Replit Secrets
4. Restart the server
5. Run `scripts/ghl-setup.ts` to bootstrap pipelines, custom fields, and calendars

## How to Apply
When investigating why GHL sync is failing, check the ActivationPanel banner first. If the token was just regenerated, restart the server to pick up the new env var.
