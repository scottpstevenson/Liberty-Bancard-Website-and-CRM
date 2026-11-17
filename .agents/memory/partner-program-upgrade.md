---
name: Partner program upgrade decisions
description: Commercial-approval gating and application/credential/consent rules for the two-path partner program (referral partner / sales agent).
---

- Referral percentage is never static content or in the client bundle. It reaches pages only through the server projection of an admin-approved policy version; absent approval the default is "confirmed in your written agreement". Referral 25% / strategic 30% stayed proposals until the owner records approval. Agent 50% is worded only for qualifying self-sourced full-cycle business.
- An application is a reviewed request: no credential, session, agent role or commission (explicit null, not the legacy column default). Acceptance is not marketing consent.
- Credential eligibility is application-aware and shared: an application that is not accepted can never obtain a login, password reset or invitation; legacy credentialed partners keep login/reset. Any route that issues, consumes or honors a partner credential must use that shared check.
- A partner-session route is unreachable unless the central partner allowlist in the main route registration also names it; a route-level auth check alone does not make it reachable. Prove new partner routes with a real partner session, not only role-denial cases.
- In-site partner links must go through the shared attribution helper; plain `<Link>`/`href` to a partner route silently drops ref/UTM. Prove attribution by real clicks in a browser, not by reading link props.
- Partner funnel analytics are inert when the build carries no measurement id (the id is inlined at build time, so it cannot be injected at runtime in tests). Report consent-granted events as not exercised rather than passed.
- Only `/affiliate` is server-rendered; the `/partners*` pages are client-rendered, so raw HTML has the default title and no h1. The public perf harness waits only 4 s and marks every client-rendered page INVALID (base and current alike); a longer-wait copy measured both fine. Do not count missing LCP as zero.
- Production `/partner-login` has pre-existing a11y/tap-target findings unrelated to this program.

**Why:** the owner's brief treats unapproved percentages and any pre-approval access as release blockers, and partner sessions are walled off from the CRM by that central allowlist.
**How to apply:** touching partner copy, calculator, intake, approval, login/reset or any new partner-session route.
