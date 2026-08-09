---
name: Arbitration fail-closed
description: The communication arbitration catch block returns suppressed=true on error to prevent compliance bypass.
---

## Rule
`checkCommunicationArbitration()` in `server/services/communication-arbitration.ts` now fails **CLOSED** — any exception (DB timeout, Redis error, etc.) returns `{ suppressed: true, signal: "arbitration_error" }` and writes an `ARBITRATION_ERROR` audit log. It must never fail-open again.

## Why
A broken check silently disabling the compliance gate is worse than a blocked send. Merchants cannot receive unwanted messages just because the arbitration DB query timed out.

## How to apply
- When adding try/catch blocks to any compliance gate: default to fail-closed, not fail-open.
- The catch block also calls `storage.createAuditLog({ action: "ARBITRATION_ERROR" })` so ops can diagnose without log trawling.
- Task #1415 tracks the missing automated test for this behavior.

## Location
`server/services/communication-arbitration.ts`, catch block after line ~380 (look for `signal: "arbitration_error"`).
