import { drizzle } from "drizzle-orm/node-postgres";
import { computeLivePackageContentHash } from "./cro03/sfp-campaign-packages";
/** Reuses the paired package hash; no campaign/sequence content is edited by an experiment. */
export async function readPhase7SourceBinding(client: any, sequenceId: number) {
  const pins = (
    await client.query(
      `SELECT * FROM sfp_campaign_package_versions WHERE sequence_id=$1 AND lifecycle_state='current' ORDER BY id FOR SHARE`,
      [sequenceId],
    )
  ).rows;
  if (pins.length !== 1)
    throw new Error("CRO07_CURRENT_PAIRED_PACKAGE_REQUIRED");
  const p = pins[0];
  await client.query(`SELECT id FROM campaigns WHERE id=$1 FOR SHARE`, [
    p.campaign_id,
  ]);
  await client.query(
    `SELECT id FROM campaign_steps WHERE campaign_id=$1 ORDER BY id FOR SHARE`,
    [p.campaign_id],
  );
  await client.query(
    `SELECT id FROM follow_up_sequences WHERE id=$1 FOR SHARE`,
    [sequenceId],
  );
  await client.query(
    `SELECT id FROM sequence_steps WHERE sequence_id=$1 ORDER BY id FOR SHARE`,
    [sequenceId],
  );
  const live = await computeLivePackageContentHash(
    drizzle(client),
    p.campaign_id,
    sequenceId,
  );
  if (live !== p.content_hash)
    throw new Error("CRO07_PAIRED_PACKAGE_CONTENT_DRIFT");
  return {
    packageVersionId: p.id,
    packageContentHash: p.content_hash,
    campaignId: p.campaign_id,
    sequenceId,
    vertical: p.vertical,
  };
}
