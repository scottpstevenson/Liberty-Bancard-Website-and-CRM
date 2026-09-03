---
name: Processor boarding authority pattern
description: REV-05A design decisions for the activation snapshot gate, MID masking, and adapter held-return contract.
---

## Activation snapshot gate (requireConfirmedActivationSnapshot)

The gate evaluates **only the latest snapshot** (LIMIT 1, ordered by createdAt DESC). A newer `expired_or_drifted` or `held` snapshot supersedes any older `owner_confirmed` row — there is no fallback to historical rows.

Before returning, the gate also verifies:
- `productionEntitlement` must be true when `NODE_ENV=production`; at least one entitlement must be true otherwise.
- `supportedOperations` must include `"board_merchant"`.
- `authorizedBaseUrl` must be non-null — the adapter uses this URL, not the env-configured default.

**Why:** An incomplete or revoked snapshot must not silently re-allow production I/O via a historical qualifying row.

**How to apply:** Any new transport gate that reads `processor_activation_snapshots` must use the latest-row pattern, check the three additional constraints, and pass `snapshotAuthorizedBaseUrl` to the adapter.

## Program-aware routing

`boardMerchant(profile)` reads `profile.processorProgram` (set from the snapshot by the outbox worker) and `profile.snapshotAuthorizedBaseUrl`. Traditional → `/applicants`; Payfac → `/agent-hub/apply/add-lead/`. Transport must remain paused for Payfac until Liberty's contracted program is owner-confirmed in the snapshot.

## MID masking contract

Every list, create, update, and boarding-status response returns `midMasked` (last-4 asterisks) + `hasMid: boolean` instead of the raw value. The only endpoint that may return a full MID is a dedicated, purpose-bound, role-authorized route that **awaits** a `writeMidAccessReceipt()` call before sending the response.

Affected routes: `GET /api/admin/mids`, `POST /api/admin/mids`, `PATCH /api/admin/mids/:id`, `GET /api/merchants/:contactId/mids`, `PATCH /api/merchant-mids/:id`, `PUT /api/admin/merchants/:id/mid`, `GET /api/deals/:id/boarding-status`, `GET /api/boarding/submissions`, `GET /api/boarding/mid-registry`, `GET /api/mid-stats/*`.

## #1737-domain adapter contract

`getTransactions`, `getResiduals`, `getDailyStats`, `submitChargeback` must return `HeldResult` (`{ status: "held", reason: "pending_task_1737" }`) in ALL adapters (Payarc, NMI, Mock). The CI kill-line script (`scripts/check-processor-kill-lines.ts`) checks all three adapters. Simulation data generation in getDailyStats is a kill-line violation.
