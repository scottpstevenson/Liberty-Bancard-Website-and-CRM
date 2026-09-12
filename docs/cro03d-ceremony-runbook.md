# CRO-03D Ceremony Runbook (MI-09)

This runbook documents all operator steps required to run the CRO-03D signing ceremony,
issue a CRO-08A certification receipt, and activate CRO-08A schedule definitions after
a successful pilot. It supersedes any prior informal guidance.

---

## Prerequisites

1. All three pilot runs (Levels 1, 2, 3) completed with `mi09_pilot_advancement_receipts` at each level.
2. `CRO03C_CURRENT_MIGRATION_HEAD` in `server/services/cro03/contracts.ts` updated to `"0260_mi07_dedup_unique_indexes"` and deployed.
3. Record the resulting RELEASE_SHA of that deploy — this is the ceremony target SHA.
4. Global outbound confirmed paused via `GET /api/admin/pause-state`. Pause epoch recorded.
5. Operator pricing artifact signed and linked to active `cro03c_activation_policies` row (via `mi09_pricing_artifacts` table).

---

## Step 1 — Pre-Ceremony Preflight (Read-Only)

```bash
npx tsx scripts/cro03d-run-ceremony.ts --preflight-only --expected-workers <N>
```

Verify all output lines show `✓`. Resolve any failures before proceeding.

---

## Step 2 — Generate Ephemeral Signing Keypair

The private key must NEVER leave the local machine or be committed to the repo.

```bash
npx tsx scripts/cro03d-ceremony.ts keygen --dir /tmp/cro03d-keys
```

Record the **public key** printed to stdout (safe to keep in operator notes).

---

## Step 3 — Derive Scope

```bash
npx tsx scripts/cro03d-ceremony.ts scope --out /tmp/cro03d-scope.json
```

Review the output. Verify:
- `releaseSha` matches the constants-update deploy SHA.
- `migrationHead` is `0260_mi07_dedup_unique_indexes`.
- `providersInScope` matches `CRO03C_PROVIDER_KEYS`.
- No hardcoded dollar amounts in scope output.

---

## Step 4 — Prepare Unsigned Approval Artifacts

```bash
npx tsx scripts/cro03d-ceremony.ts prepare \
  --scope /tmp/cro03d-scope.json \
  --approved \
  --out /tmp/cro03d-prepared.json
```

Four unsigned approval artifacts are written: operator, data, finance, legal.

---

## Step 5 — Sign Approval Artifacts

```bash
npx tsx scripts/cro03d-ceremony.ts sign \
  --keydir /tmp/cro03d-keys \
  --prepared /tmp/cro03d-prepared.json \
  --out /tmp/cro03d-signed.json
```

---

## Step 6 — Dispose Signing Key

After signing, destroy the ephemeral private key immediately:

```bash
npx tsx scripts/cro03d-ceremony.ts dispose-key --keydir /tmp/cro03d-keys
```

Record the `destroyedAt` and `keyDigestBeforeDestruction` from the output.

---

## Step 7 — Run Full Ceremony (Write Phase)

This imports approval artifacts, creates runtime attestation, and creates activation policy.
The `CRO03D_OPERATOR_PRIVATE_KEY` environment secret must be set.

```bash
npx tsx scripts/cro03d-run-ceremony.ts \
  --expected-workers <N> \
  --target-sha <CONSTANTS_UPDATE_RELEASE_SHA>
```

The ceremony will:
1. Import 4 approval receipts → `cro03c_approval_receipts`
2. Sign and import deployment inventory → `cro03c_deployment_inventories`
3. Create runtime attestation → `cro03c_runtime_attestations`
4. Create activation policy → `cro03c_activation_policies`
5. **Issue CRO-08A certification receipt** → `cro08a_certification_receipts`

> **IMPORTANT:** Runtime attestations expire in ~14 minutes. If the ceremony is
> interrupted after Step 7 but before activation, you must re-run the full ceremony
> with a fresh attestation. Do NOT reuse a pre-pilot attestation for the post-pilot
> activation ceremony.

---

## Step 8 — Verify Ceremony Output

```bash
# Verify approval receipts
psql $DATABASE_URL -c "SELECT id, dimension, issuer_id, created_at FROM cro03c_approval_receipts ORDER BY created_at DESC LIMIT 4;"

# Verify activation policy
psql $DATABASE_URL -c "SELECT id, release_sha, policy_key, created_at FROM cro03c_activation_policies ORDER BY created_at DESC LIMIT 1;"

# Verify CRO-08A certification receipt
psql $DATABASE_URL -c "SELECT id, release_sha, migration_head, expires_at FROM cro08a_certification_receipts ORDER BY issued_at DESC LIMIT 1;"
```

**Do NOT assert `cro03d_activation_snapshots` — that table does not exist in this codebase.**
Verify only `cro03c_approval_receipts` and `cro03c_activation_policies`.

---

## Step 9 — Create Schedule Definitions

With a live CRO-08A certification receipt, create operator-approved schedule definitions.
Provider budgets MUST be derived from the operator pricing artifact — no hardcoded dollar amounts.

```bash
# Example: create definitions via the admin API (requires admin session + CSRF)
curl -s -X POST https://libertybancard.com/api/admin/cro08a/schedule-definitions \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <CSRF_TOKEN>" \
  -H "Cookie: <SESSION>" \
  -d '{
    "logicalKey": "candidate_enrichment",
    "purpose": "Enrich qualified candidates via full provider waterfall",
    "cadenceCron": "0 */4 * * *",
    "windowSeconds": 14400,
    "batchSize": 50,
    "concurrencyLimit": 3,
    "budgets": {
      "serper":     { "maxUnitsPerOccurrence": <FROM_PRICING_ARTIFACT> },
      "outscraper": { "maxUnitsPerOccurrence": <FROM_PRICING_ARTIFACT> },
      "apollo":     { "maxUnitsPerOccurrence": <FROM_PRICING_ARTIFACT> },
      "zerobounce": { "maxUnitsPerOccurrence": <FROM_PRICING_ARTIFACT> }
    },
    "createdBy": "cro03d-operator"
  }'
```

Create definitions for all four logical keys:
- `candidate_enrichment` → activate after ceremony
- `candidate_freshness_refresh` → activate after ceremony
- `candidate_discovery` → **do NOT activate** until post-Pilot-3 review
- `candidate_backfill` → **do NOT activate** until post-Pilot-3 review

---

## Step 10 — Activate Schedule Definitions

```bash
# Activate via admin API (requires fresh certification receipt from Step 7)
curl -s -X POST https://libertybancard.com/api/admin/cro08a/schedule-definitions/<DEF_ID>/activate \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: <CSRF_TOKEN>" \
  -H "Cookie: <SESSION>" \
  -d '{ "activatedBy": "cro03d-operator", "reason": "post-pilot-3-ceremony" }'
```

---

## Step 11 — Verify Scheduler Creates an Occurrence

On the next BullMQ tick (within 10-15 minutes in production), the scheduler worker
should create a `cro08a_schedule_occurrences` row:

```bash
psql $DATABASE_URL -c "SELECT id, logical_key, state, created_at FROM cro08a_schedule_occurrences ORDER BY created_at DESC LIMIT 5;"
```

---

## Step 12 — Rollback

If anything goes wrong, deactivate schedules immediately:

```bash
# Via admin API
curl -s -X POST https://libertybancard.com/api/admin/cro08a/schedule-definitions/<DEF_ID>/deactivate \
  -H "x-csrf-token: <CSRF_TOKEN>" \
  -H "Cookie: <SESSION>"
```

This calls `deactivateCro08aScheduleDefinition()` — never raw SQL `active=false`.

---

## Pricing Artifact Note

The ceremony scripts no longer contain hardcoded `PRICING` objects or
`CRO03D_APPROVED_MAX_SPEND_MICROS` constants. All provider pricing and spend limits
must be:
1. Captured from each provider's live account dashboard.
2. Stored as versioned `mi09_pricing_artifacts` rows via `POST /api/lead-ops/pilot/pricing-artifacts`.
3. **Stored as a composite pricing schedule snapshot** in `mi09_pricing_schedule_snapshots` before
   running the ceremony. The ceremony script computes `stableCro03RecipeHash(fullPriceSchedule)`
   and this composite hash is what `issueCro08aCertificationReceipt()` verifies against the DB.
   The operator must write the snapshot row (POST the composite hash + artifact_ids + expires_at)
   before running `cro03d-run-ceremony.ts`. The certification gate will reject a hash that has no
   matching unexpired snapshot row.
4. Linked to the active `cro03c_activation_policies` row before paid execution.

Any attempt to run the ceremony with hardcoded dollar amounts is a configuration error.

### Creating a Pricing Schedule Snapshot (required before ceremony)

```sql
-- Run this AFTER capturing all mi09_pricing_artifacts rows (one per provider).
-- Replace <hash> with the output of stableCro03RecipeHash(fullPriceSchedule)
-- (the ceremony script prints this at Step 12).
INSERT INTO mi09_pricing_schedule_snapshots
  (composite_hash, artifact_ids, schedule_json, captured_by, expires_at)
VALUES
  ('<hash-from-ceremony-step-12>',
   '["<artifact-uuid-1>","<artifact-uuid-2>",...]'::jsonb,
   '{"serper":{"amountMicros":...},...}'::jsonb,
   'operator@company.com',
   NOW() + INTERVAL '7 days');
```

The `expires_at` must be in the future at certification time (max 7 days recommended).

---

## Key Tables

| Table | Purpose |
|-------|---------|
| `cro03c_approval_receipts` | Four per-dimension approval artifacts |
| `cro03c_runtime_attestations` | Live worker fleet attestation |
| `cro03c_activation_policies` | Active policy pointer |
| `cro08a_certification_receipts` | CRO-08A schedule activation gate |
| `cro08a_schedule_definitions` | Immutable schedule definitions |
| `cro08a_schedule_occurrences` | Per-window execution records |
| `mi09_pricing_artifacts` | Operator-captured provider pricing (one row per provider) |
| `mi09_pricing_schedule_snapshots` | Composite pricing hash verified by certification gate |
| `mi09_pilot_runs` | Pilot run state |
| `mi09_pilot_advancement_receipts` | Owner advancement approvals |
| `mi09_pilot_reconciliation_reports` | Durable report storage |
