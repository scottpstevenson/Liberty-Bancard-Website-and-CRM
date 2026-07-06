---
name: Call follow-up SMS/email test isolation
description: /api/call-follow-ups/send silently couples SMS/email sending to sequence enrollment; test outcomes carefully.
---

`POST /api/call-follow-ups/send` (server/routes/activity.ts) does more than send SMS/email: if the chosen `outcome`
is a key in `OUTCOME_TO_SEQUENCE` (e.g. "Connected - Send Review Summary" -> "Post-Call Review Follow-Up") and
`sendEmail || sendSms` is true, it also attempts to enroll the contact into that sequence as a side effect.

**Why this matters:** sequences default to `paused` (see sequence-control-policy.md), and enrollment into a paused
sequence throws. That throw is not caught defensively in the send route, so the *entire* request 500s — the caller
never gets back the truthful `smsResult`/`emailResult` enum for the send itself, even though the SMS/email gating
logic worked correctly.

**How to apply:** when writing tests (or any caller) against this endpoint, either pick an `outcome` with no
`OUTCOME_TO_SEQUENCE` mapping (e.g. "Connected - Not a Fit", "Closed Won", "Closed Lost") to avoid the side effect
entirely, or expect/handle the enrollment failure separately from the send result. The durable fix is to decouple
enrollment from the send route so an enrollment failure never masks the send's truthful result.
