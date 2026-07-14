import type { Express } from "express";
import { requireRole } from "../replit_integrations/auth";
import { upload } from "./helpers";
import { db } from "../db";
import { registryImportLog } from "@shared/schema";
import { desc } from "drizzle-orm";
import {
  runRegistryImport,
  getRegistryMapping,
  getLicenseBoardMapping,
  type ColumnMapping,
} from "../services/sdr/registry-importer";

const PRIORITY_STATES = ["FL", "TX", "CA", "NY", "GA", "NC", "AZ", "IL"];
const LICENSE_BOARD_TYPES = ["dental", "medical", "cosmetology", "veterinary"];

export function registerRegistryImportRoutes(app: Express) {
  app.post("/api/admin/registry-import", requireRole("admin"), upload.single("file"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const sourceType = req.body.sourceType as string;
        const state = (req.body.state as string || "").toUpperCase();
        const subType = req.body.subType as string | undefined;

        if (!sourceType || !["registry", "license"].includes(sourceType)) {
          return res.status(400).json({ message: "sourceType must be 'registry' or 'license'" });
        }
        if (!state) {
          return res.status(400).json({ message: "state is required" });
        }

        let columnMapping: ColumnMapping = {};

        if (req.body.columnMapping) {
          try {
            columnMapping = JSON.parse(req.body.columnMapping) as ColumnMapping;
          } catch {
            return res.status(400).json({ message: "Invalid columnMapping JSON" });
          }
        } else {
          if (sourceType === "registry") {
            columnMapping = getRegistryMapping(state);
          } else {
            columnMapping = getLicenseBoardMapping(subType || "dental");
          }
        }

        const summary = await runRegistryImport(
          req.file.buffer,
          sourceType as "registry" | "license",
          state,
          columnMapping,
          subType
        );

        return res.json({
          success: true,
          summary,
          message: `Import complete: ${summary.matched} matched, ${summary.unmatched} unmatched of ${summary.total} rows`,
        });
      } catch (err) {
        console.error("[Registry Import] Error:", err);
        return res.status(500).json({
          message: err instanceof Error ? err.message : "Import failed",
        });
      }
    }
  );

  app.get("/api/admin/registry-import/log", requireRole("admin"), async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "200");

      const results = await db.select().from(registryImportLog)
        .orderBy(desc(registryImportLog.createdAt))
        .limit(Math.min(limit, 500));

      return res.json(results);
    } catch (err) {
      console.error("[Registry Import] Log fetch error:", err);
      return res.status(500).json({ message: "Failed to fetch import log" });
    }
  });

  app.get("/api/admin/registry-import/history", requireRole("admin"), async (req, res) => {
    try {
      const raw = await db.execute<{
        import_id: string;
        source: string;
        state: string;
        total: string;
        matched: string;
        unmatched: string;
        skipped: string;
        low_confidence: string;
        ambiguous: string;
        created_at: Date;
      }>(
        `SELECT import_id, source, state,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'matched') as matched,
          COUNT(*) FILTER (WHERE status = 'unmatched') as unmatched,
          COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
          COUNT(*) FILTER (WHERE status = 'low_confidence') as low_confidence,
          COUNT(*) FILTER (WHERE status = 'ambiguous') as ambiguous,
          MIN(created_at) as created_at
         FROM registry_import_log
         GROUP BY import_id, source, state
         ORDER BY MIN(created_at) DESC
         LIMIT 50`
      );

      return res.json(raw.rows);
    } catch (err) {
      console.error("[Registry Import] History error:", err);
      return res.status(500).json({ message: "Failed to fetch import history" });
    }
  });

  app.get("/api/admin/registry-import/mappings", requireRole("admin"), async (_req, res) => {
    const registryMappings: Record<string, any> = {};
    for (const state of PRIORITY_STATES) {
      registryMappings[state] = getRegistryMapping(state);
    }
    const licenseMappings: Record<string, any> = {};
    for (const board of LICENSE_BOARD_TYPES) {
      licenseMappings[board] = getLicenseBoardMapping(board);
    }
    return res.json({
      states: PRIORITY_STATES,
      licenseBoardTypes: LICENSE_BOARD_TYPES,
      registryMappings,
      licenseMappings,
    });
  });
}
