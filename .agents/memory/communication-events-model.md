---
name: Canonical Communication Events Model
description: Wave A3 — single normalized record for every inbound/outbound communication; table, service, and wiring points.
---

## Rule
Every inbound and outbound communication writes to `communication_events` via `recordCommunicationEvent()` in `server/services/communication-events.ts`. Use the convenience helpers `recordOutboundSend()` and `recordInboundEvent()` — never INSERT directly.

## Why
AI memory (Wave F), full-funnel attribution (Wave G), and unified contact timelines all read from this single table. Forking write paths means gaps in AI context and attribution.

## Schema
- Table: `communication_events` (migration 0119_communication_events.sql, when=1791200001000)
- Key columns: contactId, dealId, direction (inbound/outbound), channel (email/sms/call/voicemail/chat/form/portal/rvm), provider (ghl/smtp/twilio/internal/manual), status, intentClassification, automationStopped, sentBy, sequenceId, sequenceStepId, ghlMessageId

## Wired sites (as of this session)
- Outbound: sequence-worker.ts email send (line ~1290), sequence-worker.ts SMS send (line ~1495)
- Inbound: ghl.ts inbound reply handler (after createGhlActivityLog), webhook-handlers.ts email bounce
- Form: public.ts statement-upload (fire-and-forget after processNewLead)

## NOT yet wired
- Campaign-engine sends (campaign-engine.ts)
- Other public forms: newsletter, manual contact create, QR/whitelist forms
- Outbound: GHL RVM/voicemail drops
- Manual sends (human-initiated from the CRM)

## API
- GET /api/contacts/:id/communication-timeline (contacts.ts) — returns events newest-first, limit 50 default, max 200

## How to apply
Any new send or receive site should call the relevant helper AFTER the primary send/log call as a non-blocking `import().then().catch()` — never let communication event logging block the actual send.
