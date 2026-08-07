---
name: Canonical host redirect — removed; use CDN layer instead
description: Application-layer canonical-host redirects (301 → custom domain) cannot coexist with Replit autoscale health probes. Remove from Express; enforce at CDN/DNS.
---

# Canonical host redirect — removed; use CDN layer instead

## The rule
**Do NOT add a canonical-host redirect middleware to the Express server for Replit autoscale deployments.**

The middleware was removed from `server/index.ts` after causing 5 consecutive deploy failures (Aug 7 2026). It must not be re-added without a guaranteed probe bypass.

## Why it breaks deploys
Replit autoscale is Cloud Run-backed. Cloud Run's startup health probe sends `GET /` with an internal service hostname (`<service>-<hash>-uc.a.run.app`) as the Host header — neither a Replit subdomain nor a numeric IP. Any Express middleware that 301-redirects non-canonical hosts will intercept this probe, return 301 instead of 200, and cause the promote step to time out after 3 minutes on every single deploy.

Adding allowlist entries for known patterns (IPv4, `*.replit.app`, `*.run.app`) was insufficient because Replit's standby build cache served pre-fix images even after code changes, and the exact probe hostname format is opaque.

## Correct approach
Canonical host enforcement (redirecting `*.replit.app` → `libertybancard.com`) belongs at the CDN/DNS layer:
- Replit custom-domain redirect rules
- Cloudflare Page Rules / Redirect Rules
- A CDN-level 301 before traffic ever hits the container

## If it must live in the app
The only safe pattern: check `req.headers["accept"]?.includes("text/html")` AND `req.headers["x-forwarded-host"]` is present before redirecting. Health probes send neither a browser Accept header nor an x-forwarded-host. Even this is fragile — prefer the CDN approach.
