---
name: pre-deploy wrapper and the running dev app
description: How the pre-deploy launcher coexists with the Start application workflow on port 5000, and why its SHA check stays.
---

The dev app (`Start application`) holds port 5000 and is not started with RELEASE_SHA, so its /api/health reports `sha":"unset"`. The pre-deploy wrapper used to refuse an occupied port (or, in a race, compared the dev app's `unset` against RELEASE_SHA and failed with "SHA mismatch").

The wrapper now keeps the default port 5000 only when it is free; if the default is taken and the caller did not set BASE_URL, it starts its own server on the first free port in 5100-5199, exports BASE_URL to pre-deploy.ts and all suites, and never signals the dev app. An explicitly set BASE_URL that is occupied is still refused.

**Why:** the SHA check is what stops the gate from running its suites against a process that is not the zero-egress test server; removing it would let a dev app (live provider transports, NODE_ENV=development) answer instead. The user suggested removing it; the cause was the shared port, so the port was fixed and the check kept.

**How to apply:** a "SHA mismatch" or "port already owned" from the wrapper now means a real second process on an explicitly chosen port, not the normal dev app. The wrapper's own server startup still runs migrations/seeds against the configured database, as before.
