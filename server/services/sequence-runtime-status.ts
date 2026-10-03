import type { SequenceRuntimeStatus } from "@shared/sequence-runtime-status";
import { getPauseState } from "./outbound-pause-authority";
import { isSmtpConfigured } from "./smtp-email";
import { isGhlConfigured } from "./ghl";

/** Configuration reads only; no connection probe or send. There is no
 * recorded per-sequence pause reason in the current schema.
 */
export async function readSequenceRuntimeStatus(): Promise<SequenceRuntimeStatus> {
  const asOf = new Date().toISOString();
  try {
    const pause = await getPauseState();
    return { version: 1, asOf, status: pause.source === "database" ? "observed" : "unavailable",
      globalPause: { state: pause.source === "database" ? pause.state : "unavailable",
        reason: pause.source === "database" ? pause.reason : null },
      smtp: { configured: isSmtpConfigured(), enabled: "not_observed" },
      ghl: { configured: isGhlConfigured(), enabled: "not_observed" },
      connectivityProbe: "not_observed", verifiedDelivery: "not_observed", sequencePauseReason: "not_recorded" };
  } catch {
    return { version: 1, asOf, status: "error", globalPause: { state: "unavailable", reason: null },
      smtp: { configured: null, enabled: "error" }, ghl: { configured: null, enabled: "error" },
      connectivityProbe: "not_observed", verifiedDelivery: "not_observed", sequencePauseReason: "not_recorded" };
  }
}