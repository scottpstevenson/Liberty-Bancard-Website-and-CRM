---
name: contacts/businesses NOT NULL convergence
description: How schema.ts-vs-live nullability drift on contacts and businesses was resolved, and the decision rule used.
---

## Rule
When `shared/schema.ts` says `.notNull()` but the live column is nullable (or vice versa), check the live NULL count before choosing a direction. If zero rows are NULL and the column has a sensible DEFAULT, tighten the live DB with `ALTER COLUMN ... SET NOT NULL` to match schema.ts — don't relax the type to `nullable` just because the live constraint is currently missing.

**Why:** `contacts.email_status`, `is_decision_maker`, `decision_maker_confidence`, `management_type` were added via a raw-SQL migration (0029) that used `DEFAULT` but never added `NOT NULL`, even though schema.ts always declared them `.notNull()`. Live data had 0 nulls across all four (162k rows), so tightening was safe and matched the code's existing non-null assumption. `businesses.free_enrichment_attempt_count` was the opposite direction (live NOT NULL, schema.ts nullable) — schema.ts was corrected to `.notNull()` to match.

**How to apply:** Production schema changes here go through Publish diffing `shared/schema.ts` (see production-schema-ownership.md), not through replaying dev's migration journal against prod. So the fix requires BOTH a dev migration file (`ALTER TABLE ... SET NOT NULL`, registered in `migrations/meta/_journal.json`) so dev's DB converges immediately, AND the corresponding `shared/schema.ts` field to already reflect the desired end state (so Publish applies the same DDL to prod on next deploy).

Also: `contacts.contact_bounced_at` existed live (added by the same migration 0029) with no `shared/schema.ts` field at all — added as `contactBouncedAt: timestamp("contact_bounced_at")` (nullable, no backing writer found). It appears to duplicate `bouncedAt`/`bounceStatus`/`bounceDate`/`bounceReason` — see task #1959 for the follow-up to reconcile these.
