import { runtimeConfigurationLabel, type SequenceRuntimeStatus } from "@shared/sequence-runtime-status";

/** A failed read is not an unconfigured transport. Configuration/sequence state
 * never implies enablement, connectivity or verified delivery.
 */
export function SequenceRuntimeFacts({ runtime }: { runtime?: SequenceRuntimeStatus }) {
  return <div data-testid="sequence-runtime-facts">
    <p>SMTP: {runtimeConfigurationLabel(runtime?.smtp.configured)} · GHL: {runtimeConfigurationLabel(runtime?.ghl.configured)}</p>
    <p>Global outbound: {runtime?.globalPause.state ?? "unavailable"} · status read: {runtime?.status ?? "unavailable"}</p>
    <p>Sequence pause reason: {runtime?.sequencePauseReason ?? "unavailable"}; manually paused and unknown reasons are not labelled compliance blocks.</p>
    <p>Transport enablement, connection probe and verified delivery: not observed. Active identities are not send permission.</p>
  </div>;
}