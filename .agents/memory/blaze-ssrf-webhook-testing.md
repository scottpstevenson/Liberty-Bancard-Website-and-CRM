---
name: SSRF-safe outbound webhook testing pattern
description: How to safely implement a "test connection" endpoint that makes a server-side request to a user-configured URL, without introducing SSRF.
---

Any endpoint that lets a user configure a URL (webhook, callback, integration
endpoint) and then has the server make a request to it is a classic SSRF
vector — even a harmless-looking non-mutating "test connection" button.

**Required controls, all three together:**
1. **Role-gate both the setter and the tester.** Restrict the endpoint that
   saves the URL and the endpoint that probes it to privileged roles
   (admin/manager), not just "any authenticated user." A low-privilege
   authenticated user should not be able to make the server issue arbitrary
   outbound requests.
2. **Resolve DNS yourself and check the resolved IP**, not just the
   hostname string. Block loopback, RFC1918 private ranges, link-local
   (including the `169.254.169.254` cloud metadata address), IPv6
   loopback/link-local/unique-local, and non-http(s) schemes. Checking only
   the literal hostname is bypassable via DNS rebinding.
3. **Don't follow redirects blindly** — set `redirect: "manual"` (or
   equivalent) on the outbound probe so a 3xx response can't be used to
   pivot to a blocked target after the initial URL passed the check.

**Why:** a "test connection" feature that unconditionally does a raw
`fetch(userSuppliedUrl)` is a server-side request forgery primitive even
when it only ever sends a HEAD request and never a real payload — the SSRF
risk lives in "who can trigger a request to an arbitrary internal target,"
not in what the request body contains.

**How to apply:** any new integration/webhook "test" or "verify" button;
any endpoint accepting a URL that the backend will later fetch.
