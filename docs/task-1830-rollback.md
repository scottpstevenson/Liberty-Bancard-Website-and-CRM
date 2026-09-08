# Task #1830 — Cross-System Identity & Authority Reconciliation (Gen-1) — Rollback Guide

## What was changed

| Area | Files | Reversible? |
|---|---|---|
| **Migrations 0230–0231** | `migrations/0230_identity_crosswalk_runs.sql`, `migrations/0231_identity_crosswalk_candidates.sql`, `migrations/meta/_journal.json` | Drop tables (see below) |
| **Fail-close guards** | `server/services/daily-outreach.ts`, `server/services/sdr/orchestrator.ts` | Remove the guard block + `return;` |
| **Approval allowlist split** | `server/services/reconciliation-approval.ts` | Merge `APPROVED_FIELDS` + `REVERTABLE_FIELDS` back to `ALLOWED_FIELDS` and re-add `"vertical"` |
| **Enrichment-jobs 503 gate** | `server/routes/prospects.ts` | Restore the original PATCH handler body |
| **Route registration** | `server/routes.ts` | Remove the `registerIdentityCrosswalkRoutes` import + call |
| **Lead-ops stats rename** | `server/routes/lead-ops.ts` | Rename columns back; remove NULLIF/BTRIM guards |
| **Reconciliation org-candidate members** | `server/routes/reconciliation.ts` | Remove the new `GET /org-candidates/:candidateId/members` block |
| **New services/routes** | `server/services/identity-crosswalk-runner.ts`, `server/routes/identity-crosswalk.ts` | Delete files |
| **UI** | `client/src/pages/dashboard/IdentityCrosswalk.tsx`, `client/src/App.tsx`, `client/src/pages/dashboard/ContactCensus.tsx`, `client/src/pages/dashboard/LeadOpsCenter.tsx` | Delete new file; revert edits |
| **CI manifest + cert script** | `scripts/ci-suite-manifest.ts`, `scripts/test-identity-crosswalk.ts` | Remove manifest entry; delete cert script |

## Database rollback

If migrations 0230–0231 have been applied, run the following to drop the new tables (development only — never run against production without a maintenance window):

```sql
-- Drop in FK-dependency order
DROP TABLE IF EXISTS contact_vertical_candidates CASCADE;
DROP TABLE IF EXISTS contact_identity_decisions CASCADE;
DROP TABLE IF EXISTS contact_identity_evidence CASCADE;
DROP TABLE IF EXISTS contact_identity_candidates CASCADE;
DROP TABLE IF EXISTS contact_identity_subjects CASCADE;
DROP TABLE IF EXISTS contact_identity_reconciliation_runs CASCADE;

-- Drop expression indexes added to contacts
DROP INDEX IF EXISTS contacts_lower_email_crosswalk_idx;
DROP INDEX IF EXISTS contacts_lower_company_crosswalk_idx;

-- Remove journal entries (adjust idx values if they differ in your environment)
DELETE FROM drizzle.__drizzle_migrations
WHERE hash IN (
  -- get hashes from: SELECT hash, tag FROM drizzle.__drizzle_migrations WHERE tag LIKE '%identity_crosswalk%'
  '<hash-of-0230>', '<hash-of-0231>'
);
```

## Checkpoint rollback

The safest rollback path is via the Replit checkpoint that preceded this task. Use the Replit checkpoint UI to restore the workspace to the state before Task #1830 was applied.

## Fail-close guard lift (when Gen-2 is ready)

When Gen-2 crosswalk authorization is approved, remove the two fail-close blocks:

**`server/services/daily-outreach.ts`** — remove lines starting with `// TASK-1830:` through and including the `return { promoted: 0, skipped: 0, dealsCreated: 0 };` line and the comment about unreachable body.

**`server/services/sdr/orchestrator.ts`** — remove lines starting with `// TASK-1830:` through and including the `return;` line and the comment about unreachable body. Also restore the opening `try {` and closing `} catch` that were already there (they were not removed, just made unreachable).

**`server/routes/prospects.ts`** — restore the original PATCH handler body (remove the 503 return and TODO comment, restore the z.object validation + storage.updateEnrichmentJob call).

**`server/services/reconciliation-approval.ts`** — add `"vertical"` back to `APPROVED_FIELDS` and re-evaluate whether to keep the separate `REVERTABLE_FIELDS` set or merge them.

**`client/src/pages/dashboard/LeadOpsCenter.tsx`** — set `ENRICHMENT_CONTROLS_GOVERNED = false`.
