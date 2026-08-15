---
name: Outbound Pause Authority (#1531)
description: Architecture and implementation details of the unavoidable global outbound pause authority service.
---

## Rule
Every external provider action (GHL email/SMS/workflow, SMTP, Gmail, RVM/voice) MUST obtain an `AuthorizedSendDecision` from `OutboundPauseAuthority.authorize()` before making network I/O, and call `recheckEpoch()` immediately before the network call. No caller-controlled boolean can bypass this gate. The gate lives at the transport boundary (ghl.ts, smtp-email.ts) — not only at the orchestrator level.

**Why:** Reviewer rejection confirmed that orchestrator-level checks alone don't prevent direct callers (e.g. digest-service.ts, replitAuth.ts) from bypassing the pause.

## Architecture

### New Files
- `server/services/outbound-pause-authority.ts` — canonical read path; `authorize()`, `getPauseState()`, `recheckEpoch()`, `getCurrentEpoch()`, `invalidatePauseStateCache()`, `resolveException()`, `EXCEPTION_REGISTRY` (currently empty)
- `server/services/outbound-control-service.ts` — owns all mutations; advisory lock, barrier, atomic TX; `applyPauseMutation()`, `initializePauseControl()`, `registerInflight()`, `deregisterInflight()`
- `migrations/0133_outbound_pause_control.sql` — DDL for `outbound_pause_control` (singleton) + `outbound_pause_audit` (atomic write, always same TX)

### New Migration
Migration `0133` (idx=136, when=1791600000000) creates `outbound_pause_control` and `outbound_pause_audit`.

**Why:** `system_settings` writes were non-atomic (Promise.all + separate audit). Two tables now always write in the same transaction; fault-injection test confirms full rollback.

### Modified Files
- `shared/schema.ts` — added `outboundPauseControl`, `outboundPauseAudit` table definitions; added `bigint` to pg-core imports
- `server/services/channel-orchestrator.ts` — `skipGlobalPauseCheck` removed; replaced with `pauseExceptionKey` referencing versioned `EXCEPTION_REGISTRY`; uses `authorize()` + `recheckEpoch()` + `registerInflight`/`deregisterInflight`
- `server/routes/activation.ts` — PATCH `/api/system/outbound-settings` delegates to `OutboundControlService.applyPauseMutation()`; response includes `{ ok, control: { outboundGlobalPaused, reason, epoch, committedAt, state }, sendEnforcement, queueBackpressure, changeType }`
- `server/index.ts` — `initializePauseControl()` called BEFORE `getQueueManager()` and all legacy workers; workers skipped entirely if pause initialization fails
- `scripts/compliance-scan.ts` — added architectural boundary check; fails on `skipGlobalPauseCheck` usage in any non-adapter file
- `scripts/pre-deploy.ts` — added `test-outbound-pause-authority.ts` suite
- `scripts/test-pause-fence.ts` — extended to also verify `outbound_pause_control` table row
- `scripts/test-outbound-pause-authority.ts` — new 50-check test suite (schema, atomicity, fail-closed, epoch, input validation, static checks)
- `scripts/test-channel-orchestrator.ts` — sections 4 and 7 and 10b updated to use authority-based checks (no longer look for literal `"outboundGlobalPaused"` in orchestrator source)

## Transport Boundary Pattern
Each of `sendGhlEmail`, `sendGhlEmailForMerchant`, `sendGhlSms` in `ghl.ts` and `sendSmtpEmail` in `smtp-email.ts` follows this pattern:
1. `authorize({})` — fail closed if gate throws
2. `registerInflight(token)` from outbound-control-service
3. `recheckEpoch(decision.epoch)` — final epoch check before I/O
4. Call inner `_sendXxxInner()` function containing the actual network call
5. `deregisterInflight(token)` in finally block

## Key Invariants
1. **Fail-closed**: only explicit `false`/`"false"` in control table = unpaused; null, missing, malformed, DB error, timeout → paused.
2. **Epoch tracking**: every mutation increments bigint epoch; `recheckEpoch()` must be called immediately before provider network I/O.
3. **Activation barrier**: pause transitions `activating` → drain in-flight → `paused`; while `activating`, `authorize()` returns `allowed=false` for all callers.
4. **Singleton**: `outbound_pause_control` has exactly one row (seeded by `initializePauseControl()` on startup).
5. **Legacy compat**: `system_settings.outboundGlobalPaused` is synced on BOTH pause AND unpause transitions (not just unpause) so older processes detect pause within one legacy read cycle. `syncToLegacySystemSetting(true)` is called after the final paused commit.
6. **EXCEPTION_REGISTRY**: currently empty — no approved bypass exceptions.
7. **Initialization atomicity**: `initializePauseControl()` wraps control-row INSERT + audit-row INSERT in a single BEGIN/COMMIT/ROLLBACK transaction. An audit insertion failure rolls back the control row too.

**Why:** Previous implementation had 57 raw call-sites that bypassed the pause; `skipGlobalPauseCheck` let callers opt out; PATCH was non-atomic; workers started before pause state was known.

## Out of Scope (not closed by this task)
- BT-04, BT-10, BT-11, BT-12, BT-05 — consent/validation/Redis remain separate
- Physical BullMQ queue pause/resume (Task #1522B)
- Wave 2 migration backlog (17 files) still uses legacy reads — see test-channel-orchestrator.ts section 11 allowlist
