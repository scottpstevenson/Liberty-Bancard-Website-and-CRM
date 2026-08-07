import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { isGhlConfigured, sendGhlEmailForMerchant } from "../services/ghl";
import { buildDailyDigest } from "../services/digest-service";
import { isSmtpConfigured } from "../services/smtp-email";
import { getQueueManager, QUEUE_NAMES } from "../services/queue-manager";
import type { InsertNotificationPreference } from "@shared/schema";
import { serverError } from "../utils/server-error";

async function computeDigestHealth() {
  const ghlConfigured = isGhlConfigured();
  const smtpConfigured = isSmtpConfigured();
  const emailProviderConfigured = ghlConfigured || smtpConfigured;

  const lastDailyDigestDate = await storage.getSystemSetting("last_daily_digest_date");
  const lastWeeklyDigestDate = await storage.getSystemSetting("last_weekly_digest_date");

  // Real scheduler status: check whether the digests BullMQ queue exists and is
  // not paused. If the queue manager or queue isn't available (e.g. mock/init
  // failure), treat the scheduler as unknown rather than assuming it's active.
  let schedulerActive: boolean | null = null;
  try {
    const qm = await getQueueManager();
    const digestsQueue = qm.getQueue(QUEUE_NAMES.DIGESTS);
    if (digestsQueue) {
      const paused = await digestsQueue.isPaused();
      schedulerActive = !paused;
    }
  } catch (err: any) {
    console.error("[digest-health] Failed to read digests queue status:", err.message);
    schedulerActive = null;
  }

  let reason: string | null = null;
  if (!emailProviderConfigured) {
    reason = "No email provider is configured (GHL and SMTP are both unset). Digest emails cannot be delivered.";
  } else if (schedulerActive === false) {
    reason = "The digest scheduler is currently paused. Digest emails will not be sent until it resumes.";
  } else if (schedulerActive === null) {
    reason = "Digest scheduler status could not be confirmed, so delivery cannot be guaranteed right now.";
  }

  return {
    emailProviderConfigured,
    ghlConfigured,
    smtpConfigured,
    schedulerActive,
    lastDailyDigestSentAt: lastDailyDigestDate || null,
    lastWeeklyDigestSentAt: lastWeeklyDigestDate || null,
    reason,
  };
}

export function registerNotificationsRoutes(app: Express) {
  // Lightweight unread count — uses SQL COUNT, scoped to current user
  app.get("/api/notifications/count", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const unread = await storage.getNotificationsUnreadCount(userId);
      res.json({ unread });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Paginated list with optional category filter, scoped to current user
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 25, 100);
      const offset = Number(req.query.offset) || 0;
      const category = ((req.query.category || req.query.type) as string) || "all";

      const userId = (req.user as any)?.id;
      const { data, total } = await storage.getNotificationsPaginated({ limit, offset, category, userId });

      // Preference-based event-type filtering is applied in SQL by the storage layer,
      // so the page's data and total are already accurate post-filter.
      const hasMore = total > offset + limit;
      res.json({ data, total, limit, offset, hasMore });
    } catch (err: any) {
      console.error("Get notifications error:", err.message);
      serverError(res, err);
    }
  });

  // Specific named routes BEFORE parameterized /:id routes to prevent conflicts

  // Bulk mark-all-as-read for the current user
  app.post("/api/notifications/mark-all-read", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Legacy PUT mark-all-read (keep for backwards compat) — must be before /:id
  app.put("/api/notifications/mark-all-read", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      await storage.markAllNotificationsRead(userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Mark all read error:", err.message);
      serverError(res, err);
    }
  });

  // Bulk delete read notifications older than 7 days — must be before /:id
  app.delete("/api/notifications/read", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const deleted = await storage.clearOldReadNotifications(userId);
      res.json({ success: true, deleted });
    } catch (err: any) {
      console.error("Clear old read notifications error:", err.message);
      serverError(res, err);
    }
  });

  // Legacy clear-all — must be before /:id
  app.delete("/api/notifications/clear-all", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      await storage.clearAllNotifications(userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Clear all notifications error:", err.message);
      serverError(res, err);
    }
  });

  // Mark individual notification read — ownership-scoped via storage layer
  app.put("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      await storage.markNotificationRead(Number(req.params.id), userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Mark notification read error:", err.message);
      serverError(res, err);
    }
  });

  // Individual dismiss (delete) with ownership check — parameterized, must be last
  app.delete("/api/notifications/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const deleted = await storage.deleteNotification(Number(req.params.id), userId);
      if (!deleted) {
        return res.status(403).json({ message: "Not authorized to delete this notification" });
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete notification error:", err.message);
      serverError(res, err);
    }
  });


  // === AUDIT LOGS === (admin-only — sensitive system-wide log)
  app.get("/api/audit-logs", requireRole('admin'), async (req, res) => {
    try {
      const { entityType, entityId, actorType, actorId, userId, startDate, endDate, limit, offset } = req.query;
      const filters: Parameters<typeof storage.getAuditLogs>[0] = {};
      if (entityType && typeof entityType === 'string') filters.entityType = entityType;
      if (entityId) filters.entityId = Number(entityId);
      if (actorType && typeof actorType === 'string') filters.actorType = actorType;
      if (actorId && typeof actorId === 'string') filters.actorId = actorId;
      if (userId && typeof userId === 'string') filters.userId = userId;
      if (startDate && typeof startDate === 'string') filters.startDate = new Date(startDate);
      if (endDate && typeof endDate === 'string') filters.endDate = new Date(endDate);
      if (limit) filters.limit = Number(limit);
      if (offset) filters.offset = Number(offset);
      // Default to 100 rows to prevent loading the entire table on large datasets
      if (!filters.limit) filters.limit = 100;
      const logs = await storage.getAuditLogs(filters);
      res.json(logs);
    } catch (err: any) {
      console.error("Get audit logs error:", err.message);
      serverError(res, err);
    }
  });

  // Contact and deal history visible to any CRM user; all other entity types require admin.
  const OPEN_HISTORY_TYPES = new Set(["contact", "deal"]);
  app.get("/api/audit-logs/entity/:entityType/:entityId", isDashboardUser, async (req, res) => {
    try {
      const entityType = req.params.entityType as string;
      const entityId = req.params.entityId as string;
      const user = req.user as any;
      if (!OPEN_HISTORY_TYPES.has(entityType) && user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required to view audit history for this entity type." });
      }
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const resolvedId = /^\d+$/.test(entityId) ? Number(entityId) : entityId;
      const logs = await storage.getAuditLogsByEntity(entityType, resolvedId, limit);
      res.json(logs);
    } catch (err: any) {
      console.error("Get entity audit logs error:", err.message);
      serverError(res, err);
    }
  });


  // === NOTIFICATION PREFERENCES ===
  app.get("/api/notification-preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const prefs = await storage.getNotificationPreferences(userId);
      res.json(prefs);
    } catch (err: any) {
      console.error("Get notification preferences error:", err.message);
      serverError(res, err);
    }
  });

  app.put("/api/notification-preferences", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const { eventType, enabled, emailEnabled, digestDaily, digestWeekly } = req.body;
      if (!eventType) return res.status(400).json({ message: "eventType required" });
      const updates: InsertNotificationPreference = { userId, eventType };
      if (typeof enabled === "boolean") updates.enabled = enabled;
      if (typeof emailEnabled === "boolean") updates.emailEnabled = emailEnabled;
      if (typeof digestDaily === "boolean") updates.digestDaily = digestDaily;
      if (typeof digestWeekly === "boolean") updates.digestWeekly = digestWeekly;
      const pref = await storage.upsertNotificationPreference(updates);
      res.json(pref);
    } catch (err: any) {
      console.error("Update notification preference error:", err.message);
      serverError(res, err);
    }
  });

  // === DIGEST DELIVERY HEALTH (full) === (admin/manager only — reveals which
  // provider (GHL/SMTP) is configured, not just whether one is)
  app.get("/api/notifications/digest-health", requireRole("admin", "manager"), async (req, res) => {
    try {
      const health = await computeDigestHealth();
      res.json(health);
    } catch (err: any) {
      console.error("Get digest health error:", err.message);
      serverError(res, err);
    }
  });

  // === DIGEST DELIVERY AVAILABILITY (minimal) === (any authenticated user —
  // exposes only whether digest delivery is currently available, without
  // naming which internal provider is configured, so the toggle UI can
  // distinguish "preference saved" from "will actually be delivered" for
  // every user, not just admins/managers.
  app.get("/api/notifications/digest-availability", isAuthenticated, async (req, res) => {
    try {
      const health = await computeDigestHealth();
      // Only report deliveryAvailable=true when we have positive confirmation
      // of both an email provider AND a running scheduler. An unknown
      // scheduler state must never be reported as available — that would
      // re-introduce a false-success signal for regular users.
      const deliveryAvailable = health.emailProviderConfigured && health.schedulerActive === true;
      // Scoped status enum — never names which provider (GHL/SMTP) is
      // configured, and never surfaces scheduler internals or raw errors.
      let status: "active" | "not_configured" | "inactive" | "unknown";
      if (!health.emailProviderConfigured) {
        status = "not_configured";
      } else if (health.schedulerActive === true) {
        status = "active";
      } else if (health.schedulerActive === false) {
        status = "inactive";
      } else {
        status = "unknown";
      }

      const message = deliveryAvailable
        ? "Email digest is active."
        : status === "not_configured"
          ? "Email digest preference saved, but delivery is not currently active."
          : status === "unknown"
            ? "Email digest delivery status is unavailable."
            : (health.reason || "Email digest preference saved, but delivery is not currently active.");

      res.json({
        deliveryAvailable,
        status,
        message,
        // Kept for backward compatibility with any existing consumer.
        deliverable: deliveryAvailable,
        reason: deliveryAvailable ? null : health.reason,
      });
    } catch (err: any) {
      console.error("Get digest availability error:", err.message);
      serverError(res, err);
    }
  });

  app.post("/api/analytics/daily-digest", isAuthenticated, async (req, res) => {
    if (!['admin', 'manager'].includes((req.user as any)?.role)) return res.status(403).json({ message: "Admin/Manager only" });
    try {
      const { html, summary } = await buildDailyDigest();
      const adminEmail = process.env.ADMIN_DIGEST_EMAIL;
      if (adminEmail && isGhlConfigured()) {
        try {
          await sendGhlEmailForMerchant({ email: adminEmail, subject: `Daily Digest — ${summary.date} — Liberty Bancard`, body: html });
          res.json({ ...summary, emailSent: true, emailRecipient: adminEmail });
          return;
        } catch (emailErr) {
          console.error("Daily digest email error:", emailErr);
          res.json({ ...summary, emailSent: false, emailError: String(emailErr) });
          return;
        }
      }
      res.json({ ...summary, emailSent: false, html });
    } catch (err: any) {
      console.error("Daily digest error:", err.message);
      serverError(res, err);
    }
  });
}
