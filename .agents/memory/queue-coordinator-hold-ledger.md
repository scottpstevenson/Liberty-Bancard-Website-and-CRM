---
name: Queue Coordinator & Hold Ledger (#1532)
description: Reason-scoped logical holds, VFC-22 enrollment restoration fix, 11 raw gate upgrades, physical actuation gating.
---

# Queue Coordinator & Hold Ledger

## Migration
- 0137 (`_journal.json` idx=140, when=1792000000000): tables `logical_job_control_holds`, `logical_job_hold_events`, `queue_reconciliation_state`, `post_enrichment_enrollment_intents`, `backlog_release_runs`.

## Core files
- `server/services/outbound-queue-coordinator.ts` — singleton `outboundQueueCoordinator`; `canExecute(logicalJobKey)` fail-closed; `addHold`/`clearHold` with advisory lock + monotonic ledger_epoch; `writeGlobalOutboundHolds`/`transitionGlobalHoldsToReleasePending` called from OutboundControlService.
- `server/services/logical-job-manifest.ts` — typed manifest keyed by `(physicalQueue, jobNamePattern)`; `validateManifest()` for G-01 gate.
- `shared/schema.ts` — Drizzle definitions for all 5 new tables at end of file.

## VFC-22 fix
When globally paused, `sequence-worker.ts` was mutating enrollment `status='paused'` + writing `_globalPauseBlock*` metadata. These enrollments were permanently stuck.

**Fix (two parts):**
1. `outbound-control-service.ts` unpause path: sweeps `sequence_enrollments WHERE status='paused' AND metadata->>'_globalPauseBlockReason' IS NOT NULL`, restores to `active`, clears `_globalPauseBlock*` — atomically within the unpause transaction.
2. `sequence-worker.ts` going forward: instead of setting `status='paused'`, writes a `_holdDeferred` metadata marker; enrollment stays `active` and is not stuck.

## Global pause integration
- On pause: `outboundQueueCoordinator.writeGlobalOutboundHolds()` called within the pause-commit transaction.
- On unpause: `outboundQueueCoordinator.transitionGlobalHoldsToReleasePending()` called within the unpause transaction. Mixed handlers remain blocked until admin calls `POST /api/admin/queue-holds/release-approval`.

## All 11 raw gate upgrades
All `storage.getSystemSetting("outboundGlobalPaused")` checks replaced with `OutboundPauseAuthority.authorize()` + `coordinator.canExecute()`:
- `proposal-followup-worker.ts`, `ghl-workflows.ts`, `nba-service.ts`, `campaign-engine.ts` (×2), `sdr/orchestrator.ts`, `sequence-worker.ts` (×2), `winback-outreach-engine.ts`, `underwriting-checklist-service.ts`, `campaigns.ts`

## Coordinator gates added
- `merchant-success-sequences.ts` — gates entire run
- `post-enrichment-worker.ts` — Phase A (stamp deal) unconditional; Phase B (enrollment) gated; defers to `post_enrichment_enrollment_intents` outbox when held
- `daily-outreach.ts` — 4-phase split: Phase A (enrichment, always runs); Phase B (discovery-promotion); Phase C (discovery-enrollment); Phase D (discovery-send)
- `sequence-enrollment-recovery.ts` — gates before capacity reservation
- `ghl-enrollment-recovery.ts` — gates without incrementing retry_count during pause

## Physical actuation
Only WINBACK_OUTREACH queue gets BullMQ physical pause/resume actuation (Phase 4 pilot). All other queues are software-gated at the handler level. Coordinator injects into QueueManager after initialization.

## Admin API
- `GET/POST/DELETE /api/admin/queue-holds` — admin-only hold CRUD
- `POST /api/admin/queue-holds/release-approval` — approve staged release (clears release_pending holds)

## Key invariants
- `canExecute()` fail-closed on DB error.
- `applied` returned only after `queue.isPaused()` readback matches desired state at epoch.
- Redis fault → `pending`/`degraded` in `queue_reconciliation_state`.
- Stale `source_epoch` cannot overwrite a newer hold for same owner.
- Two same-reason holds from different `source_key` owners coexist independently (partial unique index).

**Why:**
- Workers need both `OutboundPauseAuthority.authorize()` AND `coordinator.canExecute()` — authority alone is insufficient for logical holds.
- VFC-22 is a critical bug: globally-paused enrollments were permanently stuck until manually toggled.
- Physical pause is NOT the final send-safety boundary — that remains #1531's transport authority.
