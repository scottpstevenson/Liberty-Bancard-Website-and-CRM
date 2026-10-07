---
name: Cloud browser session handling
description: Kernel profile validation, sensitive metadata handling and partial credential-fill outcomes.
---

For a fresh Kernel session without a saved profile, omit `save_profile_changes`
entirely. Explicit `false` still triggers a requirement for a profile.

**Why:** The service rejected a fresh-session create with that flag set to false;
the same create succeeded when the flag was omitted.

**How to apply:** Create isolated test browsers without loading or saving personal
profiles. Consult current service schemas before configuring profile persistence.

Filter Kernel browser metadata before logging it. Full browser responses include
credential-bearing CDP and WebDriver URLs.

**Why:** An ordinary session update returned JWT-bearing connection URLs, even
though the operation only changed network routing.

**How to apply:** Parse the response and report only the needed session identifier,
status, and user-requested live-view link. Never save raw connection responses in
certification documents or request evidence.

Retain the Kernel response before rejecting a failed credential-fill call.
Inspect only value-free status, per-field outcomes and error codes; reconcile
the page before considering a deliberate recovery.

**Why:** A fill reported an error after changing the email field, while the
password remained empty. Discarding the response lost its per-field diagnostic;
the immutable event retained only the overall failed status.

**How to apply:** Save the response in a top-level variable before checking
`isError`. Do not log sensitive fields or connection metadata, automatically
retry a partial fill, or equate a ready credential with authenticated login.

Use browser-context routing for isolated outage interception when a service worker
controls the page; confirm an actual intercepted response before asserting failure UI.

**Why:** Page-level routing did not intercept People facet reads in the configured
cloud browser, whereas context-level routing produced the observed 503 response.

**How to apply:** Keep the worker and real authentication in place. Inspect value-free
request outcomes; do not infer an injected outage from a notice timeout alone.
