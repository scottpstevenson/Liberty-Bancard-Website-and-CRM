# Remove in-app provider budgets

## Decision

For the SFP, MI09 pilot, CRO03C, CRO08A recurring, and associated provider-enrichment workflows, provider dashboards and credits own monetary and credit limits. The app must not impose a dollar cap, provider credit ceiling, daily credit allotment, or pricing-snapshot prerequisite on paid execution. This does not change provider-side billing.

## Boundaries

- Remove all budget/cap/headroom displays and budget-adjustment actions from the operator UI. Keep status, provider enabled/circuit state, pause, and emergency-stop controls.
- Remove aggregate pilot and recurring dollar gates, per-run spend stop conditions, provider-local and Serper unit ceilings, ZeroBounce daily-credit claims, and budget-only preflight failures. Preserve operation idempotency, attempt receipts, historical accounting records, and safe error reporting; do not delete or rewrite production ledger rows.
- Paid-provider approvals remain explicit and revocable, but their confirmation text and UI must not describe a dollar cap. Provider enable switches, circuit breakers, emergency stop, outbound pause, and independently required legal/data/operator approvals remain authoritative.
- Keep technical limits on one request, batch size, concurrency, retries, and rate limiting. These limit accidental fan-out or overload, not aggregate monetary/credit spend.
- No paid calls or production data correction as part of the implementation. Only read-only production verification is permitted.

## Verification

Cover each provider path with tests that show an enabled, approved provider can run despite a previously exhausted or unset budget, while disabled/circuit-open/revoked states still block. Check UI for remaining budget claims and test the affected API/type surface. Confirm the development app starts cleanly.