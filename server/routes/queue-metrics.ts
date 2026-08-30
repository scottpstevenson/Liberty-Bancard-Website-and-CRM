import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { isAdmin } from "../replit_integrations/auth";
import { requireQueueManagerReady } from "../services/queue-manager";
import { serverError } from "../utils/server-error";

const DLQ_ALERT_WARN = 5;
const DLQ_ALERT_ERROR = 20;
let dlqThresholdAlertCooldown = 0;

async function maybeSendDlqThresholdAlert(dlqCount: number): Promise<void> {
  if (dlqCount <= DLQ_ALERT_WARN) return;
  const now = Date.now();
  if (now - dlqThresholdAlertCooldown < 60 * 60 * 1000) return;
  dlqThresholdAlertCooldown = now;
  try {
    const { sendCriticalAlert } = await import("../services/system-audit/slack-notifier");
    await sendCriticalAlert({
      subsystem: "queues",
      status: dlqCount > DLQ_ALERT_ERROR ? "error" : "warn",
      summary: `DLQ threshold exceeded — ${dlqCount} items in dead-letter queue (${dlqCount > DLQ_ALERT_ERROR ? "error" : "warn"}: >${dlqCount > DLQ_ALERT_ERROR ? DLQ_ALERT_ERROR : DLQ_ALERT_WARN})`,
      details: { dlqCount, warnThreshold: DLQ_ALERT_WARN, errorThreshold: DLQ_ALERT_ERROR },
    });
  } catch (_e) {}
}

export function registerQueueMetricsRoutes(app: Express) {
  app.get("/api/operator/queue-metrics", isAdmin, async (_req, res) => {
    try {
      let qm;
      try {
        qm = requireQueueManagerReady();
      } catch {
        const { getQueueMode } = await import("../services/queue-manager");
        return res.status(503).json({ status: "not_initialized", queueMode: getQueueMode(), queues: [], capturedAt: new Date().toISOString() });
      }
      res.json(await qm.getTelemetryEvidence());
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/operator/queue-history", isAdmin, async (_req, res) => {
    try {
      let qm;
      try {
        qm = requireQueueManagerReady();
      } catch {
        return res.status(503).json({
          status: "not_initialized",
          resultScope: "local_process_observation",
          partial: true,
          history: null,
        });
      }
      const history = qm.getJobHistory();
      res.json({
        status: history.partial ? "degraded" : "ok",
        resultScope: "local_process_observation",
        partial: history.partial,
        history,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/operator/queue-dlq", isAdmin, async (_req, res) => {
    try {
      let qm;
      try {
        qm = requireQueueManagerReady();
      } catch {
        return res.status(503).json({ status: "not_initialized", items: [], resultScope: "sampled_per_queue", complete: false, queueStatus: [] });
      }
      const dlqRead = await qm.getDeadLetterItemsWithStatus();
      const dlqItems = dlqRead.items;
      // The endpoint reads only a capped sample per queue; do not turn that
      // window into a global DLQ count or alert threshold.
      const items = dlqItems.map((item: any) => ({
        id: item.id,
        queue: item.queue ?? item.queueName ?? "unknown",
        name: item.name ?? item.jobName ?? "unknown",
        failureCode: item.failureCode ?? "terminal_exhaustion",
        attemptsMade: Number(item.attemptsMade ?? 0),
        failedAt: item.failedAt ?? item.finishedOn ?? item.timestamp ?? null,
      }));
      res.json({
        status: dlqRead.queueStatus.some((source) => source.status !== "sampled") ? "degraded" : "ok",
        items,
        resultScope: "sampled_per_queue",
        complete: false,
        queueStatus: dlqRead.queueStatus,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue-dlq/:id/retry", isAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const qm = requireQueueManagerReady();
      await qm.retryDeadLetterJob(id);
      res.json({ success: true, message: "Job requeued for retry" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/operator/queue-dlq/:id", isAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const qm = requireQueueManagerReady();
      await qm.discardDeadLetterJob(id);
      res.json({ success: true, message: "Job discarded" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue/:name/pause", isAdmin, async (req, res) => {
    try {
      const name = req.params.name as string;
      const { actor, reason_code, source_key } = req.body ?? {};
      const actorStr = (actor as string) || (req as any).user?.email || "admin";
      const { outboundQueueCoordinator } = await import("../services/outbound-queue-coordinator");
      // Route coordinator hold for this queue's logical keys; falls back to direct BullMQ if not found
      await outboundQueueCoordinator.addHold({
        logicalJobKey: name,
        reasonCode: (reason_code as any) || "manual_operator",
        sourceType: "operator",
        sourceKey: source_key || actorStr,
        actor: actorStr,
        metadata: { queueName: name, via: "operator-pause-endpoint" },
      });
      // Physical actuation via coordinator (only for WINBACK_OUTREACH in Phase 4)
      const result = await outboundQueueCoordinator.triggerReconciliation(name);
      res.json({ success: true, message: `Queue ${name} hold added`, reconciliation: result });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue/:name/resume", isAdmin, async (req, res) => {
    try {
      const name = req.params.name as string;
      const { actor, reason_code, source_key } = req.body ?? {};
      const actorStr = (actor as string) || (req as any).user?.email || "admin";
      const { outboundQueueCoordinator } = await import("../services/outbound-queue-coordinator");
      await outboundQueueCoordinator.clearHold({
        logicalJobKey: name,
        reasonCode: (reason_code as any) || "manual_operator",
        sourceKey: source_key || actorStr,
        actor: actorStr,
      });
      const result = await outboundQueueCoordinator.triggerReconciliation(name);
      res.json({ success: true, message: `Queue ${name} hold cleared`, reconciliation: result });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
