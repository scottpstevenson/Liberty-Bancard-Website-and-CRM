---
name: CAN-SPAM Footer Injection
description: Lessons from adding HMAC unsubscribe tokens, sequence worker gate, and DB column to contacts
---

## Key patterns

**Token secret sharing between test process and server:**
`getUnsubscribeTokenSecret()` uses `UNSUBSCRIBE_TOKEN_SECRET → SESSION_SECRET → test-hardcoded`. However, test scripts and the running server use different process environments — HMAC tokens generated in the test process will NOT verify against the server's endpoint because the secrets diverge. Never write HTTP-based tests for token verification that depend on the test process sharing a secret with the running server. Instead: use direct storage/module calls in-process.

**`db.select({ field: table.field })` crashes with undefined fields:**
Drizzle's partial-select syntax `db.select({ x: table.x, ... })` throws "Cannot convert undefined or null to object" if ANY column reference is undefined (e.g., field not yet in the schema). Use `db.select()` (all columns) and destructure the result row instead.

**Schema column vs DB column mismatch:**
Adding a column to `shared/schema.ts` does NOT add it to the DB; adding it to the DB with `ALTER TABLE` does NOT make Drizzle aware of it. BOTH are required together: update the Drizzle table definition in `shared/schema.ts` AND run the migration. If only the migration runs, Drizzle ignores the field in `set()` calls (UPDATE silently skips it). `optedOutEmail` was missing from the `contacts` table definition (lines 10–114 of schema.ts) even though it existed elsewhere in the schema file for a different table.

**`enrollContactInGhlWorkflow` fail-closed on channels:**
When `outboundChannels` is omitted, the function checks ALL channels (email + sms + voice_ai + ringless_vm). A `warm_no_pewc` contact fails the SMS check → returns `method: "skipped"` → worker pauses enrollment before any custom gate. Cold-outreach sequence tests MUST set `triggerConfig: { outboundChannels: ["email"] }` to prevent the SMS gate from short-circuiting the flow.

**Worker `if (blockReason && !testMode)` guard:**
Any audit-log write / enrollment-pause inside `if (blockReason && !testMode)` is silently skipped in TEST_MODE. To make the gate testable, remove `!testMode` from the outer pause/log block; keep `!testMode` only inside the specific sub-check (e.g., missing token secret) where skipping in test mode is intentional.

**Why:**
All four lessons required >2 debugging iterations to isolate and fix; they are non-obvious from reading the code.
