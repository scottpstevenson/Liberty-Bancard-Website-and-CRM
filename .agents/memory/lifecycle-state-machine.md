---
name: Canonical Lifecycle State Machine
description: lifecycle_state on contacts — 27-state canonical field, transition history table, LifecycleService, side-effect wiring pattern
---

# Canonical Lifecycle State Machine

## Rule
`contacts.lifecycle_state` is the single authoritative field for "where is this merchant in the process." Domain-specific fields (deals.stage, sdr_lead_state.currentStage, merchant_applications.status, merchant_profiles.accountStatus) remain unchanged — lifecycle is a write-through observer.

**Why:** 5 separate state fields were partially overlapping with no single source of truth. lifecycle_state provides a stable, queryable signal for NBA engine, analytics, and conflict detection without disrupting existing domain logic.

**How to apply:**
- All lifecycle writes go through `LifecycleService.transition(contactId, toState, meta)` — never direct DB updates
- Side-effect wiring pattern: fire-and-forget with `.catch(err => logger.warn(...))` — never block the primary operation
- Transitions are forward-only (by state index) with two exceptions: CHURNED→WINBACK, AT_RISK→RETENTION; any state→CLOSED_LOST is always allowed
- Same-state transition is a no-op (idempotent) — safe to call repeatedly
- `LifecycleTransitionError` is thrown for backwards moves in non-allowed paths

## Key files
- `server/services/lifecycle-service.ts` — LifecycleService, LIFECYCLE_STATES const, transition matrix, helper mappers
- `shared/schema.ts` — contactLifecycleHistory table, contacts.lifecycleState + lifecycleStateUpdatedAt columns
- `migrations/0116_contact_lifecycle_state.sql` — journal idx=119, when=1791000000000

## Wiring points
- `server/services/deal-stage-service.ts` — deal stage → lifecycle (fire-and-forget)
- `server/services/sdr/orchestrator.ts` — DISCOVERED→ENGAGED on first stage advance
- `server/routes/contacts.ts` — PUT /api/contacts/:id maps status/lifecycleStage
- `server/routes/merchants.ts` — accountStatus activated → ACTIVE_PROCESSING

## Backfill
`scripts/backfill-lifecycle-state.ts` exists but has NOT been run against production yet. Run with `--dry-run` first. Only advances forward, never downgrades.

## Admin diagnostics
GET /api/admin/lifecycle-conflicts — returns contacts where lifecycle_state disagrees with domain fields (admin/manager only).
