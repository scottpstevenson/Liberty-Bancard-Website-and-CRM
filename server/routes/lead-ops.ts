import type { Express } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { requireRole } from "../replit_integrations/auth";
import OpenAI from "openai";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

export function registerLeadOpsRoutes(app: Express) {
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
  // Backfill enrichment data to prospects/contacts for already-enriched entities.
  // Safe to run multiple times (only fills in blank fields).
  app.post("/api/lead-ops/run-writeback", requireRole("admin"), async (req, res) => {
    try {
      const { limit: limitParam = 1000 } = req.body as { limit?: number };
      const limit = Math.min(limitParam, 10000);

      // Find entities that have owner data but whose linked prospect is missing it
      const entitiesResult = await db.execute(sql`
        SELECT se.id, se.owner_name, se.owner_email, se.owner_phone,
               se.email, se.phone, se.vertical, se.score, se.website,
               se.prospect_id
        FROM sunbiz_entities se
        JOIN prospects p ON se.prospect_id = p.id
        WHERE (se.owner_name IS NOT NULL OR se.owner_email IS NOT NULL OR se.email IS NOT NULL)
          AND (p.owner_first_name IS NULL OR p.owner_email IS NULL)
        ORDER BY se.enriched_at DESC NULLS LAST
        LIMIT ${limit}
      `);
      const entities = (entitiesResult as any).rows ?? entitiesResult;

      let processed = 0;
      let prospectUpdates = 0;
      let contactUpdates = 0;

      for (const row of entities) {
        processed++;
        if (!row.prospect_id) continue;

        const ownerName = row.owner_name?.trim() || null;
        let ownerFirstName: string | null = null;
        let ownerLastName: string | null = null;
        if (ownerName) {
          const parts = ownerName.split(/\s+/);
          ownerFirstName = parts[0] || null;
          ownerLastName  = parts.length > 1 ? parts.slice(1).join(" ") : null;
        }
        const ownerEmail = row.owner_email || row.email || null;
        const ownerPhone = row.owner_phone || row.phone || null;

        try {
          const prospect = await storage.getProspect(row.prospect_id);
          if (!prospect) continue;

          const pu: Record<string, any> = {};
          if (ownerFirstName && !prospect.ownerFirstName) pu.ownerFirstName = ownerFirstName;
          if (ownerLastName  && !prospect.ownerLastName)  pu.ownerLastName  = ownerLastName;
          if (ownerEmail     && !prospect.ownerEmail)     pu.ownerEmail     = ownerEmail;
          if (ownerPhone     && !prospect.ownerPhone)     pu.ownerPhone     = ownerPhone;
          if (row.vertical   && !prospect.vertical)       pu.vertical       = row.vertical;
          if (row.score      && !prospect.score)          pu.score          = row.score;
          if (Object.keys(pu).length > 0) {
            await storage.updateProspect(row.prospect_id, pu as any);
            prospectUpdates++;
          }

          if (prospect.contactId) {
            const contact = await storage.getContact(prospect.contactId);
            if (contact) {
              const cu: Record<string, any> = {};
              if (ownerFirstName && !contact.firstName) cu.firstName = ownerFirstName;
              if (ownerLastName  && !contact.lastName)  cu.lastName  = ownerLastName;
              if (ownerEmail     && !contact.email)     cu.email     = ownerEmail;
              if (ownerPhone     && !contact.phone)     { cu.phone = ownerPhone; cu.phoneType = "main_line"; }
              if (row.vertical   && !contact.vertical)  cu.vertical  = row.vertical;
              if (row.website    && !contact.website)   cu.website   = row.website;
              if (Object.keys(cu).length > 0) {
                await storage.updateContact(prospect.contactId, cu as any);
                contactUpdates++;
              }
            }
          }
        } catch (e: any) {
          console.error(`[Writeback backfill] entity ${row.id}:`, e?.message);
        }
      }

      await storage.createAuditLog({
        action: "lead_ops_writeback_run",
        entityType: "system",
        entityId: 0,
        details: { processed, prospectUpdates, contactUpdates },
      });

      res.json({
        processed, prospectUpdates, contactUpdates,
        message: `Processed ${processed} entities — updated ${prospectUpdates} prospect records and ${contactUpdates} contact records.`,
      });
    } catch (err: any) {
      console.error("[LeadOps] run-writeback error:", err?.message);
      res.status(500).json({ error: err?.message || "Writeback failed" });
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
