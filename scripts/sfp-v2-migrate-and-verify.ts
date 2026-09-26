/**
 * One-shot operator script: verify the SFP South Florida program is on
 * taxonomy v1 (pre-migration state), capture a v1 funnel snapshot, perform
 * the explicit audited move to v2 via migrateProgramToTargetVerticalsV2,
 * then capture a v2 funnel snapshot. Read-only preview only — never freezes
 * a cohort. Run with: npx tsx scripts/sfp-v2-migrate-and-verify.ts
 */
import { getProgramReadOnly, previewFunnel, migrateProgramToTargetVerticalsV2 } from "../server/services/cro03/south-florida-prospecting";

async function main() {
  const before = await getProgramReadOnly();
  if (!before) {
    console.log(JSON.stringify({ error: "SFP_PROGRAM_NOT_CONFIGURED" }));
    process.exit(1);
  }
  console.log("BEFORE program:", JSON.stringify({
    id: before.id, taxonomyVersion: before.taxonomyVersion, policyVersion: before.policyVersion,
    verticalIds: before.verticalIds, isActive: before.isActive, recurringEnabled: before.recurringEnabled,
  }, null, 2));

  const beforeFunnel = await previewFunnel({ maxPreview: 25 });
  console.log("BEFORE funnel:", JSON.stringify(beforeFunnel.funnel, null, 2));

  const migration = await migrateProgramToTargetVerticalsV2({ actorId: "system:sfp-v2-migration-script" });
  console.log("MIGRATION result:", JSON.stringify({ migrated: migration.migrated, reason: migration.reason ?? null }, null, 2));
  console.log("AFTER program:", JSON.stringify({
    id: migration.program.id, taxonomyVersion: migration.program.taxonomyVersion, policyVersion: migration.program.policyVersion,
    verticalIds: migration.program.verticalIds, isActive: migration.program.isActive, recurringEnabled: migration.program.recurringEnabled,
  }, null, 2));

  const afterFunnel = await previewFunnel({ maxPreview: 25 });
  console.log("AFTER funnel:", JSON.stringify(afterFunnel.funnel, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("SFP_V2_MIGRATE_SCRIPT_FAILED:", err?.message ?? err);
  process.exit(1);
});
