---
name: Serper aggregate-only usage tracking
description: serper_control's single aggregate row cannot answer "which feature/day used credits"; serper_call_log fills that gap
---
- `serper_control` (id=1) tracks only the current monthly billing-window aggregate (window_calls/successes/failures, reset on rollover) plus lifetime totals. It cannot answer "how many calls came from which call site, on which day" — there was no historical or per-caller breakdown at all before Task #2003.
- A separate, older `system_settings.serper_usage` JSON key exists from an earlier tracking mechanism; it stopped being written to and is stale — do not use it as a usage source.
- Fix: `serper_call_log` table (one row per `SerperGateway.executeSearch()` attempt: call_site, endpoint, outcome, block_reason, http_status, error_text, created_at), written best-effort inside the gateway (a logging failure must never affect the search result). `GET /api/admin/serper/usage-log?days=N` aggregates it by day, by call_site, and by block_reason.
- **Why:** an admin asked where ~45k/50k monthly Serper credits went and what the success rate was; the only source (serper_control) could give a current-window total but not a breakdown, and the question couldn't be answered precisely.
- **How to apply:** for any other provider with a similar single-aggregate-counter gateway pattern (ZeroBounce, Outscraper, Apollo), consider whether the same per-call log gap exists before assuming usage questions can be answered from the aggregate row alone.
