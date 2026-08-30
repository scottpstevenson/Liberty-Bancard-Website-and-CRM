import type { Express } from "express";
import { db } from "../db";
import { inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { requireRole } from "../replit_integrations/auth";
import OpenAI from "openai";
import { listInboundRequests } from "../services/inbound-request-authority";
import { inboundRequestEffects } from "@shared/schema";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

// ── In-process health cache (60s TTL) ────────────────────────────────────────
let _healthCache: { data: any; ts: number } | null = null;
const HEALTH_CACHE_TTL_MS = 60_000;

export function registerLeadOpsRoutes(app: Express) {
  app.get("/api/lead-ops/inbound-requests", requireRole("admin", "manager"), async (req, res) => {
    try {
      const rows = await listInboundRequests({
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
        sourceClass: typeof req.query.sourceClass === "string" ? req.query.sourceClass : undefined,
        lifecycleState: typeof req.query.lifecycleState === "string" ? req.query.lifecycleState : undefined,
      });
      const requestIds = rows.map((row) => row.id);
      const effects = requestIds.length
        ? await db.select({
          effectKey: inboundRequestEffects.effectKey,
          effectType: inboundRequestEffects.effectType,
          state: inboundRequestEffects.state,
          required: inboundRequestEffects.required,
          externalSideEffect: inboundRequestEffects.externalSideEffect,
          terminalReason: inboundRequestEffects.terminalReason,
          requestId: inboundRequestEffects.requestId,
        }).from(inboundRequestEffects).where(inArray(inboundRequestEffects.requestId, requestIds))
        : [];
      const effectsByRequest = new Map<string, typeof effects>();
      for (const effect of effects) {
        const requestEffects = effectsByRequest.get(effect.requestId) || [];
        requestEffects.push(effect);
        effectsByRequest.set(effect.requestId, requestEffects);
      }
      res.json(rows.map((row) => ({
        requestReceipt: row.id,
        sourceClass: row.sourceClass,
        sourceCategory: row.sourceCategory,
        sourceType: row.sourceType,
        lifecycleState: row.lifecycleState,
        assignmentStatus: row.assignmentStatus,
        assignedTo: row.assignedTo,
        slaDueAt: row.slaDueAt,
        contactId: row.contactId,
        dealId: row.dealId,
        ticketId: row.ticketId,
        createdAt: row.createdAt,
        terminalReason: row.terminalReason,
        effects: effectsByRequest.get(row.id) || [],
      })));
    } catch (error) {
      console.error("[LeadOps] inbound request list failed:", error instanceof Error ? error.message : "unknown");
      res.status(500).json({ error: "Failed to load inbound requests" });
    }
  });

  // ── GET /api/lead-ops/stats ────────────────────────────────────────────────
  // Aggregate stats for the entire sunbiz entity lead pool.
  app.get("/api/lead-ops/stats", requireRole("admin", "manager"), async (req, res) => {
    try {
      const statsResult = await db.execute(sql`
        SELECT
          COUNT(*)::int                                                              AS total,
          COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int              AS enriched,
          COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int               AS pending,
          COUNT(*) FILTER (WHERE enrichment_status = 'processing')::int            AS processing,
          COUNT(*) FILTER (WHERE enrichment_status = 'failed')::int                AS failed,
          COUNT(*) FILTER (WHERE score = 'hot')::int                               AS hot,
          COUNT(*) FILTER (WHERE score = 'warm')::int                              AS warm,
          COUNT(*) FILTER (WHERE score = 'cold')::int                              AS cold,
          COUNT(*) FILTER (WHERE email IS NOT NULL OR owner_email IS NOT NULL)::int AS has_email,
          COUNT(*) FILTER (WHERE phone IS NOT NULL OR owner_phone IS NOT NULL)::int AS has_phone,
          COUNT(*) FILTER (WHERE (email IS NOT NULL OR owner_email IS NOT NULL)
                              AND (phone IS NOT NULL OR owner_phone IS NOT NULL))::int AS contactable,
          COUNT(*) FILTER (WHERE owner_name IS NOT NULL)::int                      AS has_owner_name
        FROM sunbiz_entities
      `);

      const verticalResult = await db.execute(sql`
        SELECT vertical, COUNT(*)::int AS count,
               COUNT(*) FILTER (WHERE score = 'hot')::int AS hot_count
        FROM sunbiz_entities
        WHERE vertical IS NOT NULL
        GROUP BY vertical
        ORDER BY count DESC
        LIMIT 25
      `);

      const rows = (statsResult as any).rows ?? statsResult;
      const vRows = (verticalResult as any).rows ?? verticalResult;
      res.json({ ...(rows[0] || {}), verticals: vRows });
    } catch (err: any) {
      console.error("[LeadOps] stats error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load stats" });
    }
  });

  // ── GET /api/lead-ops/entities ─────────────────────────────────────────────
  // Paginated, filterable list of sunbiz entities for the Lead Ops table.
  app.get("/api/lead-ops/entities", requireRole("admin", "manager"), async (req, res) => {
    try {
      const page   = Math.max(0, parseInt(String(req.query.page  || "0")));
      const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "100"))));
      const offset = page * limit;
      const status      = req.query.status as string | undefined;
      const score       = req.query.score as string | undefined;
      const vertical    = req.query.vertical as string | undefined;
      const contactable = req.query.contactable === "true";
      const noContact   = req.query.noContact === "true";
      const search      = req.query.search as string | undefined;

      // Build WHERE clause dynamically using Drizzle sql tag (safe parameterization)
      let whereClause = sql`WHERE 1=1`;
      if (status)    whereClause = sql`${whereClause} AND enrichment_status = ${status}`;
      if (score)     whereClause = sql`${whereClause} AND score = ${score}`;
      if (vertical) {
        const vterm = `%${vertical}%`;
        whereClause = sql`${whereClause} AND vertical ILIKE ${vterm}`;
      }
      if (contactable) {
        whereClause = sql`${whereClause} AND (email IS NOT NULL OR owner_email IS NOT NULL OR phone IS NOT NULL OR owner_phone IS NOT NULL)`;
      }
      if (noContact) {
        whereClause = sql`${whereClause} AND email IS NULL AND owner_email IS NULL AND phone IS NULL AND owner_phone IS NULL`;
      }
      if (search) {
        const sterm = `%${search}%`;
        whereClause = sql`${whereClause} AND (entity_name ILIKE ${sterm} OR owner_name ILIKE ${sterm} OR owner_email ILIKE ${sterm} OR email ILIKE ${sterm})`;
      }

      const countResult = await db.execute(
        sql`SELECT COUNT(*)::int AS total FROM sunbiz_entities ${whereClause}`
      );
      const total = ((countResult as any).rows ?? countResult)[0]?.total ?? 0;

      const rowsResult = await db.execute(sql`
        SELECT id, entity_name, principal_city, principal_state, vertical, score,
               enrichment_status, enriched_at, owner_name, owner_email, owner_phone,
               email, phone, website, prospect_id, ai_summary, created_at, updated_at
        FROM sunbiz_entities
        ${whereClause}
        ORDER BY
          CASE score WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 WHEN 'cold' THEN 3 ELSE 4 END,
          enriched_at DESC NULLS LAST,
          created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      res.json({ data: (rowsResult as any).rows ?? rowsResult, total, page, limit });
    } catch (err: any) {
      console.error("[LeadOps] entities error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load entities" });
    }
  });

  // ── POST /api/lead-ops/bulk-enrich ─────────────────────────────────────────
  // Reset enrichment_status to 'pending' for selected or filtered entities.
  // The existing enrichment worker picks them up automatically on its next tick.
  app.post("/api/lead-ops/bulk-enrich", requireRole("admin", "manager"), async (req, res) => {
    return res.status(503).json({
      code: "CRO03_STAGING_CONVERSION_REQUIRED",
      message: "Lead staging enrichment requires canonical intake conversion.",
    });
    /*
    try {
      const { entityIds, all, filter } = req.body as {
        entityIds?: number[];
        all?: boolean;
        filter?: {
          status?: string;
          score?: string;
          vertical?: string;
          noContact?: boolean;
        };
      };

      if (!all && (!entityIds || entityIds.length === 0)) {
        return res.status(400).json({ error: "Provide entityIds or all=true" });
      }

      let queued = 0;

      if (all) {
        let whereClause = sql`WHERE enrichment_status != 'processing'`;
        if (filter?.status) whereClause = sql`${whereClause} AND enrichment_status = ${filter.status}`;
        if (filter?.score)  whereClause = sql`${whereClause} AND score = ${filter.score}`;
        if (filter?.vertical) {
          const vt = `%${filter.vertical}%`;
          whereClause = sql`${whereClause} AND vertical ILIKE ${vt}`;
        }
        if (filter?.noContact) {
          whereClause = sql`${whereClause} AND email IS NULL AND owner_email IS NULL AND phone IS NULL AND owner_phone IS NULL`;
        }

        const result = await db.execute(sql`
          UPDATE sunbiz_entities
          SET enrichment_status = 'pending', updated_at = NOW()
          ${whereClause}
          RETURNING id
        `);
        queued = ((result as any).rows ?? result).length;
      } else {
        const ids = (entityIds as number[]).slice(0, 50000);
        if (ids.length === 0) return res.status(400).json({ error: "No valid entity IDs" });

        // Build an IN list safely using Drizzle
        const idList = ids.join(",");
        const result = await db.execute(sql.raw(
          `UPDATE sunbiz_entities
           SET enrichment_status = 'pending', updated_at = NOW()
           WHERE id = ANY(ARRAY[${idList}]::int[])
             AND enrichment_status != 'processing'
           RETURNING id`
        ));
        queued = ((result as any).rows ?? result).length;
      }

      await storage.createAuditLog({
        action: "lead_ops_bulk_enrich",
        entityType: "system",
        entityId: 0,
        details: { queued, all: !!all, filter: filter || null },
      });

      res.json({
        queued,
        message: `${queued.toLocaleString()} leads queued for enrichment. The pipeline runs every 10 minutes — check back shortly.`,
      });
    } catch (err: any) {
      console.error("[LeadOps] bulk-enrich error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to queue enrichment" });
    }
    */
  });

  // ── POST /api/lead-ops/ai-segment ─────────────────────────────────────────
  // Use OpenAI to analyze the lead pool and return segmentation insights.
  app.post("/api/lead-ops/ai-segment", requireRole("admin", "manager"), async (req, res) => {
    try {
      const { sampleSize = 150 } = req.body as { sampleSize?: number };

      const [poolResult, verticalResult, sampleResult] = await Promise.all([
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int AS enriched,
            COUNT(*) FILTER (WHERE score = 'hot')::int AS hot,
            COUNT(*) FILTER (WHERE score = 'warm')::int AS warm,
            COUNT(*) FILTER (WHERE score = 'cold')::int AS cold,
            COUNT(*) FILTER (WHERE email IS NOT NULL OR owner_email IS NOT NULL)::int AS has_email,
            COUNT(*) FILTER (WHERE phone IS NOT NULL OR owner_phone IS NOT NULL)::int AS has_phone,
            COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int AS pending
          FROM sunbiz_entities
        `),
        db.execute(sql`
          SELECT vertical, COUNT(*)::int AS count,
                 COUNT(*) FILTER (WHERE score = 'hot')::int AS hot_count,
                 COUNT(*) FILTER (WHERE email IS NOT NULL OR owner_email IS NOT NULL)::int AS with_email
          FROM sunbiz_entities
          WHERE vertical IS NOT NULL AND enrichment_status = 'enriched'
          GROUP BY vertical ORDER BY count DESC LIMIT 15
        `),
        db.execute(sql`
          SELECT entity_name, principal_city, vertical, score,
                 CASE WHEN email IS NOT NULL OR owner_email IS NOT NULL THEN 'yes' ELSE 'no' END AS has_email,
                 CASE WHEN phone IS NOT NULL OR owner_phone IS NOT NULL THEN 'yes' ELSE 'no' END AS has_phone,
                 owner_name, ai_summary
          FROM sunbiz_entities
          WHERE enrichment_status = 'enriched'
          ORDER BY CASE score WHEN 'hot' THEN 1 WHEN 'warm' THEN 2 ELSE 3 END, RANDOM()
          LIMIT ${Math.min(sampleSize, 200)}
        `),
      ]);

      const pool     = ((poolResult     as any).rows ?? poolResult    )[0] || {};
      const verts    =  (verticalResult as any).rows ?? verticalResult;
      const sample   =  (sampleResult   as any).rows ?? sampleResult;

      if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
        return res.json({
          summary: "AI analysis requires OPENAI_API_KEY to be configured.",
          segments: [], recommendations: [], outreachPriority: [], pool, verticals: verts,
        });
      }

      const openai = getOpenAI();
      const vertSummary = verts.map((v: any) =>
        `${v.vertical}: ${v.count} leads (${v.hot_count} hot, ${v.with_email} have email)`
      ).join("\n");

      const sampleSnippet = sample.slice(0, 25).map((l: any) =>
        `${l.entity_name} | ${l.principal_city}, FL | ${l.vertical || "unknown"} | ${l.score || "unscored"} | email:${l.has_email} | phone:${l.has_phone}`
      ).join("\n");

      const prompt = `You are a senior payment processing sales strategist for Liberty Bancard ISO CRM. Analyze this Florida business lead pool and produce a prioritized action plan.

LEAD POOL STATS:
- Total leads: ${pool.total?.toLocaleString()} | Enriched: ${pool.enriched} | Pending enrichment: ${pool.pending}
- Hot: ${pool.hot} | Warm: ${pool.warm} | Cold: ${pool.cold}
- Have email: ${pool.has_email} | Have phone: ${pool.has_phone}

VERTICAL BREAKDOWN (enriched leads):
${vertSummary}

SAMPLE LEADS (${sample.length} shown):
${sampleSnippet}

Your task: produce a JSON object with these exact keys:
{
  "summary": "2-3 sentence executive summary of this lead pool's quality and best opportunity",
  "segments": [
    { "name": "Segment label", "vertical": "...", "score": "hot|warm|cold", "estimatedCount": N,
      "channel": "email|phone|sms", "angle": "One-sentence pitch angle for this segment",
      "priority": 1 }
  ],
  "recommendations": ["Specific action the team should take TODAY", "..."],
  "outreachPriority": [
    { "vertical": "...", "estimatedCloseRate": "X%", "whyNow": "brief reason" }
  ],
  "quickWins": ["Short actionable items that take <30 min to execute"]
}
Return maximum 5 segments, 4 recommendations, 4 outreach priorities, 3 quick wins.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 1800,
        response_format: { type: "json_object" },
      });

      const text = completion.choices[0]?.message?.content || "{}";
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {}

      res.json({
        summary:          parsed.summary          || "Analysis complete.",
        segments:         parsed.segments          || [],
        recommendations:  parsed.recommendations   || [],
        outreachPriority: parsed.outreachPriority  || [],
        quickWins:        parsed.quickWins          || [],
        pool,
        verticals: verts,
      });
    } catch (err: any) {
      console.error("[LeadOps] ai-segment error:", err?.message);
      res.status(500).json({ error: err?.message || "AI analysis failed" });
    }
  });

  // ── POST /api/lead-ops/run-writeback ───────────────────────────────────────
  app.post("/api/lead-ops/run-writeback", requireRole("admin"), async (_req, res) => {
    return res.status(503).json({
      code: "CRO03A_GOVERNED_HANDOFF_REQUIRED",
      message: "Legacy enrichment writeback is retired. CRO-03A may only publish an effect-denied CRO-03B handoff.",
    });
  });

  // ── GET /api/lead-ops/config ───────────────────────────────────────────────
  // Exposes non-secret boolean flags about the server configuration.
  app.get("/api/lead-ops/config", requireRole("admin", "manager"), (_req, res) => {
    res.json({
      serperConfigured: !!process.env.SERPER_API_KEY,
      openaiConfigured: !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  });

  // ── GET /api/lead-ops/health ───────────────────────────────────────────────
  // Pipeline health stats — enrichment throughput, queue depth, success rate.
  // Cached for 60 seconds to avoid hammering the DB on every poll.
  app.get("/api/lead-ops/health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const now = Date.now();
      if (_healthCache && now - _healthCache.ts < HEALTH_CACHE_TTL_MS) {
        return res.json(_healthCache.data);
      }

      const result = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE enriched_at >= NOW() - INTERVAL '24 hours')::int          AS enriched_today,
          COUNT(*) FILTER (
            WHERE enriched_at >= NOW() - INTERVAL '24 hours'
              AND (email IS NOT NULL OR owner_email IS NOT NULL)
          )::int                                                                             AS emails_today,
          COUNT(*) FILTER (
            WHERE enriched_at >= NOW() - INTERVAL '24 hours'
              AND (phone IS NOT NULL OR owner_phone IS NOT NULL)
          )::int                                                                             AS phones_today,
          COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int                        AS queue_depth,
          COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int                       AS total_enriched,
          COUNT(*) FILTER (WHERE enrichment_status = 'failed')::int                         AS total_failed,
          MAX(enriched_at)                                                                   AS last_enriched_at
        FROM sunbiz_entities
      `);

      const row = ((result as any).rows ?? result)[0] || {};
      const successRate = (row.total_enriched + row.total_failed) > 0
        ? Math.round((row.total_enriched / (row.total_enriched + row.total_failed)) * 100)
        : 0;

      const lastEnrichedAt = row.last_enriched_at ? new Date(row.last_enriched_at) : null;
      const minutesSinceLastJob = lastEnrichedAt
        ? Math.floor((Date.now() - lastEnrichedAt.getTime()) / 60000)
        : null;
      const workerActive = minutesSinceLastJob !== null && minutesSinceLastJob < 15;

      const data = {
        enrichedToday:        row.enriched_today    ?? 0,
        emailsToday:          row.emails_today      ?? 0,
        phonesToday:          row.phones_today      ?? 0,
        queueDepth:           row.queue_depth       ?? 0,
        totalEnriched:        row.total_enriched    ?? 0,
        totalFailed:          row.total_failed      ?? 0,
        successRate,
        lastEnrichedAt:       lastEnrichedAt?.toISOString() ?? null,
        minutesSinceLastJob:  minutesSinceLastJob,
        workerActive,
      };

      _healthCache = { data, ts: now };
      res.json(data);
    } catch (err: any) {
      console.error("[LeadOps] health error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load health stats" });
    }
  });

  // ── POST /api/lead-ops/reset-stuck-jobs ────────────────────────────────────
  // Resets sunbiz_entities rows that are stuck in 'processing' status for more
  // than 30 minutes — these are entities the enrichment worker started but never
  // finished (e.g. after a worker crash or restart). Resetting them to 'pending'
  // lets the worker pick them up on its next tick.
  //
  // NOTE: This intentionally does NOT touch the BullMQ enrichment queue because
  // that queue is shared with other critical job types (statement-blueprint,
  // free-contact-enrichment, contact_lead_scoring, etc.) that are unrelated to
  // the Sunbiz enrichment pipeline and must not be removed.
  app.post("/api/lead-ops/reset-stuck-jobs", requireRole("admin"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE sunbiz_entities
        SET enrichment_status = 'pending', updated_at = NOW()
        WHERE enrichment_status = 'processing'
          AND updated_at < NOW() - INTERVAL '30 minutes'
        RETURNING id
      `);
      const cleared = ((result as any).rows ?? result).length;

      await storage.createAuditLog({
        action: "lead_ops_reset_stuck_jobs",
        entityType: "system",
        entityId: 0,
        details: { cleared, method: "db_processing_reset" },
      });

      // Bust the health cache so the next poll reflects updated counts
      _healthCache = null;

      res.json({
        cleared,
        message: cleared > 0
          ? `Reset ${cleared} stuck enrichment job(s) from "processing" back to "pending". The enrichment worker will pick them up on its next tick.`
          : "No stuck jobs found — no entities have been in \"processing\" state for more than 30 minutes.",
      });
    } catch (err: any) {
      console.error("[LeadOps] reset-stuck-jobs error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to reset stuck jobs" });
    }
  });

  // ── GET /api/lead-ops/export-enriched ─────────────────────────────────────
  // Streams a CSV of all enriched sunbiz entities for offline analysis.
  // Columns: entity_id, company_name, vertical, score, has_email, has_phone, enriched_at, city, state
  // Capped at 50 000 rows.
  app.get("/api/lead-ops/export-enriched", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT
          id             AS entity_id,
          entity_name    AS company_name,
          vertical,
          score,
          CASE WHEN email IS NOT NULL OR owner_email IS NOT NULL THEN 'yes' ELSE 'no' END AS has_email,
          CASE WHEN phone IS NOT NULL OR owner_phone IS NOT NULL THEN 'yes' ELSE 'no' END AS has_phone,
          enriched_at,
          principal_city  AS city,
          principal_state AS state
        FROM sunbiz_entities
        WHERE enrichment_status = 'enriched'
        ORDER BY enriched_at DESC NULLS LAST
        LIMIT 50000
      `);

      const data = (rows as any).rows ?? rows;

      // Sanitize a CSV cell value:
      // 1. Prefix formula-leading chars (=, +, -, @, tab, CR) with an apostrophe so
      //    spreadsheet apps (Excel, Google Sheets) treat the cell as literal text.
      // 2. Quote values that contain commas, double-quotes, or newlines.
      const escape = (v: any) => {
        if (v === null || v === undefined) return "";
        let s = String(v);
        // Strip any leading/trailing whitespace to avoid hidden prefix attacks
        s = s.trim();
        // Neutralize spreadsheet formula injection
        if (s.length > 0 && (s[0] === "=" || s[0] === "+" || s[0] === "-" || s[0] === "@" || s[0] === "\t" || s[0] === "\r")) {
          s = `'${s}`;
        }
        if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const cols = ["entity_id", "company_name", "vertical", "score", "has_email", "has_phone", "enriched_at", "city", "state"];
      const header = cols.join(",");
      const lines = (data as any[]).map(r => cols.map(c => escape(r[c])).join(","));
      const csv = [header, ...lines].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="enriched-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (err: any) {
      console.error("[LeadOps] export-enriched error:", err?.message);
      res.status(500).json({ error: err?.message || "Export failed" });
    }
  });

  // ── POST /api/lead-ops/clear-sla-tasks ────────────────────────────────────
  // Bulk-resolve stuck SLA tasks for leads that have no email or phone.
  app.post("/api/lead-ops/clear-sla-tasks", requireRole("admin", "manager"), async (req, res) => {
    try {
      const result = await db.execute(sql`
        UPDATE tasks t
        SET status = 'resolved', updated_at = NOW()
        FROM deals d
        JOIN contacts c ON d.contact_id = c.id
        WHERE t.deal_id = d.id
          AND t.status = 'pending'
          AND t.title ILIKE 'SLA%'
          AND (c.email IS NULL OR c.email = '')
          AND (c.phone IS NULL OR c.phone = '')
        RETURNING t.id
      `);
      const cleared = ((result as any).rows ?? result).length;

      await storage.createAuditLog({
        action: "lead_ops_clear_sla_tasks",
        entityType: "system",
        entityId: 0,
        details: { cleared, reason: "no_contact_method" },
      });

      res.json({ cleared, message: `Cleared ${cleared} stuck SLA tasks for contactless leads.` });
    } catch (err: any) {
      console.error("[LeadOps] clear-sla-tasks error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to clear tasks" });
    }
  });
}
