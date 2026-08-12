---
name: Appointment-to-Statement test polling fix
description: Why the pre-deploy Appointment-to-Statement suite flapped and how it was fixed
---

## The rule
`scripts/test-appointment-statement.ts` positive assertions must use `pollUntil()` (up to 12s), not a fixed setTimeout wait, to be resilient to GHL rate-limit waits inside `createTestContactWithLead()`.

## Why
`createTestContactWithLead()` triggers a GHL sync which bootstraps SDR custom fields. This bootstrap can hit GHL's rate limiter and wait 10–60s. During that wait, the `handleCallOutcome` fire-and-forget lifecycle transitions still complete at the DB level — but the old 2s fixed wait would expire before the assertion could observe them.

## How to apply
- Positive checks (expecting a change): use `pollUntil()` with `timeoutMs: 12_000`
- Negative checks (expecting NO change): use a fixed `await new Promise(r => setTimeout(r, 2500))` so the test still has a defined wait before asserting "nothing changed"

## Root infrastructure note
The app runs 24 Redis connections against an Upstash free tier capped at 20. This causes periodic `connect ETIMEDOUT` errors on BullMQ workers. This is a secondary contributor to flaps — the polling fix handles it without requiring an infra change, but upgrading to Upstash Pay-As-You-Go would eliminate the ETIMEDOUT noise entirely.
