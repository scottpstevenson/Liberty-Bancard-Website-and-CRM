/**
 * Knowledge Base Admin Routes
 *
 * All routes require admin or manager role.
 * Handles: source CRUD, index/re-index, version/publish/archive,
 * unanswered question review, feedback review, stats.
 */

import type { Express, Request, Response } from "express";
import { requireRole } from "../replit_integrations/auth";
import {
  listKnowledgeSources,
  getKnowledgeSource,
  createKnowledgeSource,
  updateKnowledgeSource,
  publishSource,
  archiveSource,
  deleteKnowledgeSource,
  indexSource,
  reindexAll,
  getKnowledgeStats,
} from "../services/knowledge-base";
import { db } from "../db";
import { sql } from "drizzle-orm";

const adminOrManager = requireRole("admin", "manager");

export function registerKnowledgeAdminRoutes(app: Express) {
  // ── Stats ────────────────────────────────────────────────────────────────────
  app.get("/api/knowledge/stats", adminOrManager, async (req: Request, res: Response) => {
    try {
      const stats = await getKnowledgeStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── List sources ──────────────────────────────────────────────────────────────
  app.get("/api/knowledge/sources", adminOrManager, async (req: Request, res: Response) => {
    try {
      const { status, audience } = req.query as Record<string, string>;
      const sources = await listKnowledgeSources({
        status: status || undefined,
        audience: audience || undefined,
      });
      res.json({ sources });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Get single source ─────────────────────────────────────────────────────────
  app.get("/api/knowledge/sources/:id", adminOrManager, async (req: Request, res: Response) => {
    try {
      const source = await getKnowledgeSource(Number(req.params.id));
      if (!source) return res.status(404).json({ error: "Source not found." });
      res.json({ source });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Create source ─────────────────────────────────────────────────────────────
  app.post("/api/knowledge/sources", adminOrManager, async (req: Request, res: Response) => {
    try {
      const { title, sourceType, status, audience, content, metadata } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "title and content are required." });
      }
      if (!["public", "merchant", "staff", "all"].includes(audience)) {
        return res.status(400).json({ error: "audience must be public, merchant, staff, or all." });
      }

      const source = await createKnowledgeSource({
        title: String(title).slice(0, 200),
        sourceType: ["text_block", "url", "file"].includes(sourceType) ? sourceType : "text_block",
        status: ["draft", "published"].includes(status) ? status : "draft",
        audience: audience || "public",
        content: String(content).slice(0, 50000),
        metadata: metadata && typeof metadata === "object" ? metadata : undefined,
      });

      res.json({ source });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Update source ─────────────────────────────────────────────────────────────
  app.put("/api/knowledge/sources/:id", adminOrManager, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { title, status, audience, content, metadata } = req.body;

      const updated = await updateKnowledgeSource(id, {
        ...(title !== undefined && { title: String(title).slice(0, 200) }),
        ...(status !== undefined && { status }),
        ...(audience !== undefined && { audience }),
        ...(content !== undefined && { content: String(content).slice(0, 50000) }),
        ...(metadata !== undefined && { metadata }),
      });

      if (!updated) return res.status(404).json({ error: "Source not found." });
      res.json({ source: updated });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Publish source ────────────────────────────────────────────────────────────
  app.post("/api/knowledge/sources/:id/publish", adminOrManager, async (req: Request, res: Response) => {
    try {
      const source = await publishSource(Number(req.params.id));
      if (!source) return res.status(404).json({ error: "Source not found." });
      res.json({ source });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Archive source ────────────────────────────────────────────────────────────
  app.post("/api/knowledge/sources/:id/archive", adminOrManager, async (req: Request, res: Response) => {
    try {
      await archiveSource(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Delete source ─────────────────────────────────────────────────────────────
  app.delete("/api/knowledge/sources/:id", adminOrManager, async (req: Request, res: Response) => {
    try {
      await deleteKnowledgeSource(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Index a single source ─────────────────────────────────────────────────────
  app.post("/api/knowledge/sources/:id/index", adminOrManager, async (req: Request, res: Response) => {
    try {
      const result = await indexSource(Number(req.params.id));
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Re-index all published sources ────────────────────────────────────────────
  app.post("/api/knowledge/reindex", adminOrManager, async (req: Request, res: Response) => {
    try {
      const result = await reindexAll();
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Unanswered questions ──────────────────────────────────────────────────────
  app.get("/api/knowledge/unanswered", adminOrManager, async (req: Request, res: Response) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT id, session_id, audience, question, ai_response, created_at
        FROM assistant_unanswered
        WHERE reviewed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ questions: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/knowledge/unanswered/:id/resolve", adminOrManager, async (req: Request, res: Response) => {
    try {
      const userId = (req.user as any)?.id;
      const { note } = req.body;
      await db.execute(sql`
        UPDATE assistant_unanswered
        SET reviewed_at = NOW(), reviewer_id = ${userId}, resolution_note = ${note ?? null}
        WHERE id = ${Number(req.params.id)}
      `);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Feedback review ───────────────────────────────────────────────────────────
  app.get("/api/knowledge/feedback", adminOrManager, async (req: Request, res: Response) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT af.id, af.message_id, af.session_id, af.rating, af.comment, af.created_at,
               am.content as message_content
        FROM assistant_feedback af
        LEFT JOIN assistant_messages am ON am.id = af.message_id
        ORDER BY af.created_at DESC
        LIMIT 100
      `);
      res.json({ feedback: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Chunks for a source ───────────────────────────────────────────────────────
  app.get("/api/knowledge/sources/:id/chunks", adminOrManager, async (req: Request, res: Response) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT id, source_id, chunk_index, content, token_count,
               (embedding IS NOT NULL) as has_embedding
        FROM knowledge_chunks
        WHERE source_id = ${Number(req.params.id)}
        ORDER BY chunk_index ASC
      `);
      res.json({ chunks: rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
