/**
 * trigger-digest.ts
 * Directly invokes the SDR operator digest build+send without HTTP auth.
 * Used for one-time internal email test (scott@libertybancard.com).
 * Does NOT touch outboundGlobalPaused. Does NOT enroll any sequences.
 */
async function main() {
  console.log("=== SDR Operator Digest — Direct Trigger ===");
  console.log(`ADMIN_DIGEST_EMAIL = ${process.env.ADMIN_DIGEST_EMAIL ?? "(not set)"}`);

  const { buildSdrDailyDigest, sendSdrDailyDigest } =
    await import("../server/services/sdr/operator-digest");

  const digest = await buildSdrDailyDigest();
  console.log("Digest built:", JSON.stringify(digest.summary ?? {}, null, 2));

  await sendSdrDailyDigest(digest);
  console.log("✅ Digest send triggered.");
}

main().catch(e => { console.error("❌", e); process.exit(1); });
