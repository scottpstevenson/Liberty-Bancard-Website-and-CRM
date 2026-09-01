---
name: CRO03D ceremony CLI scope shape mismatch
description: scripts/cro03d-ceremony.ts produces a scope shape the real activation-policy verifier rejects
---
`scripts/cro03d-ceremony.ts` (`deriveCro03dScope()` / `Cro03dRedactedScope`) builds approval-payload
scopes shaped like `{ releaseSha, releaseTree, migrationHead, recipeStagePlanHash, rolloutKey,
providersInScope, cohortCap, canaryCapPerProvider, maxSpendMicros, currency, derivedAt }`.

The real verifier, `cro03cApprovalScope()` in `server/services/cro03/live-execution.ts`
(private, not exported), expects a totally different shape: `{ policyKey: "cro03c_live_activation",
recipeVersion, recipeHash, stagePlanHash (via the exported `cro03cStagePlanHash()`, a DIFFERENT
hash than the ceremony tool's `recipeStagePlanHash`), migrationHead, releaseSha, priceSchedules }`.
`createCro03cActivationPolicy()` pulls `pricing` out of `receipt.scope.priceSchedules` — the
ceremony-tool shape has no such field, so a receipt built via the CLI's `scope`/`prepare`/`sign`
flow either fails price-schedule assertions or silently produces a scope hash that never matches
what `assertCro03cAuthorityBeforeIo`/`assertCro03cCommandAuthorityBeforeIo` recompute live.

**Why:** the ceremony CLI was written as a generic redacted-scope/signing utility before the
approval-scope contract in live-execution.ts was finalized; nobody reconciled the two shapes.

**How to apply:** never use `scripts/cro03d-ceremony.ts scope/prepare` output directly for real
CRO03C approval artifacts. Instead build the scope object by hand to match `cro03cApprovalScope()`
field-for-field (call the exported `CRO03C_RECIPE_VERSION`, `CRO03C_RECIPE_HASH`,
`CRO03C_MIGRATION_HEAD`, `cro03cStagePlanHash()` constants directly, plus the actual owner-approved
`priceSchedules` per provider), then sign that object's payload with `signApprovalPayload()` /
raw ed25519 using the ceremony's still-useful `keygen`/`dispose-key` commands for key lifecycle.
Sanity-check recipeHash/stagePlanHash/migrationHead against the currently active/prior receipt's
stored `scope` column before importing, to catch any other silent drift.
