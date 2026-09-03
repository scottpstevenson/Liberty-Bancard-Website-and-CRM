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
   - Contains: deploymentIdentity (REPL_DEPLOYMENT_ID), environmentIdentity (NODE_ENV), releaseSha, queueTopologyHash, workerIdentities, expectedCount

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

The attestation is fundamentally a server-internal operation. No amount of external HTTP calls can substitute for it — it reads live Redis worker heartbeats.

## Durable signing key setup (as of Sep 2026)

- `CRO03D_OPERATOR_PRIVATE_KEY` = PEM Ed25519 private key (stored in Replit secrets)
- `CRO03C_TRUSTED_APPROVAL_ISSUERS` = JSON `{"cro03d-operator": "<pubPem>"}` (stored as env var)
- `CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` = NOT YET SET — needed for deployment inventory signing

**Why:** The private key used to be ephemeral in `/tmp` and was lost on every container restart/deploy. The durable secret approach was added Sep 2026.

## What a correct startup ceremony looks like

Split into two phases:

**Phase 1 — at `httpServer.listen` callback, before workers start:**
- Sign and import 4 approval artifacts (can be done here)
- Sign and import deployment inventory (needs `CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` set)

**Phase 2 — after workers initialize and register heartbeats:**
- Call `createCro03cRuntimeAttestation` (needs live worker heartbeats)
- Call `createCro03cActivationPolicy` (needs receipt IDs + attestation)

The current `runStartupCeremony()` in `server/services/cro03-startup-ceremony.ts` attempts all 4 steps at Phase 1, which is wrong. It will always fail on the attestation step because workers haven't started.

## Current production state (as of Sep 3, 2026)

- Production SHA: `f8ff5e7ffb688dcd3bed2421744df704e5d8e3dd`
- 4 approval receipts: imported successfully
- Deployment inventory: not created (`CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` not set)
- Runtime attestation: not created
- Activation policy: not created
- Outreach: PAUSED (not blocked by ceremony — separate pause control)

## How to complete the ceremony properly

1. Set `CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS` = same value as `CRO03C_TRUSTED_APPROVAL_ISSUERS`
2. Fix `runStartupCeremony` to split into Phase 1 (pre-worker) + Phase 2 (post-worker)
3. Deploy — startup will auto-complete both phases
4. OR: wait until a legitimate feature deploy happens and the fixed code runs
