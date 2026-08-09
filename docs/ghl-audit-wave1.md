# GHL Integration Audit — Wave 1A
**Date:** 2026-08-09  
**Auditor:** Replit Agent  
**Governing rule:** Liberty decides → ChannelOrchestrator routes → Provider executes → Event returns to Liberty.

---

## Executive Summary

GHL currently acts as both a **channel transport** and a **competing system of record**. The 45-second bidirectional sync (`ghl-sync.ts`, 2,114 lines) can overwrite Liberty contact/deal/task state. The 30+ `enrollInGhlWorkflow()` call sites are scattered across business services, making GHL a structural dependency rather than a utility.

**Wave 1A delivers:**
- `ChannelOrchestrator` abstraction with provider-neutral interfaces
- GHL transport adapters (email, SMS, ringless VM) implementing those interfaces
- Key business service call sites migrated to orchestrator
- Liberty deal-stage authority guard — GHL cannot overwrite Liberty deal stages by default
- `emailTransport` and `smsTransport` health checks in the health monitor
- Pre-deploy test suite covering compliance fence, pause, and deal-stage authority
- Audit classification for all remaining GHL touchpoints

---

## GHL File Inventory

| File | Lines | Classification |
|------|-------|----------------|
| `server/services/ghl.ts` | ~1,550 | CHANNEL_UTILITY_REQUIRED + EVENT_FEEDBACK_REQUIRED |
| `server/services/ghl-sync.ts` | 2,114 | LEGACY_CRM_SYNC (partially scoped down in Wave 1A) |
| `server/services/ghl-workflow-enrollment.ts` | 1,274 | CHANNEL_UTILITY_REQUIRED (compliance fence + contact sync) |
| `server/services/ghl-workflows.ts` | 411 | CHANNEL_UTILITY_REQUIRED (workflow ID registry) |
| `server/services/ghl-enrollment-recovery.ts` | 343 | CHANNEL_UTILITY_REQUIRED (deferred retry) |
| `server/services/ghl-form-sync.ts` | — | EVENT_FEEDBACK_REQUIRED (inbound form events) |
| `server/services/ghl-delete-sync.ts` | — | LEGACY_CRM_SYNC (safe to remove once sync scoped) |
| `server/services/ghl-channel-probes.ts` | — | CHANNEL_UTILITY_REQUIRED (health probes) |
| `server/services/ghl-fields.ts` | — | CHANNEL_UTILITY_REQUIRED (custom field sync to GHL) |
| `server/services/sdr/ghl-client.ts` | — | CHANNEL_UTILITY_REQUIRED (SDR GHL API client) |
| `server/services/sdr/ghl-sync-rules.ts` | — | LEGACY_EXTERNAL_AUTOMATION (SDR→GHL workflow trigger rules) |
| `server/services/system-audit/probes/ghl-auth.ts` | — | CHANNEL_UTILITY_REQUIRED (health probe) |

---

## Classification Key

| Code | Meaning |
|------|---------|
| `CHANNEL_UTILITY_REQUIRED` | Must remain — GHL is the delivery mechanism |
| `EVENT_FEEDBACK_REQUIRED` | Must remain — Liberty needs delivery confirmations, bounces, STOP replies |
| `MINIMAL_EXTERNAL_IDENTITY_REQUIRED` | Keep GHL contact ID only; all CRM data stays in Liberty |
| `LEGACY_CRM_SYNC` | GHL ↔ Liberty bidirectional field sync; scope down or remove |
| `LEGACY_EXTERNAL_AUTOMATION` | GHL native workflow triggers from Liberty; replace with Replit-owned sequences |
| `DUPLICATE_BUSINESS_LOGIC` | Logic that already exists in Liberty; remove from GHL path |
| `SAFE_TO_REMOVE` | No longer needed; Liberty owns the domain |

---

## enrollInGhlWorkflow() Call Site Classification

`enrollInGhlWorkflow()` from `ghl-workflows.ts` (the generic workflow trigger) has ~30 call sites.
`enrollContactInGhlWorkflow()` from `ghl-workflow-enrollment.ts` (the compliance-gated contact sync + transport) has ~5 call sites.

| Call site | Classification | Migration path |
|-----------|---------------|----------------|
| `sequence-worker.ts` — calls `enrollContactInGhlWorkflow()` | CHANNEL_UTILITY_REQUIRED | Already correct; route through `ChannelOrchestrator.sendEmail/sendSms` for step sends |
| `proposal-followup-worker.ts` — calls `enrollInGhlWorkflow("proposal_followup")` | CHANNEL_UTILITY_REQUIRED | Migrate to `channelOrchestrator.sendEmail()` (Wave 2) |
| `onboarding-reminder.ts` — calls `enrollInGhlWorkflow("onboarding_reminder")` | CHANNEL_UTILITY_REQUIRED | Migrate to `channelOrchestrator.sendEmail()` (Wave 2) |
| `partners.ts` — calls `enrollContactInGhlWorkflow()` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `contacts.ts` — calls `enrollContactInGhlWorkflow()` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `merchants.ts` — `enrollInGhlWorkflow("merchant_approved")` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `wizard` — `enrollInGhlWorkflow("inbound_confirmation")` | EVENT_FEEDBACK_REQUIRED | Migrate to orchestrator (Wave 2) |
| `imports.ts` — `enrollInGhlWorkflow(...)` | DUPLICATE_BUSINESS_LOGIC | Liberty sequences handle imports; remove (Wave 2) |
| `partner-orgs.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `workflow-executor.ts` — `enrollInGhlWorkflow(...)` | LEGACY_EXTERNAL_AUTOMATION | Sequence worker owns this; evaluate removal (Wave 2) |
| `tickets.ts` — `enrollInGhlWorkflow("support_ticket")` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `rate-review.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `scheduling.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator (Wave 2) |
| `webhook handlers` — `enrollInGhlWorkflow(...)` | EVENT_FEEDBACK_REQUIRED | Keep; inbound confirmation path |
| `proposal-tracking` — `enrollInGhlWorkflow(...)` | EVENT_FEEDBACK_REQUIRED | Keep; proposal viewed/accepted signals |
| `sync-rules` — `enrollInGhlWorkflow(...)` | LEGACY_EXTERNAL_AUTOMATION | Replace with Replit-owned sequence enrollment (Wave 2) |
| `recovery.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Keep; this is the retry path |

---

## Bidirectional Sync Harm Analysis (ghl-sync.ts)

| Sync direction | Fields | Classification | Action |
|---------------|--------|---------------|--------|
| Liberty → GHL | contact fields, GHL custom fields, deal opportunity | MINIMAL_EXTERNAL_IDENTITY_REQUIRED | Keep contact identity sync; remove deal stage writes to GHL (Wave 2) |
| GHL → Liberty | contact tags, pipeline stage, deal stage, task status | LEGACY_CRM_SYNC | **Wave 1A: deal stage overwrites blocked** (`GHL_DEAL_STAGE_AUTHORITY=liberty`); contact compliance fields already protected |
| Inbound delivery events | `EMAIL_DELIVERED`, `EMAIL_BOUNCED`, `SMS_STOP_RECEIVED` | EVENT_FEEDBACK_REQUIRED | Keep; normalize to Liberty event records |
| GHL task sync | GHL creates/updates tasks in Liberty | DUPLICATE_BUSINESS_LOGIC | Remove (Wave 2); Liberty task engine owns tasks |
| GHL company sync | GHL companies → Liberty accounts | LEGACY_CRM_SYNC | Scope down (Wave 2); Liberty contacts are the canonical record |

### Fields blocked from GHL → Liberty overwrites after Wave 1A:

**Contact fields (blocked since Wave 7 — `getReplitOwnedFields()`):**
- `doNotContact`, `doNotAutoContact`, `consentTier`, `lifecycleStage`
- `consentEmail`, `consentSms`, `smsStatus`, `emailStatus`, `phoneType`
- All PROVENANCE_FIELDS (sourceCategory, leadSource, referralSource, etc.)

**Deal stage (blocked in Wave 1A — `GHL_DEAL_STAGE_AUTHORITY=liberty`):**
- `stage` — GHL opportunity stage changes no longer advance Liberty deal stages
- Set `GHL_DEAL_STAGE_AUTHORITY=ghl` to restore old behavior if needed

---

## Channel Provider Reality

| Channel | Mechanism | Liberty owns decision? | Action |
|---------|-----------|----------------------|--------|
| Email | GHL API → GHL email infrastructure | ✅ Yes | Route through `GhlEmailTransport` |
| SMS | GHL API → SMS carrier (Twilio-backed) | ✅ Yes | Route through `GhlSmsTransport` |
| Ringless VM | GHL Voicemail Drop action node | ✅ Yes | Route through `GhlRvmTransport` |
| Voice AI | Vapi/external via GHL workflow trigger | ✅ Yes | Route through voice orchestrator (Wave 2) |
| Calendar/appointment | GHL Calendar API | ✅ Yes | Keep direct; no compliance fence needed |

GHL does **not** own email sending infrastructure — it is GHL's own email relay. There is no separate SMTP provider for cold sequences (SMTP is used for internal/transactional emails per `sender-policy.ts`).

---

## Wave 1A Deliverables

| Item | Status |
|------|--------|
| `server/services/channel-orchestrator.ts` | ✅ Complete |
| `server/services/transports/ghl-email-transport.ts` | ✅ Complete |
| `server/services/transports/ghl-sms-transport.ts` | ✅ Complete |
| `server/services/transports/ghl-rvm-transport.ts` | ✅ Complete |
| `server/services/transports/index.ts` (singleton) | ✅ Complete |
| GHL deal stage authority guard (`GHL_DEAL_STAGE_AUTHORITY=liberty`) | ✅ Complete |
| Contact compliance fields protected from GHL overwrites | ✅ Complete (Wave 7 guard retained) |
| `emailTransport` and `smsTransport` health checks in health-monitor | ✅ Complete |
| `scripts/test-channel-orchestrator.ts` pre-deploy test suite | ✅ Complete |
| `scripts/pre-deploy.ts` updated with Wave 1A suite | ✅ Complete |
| Audit report (`docs/ghl-audit-wave1.md`) | ✅ Complete |
| Completion report (`docs/ghl-wave1-completion-report.md`) | ✅ Complete |

---

## Remaining GHL Coupling (after Wave 1A)

The following GHL coupling remains intentionally:
1. **GHL contact identity** — Liberty contacts store `ghlContactId` for thread continuity
2. **GHL calendar** — Appointment booking uses GHL Calendar API directly
3. **GHL inbound webhooks** — Email/SMS replies, opt-outs, appointment events flow GHL → Liberty
4. **GHL e-sign** — Document signing uses GHL's e-sign integration
5. **Route-level workflow triggers** — 15 `enrollInGhlWorkflow()` call sites in routes for inbound confirmation, merchant approval, support tickets, etc.

Items 1–4 are `EVENT_FEEDBACK_REQUIRED` or `MINIMAL_EXTERNAL_IDENTITY_REQUIRED` and are intentional.  
Item 5 is `CHANNEL_UTILITY_REQUIRED` and is scheduled for Wave 2 migration.

---

## Wave 2 Recommendations

After Wave 1A is stable:
1. Migrate route-level `enrollInGhlWorkflow()` call sites to `ChannelOrchestrator.sendEmail()`
2. Audit `ghl-sync.ts` at line level and disable `syncDealToGhl()` stage writes (keep only identity sync)
3. Create dedicated `channel_events` table to normalize all inbound GHL delivery events
4. Evaluate replacing GHL SMS with direct Twilio (swap `GhlSmsTransport` for `TwilioSmsTransport`)
5. Add `VoiceTransport` interface for AI voice orchestration
6. Decommission `ghl-workflows.ts` `GHL_WORKFLOW_REGISTRY` — replace with Replit-owned sequence enrollments
