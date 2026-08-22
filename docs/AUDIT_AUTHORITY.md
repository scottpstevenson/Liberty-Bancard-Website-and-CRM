# Audit Authority Boundaries

## Purpose

This document defines which data paths are authoritative for operational,
commercial, outbound, and release decisions. It is a change-control reference:
new code must extend the existing authority rather than recreate its own
heuristics or silent fallback.

## Commercial classification

- `commercial-classification-authority` is the only authority for changing or
  authorizing a root record's commercial class.
- `production` requires immutable, non-PII evidence and independent approval.
  `unknown`, `test`, `demo`, and `synthetic` records are not commercial truth.
- Commercial reporting, payouts, and marketing outreach require `production`.
  Transactional responses may serve a classified production contact or a newly
  created unknown contact only where the transport has a trusted, explicit
  transactional path.
- `internal_test` is a test-harness purpose, not a production bypass. It is
  denied outside `NODE_ENV=test`.
- The portfolio is an **operational work queue**, not a commercial KPI. It
  intentionally retains assigned contacts of every class so agents can resolve
  data-quality and onboarding work. KPI and executive reporting must use the
  production-class filters instead.

## Outbound authority

- `OutboundPauseAuthority` is the sole source of truth for global/channel
  outbound permission. Every provider boundary must authorize and recheck its
  epoch immediately before I/O.
- `Contactability` and commercial authorization are separate required gates:
  passing one never implies permission from the other.
- Test runs must use provider-denial controls. A test must never "pass" because
  a live provider was unavailable or because a send was silently skipped.

## Test and cleanup authority

- Stateful tests and destructive cleanup tools must call
  `test-infrastructure-guard` before importing any application DB/service
  module. It proves `DATABASE_URL` equals `TEST_DATABASE_URL`, verifies
  `current_database()`, rejects production-looking names, and requires a Redis
  test prefix when Redis is involved.
- A disposable environment is a prerequisite, not an optional warning. Cleanup
  scripts must target explicit test identifiers even after the environment
  check succeeds.

## Release and migration authority

- `ci-suite-manifest` is the CI inventory. Required static, integration, and
  server-required suites run through the manifest runner; server-optional
  provider suites are explicitly excluded from automated CI.
- The production pre-deploy gate is separate because it owns release pause and
  audit state. CI must not invoke it.
- The migration journal and root SQL files are checked by
  `check-migration-integrity`. Existing journaled migration files are immutable:
  any schema correction is an additive migration, never an edit to history.

## Change review checklist

Before approving a new route, worker, transport, metric, test, or migration:

1. Identify its authority boundary and call it directly.
2. Confirm an unknown/non-production record cannot reach a commercial metric,
   payout, or marketing send.
3. Confirm stateful verification is disposable and provider-denied.
4. Add a focused regression check that fails closed if the authority call is
   removed.