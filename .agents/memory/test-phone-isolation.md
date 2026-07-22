---
name: Test phone number isolation in form tests
description: Hardcoded phone numbers in form tests cause GHL contact ID uniqueness violations across test runs.
---

## Rule
Never use hardcoded phone numbers in form integration tests. Always generate unique phone numbers per test run using a timestamp+random suffix pattern.

**Why:** GHL's contact upsert matches on phone number. A previous test run's phone number stays in GHL even after the local contact is deleted. On the next run, GHL returns the existing contact ID for that phone, which the background GHL sync then assigns to the new local contact — but a *different* local contact may already hold that ghlContactId → `contacts_ghl_contact_id_unique` constraint violation on insert.

**How to apply:** Use a `uniquePhone()` helper like:
```ts
function uniquePhone(): string {
  const tail = (Date.now() % 100000).toString().padStart(5, "0");
  const rand = Math.floor(Math.random() * 10).toString();
  return `55501${rand}${tail}`; // 555-01X-XXXXX fictional pattern
}
```
Applies to any test that POSTs to public form endpoints (`statement-upload`, `estimate`, `get-started`, `merchant-app`) when GHL integration is configured in the environment.
