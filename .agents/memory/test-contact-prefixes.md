---
name: Test contact GHL ID prefixes
description: Smoke tests leave contacts under two different ghl_contact_id prefixes; both must be cleaned; cascade order matters.
---

## Rule
When cleaning up smoke-test contacts, always target BOTH prefixes:
- `wh-test-ghl-%` — created by webhook/contact smoke tests
- `ghl-deal-test-%` — created by deal-sync smoke tests

Querying only one prefix leaves orphan contacts that keep tripping the GHL circuit breaker.

**Why:** The two test suites use different ID prefixes. A previous cleanup deleted 155 wh-test-ghl-* contacts but left 12 ghl-deal-test-* contacts behind, causing ongoing GHL API 400 errors ("Contact with id ghl-deal-test-… not found").

## Cascade delete order
Contacts with `ghl-deal-test-*` IDs have linked deals, and those deals have FK children. The correct order is:

1. Get deal IDs: `SELECT id FROM deals WHERE contact_id IN (...)`
2. Self-referential: `UPDATE deals SET sales_deal_id = NULL WHERE sales_deal_id IN (deal_ids)`
3. Delete all FK children of those deals (agent_merchants, deal_competitors, onboarding_checklist_items, onboarding_steps, merchant_onboarding_stages, underwriting_conditions, underwriting_decisions, residual_import_rows, etc.)
4. `DELETE FROM deals WHERE contact_id IN (contact_ids)`
5. Delete contact FK children (ghl_activity_log, communication_events, tasks, etc.)
6. `UPDATE contacts SET parent_contact_id = NULL WHERE parent_contact_id IN (contact_ids)`
7. `DELETE FROM contacts WHERE ghl_contact_id LIKE 'ghl-deal-test-%'`

## How to apply
Any script that cleans smoke-test data must include both prefixes. The smoke-role-guards and test-contactability scripts should be checked after each run to confirm no orphan rows remain.
