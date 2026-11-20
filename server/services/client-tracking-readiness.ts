import { readFile } from "node:fs/promises";
import path from "node:path";

/** Read the artifact's receipt, not process.env: changing server secrets cannot reconfigure an already-built browser. */
export async function readClientTrackingReadiness() {
  try {
    const receipt = JSON.parse(await readFile(path.resolve("dist/public/tracking-readiness.json"), "utf8"));
    if (receipt.version !== 1 || ![receipt.ga4, receipt.metaPixel, receipt.googleAdsLead].every(v => ["missing", "configured", "invalid"].includes(v))) throw new Error("Invalid receipt");
    return { available: true, ...receipt };
  } catch {
    return { available: false, ga4: "unknown", metaPixel: "unknown", googleAdsLead: "unknown", acceptance: "Client build receipt unavailable; no tracking configuration or delivery inferred" };
  }
}
