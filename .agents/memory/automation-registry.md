---
name: Automation Registry & Collision Fixes
description: automation_registry table, kill-switch pattern, proposal-followup collision fix, global-pause gaps fixed
---

# Automation Registry

## Rule
Every BullMQ queue and the SDR orchestrator has a row in `automation_registry`. Kill-switches are read via `isAutomationEnabled(key)` (30s cache). The registry is seeded on every startup via `seedAutomationRegistry()` in startup-reconcile.ts — safe to call repeatedly (upsert, never overwrites kill_switch_enabled).

**Why:** 18 separate automations with no unified visibility or kill-switch. Admin needed a single page to pause any automation without a code deploy.

**How to apply:**
- Admin UI: `/dashboard/automation-registry` (protected, admin only)
- API: GET/PATCH `/api/admin/automations` and `/api/admin/automations/:key`
- Kill-switch helper: `server/services/automation-kill-switch.ts` — `isAutomationEnabled(key)` + `invalidateAutomationCache(key)`
- Queue processor wrapper in queue-manager.ts checks kill-switch before dispatch

## Collision bugs fixed
1. **Proposal-followup worker + proposal sequence**: worker now checks for active/paused sequence enrollments in the proposal family before sending. Audit log: `proposal_resend_skipped_sequence_collision`
2. **Missing global-pause checks**: `onboarding-reminder.ts` and `proposal-followup-worker.ts` both now check `outboundGlobalPaused` at the top of their main tick function

## Key files
- `server/services/automation-kill-switch.ts`
- `server/services/startup-reconcile.ts` — seedAutomationRegistry()
- `server/services/proposal-followup-worker.ts` — collision guard added
- `server/services/onboarding-reminder.ts` — global-pause check added
- `docs/automation-inventory.md` — full table of all 18 queues + SDR orchestrator
- `migrations/0115_automation_registry.sql` — journal idx=118, when=1790900000000
