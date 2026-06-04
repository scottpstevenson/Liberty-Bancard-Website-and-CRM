---
name: Login rate limiter behavior
description: Login rate limiter returns same 401 message as wrong credentials — hard to distinguish.
---

The express-rate-limit on the login endpoint returns HTTP 401 with `{"message":"Invalid email or password"}` — the same response as actual wrong credentials. This means you cannot tell from logs whether the login failed due to wrong password or exhausted rate-limit slots.

**Why:** The rate-limit config on the login endpoint uses a custom handler that mirrors the auth error format to avoid leaking rate-limit info to attackers.

**How to apply:** After multiple test login failures, restart the server (clears in-memory rate limiter) before concluding the password is wrong. Limit is 5 attempts / 15 min per IP. Use a dedicated test user account (no shared rate-limit bucket with the admin) for Playwright testing.
