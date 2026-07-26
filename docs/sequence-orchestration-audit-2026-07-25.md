# Sequence Orchestration Audit Report
**Date:** 2026-07-25  
**Status:** ✅ CONFIRMED — Replit owns all sequence orchestration. GHL = transport only.

---

## Summary

All outbound sequence steps are scheduled and gate-checked by Replit. GHL workflow IDs
are used **only** for the inbound confirmation transactional handoff
(`GHL_WORKFLOW_INBOUND_CONFIRMATION`). No outbound SDR/sales sequence step depends on
a GHL native workflow as its orchestration brain.

---

## Call-Site Audit: `enrollContactInGhlWorkflow`

| Call Site | File | Classification | Action Taken |
|-----------|------|----------------|--------------|
| Step-0 enrollment gate | `server/services/sequence-worker.ts:168` | Outbound sequence — GHL contact sync only | ✅ Refactored: never returns `ghl_workflow`; always `replit_direct` |
| Bulk re-engage | `server/routes/contacts.ts:346` | Outbound sequence — admin-triggered | ✅ Uses `enrollContactInGhlWorkflow` for GHL sync; Replit enrolls the sequence separately |
| Single re-engage | `server/routes/contacts.ts:377` | Outbound sequence — admin-triggered | ✅ Same: GHL sync only, sequence enrollment handled by Replit |
| No-show recovery | `server/services/ghl.ts:1772` | Triggered by inbound GHL no-show webhook; enrolls outbound follow-up sequence | ✅ Uses `enrollContactInGhlWorkflow` for GHL sync; BullMQ drives the actual steps |

### Inbound Confirmation (Allowed GHL Workflow Trigger)

| Call Site | File | Classification | Status |
|-----------|------|----------------|--------|
| `enrollInInboundConfirmation` | `server/services/ghl-workflow-enrollment.ts:499` | Inbound transactional — fires once on web form submit | ✅ Preserved; uses `GHL_WORKFLOW_INBOUND_CONFIRMATION` |

---

## Root Cause Removed

**Before this audit:** `enrollContactInGhlWorkflow` resolved a GHL workflow ID via
`GHL_DEFAULT_WORKFLOW_ID` (env var), per-sequence env vars, or DB entries, then called
`triggerWorkflow()` and returned `method: "ghl_workflow"`. In `sequence-worker.ts`, any
enrollment where `method === "ghl_workflow"` was immediately marked `status: "completed"`
and fully delegated to GHL — meaning GHL controlled all subsequent step timing, channel
selection, and gate enforcement for that contact.

**After this audit:** `enrollContactInGhlWorkflow` performs only GHL contact sync
(upsert + inbox tags + note) and always returns `method: "replit_direct"`. The
`sequence_delegated_to_ghl` audit log action and its handler block have been removed
from `sequence-worker.ts`. GHL workflow ID resolution for outbound sequences has been
eliminated from the call path.

---

## Architecture Boundary Established

### Replit owns:
- BullMQ tick scheduling (step timing, delayDays advancement)
- All gate checks before every step: global pause, contactability, daily-cap, DNC,
  quiet-hours, bounce guard, reply-stop, A/B split logic
- Step execution dispatch (email/SMS/task/call/voicemail)
- Enrollment status tracking (active → paused → completed)
- Audit log writes for every step outcome

### GHL provides (transport only):
- `sendGhlEmail` / `sendGhlSms` — deliver a message Replit composed
- `upsertGhlContact` — keep CRM contact record current
- `addTag` / `addNote` — label contact for inbox organisation
- `GHL_WORKFLOW_INBOUND_CONFIRMATION` — one-shot transactional confirmation on inbound
  form submission (this is the sole allowed GHL workflow trigger)

---

## Files Changed

- `server/services/ghl-workflow-enrollment.ts` — Removed GHL workflow trigger from
  `enrollContactInGhlWorkflow()`; added top-of-file architecture boundary comment block
- `server/services/sequence-worker.ts` — Removed dead `sequence_delegated_to_ghl`
  handler block; added architecture boundary comment block at top of file

---

## Verification

All pre-deploy gate scripts pass after the refactor (sequence compliance, role guards,
API coverage). The `GHL_WORKFLOW_INBOUND_CONFIRMATION` path in
`enrollInInboundConfirmation` is untouched and continues to function as the one
permitted inbound transactional GHL workflow trigger.
