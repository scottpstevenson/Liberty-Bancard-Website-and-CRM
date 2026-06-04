---
name: Playwright test user
description: Dedicated test user exists in DB for Playwright testing; avoids admin rate-limiter and 2FA.
---

A dedicated test user was seeded for Playwright end-to-end tests:
- Email: `playwright-test@libertybancard.internal`
- Password: `PlaywrightTest2024!`
- Role: admin
- No 2FA enrolled
- Created via `scripts/create-test-user.ts`

**Why:** Using the admin account (`scott@libertybancard.com`) for Playwright hits the login rate limiter (5 per 15 min) across multiple parallel test batches. The test user has a stable, known password unaffected by `seedAdminUser` restarts.

**How to apply:** Always use this test user for Playwright test plans. Use `[API] POST /api/auth/login` as the first step to establish a session cookie, then navigate the browser using that cookie. This avoids the rate limiter and 2FA prompts.
