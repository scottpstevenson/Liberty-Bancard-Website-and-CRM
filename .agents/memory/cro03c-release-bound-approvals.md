---
name: CRO03C approvals are release-SHA-bound
description: any deploy invalidates all existing CRO03C activation approvals; must re-sign
---
`cro03cApprovalScope()` embeds `releaseSha: process.env.RELEASE_SHA` at the moment it's called, and
both `assertCro03cAuthorityBeforeIo` and `assertCro03cCommandAuthorityBeforeIo` recompute
`expectedScopeHash = stableCro03RecipeHash(cro03cApprovalScope(authority.price_schedules))` FRESH
against the *live* `process.env.RELEASE_SHA` on every I/O boundary check — they do not trust the
scope stored on the approval receipt/policy row.

**Why:** this is intentional defense-in-depth so a certified/approved activation can never survive
a silent code swap — but it also means a legitimate bugfix deploy immediately and silently
invalidates every existing CRO03C approval receipt and the activation policy revision built from
them (they'll fail with `CRO03C_AUTHORITY_REVOKED` / `CRO03C_RELEASE_MISMATCH` on the next command).

**How to apply:** after ANY deploy that changes `RELEASE_SHA` while a CRO03C activation ceremony is
in flight, always: (1) confirm production's new `RELEASE_SHA` via `/api/health`, (2) rebuild and
re-sign all 4 approval-dimension receipts with that new `releaseSha` in the exact
`cro03cApprovalScope()` shape (see cro03d-ceremony-scope-mismatch.md), (3) import them via
`/api/cro03c/approval-artifacts/import`, (4) create a new activation-policy revision referencing
the new receipt IDs via `/api/cro03c/activation-policies` (requires the `confirm: "ACTIVATE CRO03C
LIVE POLICY"` literal and `expectedRevision` = current revision) before retrying any live command.
