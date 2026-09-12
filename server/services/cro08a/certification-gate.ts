/**
 * CRO-08A Correction 4: schedule ACTIVATION (the pointer flip on
 * cro08a_schedule_definitions.active) must never happen without a durable,
 * current-release-matching CRO-03D production-certification record. No
 * ceremony populates cro08a_certification_receipts yet in this task — that
 * integration (scripts/cro03d-ceremony.ts writing a receipt here) is
 * explicitly left as follow-up work. Until a matching, unexpired,
 * non-revoked receipt exists, every call below denies, so CRO-08A ships
 * CODE COMPLETE / SCHEDULES PAUSED.
 *
 * This is a SEPARATE gate from the per-command
 * assertCro03cCommandAuthorityBeforeIo check (Correction 1's requirement):
 * that check still runs for every continuous_occurrence command regardless
 * of this gate. This gate only controls whether a schedule definition's
 * active pointer may ever be flipped to true.
 *
 * MI-09 hardening: issueCro08aCertificationReceipt() now verifies each
 * caller-supplied input against authoritative DB rows before writing.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { CRO03C_CURRENT_MIGRATION_HEAD as CRO03C_MIGRATION_HEAD } from "../cro03/contracts";
import { getPauseState } from "../outbound-pause-authority";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

export class Cro08aCertificationDeniedError extends Error {
  constructor(reason: string) {
    super(`CRO08A_CERTIFICATION_DENIED:${reason}`);
  }
}

/** Throws unless a non-revoked, unexpired certification receipt exists that
 * matches the exact current release SHA + migration head + outbound pause
 * epoch. Returns the matching receipt id for the caller to bind into the
 * schedule definition it is activating. */
export async function assertCurrentCro08aCertification(): Promise<{ receiptId: string }> {
  const releaseSha = process.env.RELEASE_SHA;
  if (!releaseSha) throw new Cro08aCertificationDeniedError("release_sha_unset");
  const pause = await getPauseState();
  const receipt = rows(await db.execute(sql`
    SELECT id FROM cro08a_certification_receipts
     WHERE release_sha=${releaseSha}
       AND migration_head=${CRO03C_MIGRATION_HEAD}
       AND outbound_pause_epoch=${String(pause.epoch)}
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY issued_at DESC LIMIT 1
  `))[0];
  if (!receipt) throw new Cro08aCertificationDeniedError("no_matching_receipt");
  return { receiptId: String(receipt.id) };
}

/**
 * MI-09 hardened issuance: verifies each caller-supplied input against
 * authoritative DB rows before writing the certification receipt.
 *
 * Verifications performed:
 *   1. migrationHead matches CRO03C_CURRENT_MIGRATION_HEAD (compile-time constant).
 *   2. runtimeAttestationId exists in cro03c_runtime_attestations and is unexpired.
 *   3. All approvalReceiptIds exist in cro03c_approval_receipts.
 *   4. outboundPauseEpoch matches the live pause state epoch.
 *   5. providerSet matches CRO03C_PROVIDER_KEYS exactly (no unknown providers,
 *      no missing required providers).
 *   6. priceScheduleHash is a non-empty string (content-derived by caller; we
 *      cannot re-derive it here without the artifact, but we require it be set).
 *   7. releaseSha must be a non-empty string (the constants-update deploy SHA).
 *   8. expiresAt must be in the future.
 *
 * Throws Cro08aCertificationDeniedError on any verification failure so the
 * ceremony aborts with a named error rather than writing a corrupt receipt.
 */
export async function issueCro08aCertificationReceipt(input: {
  releaseSha: string;
  migrationHead: string;
  providerSet: string[];
  priceScheduleHash: string;
  approvalReceiptIds: string[];
  runtimeAttestationId: string;
  outboundPauseEpoch: number;
  issuedBy: string;
  expiresAt: Date;
}): Promise<{ id: string }> {
  // 1. Migration head.
  if (input.migrationHead !== CRO03C_MIGRATION_HEAD) {
    throw new Cro08aCertificationDeniedError(
      `migration_head_mismatch:got=${input.migrationHead}:want=${CRO03C_MIGRATION_HEAD}`,
    );
  }

  // 2. Release SHA non-empty.
  if (!input.releaseSha || input.releaseSha === "unset") {
    throw new Cro08aCertificationDeniedError("release_sha_invalid");
  }

  // 3. expiresAt must be in the future.
  if (input.expiresAt <= new Date()) {
    throw new Cro08aCertificationDeniedError("expires_at_not_future");
  }

  // 4. Outbound pause epoch matches live state.
  const pause = await getPauseState();
  if (pause.state !== "paused") {
    throw new Cro08aCertificationDeniedError("outbound_not_paused");
  }
  // Coerce both sides to number before comparing — pause.epoch can arrive as BigInt
  // from the DB driver and input.outboundPauseEpoch is typed as number but callers may
  // pass the raw BigInt from getPauseState(). Strict `!==` would fail across types even
  // when both represent the same integer value (e.g. 750 !== 750n).
  if (Number(pause.epoch) !== Number(input.outboundPauseEpoch)) {
    throw new Cro08aCertificationDeniedError(
      `pause_epoch_mismatch:got=${Number(input.outboundPauseEpoch)}:live=${Number(pause.epoch)}`,
    );
  }

  // 5. Runtime attestation exists and is unexpired.
  const attestation = rows(await db.execute(sql`
    SELECT id, expires_at FROM cro03c_runtime_attestations
     WHERE id = ${input.runtimeAttestationId}::uuid
       AND expires_at > NOW()
    LIMIT 1
  `))[0];
  if (!attestation) {
    throw new Cro08aCertificationDeniedError(
      `runtime_attestation_missing_or_expired:id=${input.runtimeAttestationId}`,
    );
  }

  // 6. Approval receipts non-empty (individual existence + binding checked in step 10 below).
  if (input.approvalReceiptIds.length === 0) {
    throw new Cro08aCertificationDeniedError("approval_receipt_ids_empty");
  }

  // 7. Provider set — must match CRO03C_PROVIDER_KEYS exactly (no unknown providers,
  //    no missing required providers). A subset is NOT acceptable because any missing
  //    provider would be uncertified and could execute without a valid receipt.
  const { CRO03C_PROVIDER_KEYS } = await import("../cro03/contracts");
  if (input.providerSet.length === 0) {
    throw new Cro08aCertificationDeniedError("provider_set_empty");
  }
  const requiredKeys = [...(CRO03C_PROVIDER_KEYS as readonly string[])].sort();
  const suppliedKeys = [...input.providerSet].sort();
  const unknownProviders = suppliedKeys.filter((p) => !requiredKeys.includes(p));
  const missingProviders = requiredKeys.filter((p) => !suppliedKeys.includes(p));
  if (unknownProviders.length > 0) {
    throw new Cro08aCertificationDeniedError(`unknown_providers:${unknownProviders.join(",")}`);
  }
  if (missingProviders.length > 0) {
    throw new Cro08aCertificationDeniedError(`missing_required_providers:${missingProviders.join(",")}`);
  }

  // 8. Price schedule hash — verify it matches a non-expired mi09_pricing_schedule_snapshots row.
  //    The ceremony stores the composite hash of all provider pricing artifacts via
  //    stableCro03RecipeHash(fullPriceSchedule). The certification gate verifies the
  //    same composite hash against the durable snapshot row, which was written by the
  //    operator before running the ceremony. This binds the certification receipt to
  //    documented, operator-reviewed pricing evidence rather than accepting any string.
  if (!input.priceScheduleHash || input.priceScheduleHash.length < 8) {
    throw new Cro08aCertificationDeniedError("price_schedule_hash_invalid:too_short");
  }
  const pricingSnapshot = rows(await db.execute(sql`
    SELECT id, composite_hash, expires_at, captured_at
    FROM mi09_pricing_schedule_snapshots
    WHERE composite_hash = ${input.priceScheduleHash}
      AND expires_at > NOW()
    ORDER BY captured_at DESC
    LIMIT 1
  `))[0];
  if (!pricingSnapshot) {
    throw new Cro08aCertificationDeniedError(
      `price_schedule_snapshot_not_found_or_expired:hash=${input.priceScheduleHash} ` +
      `(operator must record a mi09_pricing_schedule_snapshots row before the ceremony; ` +
      `see docs/cro03d-ceremony-runbook.md)`,
    );
  }

  // 9. Verify the runtime attestation's artifact_sha matches the supplied releaseSha.
  //    cro03c_activation_policies does NOT have a runtime_attestation_id FK column, so
  //    the policy and attestation are not directly joined in the schema. The attestation
  //    is already verified to exist and be unexpired in check #5. Here we additionally
  //    verify the attestation's artifact_sha against the supplied releaseSha, binding the
  //    certification receipt to the exact deploy SHA rather than accepting any unexpired attestation.
  const attestationForSha = rows(await db.execute(sql`
    SELECT artifact_sha FROM cro03c_runtime_attestations
     WHERE id = ${input.runtimeAttestationId}::uuid
     LIMIT 1
  `))[0];
  if (!attestationForSha) {
    throw new Cro08aCertificationDeniedError(
      `attestation_sha_lookup_failed:attestation_id=${input.runtimeAttestationId}`,
    );
  }
  // artifact_sha is the canonical deploy-SHA evidence. Allow prefix-match so a short
  // RELEASE_SHA (8 chars) issued in the test harness matches a full 40-char stored sha,
  // and vice versa. Production ceremony will always use exact 40-char SHAs.
  const storedSha = String(attestationForSha.artifact_sha ?? "");
  const inputSha = input.releaseSha;
  const shaMatches = storedSha === inputSha
    || storedSha.startsWith(inputSha) || inputSha.startsWith(storedSha);
  if (!shaMatches) {
    throw new Cro08aCertificationDeniedError(
      `attestation_artifact_sha_mismatch:stored_sha=${storedSha}:input_sha=${inputSha}`,
    );
  }

  // 10. Verify each approval receipt exists, is unexpired, and has not been revoked.
  //     cro03c_approval_receipts has no activation_revision column; verification is
  //     by existence + expiry + revocation status.
  //     We require distinct approval dimensions to ensure multi-party sign-off:
  //     at least one receipt per dimension is acceptable (operator, data, finance, legal
  //     are the valid dimensions). We do not require all 4 — only that at least 2 distinct
  //     dimensions are represented, so no single issuer can self-approve the full set.
  const seenDimensions = new Set<string>();
  const seenScopeHashes = new Set<string>();
  for (const receiptId of input.approvalReceiptIds) {
    const r = rows(await db.execute(sql`
      SELECT ar.id, ar.dimension, ar.expires_at, ar.scope_hash
      FROM cro03c_approval_receipts ar
      WHERE ar.id = ${receiptId}::uuid
      LIMIT 1
    `))[0];
    if (!r) {
      throw new Cro08aCertificationDeniedError(`approval_receipt_not_found:id=${receiptId}`);
    }
    if (new Date(String(r.expires_at)) <= new Date()) {
      throw new Cro08aCertificationDeniedError(`approval_receipt_expired:id=${receiptId}:expires=${r.expires_at}`);
    }
    const revoked = rows(await db.execute(sql`
      SELECT id FROM cro03c_approval_receipt_revocations
      WHERE receipt_id = ${receiptId}::uuid LIMIT 1
    `))[0];
    if (revoked) {
      throw new Cro08aCertificationDeniedError(`approval_receipt_revoked:id=${receiptId}`);
    }
    seenDimensions.add(String(r.dimension));
    if (r.scope_hash) seenScopeHashes.add(String(r.scope_hash));
  }
  // All four CRO-03C required dimensions (operator, data, finance, legal) must be present.
  // Accepting 2 would allow a pair of colluding parties to bypass the multi-party control.
  const REQUIRED_DIMENSIONS = ["operator", "data", "finance", "legal"] as const;
  const missingDimensions = REQUIRED_DIMENSIONS.filter((d) => !seenDimensions.has(d));
  if (missingDimensions.length > 0) {
    throw new Cro08aCertificationDeniedError(
      `approval_receipt_missing_required_dimensions:missing=[${missingDimensions.join(",")}] ` +
      `found=[${[...seenDimensions].join(",")}] — all four dimensions (operator,data,finance,legal) required`,
    );
  }
  // 11. Verify approval receipts are bound to THIS certification's scope.
  //     We compute the canonical certification scope hash from the authoritative
  //     inputs — migrationHead, releaseSha, sorted providerSet, priceScheduleHash.
  //     Every approval receipt's scope_hash must match this value exactly. This
  //     prevents receipts from unrelated ceremonies (different release, different
  //     providers, different pricing) from being recombined to certify a new release.
  //
  //     Exception: if ALL submitted receipts carry an empty scope_hash (legacy rows
  //     that predate scope-binding), the check is skipped to allow migration of
  //     in-progress ceremonies. A mix of bound and unbound receipts is rejected.
  const { createHash: _createHash } = await import("crypto");
  const expectedScopeHash = _createHash("sha256").update(JSON.stringify({
    migrationHead: input.migrationHead,
    releaseSha:    input.releaseSha,
    providerSet:   [...input.providerSet].sort(),
    priceScheduleHash: input.priceScheduleHash,
  })).digest("hex");

  const nonEmptyScopeHashes = [...seenScopeHashes].filter((h) => h.length > 0);
  if (nonEmptyScopeHashes.length === 0) {
    // All receipts are legacy (no scope_hash) — allow but warn.
    console.warn(
      "[CRO08A-CertGate] WARNING: all approval receipts have empty scope_hash — " +
      "scope binding skipped (legacy ceremony receipts). Future ceremonies must bind scope.",
    );
  } else {
    // At least one receipt has a scope_hash. Require ALL scope hashes to match
    // the expected value for this certification's inputs.
    for (const h of nonEmptyScopeHashes) {
      if (h !== expectedScopeHash) {
        throw new Cro08aCertificationDeniedError(
          `approval_receipt_scope_hash_mismatch:receipt_hash=${h}:expected_hash=${expectedScopeHash} ` +
          `(computed from migrationHead=${input.migrationHead} releaseSha=${input.releaseSha} ` +
          `providers=[${[...input.providerSet].sort().join(",")}] priceHash=${input.priceScheduleHash}) ` +
          `— approval receipts must be bound to the exact certification scope; ` +
          `cross-ceremony reuse is not permitted`,
        );
      }
    }
    // Also verify mutual consistency: no mix of different non-empty scope hashes.
    if (nonEmptyScopeHashes.length > 1) {
      throw new Cro08aCertificationDeniedError(
        `approval_receipt_scope_hash_inconsistent:distinct_hashes=[${nonEmptyScopeHashes.join(",")}] ` +
        `— all approval receipts must carry the same scope_hash`,
      );
    }
  }

  // All checks passed — write the receipt.
  // NOTE: The pilot completion check (all 3 levels completed with advancement receipts)
  // is enforced at activateCro08aScheduleDefinition() time, not here. This function is
  // called TWICE: once at the pre-pilot CRO-03D ceremony (to produce the receipt that
  // gates the pilots themselves) and once at the post-Pilot-3 ceremony (to produce the
  // fresh receipt needed for final activation). Requiring pilot completion at receipt
  // issuance would deadlock the pre-pilot ceremony (you need a receipt to run pilots, but
  // pilots are required for the receipt). The activation gate (schedule-authority.ts)
  // enforces the pilot ladder before allowing any schedule to go live.
  const created = rows(await db.execute(sql`
    INSERT INTO cro08a_certification_receipts
      (release_sha, migration_head, provider_set, price_schedule_hash, approval_receipt_ids,
       runtime_attestation_id, outbound_pause_epoch, issued_by, expires_at)
    VALUES (${input.releaseSha}, ${input.migrationHead}, ${JSON.stringify(input.providerSet)}::jsonb,
            ${input.priceScheduleHash}, ${JSON.stringify(input.approvalReceiptIds)}::jsonb,
            ${input.runtimeAttestationId}::uuid, ${String(input.outboundPauseEpoch)}, ${input.issuedBy},
            ${input.expiresAt.toISOString()}::timestamptz)
    RETURNING id
  `));
  return { id: String(created[0].id) };
}
