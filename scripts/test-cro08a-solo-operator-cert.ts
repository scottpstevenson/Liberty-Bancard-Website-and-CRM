/**
 * Focused, self-cleaning dev-DB test for the 2026-09-13 solo-operator
 * simplification of the CRO-08A certification gate:
 *   - typed confirmation replaces the 4-party approval-receipt requirement
 *   - pricing snapshots are matched regardless of expires_at (persist
 *     indefinitely until the operator submits different pricing)
 *
 * No real provider calls. No table truncation. Uniquely namespaced,
 * self-cleaning fixtures only.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import {
  issueCro08aCertificationReceipt,
  CRO08A_CERTIFICATION_TYPED_CONFIRMATION,
} from "../server/services/cro08a/certification-gate";
import { CRO03C_CURRENT_MIGRATION_HEAD as CRO03C_MIGRATION_HEAD, CRO03C_PROVIDER_KEYS } from "../server/services/cro03/contracts";
import { getPauseState } from "../server/services/outbound-pause-authority";
import { createHash, randomUUID } from "node:crypto";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const RUN = `solo-cert-test-${Date.now()}`;
let pass = 0, fail = 0;
function assertOk(cond: boolean, label: string) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.error(`  FAIL: ${label}`); fail++; }
}

async function main() {
  const pause = await getPauseState();
  if (pause.state !== "paused") {
    throw new Error("Outbound must be paused to run this test (it is here — refusing to proceed otherwise).");
  }

  const attestationId = randomUUID();
  const releaseSha = /^[0-9a-f]{40}$/.test(process.env.RELEASE_SHA || "")
    ? process.env.RELEASE_SHA!
    : "0123456789abcdef0123456789abcdef01234567";
  const inventoryId = randomUUID();
  const testHash = (s: string) => createHash("sha256").update(s).digest("hex");

  await db.execute(sql`
    INSERT INTO cro03c_deployment_inventories
      (id, issuer_id, deployment_identity, environment_identity, release_sha, queue_topology_hash,
       identity_kind, worker_identities, expected_count, issued_at, expires_at, payload, payload_hash, signature, created_by)
    VALUES (${inventoryId}::uuid, ${RUN}, 'test-deploy', 'test-env', ${releaseSha}, ${testHash(`qth:${RUN}`)},
            'worker', '["stub-worker"]'::jsonb, 1, NOW(), NOW() + interval '1 hour', '{}'::jsonb,
            ${testHash(`payload:${RUN}`)}, 'stub-sig', ${RUN})
  `);
  await db.execute(sql`
    INSERT INTO cro03c_runtime_attestations
      (id, idempotency_key, inventory_id, worker_identities, artifact_sha, migration_head,
       deployment_identity, environment_identity, web_boot_identity, worker_boot_identity,
       queue_topology_hash, worker_heartbeat_at, db_healthy, redis_healthy, expires_at, attestation_hash, created_by)
    VALUES (${attestationId}::uuid, ${`${RUN}-att`}, ${inventoryId}::uuid, '[]'::jsonb, ${releaseSha},
            ${CRO03C_MIGRATION_HEAD}, 'test-deploy', 'test-env', 'w', 'w', ${testHash(`qth:${RUN}`)},
            NOW(), TRUE, TRUE, NOW() + interval '1 hour', ${testHash(`att:${RUN}`)}, ${RUN})
  `);

  const priceHash = testHash(`price:${RUN}`);
  // Deliberately EXPIRED — proves lookups no longer filter on expires_at.
  await db.execute(sql`
    INSERT INTO mi09_pricing_schedule_snapshots
      (composite_hash, artifact_ids, schedule_json, captured_by, captured_at, expires_at)
    VALUES (${priceHash}, '[]'::jsonb, ${JSON.stringify({ test: true, run: RUN })}::jsonb, ${RUN},
            NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour')
  `);

  const baseInput = {
    releaseSha, migrationHead: CRO03C_MIGRATION_HEAD,
    providerSet: [...CRO03C_PROVIDER_KEYS] as string[],
    priceScheduleHash: priceHash,
    runtimeAttestationId: attestationId,
    outboundPauseEpoch: Number(pause.epoch),
    issuedBy: RUN,
    expiresAt: new Date(Date.now() + 3600_000),
  };

  let createdReceiptId: string | null = null;
  try {
    // 1. Wrong typed confirmation must be rejected — no approval receipts needed at all.
    try {
      await issueCro08aCertificationReceipt({
        ...baseInput, certifiedBy: RUN, typedConfirmation: "not the phrase",
      });
      assertOk(false, "wrong typed confirmation rejected");
    } catch (e: any) {
      assertOk(String(e.message).includes("typed_confirmation_mismatch"), "wrong typed confirmation rejected");
    }

    // 2. Empty certifiedBy rejected.
    try {
      await issueCro08aCertificationReceipt({
        ...baseInput, certifiedBy: "", typedConfirmation: CRO08A_CERTIFICATION_TYPED_CONFIRMATION,
      });
      assertOk(false, "empty certifiedBy rejected");
    } catch (e: any) {
      assertOk(String(e.message).includes("certified_by_empty"), "empty certifiedBy rejected");
    }

    // 3. Correct single confirmation succeeds with ZERO cro03c_approval_receipts rows involved.
    const receipt = await issueCro08aCertificationReceipt({
      ...baseInput, certifiedBy: RUN, typedConfirmation: CRO08A_CERTIFICATION_TYPED_CONFIRMATION,
    });
    createdReceiptId = receipt.id;
    assertOk(!!receipt.id, "single-confirmation issuance succeeds");

    const stored = rows(await db.execute(sql`
      SELECT approval_receipt_ids FROM cro08a_certification_receipts WHERE id = ${receipt.id}::uuid
    `))[0];
    const storedIds = stored?.approval_receipt_ids;
    assertOk(Array.isArray(storedIds) && storedIds.length === 1 && storedIds[0] === RUN,
      "receipt records certifying operator, not a multi-party receipt set");

    // 4. Pricing snapshot matched despite being expired an hour ago — proves indefinite persistence.
    assertOk(true, "expired pricing snapshot still matched (see step 3 succeeding at all)");
  } finally {
    // Cleanup — self-contained, no shared-table truncation.
    // cro03c_runtime_attestations / cro03c_deployment_inventories are append-only
    // by DB trigger (CRO03B_APPEND_ONLY) — same as the existing
    // test-cro08a-continuous-factory.ts script, these are left as test-tagged residue.
    if (createdReceiptId) {
      await db.execute(sql`DELETE FROM cro08a_certification_receipts WHERE id = ${createdReceiptId}::uuid`);
    }
    await db.execute(sql`DELETE FROM mi09_pricing_schedule_snapshots WHERE composite_hash = ${priceHash}`);
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
