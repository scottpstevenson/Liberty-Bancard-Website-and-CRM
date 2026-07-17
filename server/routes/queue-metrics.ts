import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { isAdmin } from "../replit_integrations/auth";
import { getQueueManager } from "../services/queue-manager";

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
      const qm = await getQueueManager();
      const metrics = await qm.getAllQueueMetrics();
      res.json(metrics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operator/queue-history", isAdmin, async (_req, res) => {
    try {
      const qm = await getQueueManager();
      const history = qm.getJobHistory();
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operator/queue-dlq", isAdmin, async (_req, res) => {
    try {
      const qm = await getQueueManager();
      const dlqItems = await qm.getDeadLetterItems();
      maybeSendDlqThresholdAlert(dlqItems.length).catch(() => {});
      res.json(dlqItems);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operator/queue-dlq/:id/retry", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const qm = await getQueueManager();
      await qm.retryDeadLetterJob(id);
      res.json({ success: true, message: "Job requeued for retry" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/operator/queue-dlq/:id", isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const qm = await getQueueManager();
      await qm.discardDeadLetterJob(id);
      res.json({ success: true, message: "Job discarded" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operator/queue/:name/pause", isAdmin, async (req, res) => {
    try {
      const { name } = req.params;
      const qm = await getQueueManager();
      await qm.pauseQueue(name);
      res.json({ success: true, message: `Queue ${name} paused` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operator/queue/:name/resume", isAdmin, async (req, res) => {
    try {
      const { name } = req.params;
      const qm = await getQueueManager();
      await qm.resumeQueue(name);
      res.json({ success: true, message: `Queue ${name} resumed` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
