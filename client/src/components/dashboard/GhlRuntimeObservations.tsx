import type { GhlInboundSyncStatus } from "@shared/ghl-inbound-sync";

/** Only stored incoming-run observations; never substitute these for fleet proof. */
export function GhlRuntimeObservations({ runtime }: { runtime?: GhlInboundSyncStatus["runtime"] }) {
  return <div className="rounded-md border p-3 text-sm" data-testid="ghl-inbound-runtime">
    <p>Incoming run mode: {runtime?.mode ?? "unavailable"} · lease: {runtime?.owner ?? "unavailable"}</p>
    <p>Checkpoint: {runtime?.checkpoint ? `${runtime.checkpoint.phase}; ${runtime.checkpoint.pages} pages, ${runtime.checkpoint.planned} planned, ${runtime.checkpoint.applied} applied` : "not observed"}</p>
    <p>Observation as of: {runtime?.asOf ?? "unavailable"}</p>
    <p>Last run update: {runtime?.lastUpdatedAt ?? "not observed"} · freshness: {runtime?.freshness ?? "unavailable"}
      {runtime ? ` (${runtime.freshnessThresholdMs / 60_000}-minute run-update threshold)` : ""}</p>
    <p>Incoming heartbeat: {runtime?.heartbeat ?? "unavailable"} · connection probe: {runtime?.connectionProbe ?? "unavailable"} · backlog: {runtime?.backlog ?? "unavailable"}.</p>
    <p>Configuration and a recent stored run are not verified delivery or current worker-consumption proof.</p>
    <ul aria-label="Separate runtime owner observations" className="mt-2 space-y-1 text-muted-foreground">
      {["Legacy GHL queue", "Enrichment", "SLA", "Outbound communications"].map(lane =>
        <li key={lane}>{lane}: owner, heartbeat, checkpoint and backlog unavailable from this incoming-run observation.</li>)}
    </ul>
    <p>Stage IDs and workflow mappings are configuration, not verified native inventory or semantic equivalence.</p>
  </div>;
}