import type { Express } from "express";
import { db } from "../../db";
import { users } from "../../../shared/models/auth";
import { and, eq, isNull } from "drizzle-orm";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Mark onboarding tour as completed for the current user.
  // Idempotent — calling again when already completed is a no-op.
  app.patch("/api/auth/tour-complete", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Only set the timestamp when it's null — subsequent calls (e.g. after
      // replaying the tour) are no-ops so the original completion time is preserved.
      await db
        .update(users)
        .set({ tourCompletedAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.tourCompletedAt)));
      res.json({ ok: true });
    } catch (error) {
      console.error("Error marking tour complete:", error);
      res.status(500).json({ message: "Failed to mark tour complete" });
    }
  });
}
