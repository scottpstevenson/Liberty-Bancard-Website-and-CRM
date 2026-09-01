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

## Fix confirmed (Sep 1 2026)
The offline ceremony's `Cro03dRedactedScope` receipts import fine (`/approval-artifacts/import` verifies signature + basic shape only) but silently fail `verifiedCro03cReceipts()` inside `createCro03cActivationPolicy` — that function recomputes the real internal `cro03cApprovalScope(pricing)` shape (`{policyKey, recipeVersion, recipeHash, stagePlanHash: cro03cStagePlanHash(), migrationHead, releaseSha: process.env.RELEASE_SHA, priceSchedules}`) and hard-compares hashes. Symptom: activation-policy creation 400s with the generic `CRO03_REQUEST_FAILED` (not a `CRO03C_`-prefixed code) because the thrown error isn't one `safeError`'s allowlist regex expects.
Fix: hand-build the scope object in that exact shape (import `CRO03C_RECIPE_HASH`/`CRO03C_RECIPE_VERSION`/`CRO03C_MIGRATION_HEAD`/`cro03cStagePlanHash` from `live-execution.ts`, reuse a real previously-approved `price_schedules` row from an existing `cro03c_activation_policies` record for the pricing values), sign that as the approval payload's `scope`, then import + reference those receipt IDs.
Separate gotcha: `POST /api/cro03c/approval-artifacts/import`'s top-level `idempotencyKey` field must be byte-identical to the signed artifact's embedded `payload.idempotencyKey`, or it 409s `CRO03C_IDEMPOTENCY_CONFLICT` before ever touching the DB — mismatched-but-otherwise-valid requests fail this way.
