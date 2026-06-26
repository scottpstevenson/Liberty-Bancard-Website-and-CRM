---
name: Finalize IIFE contact lookup
description: Why storage.getContacts({limit:1000}) is unsafe for email lookups in large DBs; use direct indexed query instead.
---

## Rule
Never use `storage.getContacts({ limit: 1000 })` to find a contact by email inside a finalize/side-effect IIFE. With >1000 contacts in the DB, the target contact will not appear (it is beyond the limit), causing `resolvedContactId` to be null and all downstream work (PEWC log, GHL sync) to silently skip.

**Why:** The DB in this project accumulated 154 000+ contacts from repeated test runs and real usage. `getContacts` paginates from ID=1; a brand-new contact never appears in the first 1000.

**How to apply:** Use a direct indexed query:
```ts
const [existing] = await db
  .select({ id: contacts.id })
  .from(contacts)
  .where(eq(contacts.email, contactEmail.toLowerCase()))
  .limit(1);
```

This is O(log n) via the `contacts_email_idx` index vs O(n) scan.

## Related fix
Also fixed in the same pass: `recordPewcDecision` in the finalize handler was being called with `{ email, consentGiven }` (wrong shape) instead of `{ contactId, checked, source, ipAddress, userAgent }`. Capture `req.ip` and `req.get("user-agent")` BEFORE the async IIFE starts — `req` stays in scope but capturing eagerly is safer.
