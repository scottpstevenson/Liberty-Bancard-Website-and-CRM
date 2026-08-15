---
name: ZeroBounce durable campaign engine
description: Durable invariants of the email-validation campaign model
---
- Per-contact claim is a unique (campaign, contact) attempt row inserted atomically; the attempts table — never denormalized counters — is the source of truth for accounting.
- **Crash-window rule:** record the credit reservation before calling the provider. On recovery, pending attempts with no reservation are released for retry; pending attempts with a reservation are finalized as retryable failures and never re-charged within the campaign. **Why:** local reservation ≠ confirmed provider billing; ambiguity must resolve toward "never double-charge".
- A campaign may only auto-complete when zero eligible contacts remain AND zero pending attempts exist.
- Admin cancel abandons the whole campaign (even via a terminal run's ID), so the next batch start builds a fresh campaign from its own filter — otherwise the singleton active campaign traps admins in a stale cohort.
- Stale-run interruption + pending reconciliation must be invoked at every entry point (start route, read routes, worker start), not just one.
- Campaign tracker card (DataQuality) derives UI state client-side from latestRun.state + counts; poll (10s) is gated on latestRun.state === 'running' only — never poll with no campaign or terminal run. remainingEligible===0 && pending===0 overrides run state as "completed".
