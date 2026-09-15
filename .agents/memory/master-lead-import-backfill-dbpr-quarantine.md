---
name: Master Lead import/backfill DBPR exclusion and quarantine
description: How master-lead-import.ts and master-lead-backfill.ts apply DBPR-lineage exclusion and insufficient-identifier quarantine to manual-import rows, plus a real duplicate-email unique-index bug they exposed.
---

## What changed
Manual-import paths into `master_leads` (`server/services/master-lead-import.ts` for sheet imports, `server/services/master-lead-backfill.ts` for contacts→master_leads migration) did not apply the canonical DBPR-family predicate (see `dbpr-canonical-predicate.md`) and had no quarantine path for rows with neither a usable email nor a usable phone.

- **Backfill**: joins `contacts.business_id` → `canonical_source_links` directly (the natural lineage join point for rows that already have a business FK) and sets `canonical_business_id` on the inserted `master_leads` row from that same `business_id`. A DBPR-lineage contact is written with `status='suppressed', suppression_reason='dbpr_lineage'`.
- **Import** (sheet rows have no business FK of their own): matches the import row's `domain` against `businesses.website_domain` and checks DBPR lineage via that match. A hit is written as `status='quarantined', suppression_reason='dbpr_lineage'` — quarantined rather than merely suppressed, since it's a lineage exclusion, not a contactability suppression, and the row has no `canonical_business_id` for the Step-8-style business-level authority to catch downstream.
- Both paths add `status='quarantined', suppression_reason='insufficient_identifiers'` for any row with neither a valid email nor a valid (10+ digit) phone.
- Pre-existing DNC/opt-out/unsubscribe/hard-bounce/existing-customer suppression logic in both files is unchanged; the DBPR and insufficient-identifier checks are new branches added to the same if/else suppression chain.

## Bug found and fixed along the way
`master_leads_email_unique_idx` is a partial unique index on `lower(trim(email))` that is **not scoped by status** — it applies to `duplicate`-status rows too, not just active ones. `master-lead-import.ts`'s within-batch duplicate-detection path was writing the *same* email onto both the canonical row and its `duplicate`-status sibling in one bulk `db.insert(masterLeads).values(inserts)` call (no `ON CONFLICT`), which throws and fails the **entire batch** the moment any row in it has an in-batch duplicate email. Fixed by nulling `email` on the `duplicate`-status insert (the canonical row already holds it; `duplicateOfId`/`canonicalLeadId` link back to it). Any future write path into `master_leads` that inserts more than one row sharing an email in the same statement needs the same treatment or an explicit `ON CONFLICT` target.

## Testing gotcha
`master-lead-backfill.ts`'s `runMasterLeadBackfill()` full-scans the entire `contacts` table (150K+ rows in this project) every run and takes 1-3 minutes; it also holds a single-flight lock in `system_settings` key `master_lead_backfill_progress` that stays `status:"running"` if the process is killed mid-run (e.g. a test timeout), and must be manually reset (`storage.setSystemSetting('master_lead_backfill_progress', {status:'idle'})`) before the next run will proceed. When testing, create ALL fixtures first and call the backfill exactly once, not once per assertion.

Test fixture emails sharing a literal domain (e.g. all `@test.internal`) will collide on the backfill's own domain-dedupe set, since its `extractDomain()` falls back to the email's host part; give each fixture contact a distinct `website` domain to avoid false positives.
