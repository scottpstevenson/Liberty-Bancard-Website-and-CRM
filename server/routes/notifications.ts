import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { storage } from "../storage";
import { isGhlConfigured, sendGhlEmailForMerchant } from "../services/ghl";
import { buildDailyDigest } from "../services/digest-service";
import type { InsertNotificationPreference } from "@shared/schema";

export function registerNotificationsRoutes(app: Express) {
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const allNotifications = await storage.getNotifications();
      const userId = (req.user as any)?.id;
      if (userId) {
        const prefs = await storage.getNotificationPreferences(userId);
        const disabledEvents = prefs
          .filter((p) => p.enabled === false)
          .map((p) => p.eventType);
        if (disabledEvents.length > 0) {
          const filtered = allNotifications.filter((n) => {
            const meta = n.metadata as Record<string, unknown> | null;
            const eventType = meta?.eventType as string | undefined;
            return !eventType || !disabledEvents.includes(eventType);
          });
          return res.json(filtered);
        }
      }
      res.json(allNotifications);
    } catch (err: any) {
      console.error("Get notifications error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      await storage.markNotificationRead(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Mark notification read error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // Lightweight unread count (used by sidebar badge — avoids loading 1000+ rows)
  app.get("/api/notifications/count", isAuthenticated, async (_req, res) => {
    try {
      const all = await storage.getNotifications();
      const unread = all.filter((n: any) => n.read === false).length;
      res.json({ unread, total: all.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Bulk mark-all-as-read for the current user
  app.post("/api/notifications/mark-all-read", isAuthenticated, async (_req, res) => {
    try {
      const all = await storage.getNotifications();
      const unread = all.filter((n: any) => n.read === false);
      let updated = 0;
      for (const n of unread) {
        try {
          await storage.markNotificationRead(n.id);
          updated++;
        } catch {}
      }
      res.json({ success: true, updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === AUDIT LOGS ===
  app.get("/api/audit-logs", isAuthenticated, async (req, res) => {
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


  // === MARK ALL NOTIFICATIONS READ ===
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

}
