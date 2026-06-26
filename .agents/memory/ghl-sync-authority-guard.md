---
name: GHL Sync Authority Guard (Wave 7)
description: Design rules for the permission-check endpoint and lb_* custom field sync to GHL
---

# GHL Sync Authority Guard — Wave 7

## Permission-check endpoint HTTP status codes

`POST /api/ghl/permission-check` uses a layered response strategy:
- **401** for auth/config failures: missing `GHL_WEBHOOK_SECRET` (→ `configuration_missing`) or wrong bearer token (→ `unauthorized`). These are hard infrastructure failures that GHL should surface to the operator, not silently retry.
- **400** for malformed input: missing both `ghlContactId` and `email`, or invalid `channel` value.
- **200** for all business-rule outcomes (allowed, denied, contact_not_found) and internal evaluation errors. GHL's conditional branches check `{{webhookResponse.allowed}}` in the body — a business denial must return 200 so the branch logic is reached instead of triggering retries.
- **Rate-limited** by `publicLeadRateLimit` (10 req/15 min per IP) since the endpoint is unauthenticated (uses shared secret, not session).

**Why:** 401/400 for config/input failures; 200 for all business outcomes. Internal evaluation errors fail closed (allowed=false) at HTTP 200. Rate limit prevents abuse since the endpoint accepts unauthenticated webhook calls from GHL.

## Force contact permission sync

The "Force Contact Permission Sync" card in GhlSettings calls `POST /api/ghl/sync-contact` (existing endpoint, `isAuthenticated`) with `{contactId}`. A redundant separate endpoint was removed — the existing sync already writes all lb_* permission fields via `upsertGhlContact`.

**Why:** One sync path, no duplicate code. The existing endpoint already covers permission field writes.

## lb_* custom fields must be created manually in GHL

The sync engine writes `lb_do_not_contact`, `lb_consent_tier`, `lb_can_email`, `lb_can_sms`, `lb_can_ai_voice`, `lb_can_ringless_vm`, `lb_can_manual_call`, `lb_channel_permissions`, `lb_channel_permissions_updated_at`, `lb_lifecycle_stage`, `lb_do_not_autocontact`, `lb_channel_block_reason` to GHL contacts via the `customFields` array format (`[{key, field_value}]`). GHL returns 422 if the field key doesn't exist in the Location's custom field definitions.

**Why:** GHL does not auto-create custom fields on write. A 422 is silently swallowed (isolated from the main upsert), but the field data never reaches GHL — meaning workflow guards can't read the permission values.

**How to apply:** After any new GHL location is connected, go to GHL → Settings → Custom Fields and create all 12 lb_* fields as Text type. The `fieldWriteErrors422` counter in the Sync Authority Guard dashboard section will show > 0 until this is done.

## REPLIT_OWNED_FIELDS — never overwrite from GHL

The `REPLIT_OWNED_FIELDS` set in `server/services/ghl-sync.ts` lists fields that Replit owns and that incoming GHL contact webhooks must not overwrite: `doNotContact`, `doNotAutoContact`, `consentTier`, `lifecycleStage`, `consentEmail`, `consentSms`, `smsStatus`, `emailStatus`, `phoneType`. Strip these from both update paths in `syncContactFromGhl`.

## Circuit state is exposed to the dashboard

`GET /api/ghl/circuit-status` returns `{ open, consecutiveFailures, threshold, lastTripAt, ghlWebhookSecretConfigured }`. The `GhlSettings.tsx` dashboard polls this every 30 seconds and shows it in the Sync Authority Guard card.
