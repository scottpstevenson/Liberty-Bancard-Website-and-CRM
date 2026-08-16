# Replit Runtime Verification Follow-Up

Use this after reviewing `LIBERTY_BANCARD_RUNTIME_EVIDENCE_RECONCILIATION_2026-08-16.md` and the updated `LIBERTY_BANCARD_RUNTIME_VERIFICATION_REGISTER.md`.

## Copy-ready instruction

Perform a READ-ONLY correction and completion pass for the runtime evidence packet. Do not implement fixes in this pass.

Do not deploy, restart, migrate, enqueue, backfill, modify configuration, change secrets, change database or Redis state, start a ZeroBounce campaign, run bulk GHL reconciliation, lift any pause, or call a real outbound provider. Never print secrets or sensitive values.

The prior packet must be corrected as follows:

1. Do not mark `RV-1548-07` passed because the intent table is empty. Mark it partial/inconclusive until intents flow and isolated recovery convergence passes.
2. For `RV-ZB-01`, identify the actual ZeroBounce campaign queue/job handler, owner and heartbeat. The general post-enrichment heartbeat is not sufficient. Report only whether `ZEROBOUNCE_API_KEY` is present, never its value.
3. For `RV-DAT-04`, retain the zero-value aggregate as partial evidence only; separately report whether encryption/version metadata and access restrictions exist. Do not display field values.
4. For `RV-ENR-01`, collect last start/success/failure/completion and correct BullMQ queue-depth metrics in addition to heartbeats/progress.
5. For `RV-ENR-02`, read the actual `serper_usage` properties: `totalCalls`, `successfulCalls`, `failedCalls`, `websitesFound`, `emailsFound`, `phonesFound`, `lastCallAt`, `monthlyQuota`, and `remainingCalls`. The prior `successCalls`/`failureCalls` names were wrong. A changing `totalCalls` is not a successful-call signal.
6. For `RV-ENR-06`, query `contacts.data_readiness_score`, `data_readiness_grade`, `readiness_updated_at`, and `readiness_model_version`; the prior `readiness_score` query used the wrong column.
7. For `RV-ENR-07`, report null, zero, nonzero, score ranges and model/freshness evidence by approved cohort. `lead_score` defaults to zero, and `contacts.updated_at` does not prove scoring freshness.
8. Execute the omitted safe read-only checks for `RV-DAT-03` provenance and `RV-REV-02` chargeback/residual reconciliation.
9. For `RV-DAT-02`/`DAT-11`, add normalized phone duplicate groups segmented by phone type and likely shared-business endpoints. Do not recommend automatic merges.
10. For `RV-1548-06`, enumerate BullMQ repeatable jobs through the application/BullMQ API so job name, queue, cadence and repeat options are visible. Do not infer a job name from a Redis hash.
11. For stale `enrollment-recovery`, `winback-outreach`, and `db-backup` heartbeats, report configured cadence, expected next run, enabled/paused/dormant state, last start/success/failure/completion, repeat registration and active owner. Do not call a heartbeat stale until it exceeds 2× expected cadence without an intentional state.
12. For GHL, produce a sanitized 24-hour error matrix by operation, HTTP status, normalized error code, entity type, retryability and count. Confirm credential validity only through an existing read-only validation path. Do not start or expand sync.

Also complete every still-safe read-only check that was previously omitted. Keep checks requiring mutations in an isolated DB/Redis namespace with fake transports; if that environment does not exist, leave them `INCONCLUSIVE`.

Return one corrected report with, for every RV ID:

| Field | Required value |
|---|---|
| RV ID | Exact register identifier |
| Verdict | `PASS`, `FAIL`, `PARTIAL`, or `INCONCLUSIVE` |
| Timestamp/environment | Current and explicit |
| Process/deployment SHA | Full SHA or `UNIDENTIFIED` |
| Method | Sanitized read-only query, endpoint, log, dashboard or isolated fake test |
| Observed result | Actual counts and ages |
| Pass-criteria comparison | Each criterion separately satisfied or missing |
| Residual uncertainty | Explicit |
| Required action | Verification, build task, or none |

Do not collapse partial evidence into `PASS`. Do not declare any ledger finding `CLOSED_RUNTIME`.

Save the result as `LIBERTY_BANCARD_RUNTIME_EVIDENCE_PACKET_CORRECTED_2026-08-16.md`.
