---
name: PUT routes with raw string dates hitting Drizzle timestamp columns
description: storage.updateDeal / updateCalendarEvent passed req.body straight to db.update(); a JSON string date value crashes Drizzle's timestamp column mapper.
---

`db.update(table).set({...})` for a Postgres `timestamp` column calls `value.toISOString()` internally (see `node_modules/src/pg-core/columns/timestamp.ts`). If the update payload comes from `req.body` (JSON) and contains a date field as a plain ISO string rather than a `Date` instance, this throws `value.toISOString is not a function` — a 500, not a validation error.

**Why:** `PUT /api/deals/:id` and `PUT /api/calendar-events/:id` pass `req.body` directly to storage with no Zod parsing/coercion. Any client sending `{ nextFollowUp: "2026-08-01T..." }` or `{ startTime: "..." }` as JSON (the only way JSON can represent a date) hit this. Discovered while wiring a Calendar "fix date" UI action.

**How to apply:** Before calling `db.update()`/`db.insert()` with a body sourced from JSON, coerce any known timestamp-column fields with `typeof v === "string" ? new Date(v) : v`. Fixed centrally in `storage.updateDeal` (deals.ts) and `storage.updateCalendarEvent` (misc.ts). If adding new raw-`req.body`-passthrough update methods for tables with timestamp columns, apply the same coercion or add proper Zod schema parsing with `z.coerce.date()`.
