/**
 * #1408/#1409 — AI Memory and Correction Loop API
 *
 * Endpoints:
 *   GET  /api/ai-memory/entities/:type/:id/facts   — get all facts for an entity
 *   POST /api/ai-memory/entities/:type/:id/facts   — upsert a fact
 *   POST /api/ai-memory/decisions                  — log an AI decision
 *   POST /api/ai-memory/corrections                — log a correction
 *   GET  /api/ai-memory/corrections                — list recent corrections
 *   GET  /api/ai-memory/stats                      — aggregated stats for learning center
 *   GET  /api/ai-memory/prompt-versions            — list prompt versions
 *   POST /api/ai-memory/prompt-versions            — register a new prompt version
 *   GET  /api/ai-memory/golden-examples            — list golden examples
 *   POST /api/ai-memory/golden-examples            — add a golden example
 */

import type { Express } from "express";
import { db } from "../db";
import { aiCorrections, aiDecisionLog, promptVersions, goldenExamples } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { isAuthenticated, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import {
  upsertEntityFact,
  getEntityFacts,
  recordAiDecision,
  recordAiCorrection,
  getAiDecisionStats,
  getAiCorrectionStats,
} from "../services/ai-memory";

export function registerAiMemoryRoutes(app: Express) {
  // ── Entity Facts ────────────────────────────────────────────────────────────

  // GET /api/ai-memory/entities/:type/:id/facts
  app.get("/api/ai-memory/entities/:type/:id/facts", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { type, id } = req.params as Record<string, string>;
      const entityId = parseInt(String(id), 10);
      if (isNaN(entityId)) return res.status(400).json({ message: "Invalid entity ID" });
      const facts = await getEntityFacts(type, entityId);
      res.json({ facts });
    } catch (err: any) { serverError(res, err); }
  });

  // POST /api/ai-memory/entities/:type/:id/facts
  app.post("/api/ai-memory/entities/:type/:id/facts", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { type, id } = req.params as Record<string, string>;
      const entityId = parseInt(String(id), 10);
      if (isNaN(entityId)) return res.status(400).json({ message: "Invalid entity ID" });
      const { factKey, factValue, source, confidence } = req.body as {
        factKey?: string;
        factValue?: unknown;
        source?: string;
        confidence?: number | null;
      };
      if (!factKey) return res.status(400).json({ message: "factKey is required" });
      await upsertEntityFact({
        entityType: type as "contact" | "deal" | "merchant",
        entityId,
        factKey,
        factValue: factValue ?? null,
        source: (source ?? "human") as "ai" | "human" | "system",
        confidence: confidence ?? null,
      });
      res.json({ ok: true });
    } catch (err: any) { serverError(res, err); }
  });

  // ── AI Decisions ─────────────────────────────────────────────────────────────

  // POST /api/ai-memory/decisions
  app.post("/api/ai-memory/decisions", isAuthenticated, async (req, res) => {
    try {
      const id = await recordAiDecision(req.body);
      res.json({ id });
    } catch (err: any) { serverError(res, err); }
  });

  // ── AI Corrections ───────────────────────────────────────────────────────────

  // POST /api/ai-memory/corrections
  app.post("/api/ai-memory/corrections", isAuthenticated, async (req, res) => {
    try {
      const correctedBy = (req.user as any)?.email ?? (req.user as any)?.id ?? "unknown";
      const id = await recordAiCorrection({ ...req.body, correctedBy });
      res.json({ id });
    } catch (err: any) { serverError(res, err); }
  });

  // GET /api/ai-memory/corrections
  app.get("/api/ai-memory/corrections", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
      const rows = await db
        .select()
        .from(aiCorrections)
        .orderBy(desc(aiCorrections.createdAt))
        .limit(limit);
      res.json({ corrections: rows });
    } catch (err: any) { serverError(res, err); }
  });

  // ── Stats ─────────────────────────────────────────────────────────────────────

  // GET /api/ai-memory/stats?days=7
  app.get("/api/ai-memory/stats", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const days = Math.min(parseInt(String(req.query.days ?? "7"), 10), 90);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [decisionStats, correctionStats] = await Promise.all([
        getAiDecisionStats(since),
        getAiCorrectionStats(since),
      ]);
      res.json({ days, since: since.toISOString(), decisions: decisionStats, corrections: correctionStats });
    } catch (err: any) { serverError(res, err); }
  });

  // ── Prompt Versions ───────────────────────────────────────────────────────────

  // GET /api/ai-memory/prompt-versions
  app.get("/api/ai-memory/prompt-versions", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const rows = await db.select().from(promptVersions).orderBy(desc(promptVersions.createdAt));
      res.json({ versions: rows });
    } catch (err: any) { serverError(res, err); }
  });

  // POST /api/ai-memory/prompt-versions
  app.post("/api/ai-memory/prompt-versions", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { promptKey, version, promptText, modelId, notes } = req.body as {
        promptKey?: string;
        version?: string;
        promptText?: string;
        modelId?: string | null;
        notes?: string | null;
      };
      if (!promptKey || !version || !promptText) {
        return res.status(400).json({ message: "promptKey, version, and promptText are required" });
      }
      const deployedBy = (req.user as any)?.email ?? (req.user as any)?.id ?? "unknown";
      const [row] = await db
        .insert(promptVersions)
        .values({ promptKey, version, promptText, modelId: modelId ?? null, notes: notes ?? null, deployedBy })
        .onConflictDoNothing()
        .returning();
      if (!row) return res.status(409).json({ message: `Prompt version ${promptKey}@${version} already exists` });
      res.status(201).json(row);
    } catch (err: any) { serverError(res, err); }
  });

  // ── Golden Examples ──────────────────────────────────────────────────────────

  // GET /api/ai-memory/golden-examples
  app.get("/api/ai-memory/golden-examples", isAuthenticated, requireRole("admin", "manager"), async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(goldenExamples)
        .where(eq(goldenExamples.active, true))
        .orderBy(desc(goldenExamples.createdAt));
      res.json({ examples: rows });
    } catch (err: any) { serverError(res, err); }
  });

  // POST /api/ai-memory/golden-examples
  app.post("/api/ai-memory/golden-examples", isAuthenticated, requireRole("admin"), async (req, res) => {
    try {
      const { decisionType, inputSnapshot, expectedOutput, source, label } = req.body as {
        decisionType?: string;
        inputSnapshot?: unknown;
        expectedOutput?: unknown;
        source?: string;
        label?: string | null;
      };
      if (!decisionType || !inputSnapshot || !expectedOutput) {
        return res.status(400).json({ message: "decisionType, inputSnapshot, and expectedOutput are required" });
      }
      const createdBy = (req.user as any)?.email ?? (req.user as any)?.id ?? "unknown";
      const [row] = await db
        .insert(goldenExamples)
        .values({
          decisionType,
          inputSnapshot: inputSnapshot as any,
          expectedOutput: expectedOutput as any,
          source: (source ?? "human_label"),
          label: label ?? null,
          createdBy,
        })
        .returning();
      res.status(201).json(row);
    } catch (err: any) { serverError(res, err); }
  });
}
