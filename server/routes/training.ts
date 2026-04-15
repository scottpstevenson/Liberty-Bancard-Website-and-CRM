import type { Express, RequestHandler } from "express";
import { isDashboardUser } from "../replit_integrations/auth";
import { getTrainingHubStatus, createTrainingHub, appendGhlBlueprintsToDoc, syncGhlBlueprintsToMainDoc, LIBERTY_BANCARD_GHL_DOC_ID } from "../services/google-drive";

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

  // Append GHL Workflow Node Blueprints to a Google Doc — admin or manager only
  app.post("/api/training/append-ghl-blueprints", isAdminOrManager, async (req, res) => {
    try {
      const { docId } = req.body;
      if (!docId) return res.status(400).json({ message: "docId is required" });
      const result = await appendGhlBlueprintsToDoc(docId);
      res.json(result);
    } catch (error: any) {
      console.error("Append GHL blueprints error:", error);
      res.status(500).json({ message: error.message || "Failed to append GHL blueprints to doc" });
    }
  });

  // Sync GHL Workflow Node Blueprints to the Liberty Bancard main GHL doc (hardcoded doc ID)
  // This is the explicit, auditable execution path for doc: 1qFNQoJboXVx6kGam2i1PG-ia-jWyPJZp7NEpMynOaoQ
  app.post("/api/training/sync-main-ghl-doc", isAdminOrManager, async (req, res) => {
    try {
      console.log(`[GHL Blueprints] Syncing to Liberty Bancard main doc: ${LIBERTY_BANCARD_GHL_DOC_ID}`);
      const result = await syncGhlBlueprintsToMainDoc();
      res.json({ ...result, docId: LIBERTY_BANCARD_GHL_DOC_ID });
    } catch (error: any) {
      console.error("Sync main GHL doc error:", error);
      res.status(500).json({ message: error.message || "Failed to sync GHL blueprints to main doc" });
    }
  });
}
