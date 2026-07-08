---
name: Deal backfill async-runner pattern
description: Design decisions and gotchas for the warm/hot deal backfill system and the orchestrator future-orphan guard.
---

## Rule
The deal backfill is a long-running task (153k contacts) that cannot block an Express request. It uses `setImmediate()` fire-and-forget from the POST endpoint, with durable resumable progress persisted to `system_settings` key `"contacts_deal_backfill_progress"` (JSONB) after every batch.

## Key design choices
- Progress key: `"contacts_deal_backfill_progress"` in system_settings table (via `storage.getBackfillProgress` / `storage.setBackfillProgress` in `server/storage/deals.ts`).
- Eligibility gates applied in `classifyEligibility()` helper inside `server/routes/admin.ts`: cold (<45), DNC, anonymous, placeholder email, missing identity, duplicate business.
- Anonymous detection: firstName in `{"anonymous","contact","unknown","n/a","na","","test","user"}` AND no companyName.
- Confirmation required (`"CREATE DEALS"`) only when `eligibleCount >= 100`.
- `storage.getOrphanContactCandidates()` uses `NOT EXISTS (SELECT 1 FROM deals WHERE deals.contact_id = contacts.id AND deals.archived_at IS NULL)` — includes the `archived_at IS NULL` guard.
- `getBusinessIdsWithDeals()` helper uses `innerJoin` of deals ← contacts to track businesses that already have a deal, preventing duplicate deals for the same business.

## Future-orphan guard location
In `server/services/sdr/orchestrator.ts` → `processLead()`, called via `checkAndHandleOrphanDeal(lead, reviewMode)` AFTER the scoring block (stage transitions DISCOVERED/ENRICHED/DEDUPED/CLASSIFIED). Only fires for `priorityBucket === "A" | "B"`. When `autoCreateDealsForWarmContacts` setting is false OR reviewMode is active, writes an audit log entry only (action: `contact_deal_candidate_detected`); never calls `autoEnrollFromTrigger`.

## autoCreateDealsForWarmContacts setting
- Key: `"auto_create_deals_for_warm_contacts"` in system_settings.
- Admin endpoint: `GET/PUT /api/admin/settings/auto-create-deals-for-warm-contacts` (requireRole admin for PUT).
- Default: false (log-only mode).

**Why:** We must never accidentally trigger outreach/sequences during backfill. All create paths are gated on the system setting + eligibility checks, and the eligibility check re-verifies no deal exists before writing (idempotent double-check).
