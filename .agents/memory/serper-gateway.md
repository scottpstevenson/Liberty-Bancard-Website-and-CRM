---
name: Serper canonical gateway
description: SerperGateway is the only approved Serper API path; durable circuit breaker in serper_control singleton.
---

- `server/services/serper-gateway.ts` is the ONLY file allowed to reference google.serper.dev; `scripts/scan-serper-raw-fetch.ts` enforces this in pre-deploy (build URL patterns from string pieces in tests/scanner to avoid self-matching).
- `serper_control` (id=1 singleton): kill switch (`enabled`, deployed **false** — an admin must enable it before any Serper call works), circuit state closed/open/half_open, window + lifetime counters, local_budget. All mutations are single atomic UPDATEs.
- **Why fail-closed:** missing/malformed/unreadable control row blocks calls; prior JSON read-modify-write tracking lost state on restart and raced across processes.
- Classification: 401/403 + confirmed 429-quota open immediately; timeout/5xx count toward threshold (20); 400 validation errors never advance the circuit; 200 zero results is a success.
- Monthly rollover: quota-open → half_open (one probe), auth-open stays open; lifetime counters never reset.
- **Gotcha:** optimistic-guard equality on timestamptz vs a JS Date param fails due to microsecond precision — compare with `date_trunc('milliseconds', col) = date_trunc('milliseconds', $1::timestamptz)`.
- Tests: `scripts/test-serper-gateway.ts` (fake fetchOverride + poolOverride injection, saves/restores the live control row). Admin recovery: POST /api/admin/serper/recovery (reason required, audited, one bounded probe).
