import type { Express } from "express";
import { isAuthenticated } from "../replit_integrations/auth";
import { getVapidPublicKey, saveSubscription, removeSubscription } from "../services/push-service";

export function registerPushRoutes(app: Express) {
  app.get("/api/push/vapid-public-key", isAuthenticated, (_req, res) => {
    try {
      res.json({ publicKey: getVapidPublicKey() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const { subscription } = req.body;
      if (!subscription?.endpoint) {
        return res.status(400).json({ message: "Invalid subscription object" });
      }
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      saveSubscription(userId, subscription);
      res.status(201).json({ message: "Subscribed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const { endpoint } = req.body;
      const userId = (req.user as any)?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      removeSubscription(userId, endpoint);
      res.json({ message: "Unsubscribed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
