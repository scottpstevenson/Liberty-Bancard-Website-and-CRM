---
name: Identity Crosswalk Gen-1
description: Read-only cross-system identity evidence sweep. Key design constraints, FK type fix, and fail-close guard locations.
---

# Identity Crosswalk Gen-1 (Task #1830)

## Safety constraints
- Zero writes to contacts, businesses, deals, prospects, or sunbiz_entities.
- All evidence stored as HMAC digests; no raw PII in DB.
- BACKGROUND_JOB_PROFILE must be 'off' to start a run.
- Three fail-close guards block automated mutations until Gen-2 authorization is obtained.

## Fail-close guard locations
- `promoteQualifiedToContacts()` — `server/services/daily-outreach.ts` line ~574 — returns early, audit action `discovery_promotion_fail_closed`
- `checkAndHandleOrphanDeal()` — `server/services/sdr/orchestrator.ts` line ~1181 — returns early, audit action `sdr_orphan_deal_fail_closed`
- `PATCH /api/enrichment-jobs/:id` — `server/routes/prospects.ts` — always 503 `ENRICHMENT_JOB_CONTROL_GOVERNED`
- `vertical` — removed from `APPROVED_FIELDS` in `server/services/reconciliation-approval.ts`; stays in `REVERTABLE_FIELDS`

## FK type gotcha
**users.id is character varying (text), not integer.**
Migration 0230 uses `requested_by_user_id text REFERENCES users(id)`.
Migration 0231 uses `actor_user_id text REFERENCES users(id)`.
This tripped a startup crash when first written as `int` — fix: always use `text` for user FK columns.

## Tables (migrations 0230–0231)
- `contact_identity_reconciliation_runs` — one-active-run partial unique index ON ((1)) WHERE status IN ('pending','running','paused')
- `contact_identity_subjects` — UNIQUE(run_id, source_table, source_id)
- `contact_identity_candidates` — evidence_class field; only EXPLICIT_LINK / DETERMINISTIC_MATCH / STRONG_REVIEW_CANDIDATE are decidable
- `contact_identity_evidence` — UNIQUE(candidate_id, root_source_table, root_source_id, evidence_fingerprint)
- `contact_identity_decisions` — CHECK constraint: exactly one of candidate_id or organization_candidate_id
- `contact_vertical_candidates` — vertical conflict state enum

## Routes
- All under `/api/admin/identity-crosswalk/` — admin only
- Registered in `server/routes.ts` via `registerIdentityCrosswalkRoutes`
- UI at `/dashboard/identity-crosswalk` (admin only)

## Lead-ops stats field renames
- `enriched` → `processing_completed`
- `pending` → `pending_processing`
- `has_email` → `current_email_inventory` (with NULLIF/BTRIM guards)
- `has_phone` → `current_phone_inventory` (with NULLIF/BTRIM guards)
- LeadOpsStats interface and stat cards in `LeadOpsCenter.tsx` updated to match

## Gen-2 lift guide
See `docs/task-1830-rollback.md` for full instructions on removing fail-close guards when Gen-2 is authorized.

**Why:** Gen-1 is evidence-only; writing decisions to canonical records requires separate authorization to prevent automated identity mutations from running without admin confirmation.
