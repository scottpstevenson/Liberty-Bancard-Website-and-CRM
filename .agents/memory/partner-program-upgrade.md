---
name: Partner program upgrade decisions
description: Commercial-approval gating and application/credential/consent rules for the two-path partner program (referral partner / sales agent).
---

- Referral percentage is never static content or in the client bundle. It reaches pages only through the server projection of an admin-approved policy version; absent approval the default is "confirmed in your written agreement". Test fixture rates live only in tests.
- Referral 25% / strategic 30% stayed proposals; only the owner's recorded approval may turn a numeric referral variant on. Agent 50% is worded only for qualifying self-sourced full-cycle business.
- An application is a reviewed request: no credential, no session, no agent role, no commission (explicit null, not the legacy column default of 10). Acceptance is not marketing consent; the `partner_approved` sequence hook fails closed without the application's marketing opt-in.
- Credential eligibility is application-aware and shared: an application that is not accepted can never obtain a login, password reset or invitation, even if the applicant controls the mailbox or a hash exists; legacy credentialed partners keep login/reset. Any new route that issues, consumes or honors a partner credential must use the shared eligibility check, not just a status check on invitations.
- Introductions are their own durable rows keyed (partner, idempotency key), not inbound-request envelopes; permission is introducer evidence only; partners never see contact details; a second partner introducing the same business goes to competing-referrer review.

**Why:** the owner's brief forbids inventing commercial approval and treats unapproved percentages, or any pre-approval access, as release blockers. A completion review found the legacy password-reset flow issued tokens for any partner row, bypassing the reviewed-application boundary.
**How to apply:** touching partner copy, calculator, intake, approval, login or reset code; scan the built bundle semantically (not a global numeric ban) and re-check the written-agreement default.
