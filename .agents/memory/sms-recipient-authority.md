---
name: SMS recipient authority
description: Policy for deciding whether a text may go to a contact at a number; what is and is not authority.
---
Every text needs one decision from canonical consent state (per-channel permission, global suppression, PEWC evidence) for the contact's current phone, taken immediately before provider I/O in every transport, not only in the caller. Legacy consent/opt-out/lead-phone fields are compatibility outputs, never authority. Permission must be positively bound to the current number; absence of a mismatch is not consent.

**Why:** a STOP or number change can land between an early check and dispatch, and consent captured for an old or never-recorded number must not cover a different one.

**How to apply:** standing denials (STOP, unbound number, suppression) may fall back to email; quiet hours is retryable and must not switch channel. Any new SMS sender or transport must call the shared decision right before the provider request. Replies to unsolicited inbound texts now also need positive canonical permission (fail closed).
