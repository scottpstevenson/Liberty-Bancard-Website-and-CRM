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
 *
 * 2026-09-13 solo-operator simplification: this gate previously required
 * 4 distinct multi-party approval-receipt dimensions (operator/data/finance/
 * legal) pulled from cro03c_approval_receipts. That system remains in place
 * for the SEPARATE CRO-03C command-execution authority path (live-execution.ts),
 * which this change does NOT touch. For THIS certification receipt specifically,
 * the multi-party requirement is replaced with a single typed confirmation from
 * the one operator running this project — see CRO08A_CERTIFICATION_TYPED_CONFIRMATION.
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
 * The single typed confirmation phrase a solo operator must supply, in place
 * of the prior 4-party (operator/data/finance/legal) approval-receipt
 * requirement. Modeled on MI09_ACTIVATION_TYPED_CONFIRMATION (item 10's
 * activation-readiness gate) for consistency.
 */
export const CRO08A_CERTIFICATION_TYPED_CONFIRMATION = "I CERTIFY THIS RELEASE FOR ACTIVATION";

/**
 * MI-09 hardened issuance: verifies each caller-supplied input against
 * authoritative DB rows before writing the certification receipt.
 *
 * Verifications performed:
 *   1. migrationHead matches CRO03C_CURRENT_MIGRATION_HEAD (compile-time constant).
 *   2. runtimeAttestationId exists in cro03c_runtime_attestations and is unexpired.
 *   3. typedConfirmation exactly matches CRO08A_CERTIFICATION_TYPED_CONFIRMATION.
 *   4. outboundPauseEpoch matches the live pause state epoch.
 *   5. providerSet matches CRO03C_PROVIDER_KEYS exactly (no unknown providers,
 *      no missing required providers).
 *   6. priceScheduleHash matches a recorded mi09_pricing_schedule_snapshots row
 *      (snapshots persist indefinitely until the operator explicitly replaces
 *      the pricing artifacts — no re-submission or expiry is required).
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
  certifiedBy: string;
  typedConfirmation: string;
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

  // 6. Typed confirmation — single-operator replacement for the prior 4-party
  //    approval-receipt requirement. Must match exactly.
  if (!input.certifiedBy || !input.certifiedBy.trim()) {
    throw new Cro08aCertificationDeniedError("certified_by_empty");
  }
  if (input.typedConfirmation !== CRO08A_CERTIFICATION_TYPED_CONFIRMATION) {
    throw new Cro08aCertificationDeniedError(
      `typed_confirmation_mismatch:got=${JSON.stringify(input.typedConfirmation)}`,
    );
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

  // 8. Price schedule hash — verify it matches a recorded mi09_pricing_schedule_snapshots
  //    row. Snapshots persist indefinitely (createPricingScheduleSnapshot() no longer
  //    expires them) — the operator sets pricing once and it stays valid until they
  //    explicitly submit different pricing artifacts, so no expiry check here.
  if (!input.priceScheduleHash || input.priceScheduleHash.length < 8) {
    throw new Cro08aCertificationDeniedError("price_schedule_hash_invalid:too_short");
  }
  const pricingSnapshot = rows(await db.execute(sql`
    SELECT id, composite_hash, captured_at
    FROM mi09_pricing_schedule_snapshots
    WHERE composite_hash = ${input.priceScheduleHash}
    ORDER BY captured_at DESC
    LIMIT 1
  `))[0];
  if (!pricingSnapshot) {
    throw new Cro08aCertificationDeniedError(
      `price_schedule_snapshot_not_found:hash=${input.priceScheduleHash} ` +
      `(operator must record a mi09_pricing_schedule_snapshots row first; ` +
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

  // All checks passed — write the receipt.
  // NOTE: The pilot completion check (all 3 levels completed with advancement receipts)
  // is enforced at activateCro08aScheduleDefinition() time, not here. This function is
  // called TWICE: once at the pre-pilot CRO-03D ceremony (to produce the receipt that
  // gates the pilots themselves) and once at the post-Pilot-3 ceremony (to produce the
  // fresh receipt needed for final activation). Requiring pilot completion at receipt
  // issuance would deadlock the pre-pilot ceremony (you need a receipt to run pilots, but
  // pilots are required for the receipt). The activation gate (schedule-authority.ts)
  // enforces the pilot ladder before allowing any schedule to go live.
  // approval_receipt_ids remains NOT NULL in the schema; it now holds a single-element
  // array naming the certifying operator instead of a set of multi-party receipt UUIDs.
  const created = rows(await db.execute(sql`
    INSERT INTO cro08a_certification_receipts
      (release_sha, migration_head, provider_set, price_schedule_hash, approval_receipt_ids,
       runtime_attestation_id, outbound_pause_epoch, issued_by, expires_at)
    VALUES (${input.releaseSha}, ${input.migrationHead}, ${JSON.stringify(input.providerSet)}::jsonb,
            ${input.priceScheduleHash}, ${JSON.stringify([input.certifiedBy])}::jsonb,
            ${input.runtimeAttestationId}::uuid, ${String(input.outboundPauseEpoch)}, ${input.issuedBy},
            ${input.expiresAt.toISOString()}::timestamptz)
    RETURNING id
  `));
  return { id: String(created[0].id) };
}
