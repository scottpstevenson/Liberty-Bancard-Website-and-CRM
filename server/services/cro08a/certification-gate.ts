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
 * Minimal issuance path for a future CRO-03D ceremony integration. Not wired
 * to any route or script in this task (that wiring is CRO-03D scope per the
 * task's own Correction 4 guidance); kept here so the follow-up work has a
 * single, reviewed write path rather than needing to invent one against this
 * table later.
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
