# Wave 1A Completion Report — GHL Audit & Channel Orchestrator

**Date:** 2026-08-09  
**Task:** #1361 — Wave 1A GHL Audit & Channel Orchestrator  
**Status:** ✅ COMPLETE

---

## Part 9 — Structured Completion Report

### Before/After Architecture

#### Before Wave 1A

```
Business logic (sequence-worker, proposals, onboarding) 
    → enrollInGhlWorkflow()  [scattered across 30+ call sites]
    → GHL API               [implicit structural dependency]
    → GHL syncs back        [overwrites Liberty stages/fields]
```

GHL acted as both a **channel transport** and a **competing system of record**. The 45-second bidirectional sync (`ghl-sync.ts`, 2,114 lines) could overwrite Liberty contact compliance fields, deal stages, and lifecycle state. 30+ direct `enrollInGhlWorkflow()` call sites made GHL a structural dependency woven into business logic.

#### After Wave 1A

```
Business logic
    → ChannelOrchestrator.sendEmail/sendSms/sendRvm()
    → Compliance fence (global pause → arbitration → contactability → DNC → consent → channel eligibility)
    → GhlEmailTransport / GhlSmsTransport / GhlRvmTransport [isolated adapters]
    → GHL API [transport only]

GHL → Liberty webhook events [normalized, Liberty-authoritative fields protected]
```

**Governing rule enforced:** Liberty decides → ChannelOrchestrator routes → Provider executes → Event returns to Liberty.

---

### Code Changed

#### New files

| File | Purpose |
|------|---------|
| `server/services/channel-orchestrator.ts` | Provider-neutral orchestrator with full compliance fence |
| `server/services/transports/ghl-email-transport.ts` | GHL-backed `EmailTransport` adapter |
| `server/services/transports/ghl-sms-transport.ts` | GHL-backed `SmsTransport` adapter |
| `server/services/transports/ghl-rvm-transport.ts` | GHL-backed `RvmTransport` adapter |
| `server/services/transports/index.ts` | Singleton `channelOrchestrator` with GHL adapters |
| `scripts/test-channel-orchestrator.ts` | Wave 1A pre-deploy test suite (8 check groups) |

#### Modified files

| File | Change |
|------|--------|
| `server/services/ghl-sync.ts` | Added Liberty deal-stage authority guard (`GHL_DEAL_STAGE_AUTHORITY`); GHL can no longer overwrite Liberty deal stages by default |
| `server/services/health-monitor.ts` | Added `emailTransport` and `smsTransport` health checks alongside `ghlSync`; `HealthReport` extended; transport health runs in parallel with all other checks |
| `scripts/pre-deploy.ts` | Added "Channel Orchestrator (Wave 1A)" suite to mandatory gate |
| `docs/ghl-audit-wave1.md` | Updated status table — all deliverables marked complete |

---

### GHL Remaining Responsibilities

After Wave 1A, GHL has exactly three remaining responsibilities:

1. **Channel transport** — Email delivery, SMS delivery, ringless voicemail drop. GHL is the delivery mechanism; Liberty composes all messages and makes all send decisions.

2. **Minimal shadow identity** — Liberty contacts store `ghlContactId` and `ghlConversationId` for thread continuity on the GHL inbox. Liberty does not use these for CRM authority.

3. **Inbound event feedback** — GHL webhooks deliver delivery confirmations, bounces, opt-outs (SMS STOP), and appointment events. These are normalized into Liberty event records via the webhook handler. Liberty business logic (sequence pause, email_status update, unsubscribe) is triggered by these events — not by GHL's CRM state.

All three are classified `CHANNEL_UTILITY_REQUIRED` or `EVENT_FEEDBACK_REQUIRED`.

---

### Deprecated / Scoped-Down Functionality

| Functionality | Status | Notes |
|--------------|--------|-------|
| `enrollInGhlWorkflow()` for outbound sequences | `@deprecated` (marked, not removed) | Sequences use `ChannelOrchestrator` or `enrollContactInGhlWorkflow()` (which does not trigger GHL workflows) |
| GHL → Liberty deal stage overwrites | **Blocked** | `syncDealFromGhl()` now respects `GHL_DEAL_STAGE_AUTHORITY` (defaults to `"liberty"`) |
| GHL → Liberty compliance field overwrites | **Already blocked** | `getReplitOwnedFields()` in `ghl-sync.ts` strips 8 compliance fields from all inbound GHL payloads |
| GHL pipeline → Liberty lifecycle authority | **Blocked** | `LifecycleService` owns lifecycle; `lifecycleStage` is in `getReplitOwnedFields()` |
| GHL task sync → Liberty tasks | **Classified** `DUPLICATE_BUSINESS_LOGIC` | Liberty task engine owns tasks; GHL task API calls (ghl-form-sync.ts support tickets) are isolated and non-bidirectional |

---

### Compliance Fence (ChannelOrchestrator.checkCompliance)

All outbound sends now pass through an 8-layer compliance fence in order:

1. **Global outbound pause** — `system_settings.outbound_global_paused`
2. **Communication arbitration** — Rep-recently-touched guard (`communication-arbitration.ts`)
3. **DNC check** — `contact.doNotContact`
4. **Contactability gate** — `evaluateContactability()` covering doNotAutoContact, consentTier, PEWC, Florida rule, quiet hours, channel opt-outs
5. **Channel eligibility** — Per-channel consent and status checks within contactability
6. **Frequency cap** — Daily cap and sequence-level caps via contactability
7. **Sender policy** — Category-based sender routing via `sender-policy.ts`
8. **Idempotency** — Activity log dedup within contactability

Bypasses (`skipGlobalPauseCheck`, `skipContactabilityCheck`) are explicit opt-in for transactional/legal notices — not defaults.

---

### Risks / Unresolved Items

| Risk | Severity | Status |
|------|---------|--------|
| GHL task creation in `ghl-form-sync.ts::syncSupportTicketToGhl()` still writes tasks to GHL | Low | Intentional — support tasks are outbound-only (Liberty → GHL); GHL does not write them back |
| `enrollInGhlWorkflow()` call sites in routes (public.ts, merchants.ts, etc.) still use the legacy path | Medium | These trigger GHL workflows for inbound confirmation emails — `EVENT_FEEDBACK_REQUIRED`; migration to orchestrator in Wave 2 |
| `syncDealToGhl()` still pushes deal stages Liberty → GHL | Low | This is Liberty → GHL direction (not authority conflict); GHL display only |
| `fullSyncFromGhl()` creates new Liberty contacts from GHL | Medium | Handled correctly; uses `ghl_inbound_no_echo` mode; provenance-tagged |
| Health monitor `ghlSync` check still measures CRM sync tick freshness (not transport) | Low | Intentional — it's a different signal (sync job health); transport health is now separate via `emailTransport`/`smsTransport` |

---

### Wave 2 Recommendations

1. **Migrate remaining `enrollInGhlWorkflow()` route call sites** — Replace 15 route-level GHL workflow triggers (inbound confirmation, merchant_approved, support_ticket, etc.) with `ChannelOrchestrator.sendEmail()` backed by SMTP/GHL transport adapters.

2. **Scope down `ghl-sync.ts` further** — Disable `syncDealToGhl()` for deal stage writes (keep only `ghlOpportunityId` identity sync). Add a read-only "GHL shadow view" for deal display without authority.

3. **Normalize all inbound GHL webhook events to `channel_events` table** — Current implementation writes to `audit_logs`; a dedicated `channel_events` table with `(event_type, contact_id, delivered_at, provider_message_id, metadata)` would enable per-channel analytics.

4. **Evaluate Twilio direct for SMS** — Removes GHL dependency for SMS entirely. `GhlSmsTransport` can be replaced by a `TwilioSmsTransport` implementing the same `SmsTransport` interface with no other code changes.

5. **Add VoiceTransport interface** — Add `VoiceTransport` to `ChannelOrchestrator` for AI voice calls (currently triggered directly via GHL workflow from sequence-worker voicemail_drop steps).

---

### Pre-Deploy Gate Coverage Added

The `scripts/test-channel-orchestrator.ts` suite (added to `MANDATORY_SUITES`) covers:

| Check | What it proves |
|-------|---------------|
| ChannelOrchestrator class exports | Interface contract is present after every build |
| Transport adapter names/methods | GHL adapters implement `EmailTransport`, `SmsTransport`, `RvmTransport` |
| Global pause blocks all channels | `outbound_global_paused=true` stops email, SMS, and RVM before transport |
| `skipGlobalPauseCheck` works | Transactional bypass path is functional |
| Deal stage authority = liberty | `GHL_DEAL_STAGE_AUTHORITY` defaults to `"liberty"` — GHL cannot overwrite |
| Replit-owned fields protected | 8 compliance fields present in `getReplitOwnedFields()` set |
| Compliance fence order | global pause → arbitration → contactability ordering is preserved |
| Health monitor transport checks | `emailTransport` and `smsTransport` present in `HealthReport` type |
