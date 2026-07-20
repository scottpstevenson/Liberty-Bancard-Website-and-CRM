---
name: Drizzle ORM set() silent drop for Record<string,unknown> spreads
description: db.update(table).set({...Record<string,unknown>, updatedAt} as typeof table.$inferInsert) silently drops columns when the source is a plain JS object typed as Record — use raw SQL for critical single-field updates.
---

## The Rule
When `storage.updateDeal` (or any storage method that does `tx.update(table).set({ ...coercedUpdates } as typeof table.$inferInsert)`) is called with a `Record<string, unknown>` spread typed via `as typeof table.$inferInsert`, certain columns are silently NOT written to the DB even though TypeScript is satisfied and no error is thrown.

Confirmed: `ghlOpportunityId` on the `deals` table was silently dropped every time. The `RETURNING` clause showed the updated value, but a subsequent SELECT showed the old value.

**Why:** Drizzle's `.set()` appears to only process keys it recognizes in its internal column mapping when the object is typed via a cast. The spread `{ ...coercedUpdates }` loses column metadata, so Drizzle may not map camelCase key → snake_case column correctly through the cast.

**How to apply:**
- For any single critical field that must be persisted (e.g. external IDs like `ghlOpportunityId`, `ghlContactId`), use raw SQL directly:
  ```typescript
  await db.execute(sql`UPDATE deals SET ghl_opportunity_id = ${value}, updated_at = NOW() WHERE id = ${id}`);
  ```
- The `storage.updateDeal` / `updateContact` pattern is safe for bulk updates (stage, notes, etc.) where the data is typed via `Partial<InsertDeal>` — the issue only manifests when a `Record<string,unknown>` is spread and type-cast.
- Symptoms: update returns no error, batch count increments as "success", but the column stays null in the DB on every subsequent read.
