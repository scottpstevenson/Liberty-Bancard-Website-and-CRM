# Merchant Data Key Rotation & Recovery

> **Ownership-neutral process document.**
> This document does not name specific individuals; roles and responsibilities are stated functionally.

---

## Overview

The merchant-application protected-data service uses a single AES-256-GCM key (`MERCHANT_DATA_ENCRYPTION_KEY`) to encrypt, fingerprint, and mask merchant PII and financial fields (EIN, SSN, DOB, bank routing/account numbers, `additionalOwners`).

Every encrypted envelope is versioned (`mpd_v1:`) and cryptographically bound to the owning `applicationId` and field path via Additional Authenticated Data (AAD). Moving a ciphertext to a different row or field causes authentication to fail — the binding is enforced by the algorithm, not by application logic.

---

## Current Versioning Limitations

**The current service has no old-key ring / multi-key decryption support.**

This means:

- There is exactly one active encryption key at any time.
- All encrypted envelopes in the database were encrypted with that key.
- **If the key changes without re-encrypting all existing envelopes first, all existing envelopes become permanently unreadable.**

### What this means for rotation

> ⚠️  **Key rotation MUST be performed as a controlled re-encryption pass, not a simple secret swap.**

The recommended rotation procedure is:

1. Run a complete backfill migration under the _current_ key to ensure all rows are in envelope form.
2. Verify the migration is complete (see [Aggregate Inventory](#aggregate-inventory) below).
3. **Re-encrypt all rows** from old-key envelopes to new-key envelopes in one controlled migration pass.
4. Only after 100% of rows are re-encrypted under the new key, update the secret in the deployment environment.
5. Run aggregate inventory again to verify zero plaintext rows under the new key.

**A release is blocked if any plaintext rows remain and the key has been rotated.**

---

## Key Format

`MERCHANT_DATA_ENCRYPTION_KEY` must be one of:

- 64-character lowercase hex string (representing 32 bytes)
- 44-character base64 string (representing 32 bytes, no padding variant)

**Never print the key value in logs, scripts, or terminals.**

To generate a new key (offline, never in the deployment pipeline):

```bash
# Option A: 64-char hex
openssl rand -hex 32

# Option B: 44-char base64
openssl rand -base64 32 | tr -d '\n'
```

Store the generated value immediately in the deployment secrets vault. Do not save it to any file, shell history, or log.

---

## Migration-0142 Schema Requirement

Before running any migration or inventory script, migration `0142` must be deployed:

```
migrations/0142_merchant_application_protected_data.sql
```

The inventory and migration scripts automatically detect missing columns and print an actionable error if the schema has not been deployed.

---

## Aggregate Inventory

Run aggregate inventory at any time to assess the current state. This command is read-only and requires no special authorization:

```bash
npx tsx scripts/inventory-merchant-protected-data.ts
```

Output includes:

- Count of rows by classification: null, encrypted, legacy-plaintext, invalid, partial
- Count of duplicate legacy-EIN groups (aggregate only — no EIN values or row IDs are output)
- Fingerprint/mask column population counts
- Whether all migration-0142 columns are present

**The inventory script never outputs row IDs, EIN values, ciphertext, or any identifying data.**

---

## Running the Backfill Migration

The backfill migration is resumable and bounded. Default mode is inventory-only (no writes).

### Inventory-only (default, safe, no credentials needed)

```bash
npx tsx scripts/migrate-merchant-protected-data.ts
```

### Execute mode (requires dual authorization)

Execution requires **both**:
1. The `--execute` CLI flag
2. The environment variable `MERCHANT_DATA_BACKFILL_AUTHORIZED=true`
3. A valid `MERCHANT_DATA_ENCRYPTION_KEY`

```bash
MERCHANT_DATA_BACKFILL_AUTHORIZED=true \
  npx tsx scripts/migrate-merchant-protected-data.ts --execute
```

Optional flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--batch-size N` | 50 | Rows per batch (max 200) |
| `--max-batches N` | unlimited | Stop after N batches |
| `--verify` | — | Aggregate-only verification, no writes |

### Recovery verification (no writes)

```bash
npx tsx scripts/migrate-merchant-protected-data.ts --verify
```

---

## Restart Safety

The migration script is designed to be safely restartable:

- Rows are fetched with `FOR UPDATE SKIP LOCKED` — concurrent runs skip rows in progress.
- The `WHERE protected_data_version IS NULL` clause ensures already-migrated rows are never re-processed.
- The `UPDATE` sets `protected_data_version` atomically with the ciphertext — partial writes are impossible within a row.
- Checkpoints log counts only (batch number, processed count, error count) — no values or IDs.

If the script is interrupted, re-run it with the same flags to resume from where it stopped.

---

## Key Rotation Procedure (Controlled Re-Encryption)

Because there is no old-key ring, key rotation requires a multi-step process:

### Step 1 — Ensure full migration under the current key

```bash
# Run aggregate inventory to confirm no plaintext rows remain.
npx tsx scripts/inventory-merchant-protected-data.ts

# If plaintext rows exist, run the migration to completion.
MERCHANT_DATA_BACKFILL_AUTHORIZED=true \
  npx tsx scripts/migrate-merchant-protected-data.ts --execute

# Verify completion.
npx tsx scripts/migrate-merchant-protected-data.ts --verify
```

### Step 2 — Add new key support to the service (future work)

> **Currently not implemented.** The service does not support an old-key ring.
>
> To safely rotate the key, the service would need to be extended to:
> 1. Accept both the old key and the new key simultaneously.
> 2. Decrypt with the old key and re-encrypt with the new key during migration.
> 3. Remove the old key after all rows have been re-encrypted.
>
> **Until this is implemented, rotation requires a maintenance window** in which:
> - The application is paused.
> - A custom re-encryption script is run (not included here — requires engineering work).
> - The new key replaces the old key in secrets.
> - The application is unpaused.

### Step 3 — After key change: restart and verify

After the secret is updated in the deployment environment:

1. Restart the application to pick up the new key.
2. Verify that `MERCHANT_DATA_ENCRYPTION_KEY` is valid:

```bash
# Check the key status (does not print the key).
# The pre-deploy gate includes this check automatically.
npx tsx scripts/pre-deploy.ts
```

3. Run aggregate inventory again:

```bash
npx tsx scripts/inventory-merchant-protected-data.ts
```

### Step 4 — Rollback

If the new key was deployed incorrectly:

1. Restore the old key in the deployment environment secrets vault.
2. Restart the application.
3. All existing envelopes (encrypted under the old key) will decrypt correctly again.
4. No data is lost, provided the old key is available.

---

## Previous-Key Recovery

**If the old key is lost, all existing encrypted envelopes are permanently unreadable.** There is no recovery path without the original key material.

Recovery options if old key is lost:
- Restore the old key from a secrets vault backup or out-of-band backup.
- If the key cannot be recovered, affected rows must be re-submitted by the merchant.

---

## Release Gate

The pre-deploy gate (`scripts/pre-deploy.ts` and `scripts/run-pre-deploy.sh`) checks:

1. `MERCHANT_DATA_ENCRYPTION_KEY` is present and valid (does not print the value).
2. The migration-safety test suite passes (`scripts/test-merchant-migration-safety.ts`).

**A production release is blocked if:**
- `MERCHANT_DATA_ENCRYPTION_KEY` is missing or invalid.
- The migration safety tests fail.
- Any plaintext rows remain in the database with a key mismatch.

The key check is only enforced in the production release gate — ordinary development builds do not require the key.

---

## Compliance Notes

- Encrypted envelopes self-describe their binding via embedded `applicationId` and `fieldPath`.
- Fingerprints are keyed HMAC-SHA256 (domain-separated). They are non-reversible.
- Masks are computed from normalized plaintext and stored as display-safe strings — masks are never computed on-the-fly from ciphertext.
- Decryption is restricted to `admin` and `manager` roles. All other roles receive `access denied`.
- The service never logs decrypted values, ciphertext, fingerprints, or key material.
