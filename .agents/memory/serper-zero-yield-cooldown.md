---
name: Serper zero-yield cooldown
description: Per-merchant cooldown state machine on sdr_merchants gating Serper enrichment re-selection
---

Rule: Serper enrichment outcome recording on sdr_merchants has three classes — `no_result` (200 with no usable match: attempts+1, backoff 24h/7d/30d), `matched` (attempts=0; +7d partial-match cooldown if a target field is still missing, NULL when complete), and `provider_failure` (disabled/circuit/auth/429/timeout/5xx: records outcome+reason ONLY, never touches attempts/next_eligible/checked_at).

**Why:** 251 merchants with no website/phone were re-searched every batch forever, burning quota with zero yield; and provider outages must not consume a merchant's backoff budget.

**How to apply:** Candidate claiming uses `SELECT … FOR UPDATE SKIP LOCKED` inside `db.transaction()` (`claimSerperCandidates`), with the executor threaded into `enrichMerchantWithSerper` so its sdr_merchants writes use the same tx connection — writes from a different connection would block on the row lock and deadlock the batch. The serperGateway authority gate is rechecked before each merchant's I/O. Manual requeue (`requeueSerperForMerchant` + admin route) refuses while the gate is disabled/open. Tests: `scripts/test-serper-zero-yield-cooldown.ts` (fake fetch transport, save/restore serper_control).
