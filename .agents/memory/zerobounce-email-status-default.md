---
name: ZeroBounce email_status default value
description: contacts.email_status uses 'active' as the default (not NULL) — affects ZeroBounce lazy-validation gate condition
---

## Rule
The `contacts.email_status` column defaults to `'active'` for all imported contacts — it is never NULL unless explicitly set. A `IS NULL` check for "not yet ZeroBounce validated" will match zero rows.

**Why:** Contacts are written with `email_status = 'active'` at import time (CSV, GHL sync, Sunbiz). Only 74 of 152,847 email contacts have a non-active status (56 valid, 18 bounced/bad, 0 NULL).

**How to apply:** Any code that wants to identify contacts not yet through ZeroBounce validation must check `email_status = 'active'` (or `email_status NOT IN ('valid','bounced','invalid','spam_trap','abuse','opted_out')`), not `email_status IS NULL`. This applies directly to:
- The lazy-validation gate in the sequence worker (task #1143)
- The `GET /api/contacts/quality-summary` unvalidated count query
- The `POST /api/contacts/validate-emails-batch` filter logic
- Any admin UI filter that surfaces "unvalidated" contacts
