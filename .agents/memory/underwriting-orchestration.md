---
name: Underwriting orchestration
description: Auto-create conditions, merchant doc-chase email, SLA alert, admin pending-conditions view — what was built and where
---

# Underwriting Orchestration (#1403)

## What was built

**Condition auto-creation:**
- `initUnderwritingConditions(dealId, contactEmail, contactName, contactId)` in `server/services/underwriting-checklist-service.ts`
- Called from `server/services/deal-stage-service.ts` (alongside existing `initUnderwritingChecklist`) whenever a deal stage contains "underwriting"
- Inserts 6 standard rows into `underwriting_conditions` (schema at `shared/schema.ts` lines ~4626-4654)
- Idempotent: skips if any conditions already exist for that dealId

**Merchant doc-chase email:**
- `sendMerchantConditionsEmail()` fires after condition rows are created if `contactEmail` is set
- Uses `sendSmtpEmail` with `category: "transactional_merchant"`
- Allowlisted in `scripts/compliance-scan.ts` (2026-08-12 batch)
- Only fires if SMTP is configured; silently no-ops otherwise

**SLA alert:**
- `checkUnderwritingConditionSlas()` in `server/services/sla-worker.ts` (added after line ~758)
- Called from `runSlaCheck()` on every SLA check cycle
- Finds `underwriting_conditions` with `status='pending' AND submitted_at IS NULL AND due_date < NOW()`
- Creates a `source='underwriting_sla'` task per deal (deduplicated via INSERT WHERE NOT EXISTS)

**Admin pending-conditions view:**
- `GET /api/admin/underwriting/pending-conditions` in `server/routes/admin.ts`
- Optional `?overdue=true` filter for conditions past due date
- Returns up to 500 rows joined with deals + contacts

## NOT yet built
- Merchant portal upload flow (submitDocument for each condition)
- Automated deliverability alert when thresholds crossed
- No test script for this automation path (test_gaps task proposed)

**Why:** Idempotent function + INSERT WHERE NOT EXISTS on SLA task is the pattern; don't use partial-index ON CONFLICT for new `source` values unless the index exists.
