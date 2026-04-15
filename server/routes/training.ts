import type { Express, RequestHandler } from "express";
import { isDashboardUser } from "../replit_integrations/auth";
import { getTrainingHubStatus, createTrainingHub } from "../services/google-drive";

// Admin or manager role required for write operations
const isAdminOrManager: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    const role = (req.user as any)?.role;
    if (role === "admin" || role === "manager") {
      return next();
    }
  }
  return res.status(403).json({ message: "Admin or manager access required" });
};

export function registerTrainingRoutes(app: Express) {
  // Get training hub status — internal dashboard users only (admin, manager, agent)
  app.get("/api/training/status", isDashboardUser, async (req, res) => {
    try {
      const status = await getTrainingHubStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Training hub status error:", error);
      res.status(500).json({ message: error.message || "Failed to get training hub status" });
    }
  });

  // Create / seed the training hub — admin or manager only
  app.post("/api/training/setup", isAdminOrManager, async (req, res) => {
    try {
      const result = await createTrainingHub();
      res.json(result);
    } catch (error: any) {
      console.error("Training hub setup error:", error);
      res.status(500).json({ message: error.message || "Failed to create training hub" });
    }
  });
}
