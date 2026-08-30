import { ProbeResult } from "./ghl-sync";

export async function probeQueues(): Promise<ProbeResult> {
  try {
    const { requireQueueManagerReady, getQueueMode } = await import("../../queue-manager");

    let qm: ReturnType<typeof requireQueueManagerReady>;
    try {
      qm = requireQueueManagerReady();
    } catch {
      return {
        subsystem: "queues",
        status: "warn",
        summary: getQueueMode() === "legacy_interval_partial"
          ? "BullMQ queue diagnostics unavailable; only the explicitly claimed legacy interval task may be active"
          : "BullMQ queue diagnostics unavailable",
        details: { queueMode: getQueueMode(), bullmqAvailable: false },
      };
    }

    const evidence = await qm.getTelemetryEvidence();
    const { queues } = evidence;
    const queueMode = evidence.topology.queueMode;
    const metricsStatus = evidence.status;

    const criticalQueues = ["ghl-sync", "sla-checks", "sequences"];
    const stuckThreshold = 50;

    const problems: string[] = [];
    const queueSummary: Record<string, unknown> = {};

    for (const q of queues) {
      queueSummary[q.name] = {
        waiting: q.waiting,
        active: q.active,
        failed: q.failed,
        paused: q.paused,
      };

      if (criticalQueues.includes(q.name) && q.paused) {
        problems.push(`${q.name} is PAUSED`);
      }
      if (q.probeStatus === "ok" && (q.waiting ?? 0) > stuckThreshold) {
        problems.push(`${q.name} has ${q.waiting} waiting jobs (possible backlog)`);
      }
      if (q.probeStatus === "ok" && (q.failed ?? 0) > 20) {
        problems.push(`${q.name} has ${q.failed} failed jobs`);
      }
    }

    const measuredQueues = queues.filter((q) => q.probeStatus === "ok");
    const totalFailed = measuredQueues.reduce((s, q) => s + (q.failed ?? 0), 0);
    const totalWaiting = measuredQueues.reduce((s, q) => s + (q.waiting ?? 0), 0);

    const dlqSampleCount = evidence.dlq.sampleCount;

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `${queues.length} queue probes complete. Failed: ${totalFailed}, Waiting: ${totalWaiting}; sampled terminal failures: ${dlqSampleCount} (incomplete)`;

    if (problems.length > 0) {
      const hasCritical = problems.some(p =>
        p.includes("PAUSED") || p.includes("failed") || p.includes("critical overflow")
      );
      status = hasCritical ? "error" : "warn";
      summary = `Queue issues detected: ${problems.slice(0, 3).join("; ")}`;
    }

    if (metricsStatus === "degraded") {
      status = status === "ok" ? "warn" : status;
      summary = `Queue diagnostics are degraded; totals are sampled or incomplete. ${summary}`;
    }

    return {
      subsystem: "queues",
      status,
      summary,
      details: {
        bullmqAvailable: true,
        queueMode,
        totalQueues: queues.length,
        totalFailed,
        totalWaiting,
        dlqSampleCount,
        dlqComplete: false,
        dlqResultScope: evidence.dlq.resultScope,
        metricsStatus,
        dlqQueueStatus: evidence.dlq.queueStatus,
        telemetryScope: evidence.scope,
        fleet: evidence.fleet,
        redis: evidence.redis,
        backlog: evidence.backlog,
        degradations: evidence.degradations,
        problems,
        queues: queueSummary,
      },
    };
  } catch (_err: any) {
    return {
      subsystem: "queues",
      status: "error",
      summary: "Queue probe failed; diagnostics are unavailable",
      details: { status: "unavailable", errorCode: "QUEUE_PROBE_FAILED" },
    };
  }
}
