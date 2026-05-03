import type { Express } from "express";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { isGhlConfigured, sendGhlEmailForMerchant } from "../services/ghl";
import { buildDailyDigest } from "../services/digest-service";
import type { InsertNotificationPreference } from "@shared/schema";

export function registerNotificationsRoutes(app: Express) {
  // Lightweight unread count — uses SQL COUNT, scoped to current user
  app.get("/api/notifications/count", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any)?.id;
      const unread = await storage.getNotificationsUnreadCount(userId);
      res.json({ unread });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  // Mark individual notification read — must be before generic /:id delete
  app.put("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      await storage.markNotificationRead(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Mark notification read error:", err.message);
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });


  // === AUDIT LOGS === (admin-only — sensitive system-wide log)
  app.get("/api/audit-logs", requireRole('admin'), async (req, res) => {
    try {
      const logs = await storage.getAuditLogs();
      res.json(logs);
    } catch (err: any) {
      console.error("Get audit logs error:", err.message);
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });
}
