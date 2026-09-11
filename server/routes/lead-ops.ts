import type { Express } from "express";
import { db } from "../db";
import { eq, inArray, sql } from "drizzle-orm";
import { storage } from "../storage";
import { requireRole } from "../replit_integrations/auth";
import OpenAI from "openai";
import { featureFlags } from "../services/feature-flags";
import { listInboundRequests } from "../services/inbound-request-authority";
import { backgroundJobs, inboundRequestEffects, sdrMerchants } from "@shared/schema";

function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
}

// ── In-process health cache (300 s TTL) with single-flight guard ──────────────
let _healthCache: { data: any; ts: number } | null = null;
let _healthInflight: Promise<any> | null = null;
// Incremented each time the cache is invalidated.  A completed computation
// only publishes its result if its captured generation still matches, so an
// orphaned promise (started before a manual reset) cannot overwrite newer
// data or accidentally clear a newer in-flight promise.
let _healthGeneration = 0;
const HEALTH_CACHE_TTL_MS = 300_000;
// Test-mode hook: set HEALTH_CACHE_TEST_MODE=1 to collapse the TTL to 0 and
// inject a __dbRoundTrips counter into the response body.
const HEALTH_CACHE_TEST_MODE = process.env.HEALTH_CACHE_TEST_MODE === "1";
let _healthTestRoundTrips = 0;

// ── In-memory counter: legacy route hits since last startup ───────────────────
let _legacyRouteAttemptsSinceStartup = 0;

/** Called by the deprecated POST /api/sunbiz/re-enrich-all route in prospects.ts */
export function incrementLegacyEnrichAttemptCounter(): void {
  _legacyRouteAttemptsSinceStartup++;
}

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
          COUNT(*) FILTER (WHERE enrichment_status = 'enriched')::int              AS processing_completed,
          COUNT(*) FILTER (WHERE enrichment_status = 'pending')::int               AS pending_processing,
          COUNT(*) FILTER (WHERE enrichment_status = 'processing')::int            AS processing,
          COUNT(*) FILTER (WHERE enrichment_status = 'failed')::int                AS failed,
          COUNT(*) FILTER (WHERE score = 'hot')::int                               AS hot,
          COUNT(*) FILTER (WHERE score = 'warm')::int                              AS warm,
          COUNT(*) FILTER (WHERE score = 'cold')::int                              AS cold,
          COUNT(*) FILTER (
            WHERE NULLIF(BTRIM(email), '') IS NOT NULL
               OR NULLIF(BTRIM(owner_email), '') IS NOT NULL
          )::int AS current_email_inventory,
          COUNT(*) FILTER (
            WHERE NULLIF(BTRIM(phone), '') IS NOT NULL
               OR NULLIF(BTRIM(owner_phone), '') IS NOT NULL
          )::int AS current_phone_inventory,
          COUNT(*) FILTER (
            WHERE (NULLIF(BTRIM(email), '') IS NOT NULL OR NULLIF(BTRIM(owner_email), '') IS NOT NULL)
              AND (NULLIF(BTRIM(phone), '') IS NOT NULL  OR NULLIF(BTRIM(owner_phone), '') IS NOT NULL)
          )::int AS contactable,
          COUNT(*) FILTER (WHERE NULLIF(BTRIM(owner_name), '') IS NOT NULL)::int   AS has_owner_name
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
          diagnostic_only: true,
          disclaimer: "This is a narrative analysis of a sample — it does not modify records or qualify candidates.",
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
        diagnostic_only: true,
        disclaimer: "This is a narrative analysis of a sample — it does not modify records or qualify candidates.",
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
      res.status(500).json({
        diagnostic_only: true,
        disclaimer: "This is a narrative analysis of a sample — it does not modify records or qualify candidates.",
        error: err?.message || "AI analysis failed",
      });
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
  // Pipeline health stats — enrichment throughput, queue depth, success rate,
  // plus worker-authority truth fields (intake path, enrichment_progress
  // status, free-enrichment pending jobs, last scheduled enrichment timestamp).
  // Cached for 300 s with a single-flight guard: concurrent cache-miss callers
  // all await the same in-flight Promise instead of launching separate DB scans.

  async function runHealthComputation(): Promise<any> {
    // Wrap the heavy sunbiz_entities aggregate in a 30-second statement timeout
    // so a runaway scan degrades to stale data rather than holding a pool
    // connection indefinitely.
    const [enrichResult, freeEnrichResult, canonicalFreeEnrichResult, jobRow, progressRaw] = await Promise.all([
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '30000'`);
        return tx.execute(sql`
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
      }),
      // Match runFreeContactEnrichmentTick()'s exact eligibility predicate:
      // (domain IS NOT NULL OR website IS NOT NULL) AND status='pending'
      // AND doNotContactFlag IS NOT TRUE
      // AND no sdr_merchant_contacts row with email already present.
      db.select({ count: sql<number>`COUNT(*)::int` })
        .from(sdrMerchants)
        .where(sql`
          (${sdrMerchants.domain} IS NOT NULL OR ${sdrMerchants.website} IS NOT NULL)
          AND ${sdrMerchants.ownerEnrichmentStatus} = 'pending'
          AND ${sdrMerchants.doNotContactFlag} IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1 FROM sdr_merchant_contacts mc
            WHERE mc.merchant_id = ${sdrMerchants.id} AND mc.email IS NOT NULL
          )
        `),
      // MI-04: Canonical businesses free enrichment queue depth.
      // Predicate must exactly match runCanonicalBusinessEnrichmentTick() so the UI
      // tile reflects the true backlog (null + retryable-failed + stale-enriched,
      // canonical-only). Also includes record_class guard and attempt count cap.
      db.execute(sql`
        SELECT COUNT(*)::int AS count FROM businesses
        WHERE website_domain IS NOT NULL
          AND record_class = 'canonical'
          AND (
            free_enrichment_status IS NULL
            OR (free_enrichment_status = 'failed' AND free_enrichment_attempt_count < 3)
            OR (free_enrichment_status = 'enriched' AND free_enrichment_completed_at < NOW() - INTERVAL '90 days')
          )
      `).catch(() => null),
      db.select({ lastFinishedAt: backgroundJobs.lastFinishedAt })
        .from(backgroundJobs)
        .where(eq(backgroundJobs.jobName, "enrichment-queue-processor"))
        .limit(1),
      storage.getSystemSetting("enrichment_progress").catch(() => null),
    ]);

    const row = ((enrichResult as any).rows ?? enrichResult)[0] || {};
    const successRate = (row.total_enriched + row.total_failed) > 0
      ? Math.round((row.total_enriched / (row.total_enriched + row.total_failed)) * 100)
      : 0;

    const lastEnrichedAt = row.last_enriched_at ? new Date(row.last_enriched_at) : null;
    const minutesSinceLastJob = lastEnrichedAt
      ? Math.floor((Date.now() - lastEnrichedAt.getTime()) / 60000)
      : null;
    const workerActive = minutesSinceLastJob !== null && minutesSinceLastJob < 15;

    const freeEnrichPending = Number(freeEnrichResult[0]?.count ?? 0);
    const canonicalFreeEnrichmentQueueDepth = Number(
      ((canonicalFreeEnrichResult as any)?.rows ?? canonicalFreeEnrichResult)?.[0]?.count ?? 0
    );
    const lastJobRow = jobRow[0];

    const progressObj = (progressRaw as any) || {};
    const enrichmentProgressStatus: string =
      progressObj.status === "running" ? "running"
      : progressObj.status === "interrupted" ? "interrupted"
      : progressObj.status === "failed" ? "failed"
      : "idle";

    // Use the same featureFlags getters that runEnrichmentTick() and runDailyOutreachCycle()
    // check — backed by dbFallbackBool() and accounting for wizard/DB overrides.
    const sunbizEnrichmentEnabled = featureFlags.SUNBIZ_ENRICHMENT_ENABLED;
    const legacyOutreachEnabled   = featureFlags.LEGACY_OUTREACH_ENABLED;

    // Truthfully report which intake path(s) are active.
    // runDailyOutreachCycle (LEGACY_OUTREACH_ENABLED gate) calls reEnrichAllSunbizEntities()
    // unconditionally in Phase A, so when that path is live BOTH intake paths are active.
    const intakeAuthority: "scheduled-sunbiz-pipeline" | "legacy-outreach-cycle" | "both" | "none" =
      sunbizEnrichmentEnabled && legacyOutreachEnabled ? "both"
      : sunbizEnrichmentEnabled ? "scheduled-sunbiz-pipeline"
      : legacyOutreachEnabled   ? "legacy-outreach-cycle"
      : "none";

    // Use sunbiz_entities.MAX(enriched_at) as the definitive "last Sunbiz enrichment ran"
    // timestamp — this reflects actual completion of the Sunbiz enrichment steps, not the
    // job-registry heartbeat which fires before those steps execute in runEnrichmentTick().
    const lastScheduledEnrichmentAtDerived = lastEnrichedAt?.toISOString() ?? null;

    // ── MI-02: sourceRegistryAdapters (additive) ─────────────────────────
    let sourceRegistryAdapters: Array<{
      adapterKey: string;
      lastImportStatus: string | null;
      lastCompletedAt: string | null;
      recordCount: number;
    }> = [];
    try {
      const regResult = await db.execute(sql`
        SELECT
          a.adapter_key,
          COUNT(DISTINCT ss.id)::int                AS record_count,
          MAX(r.completed_at)                       AS last_completed_at,
          (SELECT r2.status FROM source_import_runs r2
           WHERE r2.adapter_key = a.adapter_key
           ORDER BY r2.created_at DESC LIMIT 1)     AS last_import_status
        FROM source_registry_adapters a
        LEFT JOIN source_import_runs r ON r.adapter_key = a.adapter_key AND r.status = 'completed'
        LEFT JOIN cro03_source_subjects ss ON ss.source_system = a.adapter_key AND ss.tombstoned_at IS NULL
        GROUP BY a.adapter_key
        ORDER BY a.adapter_key
      `);
      sourceRegistryAdapters = ((regResult as any).rows ?? regResult).map((row: any) => ({
        adapterKey: row.adapter_key,
        lastImportStatus: row.last_import_status ?? null,
        lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
        recordCount: Number(row.record_count ?? 0),
      }));
    } catch {
      // sourceRegistryAdapters table may not exist in older schemas — degrade gracefully
      sourceRegistryAdapters = [];
    }

    // ── MI-05: CRO-03C provider spend aggregates (last 24 h) ─────────────
    // Source: cro03c_stage_operations (settled_units, settled_amount_micros).
    // cro03_provider_ledger is legacy and intentionally NOT queried here.
    let apolloDailySpend = 0;
    let outscraperDailySpend = 0;
    let serperDailySpend = 0;
    try {
      const spendResult = await db.execute(sql`
        SELECT
          provider,
          COALESCE(SUM(settled_amount_micros), 0)::bigint AS total_micros
        FROM cro03c_stage_operations
        WHERE completed_at >= NOW() - INTERVAL '24 hours'
          AND state = 'completed'
        GROUP BY provider
      `);
      const spendRows: any[] = (spendResult as any).rows ?? spendResult ?? [];
      for (const r of spendRows) {
        const micros = Number(r.total_micros ?? 0);
        if (r.provider === "apollo")     apolloDailySpend     = micros;
        if (r.provider === "outscraper") outscraperDailySpend = micros;
        if (r.provider === "serper")     serperDailySpend     = micros;
      }
    } catch {
      // cro03c_stage_operations may not have a settled_at column in all
      // environments — degrade gracefully.
    }

    return {
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
      // ── Worker-authority truth fields ───────────────────────────────────
      intakeAuthority,
      enrichmentProgressStatus,
      sunbizEnrichmentEnabled,
      freeEnrichmentPendingJobs:        freeEnrichPending,
      lastScheduledEnrichmentAt:        lastScheduledEnrichmentAtDerived,
      // ── MI-04: Canonical free enrichment queue depth ────────────────────
      canonicalFreeEnrichmentQueueDepth,
      // ── MI-02: Source registry adapters (additive) ─────────────────────
      sourceRegistryAdapters,
      // ── MI-05: Provider spend (last 24 h, from cro03c_stage_operations) ─
      apolloDailySpend,
      outscraperDailySpend,
      serperDailySpend,
    };
  }

  /**
   * Coalescing cache refresh: concurrent misses all await the **same** in-flight
   * Promise.  Both the creator and any joiners go through the same stale-fallback
   * try/catch, so every caller gets stale data (with isStale:true) when the
   * computation fails and a previous cache entry exists.
   *
   * Generation tracking prevents a stale/orphaned computation (e.g. one that was
   * started before a manual cache invalidation) from overwriting a newer result or
   * clearing a newer _healthInflight value.
   */
  async function getOrRefreshHealth(): Promise<{ data: any; isStale: boolean }> {
    const now = Date.now();
    const ttl = HEALTH_CACHE_TEST_MODE ? 0 : HEALTH_CACHE_TTL_MS;
    if (_healthCache && now - _healthCache.ts < ttl) {
      return { data: _healthCache.data, isStale: false };
    }

    if (!_healthInflight) {
      // First caller after a cache miss — own this generation and start computation.
      const gen = ++_healthGeneration;
      _healthInflight = runHealthComputation()
        .then((data) => {
          if (HEALTH_CACHE_TEST_MODE) _healthTestRoundTrips++;
          // Only publish if our generation is still current (not superseded by reset).
          if (_healthGeneration === gen) {
            _healthCache = { data, ts: Date.now() };
          }
          return data;
        })
        .finally(() => {
          // Only clear the shared pointer if it is still ours.
          if (_healthGeneration === gen) {
            _healthInflight = null;
          }
        });
      // Note: rejection is intentionally left unhandled on the promise itself so
      // that all awaiting callers (below) receive the rejection and can apply the
      // stale-fallback logic uniformly.
    }

    // Every caller — creator and all joiners — awaits here with the same error
    // handling so stale-data fallback is applied to every concurrent request.
    try {
      const data = await _healthInflight!;
      return { data, isStale: false };
    } catch (err) {
      if (_healthCache) {
        console.error("[LeadOps] health refresh failed — serving stale cache:", (err as Error)?.message);
        return { data: _healthCache.data, isStale: true };
      }
      throw err;
    }
  }

  app.get("/api/lead-ops/health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const { data, isStale } = await getOrRefreshHealth();
      // Always inject the live in-memory counter (not cached — resets on restart).
      res.json({
        ...data,
        legacyRouteAttemptsSinceStartup: _legacyRouteAttemptsSinceStartup,
        ...(isStale ? { isStale: true } : {}),
        ...(HEALTH_CACHE_TEST_MODE ? { __dbRoundTrips: _healthTestRoundTrips } : {}),
      });
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

      // Bust the health cache so the next poll reflects updated counts.
      // Incrementing _healthGeneration orphans any in-flight computation: its
      // .then() and .finally() callbacks will see a generation mismatch and
      // will neither overwrite _healthCache nor clear _healthInflight.
      _healthCache = null;
      _healthGeneration++;
      _healthInflight = null;

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

  // ── GET /api/lead-ops/businesses/:businessId ──────────────────────────────
  // MI-04: Returns a single businesses row plus its processor_signals rows.
  // NOTE: Do NOT reuse the Sunbiz /entities endpoint — businesses and sunbiz_entities
  // are separate tables with different schemas.
  app.get("/api/lead-ops/businesses/:businessId", requireRole("admin", "manager"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    try {
      const [bizResult, signalsResult] = await Promise.all([
        db.execute(sql`
          SELECT id, canonical_name, normalized_name, website_domain, main_phone, main_email,
                 city, state, vertical, status,
                 free_enrichment_status, free_enrichment_attempt_count,
                 free_enrichment_last_attempt_at, free_enrichment_completed_at,
                 free_enrichment_last_error_code, free_enrichment_evidence
          FROM businesses WHERE id = ${businessId}
        `),
        db.execute(sql`
          SELECT id, signal_type, vendor_name, detection_method, confidence_score, evidence, detected_at
          FROM processor_signals WHERE business_id = ${businessId}
          ORDER BY detected_at DESC
        `).catch(() => null),
      ]);
      const biz = ((bizResult as any).rows ?? bizResult)[0];
      if (!biz) return res.status(404).json({ error: "Business not found" });
      const signals = ((signalsResult as any)?.rows ?? signalsResult) ?? [];
      res.json({ business: biz, processorSignals: signals });
    } catch (err: any) {
      console.error("[LeadOps] businesses/:id error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load business" });
    }
  });

  // ── POST /api/lead-ops/businesses/:businessId/enrich-free ─────────────────
  // MI-04: Manually enqueue a single free enrichment job for a canonical business.
  // Returns 202. Must use /businesses/:businessId — NOT /entities/:id.
  app.post("/api/lead-ops/businesses/:businessId/enrich-free", requireRole("admin", "manager"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    try {
      // Validate the business is canonical before enqueueing
      const bizCheck = await db.execute(sql`
        SELECT id, record_class FROM businesses WHERE id = ${businessId}
      `);
      const biz = ((bizCheck as any).rows ?? bizCheck)[0];
      if (!biz) return res.status(404).json({ error: "Business not found" });
      if (biz.record_class !== "canonical") {
        return res.status(422).json({
          error: `Business #${businessId} has record_class='${biz.record_class}'; only canonical businesses are eligible for free enrichment`
        });
      }

      const { requireQueueManagerReady, QUEUE_NAMES } = await import("../services/queue-manager");
      const qm = requireQueueManagerReady();
      const enrichmentQueue = qm.getQueue(QUEUE_NAMES.ENRICHMENT);
      if (!enrichmentQueue) return res.status(503).json({ error: "Enrichment queue not available" });

      await enrichmentQueue.add(
        "free-contact-enrichment",
        { businessId },
        {
          jobId: `free-business-enrichment-manual-${businessId}-${Date.now()}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        }
      );
      res.status(202).json({ queued: true, businessId });
    } catch (err: any) {
      console.error("[LeadOps] enrich-free error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to enqueue enrichment" });
    }
  });

  // ── GET /api/lead-ops/canonical-summary ──────────────────────────────────
  // MI-03: On-demand diagnostic endpoint for canonical pipeline health.
  // Returns canonicalBusinessesCount and openConflictEvidenceCount without
  // blocking the 60-second health cache on large table scans.
  app.get("/api/lead-ops/canonical-summary", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const [businessResult, conflictResult] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int AS count FROM businesses WHERE id > 0`),
        db.execute(sql`SELECT COUNT(*)::int AS count FROM canonical_conflict_evidence WHERE status='open'`).catch(() => null),
      ]);
      const canonicalBusinessesCount = Number(((businessResult as any).rows ?? businessResult)[0]?.count ?? 0);
      const openConflictEvidenceCount = conflictResult
        ? Number(((conflictResult as any).rows ?? conflictResult)[0]?.count ?? 0)
        : null;
      res.json({ canonicalBusinessesCount, openConflictEvidenceCount });
    } catch (err: any) {
      console.error("[LeadOps] canonical-summary error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load canonical summary" });
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
