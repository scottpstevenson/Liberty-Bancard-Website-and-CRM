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
    const [enrichResult, freeEnrichResult, canonicalFreeEnrichResult, paidQueueResult, jobRow, progressRaw] = await Promise.all([
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
      }).catch(() => null),
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
        `).catch(() => null),
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
      // Paid CRO-03C work is represented by reserved/pending/running stage
      // operations.  This is deliberately separate from the canonical free
      // enrichment predicate above.
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM cro03c_stage_operations
        WHERE state IN ('reserved', 'pending', 'running')
      `).catch(() => null),
      db.select({ lastFinishedAt: backgroundJobs.lastFinishedAt })
        .from(backgroundJobs)
        .where(eq(backgroundJobs.jobName, "enrichment-queue-processor"))
        .limit(1).catch(() => []),
      storage.getSystemSetting("enrichment_progress").catch(() => null),
    ]);

    const enrichRows = enrichResult ? ((enrichResult as any).rows ?? enrichResult) : [];
    const row = enrichRows[0] || {};
    const throughputAvailable = !!enrichResult;
    const metric = (value: number | string | null, available = true, error?: string) => ({
      value, available, stale: false, ...(error ? { error } : {}),
    });
    const successRate = (Number(row.total_enriched ?? 0) + Number(row.total_failed ?? 0)) > 0
      ? Math.round((Number(row.total_enriched ?? 0) / (Number(row.total_enriched ?? 0) + Number(row.total_failed ?? 0))) * 100)
      : 0;

    const lastEnrichedAt = row.last_enriched_at ? new Date(row.last_enriched_at) : null;
    const minutesSinceLastJob = lastEnrichedAt
      ? Math.floor((Date.now() - lastEnrichedAt.getTime()) / 60000)
      : null;
    const workerActive = minutesSinceLastJob !== null && minutesSinceLastJob < 15;

    const freeEnrichPending = Number(freeEnrichResult?.[0]?.count ?? 0);
    // Per-metric availability: .catch(() => null) means null = query failed.
    // Must NOT coerce null to 0 — that makes a failed query look like a healthy zero backlog.
    const canonicalFreeQueueAvailable = canonicalFreeEnrichResult !== null;
    const canonicalFreeEnrichmentQueueDepth = canonicalFreeQueueAvailable
      ? Number(((canonicalFreeEnrichResult as any)?.rows ?? canonicalFreeEnrichResult)?.[0]?.count ?? 0)
      : null;
    const paidQueueAvailable = paidQueueResult !== null;
    const paidQueueDepth = paidQueueAvailable
      ? Number(((paidQueueResult as any)?.rows ?? paidQueueResult)?.[0]?.count ?? 0)
      : null;
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
    let sourceRegistryCounts: any = {
      canonicalBusinesses: { value: 0, available: false, stale: false, error: "query_failed" },
      sourceLinks: { value: 0, available: false, stale: false, error: "query_failed" },
      adapters: { value: 0, available: false, stale: false, error: "query_failed" },
    };
    try {
      const [regResult, countResult] = await Promise.all([db.execute(sql`
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
      `), db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM businesses WHERE record_class = 'canonical') AS canonical_businesses,
          (SELECT COUNT(*)::int FROM canonical_source_links) AS source_links,
          (SELECT COUNT(*)::int FROM source_registry_adapters) AS adapters
      `)]);
      sourceRegistryAdapters = ((regResult as any).rows ?? regResult).map((row: any) => ({
        adapterKey: row.adapter_key,
        lastImportStatus: row.last_import_status ?? null,
        lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
        recordCount: Number(row.record_count ?? 0),
      }));
      const counts = ((countResult as any).rows ?? countResult)[0] ?? {};
      sourceRegistryCounts = {
        canonicalBusinesses: { value: Number(counts.canonical_businesses ?? 0), available: true, stale: false },
        sourceLinks: { value: Number(counts.source_links ?? 0), available: true, stale: false },
        adapters: { value: Number(counts.adapters ?? 0), available: true, stale: false },
      };
    } catch {
      // sourceRegistryAdapters table may not exist in older schemas — degrade gracefully
      sourceRegistryAdapters = [];
      sourceRegistryCounts = {
        canonicalBusinesses: { value: 0, available: false, stale: false, error: "query_failed" },
        sourceLinks: { value: 0, available: false, stale: false, error: "query_failed" },
        adapters: { value: 0, available: false, stale: false, error: "query_failed" },
      };
    }

    // ── MI-05: CRO-03C provider spend aggregates (last 24 h) ─────────────
    // Source: cro03c_stage_operations (settled_units, settled_amount_micros).
    // cro03_provider_ledger is legacy and intentionally NOT queried here.
    let apolloDailySpend = metric(null, false, "query_failed");
    let outscraperDailySpend = metric(null, false, "query_failed");
    let serperDailySpend = metric(null, false, "query_failed");
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
      // After a successful aggregate query, all three metrics are available even if
      // zero rows match (= no spend today, not a query failure).
      // Initialize to available-zero, then overwrite with actual values.
      apolloDailySpend     = metric(0);
      outscraperDailySpend = metric(0);
      serperDailySpend     = metric(0);
      for (const r of spendRows) {
        const micros = Number(r.total_micros ?? 0);
        if (r.provider === "apollo")     apolloDailySpend     = metric(micros);
        if (r.provider === "outscraper") outscraperDailySpend = metric(micros);
        if (r.provider === "serper")     serperDailySpend     = metric(micros);
      }
    } catch (err: any) {
      // cro03c_stage_operations may not have a settled_at column in all
      // environments — degrade gracefully.
      const error = String(err?.message ?? "query_failed");
      apolloDailySpend = metric(null, false, error);
      outscraperDailySpend = metric(null, false, error);
      serperDailySpend = metric(null, false, error);
    }

    // ── MI-08: Per-named-worker heartbeat status ──────────────────────────
    // Each named worker is queried from background_jobs.
    // Returns per-metric { value, available, stale, staleSince? } objects.
    // Job names MUST match JOB_NAMES constants in server/services/job-registry.ts.
    // master-lead-stager uses BullMQ only (no acquireJobLock), so it is not in
    // background_jobs. It is surfaced via audit_logs last-action instead.
    const NAMED_WORKERS = [
      { key: "enrichment",     jobName: "enrichment-queue-processor" },
      { key: "ghlSync",        jobName: "ghl-sync" },
      { key: "sequenceWorker", jobName: "sequence-worker" },
      { key: "slaWorker",      jobName: "sla-worker" },
    ] as const;

    const now2 = Date.now();
    const STALE_WORKER_MS = 30 * 60 * 1000; // 30 minutes
    let workerHeartbeats: Record<string, { available: boolean; stale: boolean; staleSince?: string; lastFinishedAt?: string | null; status?: string | null; consecutiveFailures?: number | null; minutesSince?: number | null; error?: string }> = {};
    try {
      // No .catch() here — query failures must surface as query_failed, not not_registered.
      const wRows = await db.execute(sql`
        SELECT job_name, status, last_finished_at, consecutive_failures
        FROM background_jobs
        WHERE job_name = ANY(ARRAY[${sql.raw(NAMED_WORKERS.map(w => `'${w.jobName}'`).join(","))}])
      `);
      const wData: any[] = (wRows as any)?.rows ?? wRows ?? [];
      const wMap: Record<string, any> = {};
      for (const r of wData) wMap[r.job_name] = r;

      for (const w of NAMED_WORKERS) {
        const r = wMap[w.jobName];
        if (!r) {
          workerHeartbeats[w.key] = { available: false, stale: false, error: "not_registered" };
          continue;
        }
        const lastAt = r.last_finished_at ? new Date(r.last_finished_at) : null;
        const msAgo = lastAt ? now2 - lastAt.getTime() : null;
        const stale = msAgo !== null ? msAgo > STALE_WORKER_MS : true;
        // A worker whose last run failed must be shown as failed/degraded, not green Active.
        // consecutive_failures > 0 or status = 'failed' indicates a degraded worker.
        const consecutiveFailures = Number(r.consecutive_failures ?? 0);
        workerHeartbeats[w.key] = {
          available: true,
          stale,
          ...(stale ? { staleSince: lastAt?.toISOString() ?? new Date(now2).toISOString() } : {}),
          lastFinishedAt: lastAt?.toISOString() ?? null,
          status: r.status ?? null,
          consecutiveFailures,
          minutesSince: msAgo !== null ? Math.floor(msAgo / 60000) : null,
        };
      }

      // ── master-lead-stager: BullMQ-only worker, not registered in background_jobs.
      // BullMQ worker liveness cannot be reliably derived from audit_logs: an idle
      // but healthy stager emits no audit events and would appear stale after 30 min.
      // Failed BullMQ jobs also do not surface consecutive_failures here.
      // Mark explicitly as not monitorable via this mechanism.
      workerHeartbeats.stager = {
        available: false,
        stale: false,
        error: "bullmq_only",
      };
    } catch {
      // Worker heartbeat query failed — mark all unavailable
      for (const w of NAMED_WORKERS) {
        workerHeartbeats[w.key] = { available: false, stale: false, error: "query_failed" };
      }
      workerHeartbeats.stager = { available: false, stale: false, error: "query_failed" };
    }

    // ── MI-08: Pipeline counts from /api/master-leads/pipeline-stats ────
    // These are fetched in-process for the health endpoint.
    // Pipeline counts mirror the authoritative /api/master-leads/pipeline-stats
    // predicates (server/routes/imports.ts:2776-2813):
    //  - staged/promoted: master_leads WHERE pipeline_origin='cro03_pipeline'
    //  - suppressed/duplicate: master_lead_staging_receipts by disposition
    //  - readyToPromote: JOIN businesses on email_discovery_status='provider_valid'
    //    AND NOT EXISTS open canonical_conflict_evidence
    // master_leads does NOT have open_conflict_count or email_discovery_status columns.
    let pipelineCounts: { value: { staged: number; readyToPromote: number; promoted: number; suppressed: number; duplicates: number } | null; available: boolean; stale: boolean; error?: string } = { value: null, available: false, stale: false };
    try {
      const [stagedResult, suppressedResult, duplicateResult, promotedResult, readyResult] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int AS cnt FROM master_leads WHERE pipeline_origin='cro03_pipeline' AND status='staged'`),
        db.execute(sql`SELECT COUNT(*)::int AS cnt FROM master_lead_staging_receipts WHERE disposition='suppressed'`),
        db.execute(sql`SELECT COUNT(*)::int AS cnt FROM master_lead_staging_receipts WHERE disposition='duplicate'`),
        db.execute(sql`SELECT COUNT(*)::int AS cnt FROM master_leads WHERE pipeline_origin='cro03_pipeline' AND status='promoted'`),
        db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM master_leads ml
          JOIN businesses b ON b.id = ml.canonical_business_id
          WHERE ml.pipeline_origin = 'cro03_pipeline'
            AND ml.status = 'staged'
            AND b.email_discovery_status = 'provider_valid'
            AND NOT EXISTS (
              SELECT 1 FROM canonical_conflict_evidence cce
              WHERE (cce.business_id_a = ml.canonical_business_id OR cce.business_id_b = ml.canonical_business_id)
                AND cce.status = 'open'
            )
        `),
      ]);
      const cnt = (r: any) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0);
      pipelineCounts = {
        available: true, stale: false,
        value: {
          staged:         cnt(stagedResult),
          readyToPromote: cnt(readyResult),
          promoted:       cnt(promotedResult),
          suppressed:     cnt(suppressedResult),
          duplicates:     cnt(duplicateResult),
        },
      };
    } catch (err: any) {
      // A failed DB query must never be collapsed to zero. Return available:false
      // with an error indicator so the UI can distinguish a real zero from a failure.
      pipelineCounts = { value: null, available: false, stale: false, error: String(err?.message ?? "query_failed") };
    }

    return {
      enrichedToday:        metric(Number(row.enriched_today ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      emailsToday:          metric(Number(row.emails_today ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      phonesToday:          metric(Number(row.phones_today ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      queueDepth:           metric(Number(row.queue_depth ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      totalEnriched:        metric(Number(row.total_enriched ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      totalFailed:          metric(Number(row.total_failed ?? 0), throughputAvailable, throughputAvailable ? undefined : "query_failed"),
      successRate:          metric(successRate, throughputAvailable, throughputAvailable ? undefined : "query_failed"),
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
      sourceRegistryCounts,
      // ── MI-05: Provider spend (last 24 h, from cro03c_stage_operations) ─
      apolloDailySpend,
      outscraperDailySpend,
      serperDailySpend,
      // ── MI-08: Per-named-worker heartbeats (per-metric availability) ────
      workerHeartbeats,
      // ── MI-08: Pipeline counts (from master_leads) ──────────────────────
      pipelineCounts,
      // ── MI-08: Free enrichment queue split ──────────────────────────────
      // Queue depths wrapped with availability metadata so UI can distinguish
      // a real zero from an unavailable/failed query (fail-closed behavior).
      freeEnrichQueueDepth: {
        free: canonicalFreeQueueAvailable
          ? { value: canonicalFreeEnrichmentQueueDepth, available: true }
          : { value: null, available: false, error: "query_failed" },
        paid: paidQueueAvailable
          ? { value: paidQueueDepth, available: true }
          : { value: null, available: false, error: "query_failed" },
      },
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
  // MI-04 + MI-08: Returns a single businesses row, processor_signals, and
  // MI-08 evidence chain (source links, source observations, qualification
  // decisions, field claim, master_lead staging state).
  // Role: admin + manager (existing). MI-08 adds role-based field redaction:
  // agent role must not receive unmasked email or phone (agent cannot reach
  // this route — requireRole blocks them — but the redaction is documented
  // here for future agent-safe view tasks).
  // NOTE: Do NOT reuse the Sunbiz /entities endpoint — businesses and sunbiz_entities
  // are separate tables with different schemas.
  app.get("/api/lead-ops/businesses/:businessId", requireRole("admin", "manager"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    try {
      const [bizResult, signalsResult] = await Promise.all([
        db.execute(sql`
          SELECT id, canonical_name, normalized_name, website_domain, main_phone, main_email,
                 city, state, vertical, status, street_address, latitude, longitude,
                 free_enrichment_status, free_enrichment_attempt_count,
                 free_enrichment_last_attempt_at, free_enrichment_completed_at,
                 free_enrichment_last_error_code, free_enrichment_evidence,
                 email_discovery_status, email_validation_updated_at,
                 email_selected_candidate_hash, email_outreach_catch_all_approved_at,
                 email_outreach_approved_by, record_class, created_at, updated_at
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

      // MI-06: derive isStale boolean from email_validation_updated_at.
      // Kill line: do NOT mutate email_discovery_status during GET handler.
      const STALE_DAYS = 90;
      const emailValidationUpdatedAt = biz.email_validation_updated_at ? new Date(biz.email_validation_updated_at) : null;
      const isStale = emailValidationUpdatedAt
        ? (Date.now() - emailValidationUpdatedAt.getTime()) > STALE_DAYS * 24 * 3600 * 1000 &&
          biz.email_discovery_status === "provider_valid"
        : false;

      // MI-06: load winner selection and pending intent for this business (if any).
      // MI-08: load evidence chain in parallel.
      const [winnerResult, intentResult, sourceLinksResult, qualDecisionResult, fieldClaimResult, masterLeadResult, sourceObservationsResult, existingContactResult] = await Promise.all([
        db.execute(sql`
          SELECT ws.id, ws.source, ws.subject_type, ws.confidence, ws.state,
                 ws.normalized_value_hash, ce.masked_value
            FROM cro03c_email_winner_selections ws
            LEFT JOIN cro03c_candidate_evidence ce ON ce.id = ws.candidate_evidence_id
           WHERE ws.business_id = ${businessId} AND ws.state = 'selected'
           ORDER BY ws.created_at DESC LIMIT 1
        `).catch(() => null),
        db.execute(sql`
          SELECT id, state, approval_required, apollo_match_confidence, disposition,
                 attempt_count, created_at
            FROM business_validation_intents
           WHERE business_id = ${businessId}
             AND state NOT IN ('superseded','revoked','completed','failed')
           ORDER BY created_at DESC LIMIT 1
        `).catch(() => null),
        // MI-08: source provenance chain
        db.execute(sql`
          SELECT csl.id, csl.source_system, csl.source_type, csl.stable_key,
                 csl.registry_id, csl.first_seen_at, csl.last_confirmed_at,
                 -- latest import run for this adapter
                 (SELECT sir.status FROM source_import_runs sir
                  WHERE sir.adapter_key = csl.source_system
                  ORDER BY sir.created_at DESC LIMIT 1) AS last_import_status,
                 (SELECT sir.completed_at FROM source_import_runs sir
                  WHERE sir.adapter_key = csl.source_system AND sir.status = 'completed'
                  ORDER BY sir.completed_at DESC LIMIT 1) AS last_import_completed_at,
                 -- adapter metadata
                 (SELECT sra.source_name FROM source_registry_adapters sra
                  WHERE sra.adapter_key = csl.source_system LIMIT 1) AS adapter_source_name,
                 (SELECT sra.source_type FROM source_registry_adapters sra
                  WHERE sra.adapter_key = csl.source_system LIMIT 1) AS adapter_source_type
          FROM canonical_source_links csl
          WHERE csl.business_id = ${businessId}
          ORDER BY csl.last_confirmed_at DESC
          LIMIT 10
        `).catch(() => null),
        // MI-08: latest qualification decision via cro03a_handoffs + cro03a_qualification_decisions.
        // Correlate on BOTH source_type AND stable_key from canonical_source_links to ensure
        // we return the decision for THIS business, not another business on the same source system.
        db.execute(sql`
          SELECT qd.id, qd.disposition, qd.score, qd.reason_codes, qd.fit_components,
                 qd.missing_field_classes, qd.created_at,
                 h.source_type, h.source_system, h.source_key
          FROM canonical_source_links csl
          JOIN cro03a_handoffs h
            ON h.source_system = csl.source_system
           AND h.source_type   = csl.source_type
           AND h.source_key    = csl.stable_key
          JOIN cro03a_qualification_decisions qd ON qd.id = h.decision_id
          WHERE csl.business_id = ${businessId}
          ORDER BY qd.created_at DESC LIMIT 1
        `).catch(() => null),
        // MI-08: active field claim for this business
        db.execute(sql`
          SELECT frs.id, frs.status, frs.claimed_at, frs.claimed_by_user_id,
                 u.email AS claimed_by_email
          FROM field_route_stops frs
          LEFT JOIN users u ON u.id = frs.claimed_by_user_id
          WHERE frs.business_id = ${businessId} AND frs.status = 'claimed'
          ORDER BY frs.claimed_at DESC LIMIT 1
        `).catch(() => null),
        // MI-08: master_lead staging state for this business.
        // NOTE: master_leads does NOT have open_conflict_count or email_discovery_status.
        // Actual columns: id, status, fit_tier, quality_score, email_type, email_valid,
        // suppression_reason, promoted_at, created_at, pipeline_origin, canonical_business_id.
        db.execute(sql`
          SELECT id, status, fit_tier, quality_score, email_type, email_valid,
                  suppression_reason, promoted_at, created_at, county_fips
          FROM master_leads
          WHERE canonical_business_id = ${businessId}
            AND pipeline_origin = 'cro03_pipeline'
          ORDER BY created_at DESC LIMIT 1
        `).catch(() => null),
        // MI-08: source observations/occurrences — operating status evidence.
        // Joins canonical_source_links → cro03_source_subjects → cro03_source_observations.
        // cro03_source_observations.payload is encrypted (payloadHash only, not decrypted here).
        db.execute(sql`
          SELECT obs.id, obs.observed_at, obs.observed_by_actor_type,
                 obs.provenance, obs.payload_hash,
                 occ.source_observed_at, occ.timestamp_provenance, occ.source_event_key,
                 ss.source_system, ss.subject_type, ss.subject_key
          FROM canonical_source_links csl
          JOIN cro03_source_subjects ss
            ON ss.source_system = csl.source_system
           AND ss.subject_type  = csl.source_type
           AND ss.subject_key   = csl.stable_key
          JOIN cro03_source_observations obs ON obs.source_subject_id = ss.id
          JOIN cro03_source_occurrences  occ ON occ.source_observation_id = obs.id
          WHERE csl.business_id = ${businessId}
          ORDER BY occ.source_observed_at DESC
          LIMIT 5
        `).catch(() => null),
        // Existing contact/customer check. Contacts stores the canonical phone
        // in its legacy phone column, so normalize digits at comparison time;
        // website is similarly normalized to a hostname before comparing.
        db.execute(sql`
          SELECT c.id, c.email_status, c.phone, c.lifecycle_state
          FROM contacts c
          CROSS JOIN businesses b
          WHERE b.id = ${businessId}
            AND (
              (b.email_selected_candidate_hash IS NOT NULL
                AND c.email_token_hash = b.email_selected_candidate_hash)
              OR (
                b.main_phone IS NOT NULL
                AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g')
                    = regexp_replace(b.main_phone, '[^0-9]', '', 'g')
              )
              OR (
                b.website_domain IS NOT NULL
                AND regexp_replace(
                  regexp_replace(lower(COALESCE(c.website, '')), '^https?://(www\\.)?', ''),
                  '/.*$', ''
                ) = lower(b.website_domain)
              )
            )
          LIMIT 1
        `).catch(() => null),
      ]);

      const winnerSelection = winnerResult ? (((winnerResult as any).rows ?? winnerResult)[0] ?? null) : null;
      const pendingIntent = intentResult ? (((intentResult as any).rows ?? intentResult)[0] ?? null) : null;
      const sourceLinks = (sourceLinksResult as any)?.rows ?? sourceLinksResult ?? [];
      const qualDecision = qualDecisionResult ? (((qualDecisionResult as any).rows ?? qualDecisionResult)[0] ?? null) : null;
      const fieldClaim = fieldClaimResult ? (((fieldClaimResult as any).rows ?? fieldClaimResult)[0] ?? null) : null;
      const masterLead = masterLeadResult ? (((masterLeadResult as any).rows ?? masterLeadResult)[0] ?? null) : null;
      // sourceObservations: operating-status evidence from cro03_source_observations/occurrences.
      // Raw payload is NOT returned (encrypted in DB); only provenance metadata is exposed.
      const sourceObservations: any[] = (sourceObservationsResult as any)?.rows ?? sourceObservationsResult ?? [];
      // Track query success/failure separately from "no match found".
      // null existingContactResult means the query threw (catch → null);
      // a successful query with no rows returns an empty array → existingContact = null.
      const contactMatchAvailable = existingContactResult !== null;
      const existingContact = contactMatchAvailable
        ? (((existingContactResult as any).rows ?? existingContactResult)[0] ?? null)
        : null;

      // MI-08: count open conflicts from canonical_conflict_evidence (the authoritative source).
      // Used in safeNextAction derivation and returned on masterLead for the UI.
      // MUST NOT fail open: a query failure must be represented as unknown, not zero.
      let openConflictCount = 0;
      let conflictEvidenceAvailable = false;
      try {
        const conflictResult = await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM canonical_conflict_evidence
          WHERE (business_id_a = ${businessId} OR business_id_b = ${businessId})
            AND status = 'open'
        `);
        openConflictCount = Number(((conflictResult as any).rows ?? conflictResult)[0]?.cnt ?? 0);
        conflictEvidenceAvailable = true;
      } catch {
        // Query failed — treat as unknown (not promotable) to avoid fail-open.
        conflictEvidenceAvailable = false;
      }

      // MI-08: role-based field redaction.
      // agent role must not receive unmasked email or phone. admin/manager receive full data.
      // (requireRole currently blocks agents entirely, but redaction is applied defensively.)
      const userRole = (req as any).user?.role ?? "agent";
      const canSeeContactDetails = userRole === "admin" || userRole === "manager";
      const redactedBiz = {
        ...biz,
        main_email: canSeeContactDetails ? biz.main_email : null,
        main_phone: canSeeContactDetails ? biz.main_phone : null,
      };

      // MI-08: derive safe next action using authoritative predicates:
      // - conflict evidence from canonical_conflict_evidence (not a denormalized column)
      // - email validity from businesses.email_discovery_status = 'provider_valid'
      //   (matches the readiness predicate in /api/master-leads/pipeline-stats)
      // CRITICAL: promoted/suppressed lifecycle states are TERMINAL — they must be
      // checked first. Enrichment and readiness guidance must NEVER override terminal state.
      // This matches the list endpoint which also prioritizes promoted/suppressed first.
      const emailValid = biz.email_discovery_status === "provider_valid";
      let safeNextAction: string;
      if (masterLead?.status === "promoted") {
        safeNextAction = "already_promoted";
      } else if (masterLead?.status === "suppressed") {
        safeNextAction = "suppressed_no_action";
      } else if (masterLead?.status === "staged" && !conflictEvidenceAvailable) {
        // Cannot determine conflict state — do not derive promotable. Fail closed.
        safeNextAction = "resolve_conflicts_before_promotion";
      } else if (masterLead?.status === "staged" && !contactMatchAvailable) {
        // Cannot determine contact duplicate state — do not derive promotable. Fail closed.
        safeNextAction = "resolve_conflicts_before_promotion";
      } else if (masterLead?.status === "staged" && openConflictCount > 0) {
        safeNextAction = "resolve_conflicts_before_promotion";
      } else if (masterLead?.status === "staged" && emailValid && openConflictCount === 0 && existingContact) {
        // A duplicate contact match exists — must be resolved before promotion
        safeNextAction = "resolve_duplicate_contact_before_promotion";
      } else if (masterLead?.status === "staged" && emailValid && openConflictCount === 0) {
        safeNextAction = "ready_to_promote";
      } else if (!biz.email_discovery_status || biz.email_discovery_status === "no_valid_candidate") {
        safeNextAction = "run_email_discovery";
      } else if (biz.email_discovery_status === "provider_catch_all" && !biz.email_outreach_catch_all_approved_at) {
        safeNextAction = "approve_catch_all_for_outreach";
      } else if (!emailValid) {
        safeNextAction = "run_email_discovery";
      } else if (biz.free_enrichment_status === null || biz.free_enrichment_status === "failed") {
        safeNextAction = "run_free_enrichment";
      } else {
        safeNextAction = "monitor";
      }

      res.json({
        business: redactedBiz,
        processorSignals: signals,
        emailDiscoveryStatus: biz.email_discovery_status ?? null,
        emailValidationUpdatedAt: biz.email_validation_updated_at ?? null,
        isStale,
        winnerSelection,
        pendingIntent,
        // ── MI-08: evidence chain ────────────────────────────────────────────
        sourceLinks,
        qualificationDecision: qualDecision,
        fieldClaim: fieldClaim ? {
          status: fieldClaim.status,
          claimedAt: fieldClaim.claimed_at,
          claimedByUserId: fieldClaim.claimed_by_user_id,
          // agent email redacted from this endpoint since it's admin/manager only
          claimedByEmail: canSeeContactDetails ? fieldClaim.claimed_by_email : null,
        } : null,
        masterLead: masterLead ? { ...masterLead, openConflictCount } : null,
         contactMatchAvailable,
         existingContactMatch: existingContact ? {
           id: existingContact.id,
           emailStatus: existingContact.email_status ?? null,
           lifecycleState: existingContact.lifecycle_state ?? null,
         } : null,
         conflictCount: openConflictCount,
         conflictEvidenceAvailable,
        safeNextAction,
        // operating-status evidence from cro03_source_observations/occurrences
        // (provenance metadata only — raw payload not exposed)
        sourceObservations,
      });
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

  // ── MI-06: POST /api/lead-ops/businesses/:businessId/trigger-winner-selection ──
  // Manually triggers winner selection for a specific business (admin only).
  // Required for Phase 2 rollout.
  app.post("/api/lead-ops/businesses/:businessId/trigger-winner-selection", requireRole("admin"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    const { generationId } = req.body ?? {};
    if (!generationId || typeof generationId !== "string") {
      return res.status(400).json({ error: "generationId (string) is required" });
    }
    try {
      const { selectEmailWinner } = await import("../services/cro03/candidate-selector");
      const result = await selectEmailWinner(businessId, generationId);
      res.json(result);
    } catch (err: any) {
      console.error("[LeadOps] trigger-winner-selection error:", err?.message);
      res.status(500).json({ error: err?.message || "Winner selection failed" });
    }
  });

  // ── MI-06: POST /api/lead-ops/businesses/:businessId/approve-catch-all ───────
  // Approve a catch-all result for outreach use. Does NOT change email_discovery_status.
  // Only writes email_outreach_catch_all_approved_at and email_outreach_approved_by.
  app.post("/api/lead-ops/businesses/:businessId/approve-catch-all", requireRole("admin"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    try {
      const bizCheck = await db.execute(sql`
        SELECT id, email_discovery_status, email_selected_candidate_hash
          FROM businesses WHERE id = ${businessId}
      `);
      const biz = ((bizCheck as any).rows ?? bizCheck)[0];
      if (!biz) return res.status(404).json({ error: "Business not found" });
      if (biz.email_discovery_status !== "provider_catch_all") {
        return res.status(422).json({
          error: `Catch-all approval is only valid when email_discovery_status='provider_catch_all'. Current status: '${biz.email_discovery_status}'`,
        });
      }
      // CAS: bind approval to the current winning candidate hash.
      // Prevents stale approvals from authorizing future, different candidates.
      const selectedHash = biz.email_selected_candidate_hash;
      if (!selectedHash) {
        return res.status(422).json({ error: "No selected candidate hash — winner selection not yet complete." });
      }
      const actor = (req as any).user?.id ?? (req as any).user?.email ?? "admin";
      // Decrypt the winner candidate email so we can write main_email.
      // SDR consumers (compliance-engine, voice-orchestrator, sdr.ts) gate on
      // mainEmail IS NOT NULL — without this write, catch-all approval has no
      // outreach effect regardless of the approval metadata.
      const winnerEvidence = ((await db.execute(sql`
        SELECT ce.envelope_ciphertext, ce.envelope_nonce, ce.envelope_tag,
               ce.envelope_key_version, ce.field
          FROM cro03c_email_winner_selections ws
          JOIN cro03c_candidate_evidence ce ON ce.id = ws.candidate_evidence_id
         WHERE ws.business_id = ${businessId}
           AND ws.state = 'selected'
           AND ws.normalized_value_hash = ${String(selectedHash)}
         LIMIT 1
      `)) as any)?.rows?.[0];
      if (!winnerEvidence) {
        return res.status(422).json({ error: "Winner candidate evidence not found for the current selected hash." });
      }

      let decryptedEmail: string;
      try {
        const { unseal } = await import("../services/cro03/candidate-evidence-service");
        decryptedEmail = unseal(String(winnerEvidence.field), {
          ciphertext: String(winnerEvidence.envelope_ciphertext),
          nonce: String(winnerEvidence.envelope_nonce),
          tag: String(winnerEvidence.envelope_tag),
          keyVersion: Number(winnerEvidence.envelope_key_version),
        });
      } catch {
        return res.status(500).json({ error: "Failed to decrypt winner email for approval." });
      }

      const updated = ((await db.execute(sql`
        UPDATE businesses
           SET email_outreach_catch_all_approved_at = NOW(),
               email_outreach_approved_by = ${String(actor)},
               email_outreach_approved_candidate_hash = ${String(selectedHash)},
               main_email = ${decryptedEmail},
               updated_at = NOW()
         WHERE id = ${businessId}
           AND email_discovery_status = 'provider_catch_all'
           AND email_selected_candidate_hash = ${String(selectedHash)}
         RETURNING id
      `)) as any)?.rows ?? [];
      if (updated.length === 0) {
        return res.status(409).json({
          error: "Approval CAS failed — email_discovery_status or selected candidate hash changed concurrently.",
        });
      }
      res.json({
        success: true,
        message: "Catch-all approved for outreach. main_email written from winner candidate. email_discovery_status unchanged.",
        emailDiscoveryStatus: biz.email_discovery_status,
        approvedCandidateHash: selectedHash,
      });
    } catch (err: any) {
      console.error("[LeadOps] approve-catch-all error:", err?.message);
      res.status(500).json({ error: err?.message || "Approval failed" });
    }
  });

  // ── MI-06: POST /api/lead-ops/businesses/:businessId/approve-medium-confidence-validation ──
  // Approve a medium-confidence intent for ZeroBounce validation.
  // Sets approval_required=FALSE so the intent can be claimed.
  // SEPARATE from catch-all approval — different route, different modal, different action.
  app.post("/api/lead-ops/businesses/:businessId/approve-medium-confidence-validation", requireRole("admin"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    const { intentId } = req.body ?? {};
    if (!intentId || typeof intentId !== "string") {
      return res.status(400).json({ error: "intentId (string) is required" });
    }
    try {
      const intentCheck = await db.execute(sql`
        SELECT id, state, approval_required, apollo_match_confidence
          FROM business_validation_intents
         WHERE id = ${intentId}::uuid AND business_id = ${businessId}
      `);
      const intent = ((intentCheck as any).rows ?? intentCheck)[0];
      if (!intent) return res.status(404).json({ error: "Intent not found for this business" });
      if (intent.state !== "pending" || !intent.approval_required) {
        return res.status(422).json({
          error: `Intent must be in state='pending' with approval_required=TRUE. State: '${intent.state}', approval_required: ${intent.approval_required}`,
        });
      }
      await db.execute(sql`
        UPDATE business_validation_intents
           SET approval_required = FALSE, updated_at = NOW()
         WHERE id = ${intentId}::uuid
           AND business_id = ${businessId}
           AND state = 'pending'
           AND approval_required = TRUE
      `);
      res.json({
        success: true,
        message: "Medium-confidence intent approved for ZeroBounce validation.",
        intentId,
        note: "The intent is now eligible for claim. This does NOT approve for outreach — ZeroBounce must confirm validity first.",
      });
    } catch (err: any) {
      console.error("[LeadOps] approve-medium-confidence-validation error:", err?.message);
      res.status(500).json({ error: err?.message || "Approval failed" });
    }
  });

  // ── GET /api/lead-ops/businesses ─────────────────────────────────────────
  // MI-08: Paginated canonical businesses list for the Businesses tab.
  // Supports search, vertical filter, email_discovery_status filter, fit-tier
  // (from master_leads). Role: admin, manager.
  app.get("/api/lead-ops/businesses", requireRole("admin", "manager"), async (req, res) => {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const vertical = typeof req.query.vertical === "string" ? req.query.vertical : "";
    const emailStatus = typeof req.query.emailStatus === "string" ? req.query.emailStatus : "";

    try {
      const rows = await db.execute(sql`
        SELECT
          b.id,
          b.canonical_name,
          b.website_domain,
          b.city,
          b.state,
          b.vertical,
          b.record_class,
          b.free_enrichment_status,
          b.email_discovery_status,
          b.email_validation_updated_at,
          b.latitude,
          b.longitude,
          b.street_address,
           -- County is carried by the CRO-03 pipeline master lead row.
           (SELECT ml.county_fips FROM master_leads ml
            WHERE ml.canonical_business_id = b.id
            ORDER BY ml.created_at DESC LIMIT 1)              AS county_fips,
          b.main_phone,
          b.main_email,
          b.created_at,
          -- Latest master_lead fit_tier for this business
          (SELECT ml.fit_tier FROM master_leads ml
           WHERE ml.canonical_business_id = b.id
           ORDER BY ml.created_at DESC LIMIT 1)              AS fit_tier,
          -- Active field claim
          (SELECT frs.status FROM field_route_stops frs
           WHERE frs.business_id = b.id AND frs.status = 'claimed'
            ORDER BY frs.claimed_at DESC LIMIT 1)              AS field_claim_status,
           (SELECT frs.claimed_at FROM field_route_stops frs
            WHERE frs.business_id = b.id AND frs.status = 'claimed'
            ORDER BY frs.claimed_at DESC LIMIT 1)              AS field_claimed_at,
           (SELECT u.email
            FROM field_route_stops frs
            LEFT JOIN users u ON u.id = frs.claimed_by_user_id
            WHERE frs.business_id = b.id AND frs.status = 'claimed'
            ORDER BY frs.claimed_at DESC LIMIT 1)              AS field_claimed_by_email,
           CASE
             WHEN (SELECT ml.status FROM master_leads ml
                   WHERE ml.canonical_business_id = b.id AND ml.pipeline_origin = 'cro03_pipeline'
                   ORDER BY ml.created_at DESC LIMIT 1) = 'promoted' THEN 'already_promoted'
             WHEN (SELECT ml.status FROM master_leads ml
                   WHERE ml.canonical_business_id = b.id AND ml.pipeline_origin = 'cro03_pipeline'
                   ORDER BY ml.created_at DESC LIMIT 1) = 'suppressed' THEN 'suppressed_no_action'
             WHEN b.email_discovery_status IS NULL OR b.email_discovery_status = 'no_valid_candidate' THEN 'run_email_discovery'
             WHEN b.email_discovery_status = 'provider_catch_all'
               AND b.email_outreach_catch_all_approved_at IS NULL THEN 'approve_catch_all_for_outreach'
             WHEN b.free_enrichment_status IS NULL OR b.free_enrichment_status = 'failed' THEN 'run_free_enrichment'
             WHEN (SELECT ml.status FROM master_leads ml
                   WHERE ml.canonical_business_id = b.id AND ml.pipeline_origin = 'cro03_pipeline'
                   ORDER BY ml.created_at DESC LIMIT 1) = 'staged'
               AND b.email_discovery_status = 'provider_valid' THEN 'staged_awaiting_review'
             ELSE 'monitor'
           END                                                  AS safe_next_action,
          COUNT(*) OVER()::int                               AS total_count
        FROM businesses b
        WHERE b.record_class = 'canonical'
          AND (${search === ""} OR b.canonical_name ILIKE ${'%' + search + '%'} OR b.website_domain ILIKE ${'%' + search + '%'})
          AND (${vertical === ""} OR b.vertical = ${vertical})
          AND (${emailStatus === ""} OR b.email_discovery_status = ${emailStatus})
        ORDER BY b.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      const data = (rows as any).rows ?? rows;
      const total = Number(data[0]?.total_count ?? 0);
      const businesses = data.map((r: any) => {
        const { total_count, ...rest } = r;
        if ("field_claim_status" in rest) {
          rest.fieldClaim = rest.field_claim_status
            ? {
                status: rest.field_claim_status,
                claimedByEmail: rest.field_claimed_by_email ?? null,
                claimedAt: rest.field_claimed_at ?? null,
              }
            : null;
          delete rest.field_claim_status;
          delete rest.field_claimed_by_email;
          delete rest.field_claimed_at;
        }
        if ("safe_next_action" in rest) {
          rest.safeNextAction = rest.safe_next_action;
          delete rest.safe_next_action;
        }
        return rest;
      });
      res.json({ businesses, total, limit, offset });
    } catch (err: any) {
      console.error("[LeadOps] /businesses list error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load businesses" });
    }
  });

  // ── GET /api/lead-ops/business-verticals ────────────────────────────────────
  // Returns distinct verticals with counts from canonical businesses table.
  // Used by the Businesses tab vertical selector; must NOT query sunbiz_entities
  // (which is the legacy table and may have different vertical classification).
  app.get("/api/lead-ops/business-verticals", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT vertical, COUNT(*)::int AS count
        FROM businesses
        WHERE vertical IS NOT NULL
          AND record_class = 'canonical'
        GROUP BY vertical
        ORDER BY count DESC
        LIMIT 50
      `);
      const rows = (result as any).rows ?? result;
      res.json({ verticals: rows.map((r: any) => ({ vertical: r.vertical, count: Number(r.count) })) });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load verticals" });
    }
  });

  // ── GET /api/lead-ops/budget-preview ────────────────────────────────────────
  // CRO-03C price schedules are stored as immutable JSONB authority artifacts
  // on the active activation policy (there is no standalone price-schedules
  // table in this schema). Never turn a missing/invalid schedule into a
  // fabricated estimate.
  app.get("/api/lead-ops/budget-preview", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT version, price_schedules
        FROM cro03c_activation_policies
        WHERE status = 'approved'
          AND policy_key = 'cro03c_live_activation'
        ORDER BY version DESC, created_at DESC
        LIMIT 1
      `);
      const row = ((result as any).rows ?? result)[0];
      const schedules = row?.price_schedules;
      if (!schedules || typeof schedules !== "object" || Array.isArray(schedules) || Object.keys(schedules).length === 0) {
        return res.json({ available: false });
      }
      const prices = Object.entries(schedules).map(([provider, value]: [string, any]) => ({
        provider,
        version: Number(value?.version ?? row.version ?? 0),
        unitType: value?.unitType ?? null,
        currency: value?.currency ?? null,
        amountMicros: typeof value?.amountMicros === "number" ? value.amountMicros : null,
        billingSemantics: value?.billingSemantics ?? null,
      }));
      const validPrices = prices.filter((p) => p.amountMicros !== null);
      return res.json(validPrices.length > 0
        ? { available: true, prices: validPrices }
        : { available: false });
    } catch {
      return res.json({ available: false });
    }
  });

  // ── GET /api/lead-ops/businesses/:id/routing-preview ──────────────────────
  // MI-08: Returns the ordered provider plan for a business by calling
  // selectCro03Route(). Read-only — does NOT trigger any provider call.
  // Responds within 500ms (no remote calls involved).
  app.get("/api/lead-ops/businesses/:businessId/routing-preview", requireRole("admin", "manager"), async (req, res) => {
    const businessId = Number(req.params.businessId);
    if (!businessId || isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    try {
      const bizResult = await db.execute(sql`
        SELECT id, canonical_name, website_domain, main_phone, main_email,
               email_discovery_status, free_enrichment_status, vertical
        FROM businesses WHERE id = ${businessId}
      `);
      const biz = ((bizResult as any).rows ?? bizResult)[0];
      if (!biz) return res.status(404).json({ error: "Business not found" });

      const { selectCro03Route } = await import("../services/cro03/routing-policy");

      const hasWebsite = !!biz.website_domain;
      const hasPhone   = !!biz.main_phone;
      const hasEmail   = !!biz.main_email;
      const needsBusinessDiscovery  = !hasWebsite && !hasPhone;
      const needsContactEnrichment  = hasWebsite && !hasEmail;
      const needsEmailValidation    = hasEmail && biz.email_discovery_status !== "provider_valid";

      const routePlan = selectCro03Route({
        hasWebsite, hasPhone, hasEmail,
        needsBusinessDiscovery,
        needsContactEnrichment,
        needsEmailValidation,
      });
      let pricing: { available: boolean; prices?: Array<Record<string, unknown>> } = { available: false };
      try {
        // Must constrain on policy_key='cro03c_live_activation' so only the
        // canonical live activation policy is used, not any other approved policy.
        const pricingResult = await db.execute(sql`
          SELECT version, price_schedules
          FROM cro03c_activation_policies
          WHERE status = 'approved'
            AND policy_key = 'cro03c_live_activation'
          ORDER BY version DESC, created_at DESC
          LIMIT 1
        `);
        const pricingRow = ((pricingResult as any).rows ?? pricingResult)[0];
        const schedules = pricingRow?.price_schedules;
        if (schedules && typeof schedules === "object" && !Array.isArray(schedules)) {
          const prices = Object.entries(schedules)
            .map(([provider, value]: [string, any]) => ({
              provider,
              version: Number(value?.version ?? pricingRow.version ?? 0),
              unitType: value?.unitType ?? null,
              currency: value?.currency ?? null,
              amountMicros: typeof value?.amountMicros === "number" ? value.amountMicros : null,
              billingSemantics: value?.billingSemantics ?? null,
            }))
            .filter((price) => price.amountMicros !== null);
          if (prices.length) pricing = { available: true, prices };
        }
      } catch {
        pricing = { available: false };
      }

      res.json({
        businessId,
        businessName: biz.canonical_name,
        routingInput: { hasWebsite, hasPhone, hasEmail, needsBusinessDiscovery, needsContactEnrichment, needsEmailValidation },
        routePlan: {
          policyVersion: routePlan.policyVersion,
          providers: routePlan.providers,
          stopReasons: routePlan.stopReasons,
          recipes: routePlan.recipes.map(r => ({
            provider: r.provider,
            operation: r.operation,
            requiresPaidEligibility: r.requiresPaidEligibility,
          })),
        },
        pricing,
      });
    } catch (err: any) {
      console.error("[LeadOps] routing-preview error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to compute routing preview" });
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
