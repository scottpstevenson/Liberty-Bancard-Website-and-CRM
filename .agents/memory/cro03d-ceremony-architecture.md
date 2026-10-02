---
name: CRO-03D ceremony architecture
description: Full dependency chain and failure modes for the CRO-03D approval ceremony — what must exist before what, and what can only run inside the production server.
---

# CRO-03D Ceremony Architecture

## Dependency chain (must complete in order)

1. **Approval artifacts** (4 dimensions: operator/data/finance/legal)
   - Signed with Ed25519 key registered in `CRO03C_TRUSTED_APPROVAL_ISSUERS`
   - Can be created and imported from outside via HTTP (`POST /api/cro03c/approval-artifacts/import`)
   - Idempotency key in the artifact payload MUST equal the `idempotencyKey` field sent to the import endpoint
   - `reason` field is required on the import call
   - `ttlMs` on attestation is capped at 15 minutes (900000ms) by the schema

2. **Deployment inventory** (separate signed artifact)
   - Signed with Ed25519 key registered in `CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` (different from approval issuers!)
   - Must be imported before the runtime attestation can be created
   - Bind the inventory to the actual server-derived execution identity, release, environment, topology and worker set; never guess a deployment identifier or substitute another authority's build ID.

3. **Runtime attestation** (`createCro03cRuntimeAttestation`)
   - Can ONLY be created from INSIDE the running production server
   - Requires: valid deployment inventory in DB, live worker heartbeats in Redis, queue topology hash, RELEASE_SHA
   - Workers must be fully started and registered heartbeats before this call
   - Cannot be created at early startup (before workers start)
   - Must run AFTER BullMQ workers initialize and send heartbeats (~30-60s after boot)

4. **Activation policy** (`createCro03cActivationPolicy`)
   - References the 4 receipt IDs from step 1
   - Can be created after attestation exists

## Key design constraint

Runtime attestation is a server-internal observation of the live worker fleet,
not an approval. An authenticated HTTP request can invoke the guarded server
collector; the caller cannot supply or manufacture its release, worker or
health facts.

Do not restore startup signing or treat a Publish as independent approval.
Approval and deployment-inventory issuance remain separate from runtime
observation. If only the current attestation is missing or expired and the
other real prerequisites pass, collect fresh observations instead of
reissuing approvals, changing spend ceilings or relaxing readiness.

**Why:** A healthy published build and selected SFP runtime owner coexisted
with an otherwise-valid CRO fleet/inventory and an expired observation gate.
The guarded collector restored readiness from actual live facts, without
new signing, fabricated approvals or provider-control changes. Older notes
recommending startup auto-signing were obsolete and violated the independent
approval boundary.

**How to apply:** Inspect current diagnostics and the current ceremony
runbook. Use the existing guarded production runtime-observation endpoint
only for real capture; observe its bounded expiry and retain failures.
Missing or invalid signed artifacts still require the independent issuer.
SFP runtime selection and CRO runtime attestation are separate authorities:
one being ready does not prove the other is ready.
