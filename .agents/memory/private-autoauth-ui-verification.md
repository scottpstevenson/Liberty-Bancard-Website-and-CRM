---
name: Private auto-auth UI verification
description: Verify isolated authenticated UI fixtures without exposing their session-injecting proxy.
---

Keep any fixture proxy that injects an authenticated admin session bound to loopback. Use a one-off private process and an app-preview screenshot with its explicit port.

**Why:** Workflow port detection expects a externally reachable bind. A healthy loopback fixture can therefore report a port-start failure; changing it to bind publicly would expose the proxy's automatic fixture-admin authority.

**How to apply:** Confirm the fixture is serving locally, screenshot its explicit loopback port, and stop it afterward. Do not weaken the bind merely to satisfy workflow readiness; external preview needs separate authentication.