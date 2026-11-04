# Stage 5 — Application to MID: verdicts (partial pass)

Date: 2026-11-04. Baseline HEAD `d20e597a`. The preflight confirmed all 24 findings (S5-01…S5-24).
This pass repaired a subset. It does **not** complete Stage 5. Verdicts are reported separately and none is a production claim.

## Fixed in this pass (source + disposable-database verdict only)

| Finding | Change | Evidence |
|---|---|---|
| S5-06 | Application outbox settlement (delivered / retry / dead-letter / wait) is fenced on `status='processing'` and the claim's attempt counter. | `test-stage5-boarding-worker.ts` (stale claim cannot settle or reset a newer claim) |
| S5-07 | Underwriting engine: missing, invalid, nonfinite or contradictory evidence/rules → review (score ≤ 50). No hard-coded fallback thresholds. | `test-stage5-underwriting-evidence.ts` (27 checks) |
| S5-08 (partial) | Manual approve/reject no longer return 503 before the local decision when GHL is paused; the optional GHL task is checked after the local commit and recorded as `not_applicable`/`attempted`/`skipped_paused`. The decision + override + stage advance is still not one atomic latest-decision command. | `test-stage5-boarding-routes.ts` |
| S5-11 | Boarding payload comes only from the application (typed select; raw `SELECT *` lost every multi-word field). Contact fallback and "Unknown Business" removed. Missing required fields dead-letter with `BOARDING_PAYLOAD_INCOMPLETE` before any snapshot read or transport; audit holds field names only. | `test-stage5-boarding-worker.ts` |
| S5-12 | Typed settlement from the handler. Only "delivered" is followed by a fenced `markDelivered`. Ambiguous provider outcome is one fenced transaction (outbox dead_letter + deal ambiguous + audit) and is never marked delivered. `processorProgram` is committed with the outcome, not before I/O. | `test-stage5-boarding-worker.ts`, kill-line KL7b |
| S5-13 | Idempotency replay honoured only for the same deal/application/processor; otherwise 409. A lost insert race rolls back the deal claim (409). | `test-stage5-boarding-routes.ts` incl. 4-way barrier concurrency |
| S5-16 | Activation-snapshot host allowlist accepts the documented sandbox host `testapi.payarc.net`; foreign hosts still rejected. | routes cert (source regex check) |
| S5-19 | Bulk refresh validates, de-duplicates and caps ids (200), applies per-deal owner authorization, and replaces the 10,000-row global load with a bounded owner-scoped SQL read. | routes cert |
| S5-20 | `createMerchantMid` fills an empty `deals.mid` alias; `assignMerchantMidToCanonical` locks the deal and chooses the existing canonical row deterministically (exact match, then oldest non-closed). No one-per-deal uniqueness was added (census/policy not done). | routes cert |
| S5-21 | MID registry reads canonical `merchant_mids` (alias fallback), matches pipelines case-insensitively, and reports `total`/`returned`/`truncated`. MIDs stay masked. | routes cert |
| S5-22 | Embedded Boarding panel sends one stable Idempotency-Key per (deal, processor) and its toast no longer claims a provider application id. | routes cert (source check). No browser journey was run. |

## Not done (deferred, still open)

S5-01, S5-02, S5-03, S5-04, S5-05, S5-08 (atomic latest-decision command), S5-09, S5-10, S5-14, S5-15, S5-17, S5-18, S5-23, S5-24.

## Verdicts by layer

- **Source:** the items above are changed in the working tree. Not committed manually; no publish.
- **Fixture (disposable DB, real handlers, fake transport):** PASS for the three Stage 5 suites (`stage5-boarding-worker`, `stage5-underwriting-evidence`, `stage5-boarding-routes`). They use the provider-deny boundary; no provider was contacted.
- **UI:** NOT VERIFIED. Only `BoardingPanel.tsx` changed; no rebuilt browser journey (roles, 1280/768/390, light/dark) was run.
- **Native / production:** NOT RUN. No production write, snapshot, boarding, e-sign, backfill or publish. See `native-packet.md` (prepared, not executed).
- **Release:** not published. Publish is the owner's step.

## Baseline failure noted

`scripts/test-merchant-application-security.ts` still fails one assertion, "workflow_enroll propagates missing ghlContactId". It checks a message in `merchant-application-outbox-worker.ts` that this pass did not touch for that purpose. A second assertion in that file (deal_id linkage) was updated to match the typed select.
