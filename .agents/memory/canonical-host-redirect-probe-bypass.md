---
name: Canonical host redirect — health probe bypass rules
description: The canonical-host redirect middleware must not redirect Cloud Run startup probes or it blocks every deploy at the promote step.
---

# Canonical host redirect — health probe bypass rules

## The rule
The middleware in `server/index.ts` that redirects non-canonical hostnames to `libertybancard.com` MUST pass through all of the following without redirecting:

1. `localhost` / `127.0.0.1` — local dev and CI scripts
2. Numeric IPv4 (regex `^\d{1,3}(\.\d{1,3}){3}$`) — Cloud Run container IPs
3. `*.replit.app`, `*.repl.co`, `*.replit.dev` — Replit infra subdomains
4. `*.run.app` — Google Cloud Run internal service URLs (e.g. `liberty-bancard-system-xxx-uc.a.run.app`)
5. Requests with **no `x-forwarded-host` header** — direct container probes that haven't been proxied through a load balancer

**Why:** Replit autoscale is Cloud Run-backed. The startup probe Host header is the internal Cloud Run service URL (`*.a.run.app`), not a Replit subdomain. If the probe gets a 301, Cloud Run marks the health check failed and the promote step fails on every deploy. The `!x-forwarded-host` rule is a belt-and-suspenders catch-all for any future probe that uses an unknown hostname.

**How to apply:** Any time the canonical-host middleware is modified, verify all 5 rules above are present before deploying.
