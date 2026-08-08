---
name: NBA Engine & ChannelOrchestrator (Wave 1A/1B)
description: ChannelOrchestrator compliance fence, GHL transport adapters, NBA UPSERT tables, API routes, and manager UI — key pitfalls encountered during build.
---

## ChannelOrchestrator (Wave 1A)

- Provider-neutral interfaces: `EmailTransport`, `SmsTransport`, `RvmTransport` in `server/services/channel-orchestrator.ts`.
- Compliance fence order: global pause → DNC → contactability → consent. Lives in the orchestrator, NOT in transport files.
- Transport adapters: `server/services/transports/ghl-email-transport.ts`, `ghl-sms-transport.ts`, `ghl-rvm-transport.ts`. Swap provider by editing `server/services/transports/index.ts` only.
- **Compliance scanner pitfall**: scanner flags transport files for missing `evaluateContactability` within 120 lines because it sees the raw `sendGhlEmail/sendGhlSms` calls. Fix: add both files to `CALL_SITE_ALLOWLIST` in `scripts/compliance-scan.ts` with category `admin_gated` and reason explaining the ChannelOrchestrator gate.

## NBA Engine (Wave 1B)

### Schema
- `contact_nba` — UNIQUE on `contact_id`; `dismissed_by` is `varchar` (NOT integer FK — users.id is varchar/uuid in this project).
- `nba_recommendation_history` — history of superseded rows.
- Migration: idx=120, when=1791100000000, tag=`0117_contact_nba`.

### Global pause key
- The app stores the global pause flag under key `"outboundGlobalPaused"` (camelCase), NOT `"outbound_global_paused"`.
- `storage.getSystemSetting("outboundGlobalPaused")` returns `"true"` (string) or `true` (boolean) — check both: `paused === "true" || paused === true`.

### _persistNBA UPSERT behavior
- `_persistNBA` moves the existing row to `nba_recommendation_history` first, then does `onConflictDoUpdate` on `contact_nba`.
- Returns `rec` (the input struct), not the DB row — safe, as all fields are passed in.

### Routes
- Registered via `registerNbaRoutes(app)` in `server/routes/nba.ts` — follow the existing `registerXRoutes` pattern, NOT default Router export.
- 5 endpoints: GET/POST nba per contact, priority queue (admin+manager), force-compute (admin only).

### Test isolation
- `scripts/test-nba.ts` must bracket cases 1–12 with `outboundGlobalPaused = "false"` because the pre-deploy environment has global pause = "true". Case 6 tests the pause explicitly with its own set/restore cycle.
- Save and restore `prevPause` in `main()` so the environment is clean after the test.

### Drizzle `or()` in `.where()`
- `and(or(eq(...), eq(...)))` — `or()` returns `SQL<unknown> | undefined` and causes TS2769. Use raw `sql\`... IN (...)\`` template or check nullable field with `?.sequenceId`.

### users.id type
- `users.id` is `character varying` (uuid default via `gen_random_uuid()`). Any FK referencing `users.id` must use `varchar`, not `integer`. Drizzle schema: use `text(...)` not `integer(...).references(() => users.id)`.

**Why:** Trying `integer REFERENCES users(id)` throws error code 42804 "incompatible types: integer and character varying" at migration time.

## Manager UI

- `/dashboard/nba` — `NbaPriorityPage` at `client/src/pages/dashboard/NbaPriorityPage.tsx`.
- Role-gated: admin + manager (`allowedRoles={["admin", "manager"]}`).
- Real-time via `useQuery` on `/api/nba/priority` with 60s refetch interval.
- Lazy-loaded in `App.tsx` (route added after automation-registry block).
