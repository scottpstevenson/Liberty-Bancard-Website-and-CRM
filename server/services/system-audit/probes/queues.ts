import { ProbeResult } from "./ghl-sync";

export async function probeQueues(): Promise<ProbeResult> {
  try {
    const { requireQueueManagerReady } = await import("../../queue-manager");

    let qm: ReturnType<typeof requireQueueManagerReady>;
    try {
      qm = requireQueueManagerReady();
    } catch {
      return {
        subsystem: "queues",
        status: "warn",
        summary: "BullMQ unavailable — running in legacy setInterval fallback mode",
        details: { bullmqAvailable: false },
      };
    }

    const { queues, usingMock, status: metricsStatus } = await qm.getAllQueueMetrics();

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

    const dlqRead = await qm.getDeadLetterItemsWithStatus();
    const dlqCount = dlqRead.items.length;
    if (dlqCount > 20) {
      problems.push(`DLQ has ${dlqCount} items (critical overflow threshold exceeded)`);
    } else if (dlqCount > 5) {
      problems.push(`DLQ has ${dlqCount} items (warn threshold exceeded)`);
    }

    let status: "ok" | "warn" | "error" = "ok";
    let summary = `${queues.length} queues healthy. Failed: ${totalFailed}, Waiting: ${totalWaiting}, DLQ: ${dlqCount}`;

    if (problems.length > 0) {
      const hasCritical = problems.some(p =>
        p.includes("PAUSED") || p.includes("failed") || p.includes("critical overflow")
      );
      status = hasCritical ? "error" : "warn";
      summary = `Queue issues detected: ${problems.slice(0, 3).join("; ")}`;
    }

    if (usingMock) {
      status = status === "ok" ? "warn" : status;
      summary += " [using in-memory mock Redis]";
    }
    if (metricsStatus === "degraded" || dlqRead.queueStatus.some((source) => source.status !== "sampled")) {
      status = status === "ok" ? "warn" : status;
      summary = `Queue diagnostics are degraded; totals are sampled or incomplete. ${summary}`;
    }

    return {
      subsystem: "queues",
      status,
      summary,
      details: {
        bullmqAvailable: true,
        usingMock,
        totalQueues: queues.length,
        totalFailed,
        totalWaiting,
        dlqCount,
        metricsStatus,
        dlqQueueStatus: dlqRead.queueStatus,
        dlqWarnThreshold: 5,
        dlqErrorThreshold: 20,
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
