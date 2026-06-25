---
name: Contactability Engine (Wave 1A)
description: Architecture decisions and gotchas for the shared outbound permission gate built in Wave 1A.
---

# Contactability Engine — Wave 1A

## The Rule
Every automated send path calls `evaluateContactability()` in `server/services/contactability.ts` before execution. Replit owns contactability truth; GHL executes.

## Channel Mapping
- sequence-worker automated steps: email→`email`, sms→`sms`, call→`voice_ai`, voicemail_drop→`ringless_vm`
- GHL workflow enrollment: always `email` channel (enrollment triggers email outreach)
- SDR compliance-engine bridge: `email`→`email`, `sms`→`sms`, `call`→`voice_ai`

## Key architectural decisions
- **mode: 'enforcement'** writes consent_audit_logs for automated channels; **mode: 'dryRun'** does NOT write any logs — safe for dashboards
- **Step 12 (PEWC evidence)**: `pewc_full_automation` tier also requires `consentedPhone` + `disclosureVersion` in consent_audit_logs — setting the tier alone is not enough
- **doNotAutoContact** blocks all automated channels BUT allows `manual_call` task creation
- **Florida rule** blocks sms/voice_ai/ringless_vm without PEWC; email and manual_call are NOT blocked by FL state alone
- **SDR bridge**: looks up contact by `sdrMerchants.mainEmail` → `contacts.email`; falls back to legacy checks if no match
- **Rate limits**: only evaluated when `sdrMerchantId` is provided (SDR path); other paths return `rateLimitStatus: 'not_evaluated'`

## Migration note
Migration 0037 must be in `migrations/meta/_journal.json` with `when: 1782500000000` to be picked up by `runDrizzleMigrations()`. Drizzle uses the journal, not filesystem scan.

**Why:** Drizzle-kit's migrator reads `migrations/meta/_journal.json` to determine order and which files to apply. SQL files without a journal entry are silently ignored.

**How to apply:** After creating a new SQL migration file manually, always add its entry to `_journal.json` with the next idx and a `when` timestamp higher than the previous entry.

## Gate placement
- `server/services/sequence-worker.ts` — Gate (a) at enrollment step (currentStep===0), Gate (b) before the `switch(step.actionType)` dispatch
- `server/services/ghl-workflow-enrollment.ts` — inside `enrollContactInGhlWorkflow()` after doNotContact check
- `server/services/sdr/voice-orchestrator.ts` — inside `triggerAiCall()` before the existing compliance check; uses bridge via `merchant.mainEmail`
- `server/services/sdr/compliance-engine.ts` — `checkBeforeSend()` calls shared gate first; legacy checks only run if no contacts row found

## API endpoint
`GET /api/contacts/:id/contactability` — requireRole admin/manager; calls `evaluateAllChannels()` in dryRun mode; returns full channel matrix + ghlPermissionPayload

## Backfill
`scripts/backfill-consent-tiers.ts` — safe to run multiple times; DRY_RUN=true for preview; only updates contacts with default `cold_no_consent` tier
