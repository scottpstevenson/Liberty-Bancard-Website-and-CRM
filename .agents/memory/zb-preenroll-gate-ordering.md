---
name: ZeroBounce pre-enrollment gate ordering
description: ZB pre-enrollment fires BEFORE all contactability and business-logic gates in the sequence worker; test contacts that use emailStatus="active" get intercepted by ZB before the gate under test is reached.
---

## Rule

Any sequence-worker test case that expects a specific audit log action
(e.g. `sequence_enrollment_blocked_contactability`,
`sequence_step_deferred_daily_cap`,
`sequence_send_blocked_no_mailing_address`) must create the test contact
with `emailStatus: "valid"`.

## Why

The sequence worker runs a ZeroBounce pre-enrollment check at **step 0**
before Gate (a) (contactability) and before the daily-cap / mailing-address
gates.  The check fires when:
```
emailStatus is null || emailStatus === "active" || emailStatus === "unvalidated"
```
`makeContact()` defaults to `emailStatus: "active"`.  For fake @test.internal
addresses ZeroBounce may return invalid/undeliverable, pausing the enrollment
with `sequence_enrollment_blocked_zb_invalid` before the intended gate runs.
Even if ZB returns "valid", the ZB credit path consumes state that can hide
the real gate under test.

`emailStatus: "valid"` sets `needsZbValidation = false` → the ZB block is
skipped entirely → the first gate actually reached is the one the test covers.

## How to apply

In every `makeContact()` call inside a sequence-worker test case that
verifies a specific audit action, add `emailStatus: "valid"` to the
overrides object unless the test is specifically about the ZB gate itself.

Affected cases confirmed fixed:
- Case 14 (`sequence_enrollment_blocked_contactability`)
- Case 23 (`sequence_send_blocked_no_mailing_address`)
- Case 29 (`sequence_step_deferred_daily_cap`)
- Case 34B (`sequence_step_deferred_daily_cap`)
