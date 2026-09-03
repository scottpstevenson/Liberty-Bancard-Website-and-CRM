---
name: REV-05A Processor Boarding Authority
description: Fail-closed boarding lifecycle patterns, MID masking contract, and ceremony signing boundary enforced by this task.
---

## MID masking contract
Every API response that includes a deal or MID value must use `serializeDeal()` or `maskMid()`. Raw `mid` must never appear in:
- list/aggregate/detail endpoints (use `midMasked` + `hasMid`)
- audit log `details` JSON
- stat rows from `getMidDailyStatsByDeal()` — strip `mid` from each row before returning

Full MID is only returned from dedicated purpose-bound, role-authorized endpoints that also write an access receipt (`merchant_mid_access_receipts`).

**Why:** A code review caught raw MID leaking through `GET /api/contacts/:id/detail`, `GET /api/statement-reviews/:id`, `GET /api/deals/:id/mid-stats`, `POST /api/deals/:id/refresh-mid-stats`, and `GET /api/merchant/financial-overview` even after initial masking work. Audit every new route that calls `storage.getDeal()` or `getDealsByContact()`.

**How to apply:** After adding any route that touches deals, grep for `\.mid\b` in the response shape and replace with `serializeDeal()` / `maskMid()`.

## Outbox worker: AlreadyTerminalError pattern
When `handleProcessorSubmit()` writes `dead_letter` to the outbox itself (e.g. ACTIVATION_SNAPSHOT_REQUIRED), it must throw `AlreadyTerminalError` (with `alreadyHandled: true`) instead of returning normally. `tick()` checks `err?.alreadyHandled` and skips both `markDelivered` and `markRetryOrDeadLetter` to preserve the terminal state.

**Why:** A plain `return` after writing `dead_letter` allowed `tick()` to call `markDelivered()` next, overwriting the terminal state to `delivered`.

## Ambiguous POST transport classification
All transport exceptions from `boardMerchant()` in both Payarc and NMI adapters must return `ambiguous: true` — not just `AbortError`. Any network error (ECONNRESET, EPIPE, fetch failed, etc.) during a POST may mean the provider received the request.

**Why:** Blind retry on non-AbortError exceptions can create duplicate merchant applications at the processor.

## Adapter health probe snapshot gate
`getHealthState()` and `ping()` must use the snapshot-authorized URL. If no URL is provided, return `missing_contract` — do NOT fall back to the env-var base URL. Fallback sends credentials to an unapproved endpoint.

**Why:** Code review flagged Payarc `ping()` falling back to `PAYARC_API_BASE_URL` and NMI `getHealthState()` calling `ping()` against `this.apiBase`.

## Server-side auto-signing prohibition
`runStartupCeremonyArtifacts()` must NOT sign multi-party approvals from the server runtime. A private key in the running process means a single compromise self-authorizes production activation. Signing must happen offline via `scripts/cro03d-run-ceremony.ts`.

**Why:** Code review identified the collapsed approval boundary as a security concern; Phase 1 was removed from the startup ceremony.

## Canonical Pipeline MID edit
`submitDealUpdateWithReason()` in Pipeline.tsx must call `PUT /api/admin/merchants/:id/mid` when `editMid` changes — not pass `mid` through the generic deal PUT (which strips it). Clearing MID requires explicit guidance to the MID Registry page, not a silent no-op.
