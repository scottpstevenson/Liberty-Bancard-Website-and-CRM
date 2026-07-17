import { ProbeResult } from "./ghl-sync";

export async function probeQueues(): Promise<ProbeResult> {
  try {
    const { getQueueManager } = await import("../../queue-manager");

    let qm: Awaited<ReturnType<typeof getQueueManager>>;
    try {
      qm = await getQueueManager();
    } catch {
      return {
        subsystem: "queues",
        status: "warn",
        summary: "BullMQ unavailable — running in legacy setInterval fallback mode",
        details: { bullmqAvailable: false },
      };
    }

    const { queues, usingMock } = await qm.getAllQueueMetrics();

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
      if (q.waiting > stuckThreshold) {
        problems.push(`${q.name} has ${q.waiting} waiting jobs (possible backlog)`);
      }
      if (q.failed > 20) {
        problems.push(`${q.name} has ${q.failed} failed jobs`);
      }
    }

    const totalFailed = queues.reduce((s, q) => s + q.failed, 0);
    const totalWaiting = queues.reduce((s, q) => s + q.waiting, 0);

    const dlqItems = await qm.getDeadLetterItems().catch(() => [] as any[]);
    const dlqCount = dlqItems.length;
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
        dlqWarnThreshold: 5,
        dlqErrorThreshold: 20,
        problems,
        queues: queueSummary,
      },
    };
  } catch (err: any) {
    return {
      subsystem: "queues",
      status: "error",
      summary: `Queue probe failed: ${err.message}`,
      details: { error: err.message },
    };
  }
}
