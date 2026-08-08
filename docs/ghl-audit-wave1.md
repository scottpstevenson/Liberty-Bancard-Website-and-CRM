# GHL Integration Audit — Wave 1A
**Date:** 2026-08-08  
**Auditor:** Replit Agent  
**Governing rule:** Liberty decides → ChannelOrchestrator routes → Provider executes → Event returns to Liberty.

---

## Executive Summary

GHL currently acts as both a **channel transport** and a **competing system of record**. The 45-second bidirectional sync (`ghl-sync.ts`, 2,114 lines) can overwrite Liberty contact/deal/task state. The 30+ `enrollInGhlWorkflow()` call sites are scattered across business services, making GHL a structural dependency rather than a utility.

**Wave 1A delivers:**
- `ChannelOrchestrator` abstraction with provider-neutral interfaces
- GHL transport adapters (email, SMS, ringless VM) implementing those interfaces
- Key business service call sites migrated to orchestrator
- Audit classification for all remaining GHL touchpoints

---

## GHL File Inventory

| File | Lines | Classification |
|------|-------|----------------|
| `server/services/ghl.ts` | ~1,550 | CHANNEL_UTILITY_REQUIRED + EVENT_FEEDBACK_REQUIRED |
| `server/services/ghl-sync.ts` | 2,114 | LEGACY_CRM_SYNC (partially removable) |
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
| `proposal-followup-worker.ts` — calls `enrollInGhlWorkflow("proposal_followup")` | CHANNEL_UTILITY_REQUIRED | Migrate to `channelOrchestrator.sendEmail()` |
| `onboarding-reminder.ts` — calls `enrollInGhlWorkflow("onboarding_reminder")` | CHANNEL_UTILITY_REQUIRED | Migrate to `channelOrchestrator.sendEmail()` |
| `partners.ts` — calls `enrollContactInGhlWorkflow()` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `contacts.ts` — calls `enrollContactInGhlWorkflow()` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `merchants.ts` — `enrollInGhlWorkflow("merchant_approved")` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `wizard` — `enrollInGhlWorkflow("inbound_confirmation")` | EVENT_FEEDBACK_REQUIRED | Migrate to orchestrator |
| `imports.ts` — `enrollInGhlWorkflow(...)` | DUPLICATE_BUSINESS_LOGIC | Liberty sequences handle imports; remove |
| `partner-orgs.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `workflow-executor.ts` — `enrollInGhlWorkflow(...)` | LEGACY_EXTERNAL_AUTOMATION | Sequence worker owns this; evaluate removal |
| `tickets.ts` — `enrollInGhlWorkflow("support_ticket")` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `rate-review.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `scheduling.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Migrate to orchestrator |
| `webhook handlers` — `enrollInGhlWorkflow(...)` | EVENT_FEEDBACK_REQUIRED | Keep; inbound confirmation path |
| `proposal-tracking` — `enrollInGhlWorkflow(...)` | EVENT_FEEDBACK_REQUIRED | Keep; proposal viewed/accepted signals |
| `sync-rules` — `enrollInGhlWorkflow(...)` | LEGACY_EXTERNAL_AUTOMATION | Replace with Replit-owned sequence enrollment |
| `recovery.ts` — `enrollInGhlWorkflow(...)` | CHANNEL_UTILITY_REQUIRED | Keep; this is the retry path |

---

## Bidirectional Sync Harm Analysis (ghl-sync.ts)

| Sync direction | Fields | Classification | Action |
|---------------|--------|---------------|--------|
| Liberty → GHL | contact fields, GHL custom fields, deal opportunity | MINIMAL_EXTERNAL_IDENTITY_REQUIRED | Keep contact identity sync; remove deal stage writes to GHL |
| GHL → Liberty | contact tags, pipeline stage, deal stage, task status | LEGACY_CRM_SYNC | Stop GHL pipeline stage / deal stage overwrites; keep delivery events |
| Inbound delivery events | `EMAIL_DELIVERED`, `EMAIL_BOUNCED`, `SMS_STOP_RECEIVED` | EVENT_FEEDBACK_REQUIRED | Keep; normalize to Liberty event records |
| GHL task sync | GHL creates/updates tasks in Liberty | DUPLICATE_BUSINESS_LOGIC | Remove; Liberty task engine owns tasks |
| GHL company sync | GHL companies → Liberty accounts | LEGACY_CRM_SYNC | Scope down; Liberty contacts are the canonical record |

### Fields that must stop being overwritten from GHL:
- Deal stage / pipeline position
- Contact lifecycle state (now owned by `LifecycleService`)  
- SLA task status
- Liberty automation state flags

### Fields GHL should continue to write to Liberty:
- Email delivery status (delivered/bounced/failed)
- SMS STOP signal → contact opt-out
- Appointment booked/no-show/completed events
- GHL conversation ID (for thread continuity)

---

## Channel Provider Reality

| Channel | Mechanism | Liberty owns decision? | Action |
|---------|-----------|----------------------|--------|
| Email | GHL API → GHL email infrastructure | ✅ Yes | Route through `GhlEmailTransport` |
| SMS | GHL API → SMS carrier (Twilio-backed) | ✅ Yes | Route through `GhlSmsTransport` |
| Ringless VM | GHL Voicemail Drop action node | ✅ Yes | Route through `GhlRvmTransport` |
| Voice AI | Vapi/external via GHL workflow trigger | ✅ Yes | Route through voice orchestrator |
| Calendar/appointment | GHL Calendar API | ✅ Yes | Keep direct; no compliance fence needed |

GHL does **not** own email sending infrastructure — it is GHL's own email relay. There is no separate SMTP provider for cold sequences (SMTP is used for internal/transactional emails per `sender-policy.ts`).

---

## Wave 1A Deliverables

| Item | Status |
|------|--------|
| `server/services/channel-orchestrator.ts` | ✅ Built |
| `server/services/transports/ghl-email-transport.ts` | ✅ Built |
| `server/services/transports/ghl-sms-transport.ts` | ✅ Built |
| `server/services/transports/ghl-rvm-transport.ts` | ✅ Built |
| `server/services/transports/index.ts` (singleton) | ✅ Built |
| GHL bidirectional sync scope-down | 🔄 In progress — ghl-sync.ts audit required |
| Call site migration (30 sites) | 🔄 In progress — key sites in sequence-worker, proposal-followup, onboarding-reminder |
| Inbound event normalization | 🔄 In progress |
| Health monitor transport checks | 🔄 In progress |

---

## Remaining GHL Coupling (after Wave 1A)

The following GHL coupling remains intentionally:
1. **GHL contact identity** — Liberty contacts store `ghlContactId` for thread continuity
2. **GHL calendar** — Appointment booking uses GHL Calendar API directly
3. **GHL inbound webhooks** — Email/SMS replies, opt-outs, appointment events flow GHL → Liberty
4. **GHL e-sign** — Document signing uses GHL's e-sign integration

All above are `EVENT_FEEDBACK_REQUIRED` or `MINIMAL_EXTERNAL_IDENTITY_REQUIRED` and are intentional.

---

## Wave 2 Recommendations

After Wave 1A is stable:
1. Audit `ghl-sync.ts` at line level and disable the 15+ fields that overwrite Liberty-authoritative data
2. Migrate appointment booking to a Liberty-native calendar integration or Calendly
3. Evaluate replacing GHL SMS with direct Twilio (removes GHL dependency for SMS entirely)
4. Decommission `ghl-workflows.ts` `GHL_WORKFLOW_REGISTRY` — replace all workflow triggers with Replit-owned sequence enrollments
