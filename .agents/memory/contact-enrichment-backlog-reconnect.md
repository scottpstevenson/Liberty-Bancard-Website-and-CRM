---
name: Recurring backlog-enrichment selection pitfalls
description: General pitfalls for any recurring job that selects "needs work" rows via SQL and processes them through a rate/circuit-limited paid provider.
---

- Keep exactly one missing/eligibility predicate. If a SQL selection query and the per-row
  worker re-check it feeds diverge (e.g. one checks a placeholder string, the other only checks
  JS truthiness), rows the query considers eligible can be silently skipped by the worker forever.
  Extract one shared predicate/helper and use it in both places.
- A recurring selection query needs attempt/cooldown tracking, not just "oldest untouched row
  first." Without it, one row the provider can never resolve gets re-selected on every tick,
  burns quota, and starves every row behind it. Record every attempt (including a genuine
  no-result one) and exclude recently-attempted rows from the next automatic page.
- A provider call that a rate-limit/circuit-breaker gateway silently blocks returns a result
  indistinguishable in shape from a genuine "found nothing." A pre-flight check of gateway/circuit
  state is only a cheap optimization, never sufficient by itself — budget exhaustion, malformed
  control state, a rollover failure, half-open probe contention, or a trip during the request
  itself can all block a call that passed the pre-check. Have the gateway wrapper return an
  explicit "did a real provider round-trip happen" discriminator (distinct from "found data") and
  make every caller branch on that, not on emptiness of the result. Never record a blocked/failed
  call as a completed attempt — doing so falsely cools the row down and delays its real attempt
  after recovery. When a multi-step lookup blocks partway through, keep whatever the earlier,
  genuinely-completed steps found instead of discarding it, but do NOT let "found something"
  alone justify writing the cooldown attempt row — a row is still missing whatever the blocked
  step was supposed to resolve, and marking the whole attempt as done/successful would suppress
  retrying just that missing piece. Scope the cooldown decision to "every lookup this row needed
  actually completed," not to "any field got filled in."
- A gateway "is it live" status surfaced to admins must combine the enabled flag with the actual
  circuit state; enabled-alone reads as available even while an open circuit blocks every call.
- Verify a status/control table's real column names (`\d table_name`) before writing a query
  against it — a wrong column name inside a swallowed try/catch reports the gateway as
  permanently disabled/unknown with no visible error.
- A new named sub-route under a resource path (e.g. `/api/things/<name>`) must be registered
  before that resource's generic `/:id` route, or Express silently swallows it as an `:id` lookup.
