import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { isAdmin } from "../replit_integrations/auth";
import { getQueueManager } from "../services/queue-manager";
import { serverError } from "../utils/server-error";
import { storage } from "../storage";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { diagnoseRedisCapacity } from "../services/queue-connection";
import type { QueueTopologySnapshot } from "../services/queue-manager";

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

      // Extended sequence + Redis metrics
      let sequenceBacklog = 0;
      let sequenceOldestDueMs: number | null = null;
      let sequenceLastRunMs: number | null = null;
      let redisConnectionCount: number | null = null;

      try {
        const backlogResult = await db.execute(sql`
          SELECT
            COUNT(*)::int AS backlog,
            MIN(next_action_at) AS oldest_due_at
          FROM sequence_enrollments
          WHERE status = 'active'
            AND next_action_at IS NOT NULL
            AND next_action_at <= NOW()
        `);
        const row = backlogResult.rows[0] as any;
        sequenceBacklog = row?.backlog ?? 0;
        if (row?.oldest_due_at) {
          sequenceOldestDueMs = Date.now() - new Date(row.oldest_due_at).getTime();
        }
      } catch (_e) {}

      try {
        const lastRunRaw = await storage.getSystemSetting("sequence_worker_last_run");
        if (lastRunRaw && typeof lastRunRaw === "object" && (lastRunRaw as any).duration_ms !== undefined) {
          sequenceLastRunMs = (lastRunRaw as any).duration_ms;
        }
      } catch (_e) {}

      try {
        const { getSharedRedisClientIfReady } = await import("../services/queue-connection");
        const redisClient = getSharedRedisClientIfReady();
        if (redisClient) {
          const infoRaw = await redisClient.info("clients");
          const match = infoRaw.match(/connected_clients:(\d+)/);
          if (match) redisConnectionCount = parseInt(match[1], 10);
        }
      } catch (_e) {}

      // Redis capacity diagnosis — uses actual instantiated Worker count from the
      // topology snapshot, not the response-shape key count (which was always 2).
      const { queues: queueMetrics, usingMock } = metrics;

      let topologySnapshot: QueueTopologySnapshot | null = null;
      let redisCapacity = null;
      try {
        topologySnapshot = qm.getTopologySnapshot();
        redisCapacity = diagnoseRedisCapacity({
          physicalWorkerCount: topologySnapshot.instantiatedWorkerCount,
          observedAccountConnectedClients: redisConnectionCount,
        });
      } catch (_capacityErr) {
        // Probe failure must not produce a false-green — leave status unknown.
        redisCapacity = {
          status: "unknown",
          reasons: ["Capacity probe failed — topology unavailable"],
          estimatedProcessConnections: null,
          capturedAt: new Date().toISOString(),
        };
      }

      res.json({
        queues: queueMetrics,
        usingMock,
        sequenceBacklog,
        sequenceOldestDueMs,
        sequenceLastRunMs,
        redisConnectionCount,
        redisCapacity,
        topologySnapshot,
        capturedAt: topologySnapshot?.capturedAt ?? new Date().toISOString(),
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/operator/queue-history", isAdmin, async (_req, res) => {
    try {
      const qm = await getQueueManager();
      const history = qm.getJobHistory();
      res.json(history);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/operator/queue-dlq", isAdmin, async (_req, res) => {
    try {
      const qm = await getQueueManager();
      const dlqItems = await qm.getDeadLetterItems();
      maybeSendDlqThresholdAlert(dlqItems.length).catch(() => {});
      res.json(dlqItems);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue-dlq/:id/retry", isAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const qm = await getQueueManager();
      await qm.retryDeadLetterJob(id);
      res.json({ success: true, message: "Job requeued for retry" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/operator/queue-dlq/:id", isAdmin, async (req, res) => {
    try {
      const id = req.params.id as string;
      const qm = await getQueueManager();
      await qm.discardDeadLetterJob(id);
      res.json({ success: true, message: "Job discarded" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue/:name/pause", isAdmin, async (req, res) => {
    try {
      const name = req.params.name as string;
      const qm = await getQueueManager();
      await qm.pauseQueue(name);
      res.json({ success: true, message: `Queue ${name} paused` });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/operator/queue/:name/resume", isAdmin, async (req, res) => {
    try {
      const name = req.params.name as string;
      const qm = await getQueueManager();
      await qm.resumeQueue(name);
      res.json({ success: true, message: `Queue ${name} resumed` });
    } catch (err: any) {
      serverError(res, err);
    }
  });
}
