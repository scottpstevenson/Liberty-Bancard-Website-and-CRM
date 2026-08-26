import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { logAiCall } from "../services/ai-audit-logger";
import { storage } from "../storage";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { contacts, followUpSequences, sequenceEnrollments, insertCampaignSchema, insertCampaignStepSchema, insertFollowUpSequenceSchema, insertSequenceEnrollmentSchema, insertSequenceStepSchema } from "@shared/schema";
import type { AbTestConfig, AbTestResults } from "@shared/schema";
import { getCampaignAnalytics, processSendQueue, queueCampaignMessages, queueContactCampaignMessages, queueFrozenCampaignPreviewMembers, startCampaignPreviewAsync, getCampaignPreviewState, computeTargetingHash } from "../services/campaign-engine";
import { validateGhlWebhookSignature } from "../services/ghl";
import { parse } from "csv-parse/sync";
import { checkAbTestWinners } from "../services/ab-test-worker";
import { pool, db } from "../db";
import { eq, and, count } from "drizzle-orm";
import { serverError } from "../utils/server-error";
import { applyConsentCommand } from "../services/consent-authority";

interface AbTestResultRow {
  sequenceId: number;
  sequenceName: string;
  stepId: number;
  stepOrder: number;
  actionType: string;
  variantA: { subject?: string; body?: string };
  variantB: { subject?: string; body?: string };
  abTestConfig: { splitRatio: number; minSampleSize: number; winnerCriteria: string };
  abTestResults: Partial<AbTestResults>;
}

export function registerCampaignsRoutes(app: Express) {
  // === CAMPAIGNS ===
  app.get("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const campaigns = await storage.getCampaigns();
      // Attach computed send stats from outbound_messages for each campaign
      const campaignsWithStats = await Promise.all(
        campaigns.map(async (campaign) => {
          const stats = await storage.getOutboundStats(campaign.id);
          return {
            ...campaign,
            totalSent: Number(stats.sent) || 0,
            totalOpened: Number(stats.opened) || 0,
            totalReplied: Number(stats.replied) || 0,
            totalBounced: Number(stats.bounced) || 0,
          };
        })
      );
      res.json(campaignsWithStats);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getCampaign(Number(req.params.id));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      res.json(campaign);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignSchema.parse(req.body);
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCampaign(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/campaigns/:id/analytics", isAuthenticated, async (req, res) => {
    try {
      const analytics = await getCampaignAnalytics(Number(req.params.id));
      res.json(analytics);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === CAMPAIGN STEPS ===
  app.get("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getCampaignSteps(Number(req.params.id));
      res.json(steps);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignStepSchema.parse({ ...req.body, campaignId: Number(req.params.id) });
      const step = await storage.createCampaignStep(input);
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  const updateCampaignStepSchema = z.object({
    subject: z.string().trim().max(500).optional(),
    bodyTemplate: z.string().max(50000).optional(),
    delayDays: z.coerce.number().int().min(0).optional(),
  });

  app.put("/api/campaign-steps/:id", isAuthenticated, async (req, res) => {
    try {
      const parsed = updateCampaignStepSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
      const updated = await storage.updateCampaignStep(Number(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ message: "Step not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/campaign-steps/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCampaignStep(Number(req.params.id));
      res.json({ message: "Step deleted" });
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === OUTBOUND MESSAGES ===
  app.get("/api/outbound-messages", isAuthenticated, async (req, res) => {
    try {
      const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
      const messages = await storage.getOutboundMessages(campaignId);
      res.json(messages);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/outbound-messages/stuck-sending
  // Returns messages that have been in `sending` status for more than 60 seconds.
  // Used by the campaign dashboard to warn operators before the 5-minute
  // stale-cleanup fires and marks them `failed`.
  app.get("/api/outbound-messages/stuck-sending", isAuthenticated, async (_req, res) => {
    try {
      const messages = await storage.getStuckSendingMessages();
      res.json({ count: messages.length, messages });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/campaigns/:id/queue", isAuthenticated, async (req, res) => {
    try {
      const campaignId = Number(req.params.id);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      // Branch: contact-mode campaign (has targetVerticals, no targetListId)
      // vs. prospect-list campaign (legacy, has targetListId).
      const isCrmMode = !campaign.targetListId && campaign.targetVerticals && campaign.targetVerticals.length > 0;
      let queued: number;
      let mode: string;

      if (isCrmMode) {
        // ENFORCE: a completed, unexpired, unconsumed, hash-matching preview is required.
        const { previewId } = req.body;
        if (!previewId) {
          return res.status(400).json({ message: "previewId is required for CRM contact campaigns. Run an audience preview first." });
        }
        const preview = await storage.getCampaignPreview(Number(previewId));
        if (!preview) {
          return res.status(400).json({ message: "Preview not found. Please re-run the audience preview." });
        }
        if (preview.campaignId !== campaignId) {
          return res.status(400).json({ message: "Preview does not belong to this campaign." });
        }
        if (preview.status !== "done") {
          return res.status(400).json({ message: `Preview is not complete (status: ${preview.status}). Please wait or re-run.` });
        }
        if (!preview.eligibleCount || preview.eligibleCount === 0) {
          return res.status(400).json({ message: "No eligible contacts in this audience. Nothing to queue." });
        }
        if (preview.expiresAt && new Date() > new Date(preview.expiresAt)) {
          return res.status(400).json({ message: "Preview has expired (1-hour window). Please re-run the audience preview." });
        }
        // Verify targeting/template version has not changed since the preview.
        // Hash covers: verticals (sorted), targetListId, step content per step,
        // readinessThreshold, and READINESS_MODEL_VERSION.
        const steps = await storage.getCampaignSteps(campaignId);
        const currentHash = computeTargetingHash(campaign, steps);
        if (preview.targetingHash !== currentHash) {
          return res.status(400).json({ message: "Campaign targeting or step templates changed since the preview was run. Please re-run the audience preview." });
        }
        // The durable queue worker, not a second HTTP request, owns recovery of
        // an already-consumed preview. This preserves one accepted queueing
        // command under concurrent submits.
        if (preview.consumedAt) {
          return res.status(409).json({ message: "This preview was already consumed by a concurrent request. Re-run the audience preview to queue again." });
        }
        // Phase 2: verify readiness model version matches the snapshot in the preview.
        // If the scoring model was updated between preview and queue, block queueing.
        const { READINESS_MODEL_VERSION } = await import("../services/contact-readiness");
        // Versioned previews must match. Legacy previews with no version remain
        // consumable for compatibility, but newly materialized BT-10 previews
        // always carry the version and the frozen member ledger.
        if (preview.readinessModelVersion !== null && preview.readinessModelVersion !== READINESS_MODEL_VERSION) {
          return res.status(400).json({
            message: `Readiness scoring model mismatch (preview used v${preview.readinessModelVersion ?? "none"}, current is v${READINESS_MODEL_VERSION}). Please re-run the audience preview.`,
          });
        }
        const queueResult = await queueFrozenCampaignPreviewMembers(
          campaignId,
          preview.id,
          (req as any).user?.email ?? (req as any).user?.id?.toString(),
        );
        if (!queueResult.queueRunId) {
          return res.status(409).json({ message: "This preview was already consumed by a concurrent request. Re-run the audience preview to queue again." });
        }
        queued = queueResult.queued;
        mode = "contacts";
        const previewEligibleCount = preview.eligibleCount ?? 0;
        return res.status(queueResult.deferred ? 503 : 202).json({
          queued,
          mode,
          queueRunId: queueResult.queueRunId,
          deferred: !!queueResult.deferred,
          previewEligibleCount,
          countDifference: queued - previewEligibleCount,
          message: queued === previewEligibleCount
            ? `${queued} messages queued (matches preview).`
            : `${queued} messages queued (preview showed ${previewEligibleCount} eligible — difference due to contactability changes since preview).`,
        });
      } else {
        return res.status(400).json({
          message: "Campaign queueing requires a completed frozen audience preview. Run an audience preview before queueing.",
        });
      }
      res.json({ queued, mode, message: `${queued} messages queued for sending` });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST — create and fully materialize a durable audience preview. The route
  // does not report "accepted" before membership ownership exists.
  app.post("/api/campaigns/:id/audience-preview", isAuthenticated, async (req, res) => {
    try {
      const campaignId = Number(req.params.id);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      const requestedBy = (req as any).user?.email ?? (req as any).user?.id?.toString();
      const previewId = await startCampaignPreviewAsync(campaignId, requestedBy);
      res.status(202).json({ status: "done", previewId, pollingUrl: `/api/campaigns/${campaignId}/audience-preview` });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET — poll for preview status and result.
  // Returns { status, previewId?, result?, error? }.
  // status: "idle" | "running" | "done" | "error" | "interrupted"
  // Queue is only unlocked server-side when status === "done" and previewId is valid.
  app.get("/api/campaigns/:id/audience-preview", isAuthenticated, async (req, res) => {
    try {
      const state = await getCampaignPreviewState(Number(req.params.id));
      res.json(state);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/outbound/process-queue", isAuthenticated, async (req, res) => {
    try {
      const result = await processSendQueue();
      res.json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === OUTBOUND WEBHOOK (for GHL tracking) ===
  app.post("/api/outbound/webhook", async (req, res) => {
    try {
      // --- Signature verification (HMAC-SHA256) ---
      // Always verify using the shared GHL HMAC helper.  It checks GHL_WEBHOOK_SECRET
      // and uses isLocalhostEnv() (not NODE_ENV) to decide whether to allow unsigned
      // requests.  When the secret is configured, an absent or wrong signature
      // always fails regardless of environment.
      const rawBody = req.rawBody instanceof Buffer ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
      const sig = (req.headers["x-wh-signature"] || req.headers["x-hub-signature-256"] || "") as string;

      if (!validateGhlWebhookSignature(rawBody, sig)) {
        console.error("[Outbound Webhook] Signature verification failed (missing or invalid)");
        return res.status(401).json({ message: "Invalid or missing webhook signature" });
      }
      // --- End signature verification ---

      const { messageId, event } = req.body;
      if (!messageId || !event) return res.status(400).json({ message: "Missing messageId or event" });

      const msg = await storage.getOutboundMessage(Number(messageId));
      if (!msg) return res.status(404).json({ message: "Message not found" });

      const updates: Record<string, any> = {};
      if (event === "opened") { updates.status = "opened"; updates.openedAt = new Date(); }
      if (event === "replied") { updates.status = "replied"; updates.repliedAt = new Date(); }
      if (event === "bounced") { updates.status = "bounced"; updates.bouncedAt = new Date(); }
      if (event === "unsubscribed") {
        updates.status = "unsubscribed";
        if (msg.prospectId) {
          await applyConsentCommand({
            subject: { type: "prospect", id: msg.prospectId },
            kind: "global_dnc",
            purpose: "outreach",
            eventNamespace: "campaign_webhook",
            eventKey: `${msg.id}:prospect:${msg.prospectId}:unsubscribe`,
            source: "campaign_unsubscribe",
            evidence: { messageId: msg.id, campaignId: msg.campaignId },
            details: { messageId: msg.id, campaignId: msg.campaignId },
          });
        }
        // CAN-SPAM: contact-mode campaigns target the contacts table directly.
        // Apply the same suppression to the linked contacts record so the
        // contactability gate blocks future automated email to this address.
        // Raw SQL: bypass Drizzle set() cast which can silently drop boolean/enum cols.
        if (msg.contactId) {
          const contactId = msg.contactId;
          await applyConsentCommand({
            subject: { type: "contact", id: contactId },
            kind: "opt_out",
            channel: "email",
            purpose: "outreach",
            eventNamespace: "campaign_webhook",
            eventKey: `${msg.id}:contact:${contactId}:unsubscribe`,
            source: "campaign_unsubscribe",
            evidence: { messageId: msg.id, campaignId: msg.campaignId },
            details: { messageId: msg.id, campaignId: msg.campaignId },
          });
        }
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateOutboundMessage(msg.id, updates);
      }

      res.json({ message: "Webhook processed" });
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // === FOLLOW-UP SEQUENCES (DRIP CAMPAIGNS) ===
  app.get("/api/sequences", isAuthenticated, async (req, res) => {
    try {
      const sequences = await storage.getFollowUpSequences();
      // #1443 — Augment each sequence with avgDelayDays computed from its steps
      if (sequences.length === 0) return res.json(sequences);
      const seqIds = sequences.map((s: any) => s.id);
      const placeholders = seqIds.map((_: any, i: number) => `$${i + 1}`).join(",");
      const avgResult = await pool.query(
        `SELECT sequence_id, ROUND(AVG(delay_days)::numeric, 1) AS avg_delay_days
         FROM sequence_steps
         WHERE sequence_id IN (${placeholders})
         GROUP BY sequence_id`,
        seqIds,
      ).catch(() => ({ rows: [] as any[] }));
      const avgMap = new Map<number, number>();
      for (const row of avgResult.rows) {
        avgMap.set(Number(row.sequence_id), Number(row.avg_delay_days));
      }
      const enriched = sequences.map((s: any) => ({
        ...s,
        avgDelayDays: avgMap.get(s.id) ?? null,
      }));
      res.json(enriched);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/sequences/vertical-coverage", isAuthenticated, async (_req, res) => {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT
            s.id,
            s.name,
            s.status,
            s.total_steps,
            COUNT(e.id)::int AS enrolled,
            COUNT(CASE WHEN e.current_step >= 1 THEN 1 END)::int AS step1_complete,
            COUNT(CASE WHEN e.current_step >= 3 THEN 1 END)::int AS step3_complete,
            COUNT(CASE WHEN e.status = 'completed' THEN 1 END)::int AS completed,
            MAX(e.created_at) AS last_enrolled_at
          FROM follow_up_sequences s
          LEFT JOIN sequence_enrollments e ON e.sequence_id = s.id
          GROUP BY s.id, s.name, s.status, s.total_steps
          ORDER BY s.name
        `);

        const now = new Date();
        const rows = result.rows.map((row: any) => {
          const name: string = row.name || "";
          const dashIdx = name.indexOf(" \u2014 ");
          const vertical = dashIdx !== -1 ? name.substring(0, dashIdx).trim() : name;
          const sequenceType = dashIdx !== -1 ? name.substring(dashIdx + 3).trim() : "";
          const enrolled = row.enrolled ?? 0;
          const completed = row.completed ?? 0;
          const conversionRate = enrolled > 0 ? Math.round((completed / enrolled) * 1000) / 10 : 0;
          const lastEnrolledAt: string | null = row.last_enrolled_at ? row.last_enrolled_at.toISOString() : null;
          const daysSinceEnrollment = lastEnrolledAt
            ? Math.floor((now.getTime() - new Date(lastEnrolledAt).getTime()) / 86400000)
            : null;
          return {
            id: row.id,
            sequenceName: name,
            vertical,
            sequenceType,
            sequenceStatus: row.status,
            totalSteps: row.total_steps ?? 0,
            enrolled,
            step1Complete: row.step1_complete ?? 0,
            step3Complete: row.step3_complete ?? 0,
            completed,
            conversionRate,
            lastEnrolledAt,
            daysSinceEnrollment,
          };
        });

        res.json(rows);
      } finally {
        client.release();
      }
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === SEQUENCE GROUPING / FILTERING / GHL WIRING STATUS (read-only) ===
  app.get("/api/sequences/grouping-meta", isDashboardUser, async (_req, res) => {
    try {
      const { classifySequenceBucket, getSequenceWiringMap } = await import("../services/sequence-grouping");
      const sequences = await storage.getFollowUpSequences();
      const wiringMap = await getSequenceWiringMap(sequences.map(s => ({ name: s.name, triggerType: s.triggerType })));
      const meta = sequences.map(s => ({
        id: s.id,
        name: s.name,
        bucket: classifySequenceBucket(s),
        wiring: wiringMap[s.name] || { status: "missing" as const, workflowId: null, source: "none" as const },
      }));
      res.json(meta);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.put("/api/sequences/:id/toggle-status", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const seq = await storage.getFollowUpSequence(id);
      if (!seq) return res.status(404).json({ message: "Sequence not found" });
      const newStatus = seq.status === "active" ? "paused" : "active";
      const updated = await storage.updateFollowUpSequence(id, { status: newStatus });
      await storage.createAuditLog({ action: `sequence_${newStatus}`, entityType: "sequence", entityId: id, details: { name: seq.name, previousStatus: seq.status } });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/sequences/:id", isAuthenticated, async (req, res) => {
    try {
      const seq = await storage.getFollowUpSequence(Number(req.params.id));
      if (!seq) return res.status(404).json({ message: "Not found" });
      res.json(seq);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/sequences", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertFollowUpSequenceSchema.parse(req.body);
      const seq = await storage.createFollowUpSequence(input);
      await storage.createAuditLog({ action: "sequence_created", entityType: "sequence", entityId: seq.id, details: { name: seq.name } });
      res.status(201).json(seq);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/sequences/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateFollowUpSequence(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/sequences/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteFollowUpSequence(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });


  // ============================================================
  // Phase 2 — Readiness backfill + stats admin endpoints
  // All three are admin/manager gated.
  // ============================================================

  // POST /api/admin/readiness-backfill/start
  // Starts (or restarts) a readiness score backfill run.
  // Optional body: { force: boolean } — interrupts stale/active runs.
  app.post("/api/admin/readiness-backfill/start", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { startReadinessBackfill } = await import("../services/contact-readiness-backfill");
      const force = req.body?.force === true;
      const result = await startReadinessBackfill(force);
      res.status(202).json(result);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/admin/readiness-backfill/status
  // Returns the most recent backfill run status (any terminal state).
  app.get("/api/admin/readiness-backfill/status", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { getReadinessBackfillStatus } = await import("../services/contact-readiness-backfill");
      const status = await getReadinessBackfillStatus();
      res.json(status);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // GET /api/contacts/readiness-stats
  // Aggregated readiness score distribution — computed in Postgres via CASE on
  // the integer column, never loads JSONB blobs into Node.
  // Returns: grade distribution, 10-bucket histogram, top-10 missing reason codes
  // (derived from readiness_breakdown JSONB), and the latest backfill run status.
  app.get("/api/contacts/readiness-stats", isDashboardUser, async (req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      const { db } = await import("../db");
      const { READINESS_MODEL_VERSION, READINESS_GRADE_THRESHOLDS } = await import("../services/contact-readiness");
      const { storage } = await import("../storage");

      // All three queries run in parallel — none depends on another.
      const [summaryResult, histogramResult, reasonResult, latestRun] = await Promise.all([
        // 1. Summary + grade breakdown
        db.execute(sql`
          SELECT
            COUNT(*)                                                                            AS total,
            COUNT(*) FILTER (WHERE data_readiness_score IS NULL)                                AS null_score,
            COUNT(*) FILTER (WHERE readiness_model_version < ${READINESS_MODEL_VERSION}
                              OR readiness_model_version IS NULL)                               AS stale_model,
            COUNT(*) FILTER (WHERE data_readiness_score IS NOT NULL
                              AND readiness_updated_at < last_meaningful_contact_mutation_at)   AS mutation_stale,
            COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.A})     AS grade_a,
            COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.B}
                              AND  data_readiness_score <  ${READINESS_GRADE_THRESHOLDS.A})     AS grade_b,
            COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.C}
                              AND  data_readiness_score <  ${READINESS_GRADE_THRESHOLDS.B})     AS grade_c,
            COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.D}
                              AND  data_readiness_score <  ${READINESS_GRADE_THRESHOLDS.C})     AS grade_d,
            COUNT(*) FILTER (WHERE data_readiness_score < ${READINESS_GRADE_THRESHOLDS.D}
                              AND  data_readiness_score IS NOT NULL)                            AS grade_f,
            ROUND(AVG(data_readiness_score), 1)                                                 AS avg_score,
            MIN(data_readiness_score)                                                           AS min_score,
            MAX(data_readiness_score)                                                           AS max_score
          FROM contacts
          WHERE archived_at IS NULL
        `),

        // 2. 10-bucket score histogram (0-9, 10-19, …, 90-100)
        db.execute(sql`
          SELECT
            CASE
              WHEN data_readiness_score >= 100 THEN 90
              ELSE (data_readiness_score / 10) * 10
            END AS bucket_start,
            COUNT(*) AS cnt
          FROM contacts
          WHERE archived_at IS NULL AND data_readiness_score IS NOT NULL
          GROUP BY bucket_start
          ORDER BY bucket_start
        `),

        // 3. Top-10 missing reason codes — aggregated from the missingReasons array
        //    stored at readiness_breakdown->'missingReasons'.  The array contains
        //    canonical REASON_CODE strings (e.g. "missing_email", "missing_city").
        db.execute(sql`
          SELECT reason, COUNT(*) AS cnt
          FROM contacts,
               jsonb_array_elements_text(readiness_breakdown->'missingReasons') AS reason
          WHERE archived_at IS NULL
            AND readiness_breakdown IS NOT NULL
            AND readiness_breakdown ? 'missingReasons'
          GROUP BY reason
          ORDER BY cnt DESC
          LIMIT 10
        `),

        // 4. Latest backfill run (any status) for run-status reporting
        storage.getLatestReadinessRun(),
      ]);

      // Normalise drizzle execute result — may be array or {rows:[…]}
      const toRows = (r: unknown) => Array.isArray(r) ? r : (r as any)?.rows ?? [];
      const [summary] = toRows(summaryResult);
      const histRows: Array<{ bucket_start: number; cnt: number }> = toRows(histogramResult)
        .map((r: any) => ({ bucket_start: Number(r.bucket_start), cnt: Number(r.cnt) }));
      const reasonRows: Array<{ reason: string; cnt: number }> = toRows(reasonResult)
        .map((r: any) => ({ reason: String(r.reason), cnt: Number(r.cnt) }));

      // Build full 10-bucket histogram (0–90 step 10) filling missing buckets with 0
      const histogramMap: Record<number, number> = {};
      for (const r of histRows) histogramMap[r.bucket_start] = r.cnt;
      const histogram = Array.from({ length: 10 }, (_, i) => ({
        bucketStart: i * 10,
        bucketEnd: i === 9 ? 100 : i * 10 + 9,
        count: histogramMap[i * 10] ?? 0,
      }));

      res.json({
        total: Number(summary.total),
        nullScore: Number(summary.null_score),
        staleModel: Number(summary.stale_model),
        mutationStale: Number(summary.mutation_stale),
        grades: {
          A: Number(summary.grade_a),
          B: Number(summary.grade_b),
          C: Number(summary.grade_c),
          D: Number(summary.grade_d),
          F: Number(summary.grade_f),
        },
        avgScore: summary.avg_score !== null ? Number(summary.avg_score) : null,
        minScore: summary.min_score !== null ? Number(summary.min_score) : null,
        maxScore: summary.max_score !== null ? Number(summary.max_score) : null,
        histogram,
        topMissingReasons: reasonRows,
        modelVersion: READINESS_MODEL_VERSION,
        backfillRun: latestRun
          ? {
              runId: latestRun.runId,
              status: latestRun.status,
              processed: latestRun.processed,
              updated: latestRun.updated,
              errors: latestRun.errors,
              startedAt: latestRun.startedAt,
              completedAt: latestRun.completedAt,
              lastHeartbeatAt: latestRun.lastHeartbeatAt,
              lastProcessedContactId: latestRun.lastProcessedContactId,
            }
          : null,
      });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === SEQUENCE STEPS ===
  app.get("/api/sequences/:sequenceId/steps", isAuthenticated, async (req, res) => {
    try {
      const sequenceId = Number(req.params.sequenceId);
      const steps = await storage.getSequenceSteps(sequenceId);
      // #902 — Annotate each step with how many outbound sends it has produced
      const sentCountsResult = await pool.query(
        `SELECT sequence_step_id, COUNT(*) AS sent_count
         FROM communication_events
         WHERE sequence_id = $1
           AND direction = 'outbound'
           AND status IN ('sent', 'delivered')
           AND sequence_step_id IS NOT NULL
         GROUP BY sequence_step_id`,
        [sequenceId]
      ).catch(() => ({ rows: [] as any[] }));
      const sentByStepId = new Map<number, number>();
      for (const row of sentCountsResult.rows) {
        sentByStepId.set(Number(row.sequence_step_id), Number(row.sent_count));
      }
      const stepsWithCounts = steps.map((s: any) => ({
        ...s,
        sentCount: sentByStepId.get(s.id) ?? 0,
      }));
      res.json(stepsWithCounts);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/sequences/:sequenceId/steps", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const input = insertSequenceStepSchema.parse({ ...req.body, sequenceId: Number(req.params.sequenceId) });
      const step = await storage.createSequenceStep(input);
      const seq = await storage.getFollowUpSequence(Number(req.params.sequenceId));
      if (seq) {
        const steps = await storage.getSequenceSteps(seq.id);
        await storage.updateFollowUpSequence(seq.id, { totalSteps: steps.length });
      }
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/sequence-steps/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateSequenceStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.delete("/api/sequence-steps/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteSequenceStep(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === SEQUENCE TIER BREAKDOWN ===
  app.get("/api/sequences/:id/enrollments/by-tier", isDashboardUser, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid sequence id" });
      }
      const [seq] = await db.select({ id: followUpSequences.id }).from(followUpSequences).where(eq(followUpSequences.id, id)).limit(1);
      if (!seq) {
        return res.status(404).json({ message: "Sequence not found" });
      }
      const rows = await db
        .select({
          consentTier: contacts.consentTier,
          count: count(),
        })
        .from(sequenceEnrollments)
        .innerJoin(contacts, eq(sequenceEnrollments.contactId, contacts.id))
        .where(
          and(
            eq(sequenceEnrollments.sequenceId, id),
            eq(sequenceEnrollments.status, "active")
          )
        )
        .groupBy(contacts.consentTier);

      const normalized = rows
        .map((r) => ({
          consentTier: r.consentTier === null ? "unknown" : r.consentTier,
          count: Number(r.count),
        }))
        .sort((a, b) => b.count - a.count);

      return res.json(normalized);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === SEQUENCE ENROLLMENTS ===
  app.get("/api/sequence-enrollments", isDashboardUser, async (req, res) => {
    try {
      const sequenceId = req.query.sequenceId ? Number(req.query.sequenceId) : undefined;
      const enrollments = await storage.getSequenceEnrollments(sequenceId);
      res.json(enrollments);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/sequence-enrollments", isDashboardUser, async (req, res) => {
    try {
      // Strict request schema — clients may only supply identity fields.
      // status, currentStep, nextActionAt, and metadata are server-derived.
      const enrollRequestSchema = z.object({
        sequenceId: z.number().int().positive(),
        contactId: z.number().int().positive().optional(),
        dealId: z.number().int().positive().optional(),
      }).refine(d => d.contactId || d.dealId, {
        message: "Either contactId or dealId is required.",
      });
      const input = enrollRequestSchema.parse(req.body);

      // ── Global pause hard-stop ──────────────────────────────────────────
      const pausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
      const isPaused = pausedRaw === true || pausedRaw === "true";
      if (isPaused) {
        const reason = await storage.getSystemSetting("outboundGlobalPausedReason");
        return res.status(409).json({
          message: `Enrollment blocked: ${typeof reason === "string" ? reason : "Global outbound pause active"}`,
          code: "GLOBAL_PAUSE_ACTIVE",
        });
      }

      const seq = await storage.getFollowUpSequence(input.sequenceId);
      if (!seq) return res.status(404).json({ message: "Sequence not found." });
      if (seq.status !== "active") return res.status(409).json({ message: `Sequence "${seq.name}" is ${seq.status}. Activate it before enrolling contacts.` });

      // ── Resolve contact — always required for eligibility evaluation ────
      // Fix deal-only bypass: when only dealId is provided the original code
      // skipped all eligibility checks.  We now always resolve a contactId.
      let resolvedContactId = input.contactId;
      if (!resolvedContactId && input.dealId) {
        const deal = await storage.getDeal(input.dealId);
        if (!deal) return res.status(404).json({ message: "Deal not found." });
        if (!deal.contactId) return res.status(400).json({ message: "Deal has no linked contact — cannot evaluate enrollment eligibility." });
        resolvedContactId = deal.contactId;
      }

      if (resolvedContactId) {
        const { canEnrollContactInSequence, sequenceHasEmailSteps } = await import("../services/sequence-eligibility");

        // DNC / consent-tier gate
        const eligibility = await canEnrollContactInSequence(resolvedContactId, seq);
        if (!eligibility.allowed) {
          await storage.createAuditLog({
            action: "sequence_enrollment_blocked_consent",
            entityType: "contact",
            entityId: resolvedContactId,
            actorType: "system",
            details: {
              sequenceId: seq.id,
              sequenceName: seq.name,
              sequenceFamily: seq.sequenceFamily,
              reason: eligibility.reason,
              contactConsentTier: eligibility.contactConsentTier,
              eligibleConsentTiers: eligibility.eligibleConsentTiers,
            },
          });
          return res.status(400).json({
            message: eligibility.reason || "Contact is not eligible for this sequence.",
            code: "ENROLLMENT_BLOCKED_CONSENT",
            contactConsentTier: eligibility.contactConsentTier,
            eligibleConsentTiers: eligibility.eligibleConsentTiers,
            campaignFamily: eligibility.campaignFamily,
          });
        }

        // Email-channel contactability gate (only when the sequence has email steps)
        const hasEmailSteps = await sequenceHasEmailSteps(seq.id);
        if (hasEmailSteps) {
          const { evaluateContactability } = await import("../services/contactability");
          const emailCheck = await evaluateContactability({
            contactId: resolvedContactId,
            channel: "email",
            campaignType: "sequence_enrollment",
            mode: "enforcement",
          });
          if (!emailCheck.allowed) {
            await storage.createAuditLog({
              action: "sequence_enrollment_blocked_email_status",
              entityType: "contact",
              entityId: resolvedContactId,
              actorType: "system",
              details: { sequenceId: seq.id, sequenceName: seq.name, reason: emailCheck.reason },
            });
            return res.status(400).json({
              message: emailCheck.reason || "Contact email is not eligible for this sequence.",
              code: "ENROLLMENT_BLOCKED_EMAIL",
            });
          }
        }
      }

      // Server-derives all state — clients cannot set status, currentStep, or timestamps
      const enrollment = await storage.createSequenceEnrollment({
        sequenceId: input.sequenceId,
        contactId: resolvedContactId,
        dealId: input.dealId,
        status: "active",
        currentStep: 0,
        nextActionAt: new Date(),
      });
      if (enrollment === null) {
        return res.status(409).json({ message: "Contact is already enrolled in an active or paused sequence." });
      }
      await storage.createAuditLog({ action: "sequence_enrolled", entityType: "contact", entityId: enrollment.contactId || 0, details: { sequenceId: String(enrollment.sequenceId) } });
      res.status(201).json(enrollment);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.put("/api/sequence-enrollments/:id", isDashboardUser, async (req, res) => {
    try {
      // Strict allowlist — clients may only reschedule nextActionAt or record
      // completion/pause timestamps.  status, currentStep, contactId, sequenceId,
      // dealId, and metadata are not writable from the client.
      const enrollmentUpdateSchema = z.object({
        nextActionAt: z.coerce.date().optional().nullable(),
        completedAt: z.coerce.date().optional().nullable(),
        pausedAt: z.coerce.date().optional().nullable(),
      });
      const body = enrollmentUpdateSchema.parse(req.body);
      const updated = await storage.updateSequenceEnrollment(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
      serverError(res, err);
    }
  });

  app.get("/api/contacts/:contactId/enrollments", isAuthenticated, async (req, res) => {
    try {
      const enrollments = await storage.getContactEnrollments(Number(req.params.contactId));
      res.json(enrollments);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/sequences/:id/enrollments/bulk-cancel
  // #553 — Batch-remove multiple contacts from a sequence.
  app.post("/api/sequences/:id/enrollments/bulk-cancel", isDashboardUser, async (req, res) => {
    try {
      const sequenceId = Number(req.params.id);
      const { contactIds } = req.body;
      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ message: "contactIds must be a non-empty array." });
      }
      if (contactIds.length > 500) {
        return res.status(400).json({ message: "Maximum 500 contacts per batch." });
      }

      let cancelled = 0;
      let skipped = 0;
      for (const contactId of contactIds) {
        const result = await storage.cancelSequenceEnrollment(sequenceId, Number(contactId));
        if (result) cancelled++; else skipped++;
      }

      await storage.createAuditLog({
        action: "sequence_bulk_enrollment_cancelled",
        entityType: "sequence",
        entityId: sequenceId,
        actorId: String((req as any).user?.id ?? ""),
        actorType: "user",
        details: { sequenceId, cancelled, skipped, totalRequested: contactIds.length },
      });

      res.json({ success: true, cancelled, skipped });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // DELETE /api/sequences/:id/enrollments/:contactId
  // Cancels an active or paused enrollment for the given contact+sequence pair.
  // Admins and managers may cancel any enrollment; agents may cancel as well
  // (contacts have no ownedBy field so ownership scoping is not possible at the DB level).
  // Cancelled enrollments are retained in history with status = "cancelled".
  app.delete("/api/sequences/:id/enrollments/:contactId", isDashboardUser, async (req, res) => {
    try {
      const sequenceId = Number(req.params.id);
      const contactId = Number(req.params.contactId);
      if (isNaN(sequenceId) || isNaN(contactId)) {
        return res.status(400).json({ message: "Invalid sequenceId or contactId" });
      }

      const cancelled = await storage.cancelSequenceEnrollment(sequenceId, contactId);
      if (!cancelled) {
        return res.status(404).json({ message: "No active or paused enrollment found for this contact in this sequence." });
      }

      await storage.createAuditLog({
        action: "sequence_enrollment_cancelled",
        entityType: "contact",
        entityId: contactId,
        actorId: String((req as any).user?.id ?? ""),
        actorType: "user",
        details: {
          sequenceId,
          contactId,
          enrollmentId: cancelled.id,
          cancelledByUserId: (req as any).user?.id,
          cancelledByEmail: (req as any).user?.email,
        },
      });

      res.json({ success: true, enrollment: cancelled });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // PATCH /api/sequences/:id/enrollments/:contactId/pause
  // #541 — Toggle pause/resume on a single contact enrollment (accessible by reps).
  app.patch("/api/sequences/:id/enrollments/:contactId/pause", isDashboardUser, async (req, res) => {
    try {
      const sequenceId = Number(req.params.id);
      const contactId = Number(req.params.contactId);
      if (isNaN(sequenceId) || isNaN(contactId)) {
        return res.status(400).json({ message: "Invalid sequenceId or contactId" });
      }

      // Look up current enrollment
      const enrollments = await storage.getContactEnrollments(contactId);
      const enrollment = enrollments.find((e: any) => e.sequenceId === sequenceId && (e.status === "active" || e.status === "paused"));
      if (!enrollment) {
        return res.status(404).json({ message: "No active or paused enrollment found." });
      }

      const newStatus = enrollment.status === "paused" ? "active" : "paused";
      await storage.updateSequenceEnrollment(enrollment.id, { status: newStatus });

      await storage.createAuditLog({
        action: newStatus === "paused" ? "sequence_enrollment_paused" : "sequence_enrollment_resumed",
        entityType: "contact",
        entityId: contactId,
        actorId: String((req as any).user?.id ?? ""),
        actorType: "user",
        details: { sequenceId, contactId, enrollmentId: enrollment.id, newStatus },
      });

      res.json({ success: true, status: newStatus });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.get("/api/contacts/:id/sequence-suggestions", isAuthenticated, async (req, res) => {
    try {
      const { suggestSequenceFamiliesForContact } = await import("../services/sequence-eligibility");
      const contactId = Number(req.params.id);
      const suggestions = await suggestSequenceFamiliesForContact(contactId);
      res.json(suggestions);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === A/B TEST RESULTS ===
  app.get("/api/sequences/ab-test-results", isAuthenticated, async (_req, res) => {
    try {
      const sequences = await storage.getFollowUpSequences();
      const results: AbTestResultRow[] = [];
      for (const seq of sequences) {
        const steps = await storage.getSequenceSteps(seq.id);
        for (const step of steps) {
          const cfg = step.abTestConfig as AbTestConfig | null;
          if (cfg && (step.variantBSubject || step.variantBBody)) {
            const r = (step.abTestResults as Partial<AbTestResults>) || {};
            results.push({
              sequenceId: seq.id,
              sequenceName: seq.name ?? "",
              stepId: step.id,
              stepOrder: step.stepOrder ?? 1,
              actionType: step.actionType ?? "email",
              variantA: { subject: step.subject ?? undefined, body: step.body ?? undefined },
              variantB: { subject: step.variantBSubject ?? undefined, body: step.variantBBody ?? undefined },
              abTestConfig: {
                splitRatio: cfg.splitRatio ?? 50,
                minSampleSize: cfg.minSampleSize ?? 100,
                winnerCriteria: cfg.winnerCriteria ?? "open_rate",
              },
              abTestResults: {
                variantASent: r.variantASent ?? 0,
                variantBSent: r.variantBSent ?? 0,
                aOpens: r.aOpens ?? 0,
                bOpens: r.bOpens ?? 0,
                aClicks: r.aClicks ?? 0,
                bClicks: r.bClicks ?? 0,
                aReplies: r.aReplies ?? 0,
                bReplies: r.bReplies ?? 0,
                winnerSelected: r.winnerSelected ?? null,
                winnerAt: r.winnerAt ?? null,
                startedAt: r.startedAt ?? null,
                statisticallySignificant: r.statisticallySignificant,
              },
            });
          }
        }
      }
      res.json(results);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // Results are a server-owned projection.  This retired mutation endpoint
  // remains only to return an explicit, non-successful response to stale UIs.
  app.post("/api/sequence-steps/:id/ab-test-results", isAuthenticated, (_req, res) => {
    res.status(410).json({ code: "AB_RESULTS_SERVER_OWNED", message: "A/B results are computed from immutable delivery facts." });
  });

  app.post("/api/sequences/trigger-ab-check", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const result = await checkAbTestWinners();
      res.json({ message: "A/B test check complete", ...result });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // === VERTICAL BULK ENROLLMENT ===

  app.get("/api/contacts/verticals", isAuthenticated, async (_req, res) => {
    try {
      const verticals = await storage.getContactVerticalCounts();
      res.json(verticals);
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/sequences/:id/enroll-vertical/preview", requireRole("admin", "manager"), async (req, res) => {
    try {
      const seqId = Number(req.params.id);
      const schema = z.object({ vertical: z.string().min(1) });
      const { vertical } = schema.parse(req.body);

      const seq = await storage.getFollowUpSequence(seqId);
      if (!seq) return res.status(404).json({ message: "Sequence not found." });
      if (seq.status !== "active") return res.status(409).json({ message: `Sequence "${seq.name}" is ${seq.status}. Activate it before enrolling contacts.` });

      // Surface global-pause state without blocking preview — admins need to
      // preview before deciding whether to lift the pause.
      const pausedRaw = await storage.getSystemSetting("outboundGlobalPaused");
      const globalPauseActive = pausedRaw === true || pausedRaw === "true";

      const { canEnrollContactInSequence, sequenceHasEmailSteps } = await import("../services/sequence-eligibility");
      const hasEmailSteps = await sequenceHasEmailSteps(seqId);
      const contactsInVertical = await storage.getContactsByVertical(vertical);
      const totalMatching = contactsInVertical.length;

      // Include paused enrollments in the already-enrolled set — the DB unique
      // index prevents re-enrollment of active OR paused contacts, so preview
      // must match that semantic.
      const existingEnrollments = await storage.getSequenceEnrollments(seqId);
      const enrolledContactIds = new Set(
        existingEnrollments
          .filter(e => e.status === "active" || e.status === "paused" || e.status === "completed")
          .map(e => e.contactId)
          .filter(Boolean) as number[]
      );

      let eligible = 0;
      let alreadyEnrolled = 0;
      let notEligible = 0;
      const skippedBreakdown: Record<string, number> = {};
      const previewContacts: Array<{ id: number; firstName: string; lastName: string; email: string }> = [];

      for (const c of contactsInVertical) {
        if (enrolledContactIds.has(c.id)) {
          alreadyEnrolled++;
          continue;
        }
        // Missing contact info (mirrors live route)
        if (!c.email && !c.phone) {
          notEligible++;
          skippedBreakdown["missing_contact_info"] = (skippedBreakdown["missing_contact_info"] ?? 0) + 1;
          continue;
        }
        const eligibility = await canEnrollContactInSequence(c.id, seq);
        if (!eligibility.allowed) {
          notEligible++;
          const reason = eligibility.reason ?? "ineligible";
          skippedBreakdown[reason] = (skippedBreakdown[reason] ?? 0) + 1;
          continue;
        }
        // Email-channel contactability check (same gate as live route)
        if (hasEmailSteps) {
          const { evaluateContactability } = await import("../services/contactability");
          const emailCheck = await evaluateContactability({
            contactId: c.id,
            channel: "email",
            campaignType: "sequence_enrollment",
            mode: "enforcement",
          });
          if (!emailCheck.allowed) {
            notEligible++;
            const reason = emailCheck.reason ?? "email_blocked";
            skippedBreakdown[reason] = (skippedBreakdown[reason] ?? 0) + 1;
            continue;
          }
        }
        eligible++;
        if (previewContacts.length < 5) {
          previewContacts.push({ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email });
        }
      }

      const userId = (req as any).user?.id?.toString() ?? null;
      await storage.createAuditLog({
        action: "sequence_vertical_bulk_enroll_previewed",
        entityType: "sequence",
        entityId: seqId,
        userId,
        actorType: "user",
        details: { sequenceId: seqId, vertical, totalMatching, eligible, alreadyEnrolled, notEligible, globalPauseActive, dryRun: true },
      });

      res.json({ totalMatching, eligible, alreadyEnrolled, notEligible, skippedBreakdown, previewContacts, globalPauseActive });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.post("/api/sequences/:id/enroll-vertical", requireRole("admin", "manager"), async (req, res) => {
    try {
      const seqId = Number(req.params.id);
      const schema = z.object({
        vertical: z.string().min(1),
        confirmed: z.literal(true),
      });
      const { vertical } = schema.parse(req.body);

      // ── Global pause hard-stop ──────────────────────────────────────────
      // Reject enrollment while outbound is globally paused.  The sequence
      // worker would pause each active row on its next tick anyway, but that
      // creates a stuck-paused cohort requiring manual per-enrollment resume.
      // Blocking here gives the admin clear feedback and keeps the DB clean.
      // Global pause check — upgraded to OutboundPauseAuthority + coordinator (#1532)
      {
        const { authorize } = await import("../services/outbound-pause-authority");
        const { canExecute } = await import("../services/outbound-queue-coordinator");
        const decision = await authorize({});
        const coordOk = decision.allowed ? await canExecute("discovery-enrollment") : false;
        if (!decision.allowed || !coordOk) {
          const reason = !decision.allowed
            ? (decision.reasonCode ?? "Global outbound pause active")
            : "Coordinator hold active for discovery-enrollment";
          const userId = (req as any).user?.id?.toString() ?? null;
          await storage.createAuditLog({
            action: "sequence_vertical_bulk_enroll_blocked_global_pause",
            entityType: "sequence",
            entityId: seqId,
            userId,
            actorType: "user",
            details: {
              sequenceId: seqId,
              vertical,
              reason,
              reasonCode: decision.reasonCode,
              coordBlocked: !coordOk,
            },
          });
          return res.status(409).json({
            message: `Enrollment blocked: ${reason}`,
            code: "GLOBAL_PAUSE_ACTIVE",
          });
        }
      }

      const seq = await storage.getFollowUpSequence(seqId);
      if (!seq) return res.status(404).json({ message: "Sequence not found." });
      if (seq.status !== "active") return res.status(409).json({ message: `Sequence "${seq.name}" is ${seq.status}. Activate it before enrolling contacts.` });

      // ── Resolve email-step presence once for the whole batch ────────────
      const { canEnrollContactInSequence, sequenceHasEmailSteps } = await import("../services/sequence-eligibility");
      const hasEmailSteps = await sequenceHasEmailSteps(seqId);

      // ── Cohort size guard ───────────────────────────────────────────────
      // Synchronous bulk loop is only safe for moderate cohort sizes.
      // Above the threshold, route the request to a background job.
      const COHORT_SIZE_LIMIT = 500;
      const contactsInVertical = await storage.getContactsByVertical(vertical);
      if (contactsInVertical.length > COHORT_SIZE_LIMIT) {
        return res.status(400).json({
          message: `Cohort size (${contactsInVertical.length}) exceeds the per-request limit of ${COHORT_SIZE_LIMIT}. Please contact an admin to run a background bulk-enrollment job for larger cohorts.`,
          code: "COHORT_TOO_LARGE",
          cohortSize: contactsInVertical.length,
          limit: COHORT_SIZE_LIMIT,
        });
      }

      // Include paused enrollments in already-enrolled set — the DB unique index
      // treats active AND paused as duplicates; the route must match that semantic.
      const existingEnrollments = await storage.getSequenceEnrollments(seqId);
      const enrolledContactIds = new Set(
        existingEnrollments
          .filter(e => e.status === "active" || e.status === "paused" || e.status === "completed")
          .map(e => e.contactId)
          .filter(Boolean) as number[]
      );

      const userId = (req as any).user?.id?.toString() ?? null;

      await storage.createAuditLog({
        action: "sequence_vertical_bulk_enroll_requested",
        entityType: "sequence",
        entityId: seqId,
        userId,
        actorType: "user",
        details: { sequenceId: seqId, vertical, requestedBy: userId, totalMatching: contactsInVertical.length, dryRun: false },
      });

      let queued = 0;
      let skippedAlreadyEnrolled = 0;
      let skippedIneligible = 0;
      let skippedMissingInfo = 0;
      let errors = 0;
      const skippedBreakdown: Record<string, number> = {};

      const BATCH_SIZE = 50;
      for (let i = 0; i < contactsInVertical.length; i += BATCH_SIZE) {
        const batch = contactsInVertical.slice(i, i + BATCH_SIZE);
        for (const c of batch) {
          try {
            if (enrolledContactIds.has(c.id)) {
              skippedAlreadyEnrolled++;
              continue;
            }
            if (!c.email && !c.phone) {
              skippedMissingInfo++;
              skippedBreakdown["missing_contact_info"] = (skippedBreakdown["missing_contact_info"] ?? 0) + 1;
              continue;
            }
            const eligibility = await canEnrollContactInSequence(c.id, seq);
            if (!eligibility.allowed) {
              skippedIneligible++;
              const reason = eligibility.reason ?? "ineligible";
              skippedBreakdown[reason] = (skippedBreakdown[reason] ?? 0) + 1;
              continue;
            }
            // Email-channel contactability check — only when the sequence has
            // email steps.  This correctly blocks opted_out, unsubscribed,
            // bounced, invalid, unsafe, and blocked email addresses while NOT
            // over-blocking contacts in SMS-only or manual-task sequences.
            if (hasEmailSteps) {
              const { evaluateContactability } = await import("../services/contactability");
              const emailCheck = await evaluateContactability({
                contactId: c.id,
                channel: "email",
                campaignType: "sequence_enrollment",
                mode: "enforcement",
              });
              if (!emailCheck.allowed) {
                skippedIneligible++;
                const reason = emailCheck.reason ?? "email_blocked";
                skippedBreakdown[reason] = (skippedBreakdown[reason] ?? 0) + 1;
                continue;
              }
            }
            // Only count as queued when the writer confirms a new row was created.
            // createSequenceEnrollment() returns null for paused/active duplicates
            // (the DB unique index is the hard backstop).
            const created = await storage.createSequenceEnrollment({
              sequenceId: seqId,
              contactId: c.id,
              status: "active",
              currentStep: 0,
              nextActionAt: new Date(),
            });
            if (created !== null) {
              enrolledContactIds.add(c.id);
              queued++;
            } else {
              // Writer returned null — duplicate that slipped through the pre-check
              skippedAlreadyEnrolled++;
            }
          } catch (contactErr: any) {
            // Per-contact errors are isolated — log and continue the batch
            console.error(`[enroll-vertical] Error enrolling contact ${c.id}:`, contactErr?.message);
            errors++;
          }
        }
      }

      const skipped = skippedAlreadyEnrolled + skippedIneligible + skippedMissingInfo;

      await storage.createAuditLog({
        action: "sequence_vertical_bulk_enroll_completed",
        entityType: "sequence",
        entityId: seqId,
        userId,
        actorType: "user",
        details: {
          sequenceId: seqId,
          vertical,
          requestedBy: userId,
          eligible: queued,
          queued,
          skipped,
          errors,
          skippedBreakdown: { alreadyEnrolled: skippedAlreadyEnrolled, ineligible: skippedIneligible, missingInfo: skippedMissingInfo, ...skippedBreakdown },
          dryRun: false,
        },
      });

      res.json({
        queued,
        skipped,
        errors,
        skippedBreakdown: {
          alreadyEnrolled: skippedAlreadyEnrolled,
          ineligible: skippedIneligible,
          missingInfo: skippedMissingInfo,
          ...skippedBreakdown,
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });

  app.post("/api/email-logs/:id/track-click", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.updateEmailLog(id, { clickedAt: new Date(), status: "clicked" });
      res.json({ message: "Click recorded" });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // ─── Sequence Report ─────────────────────────────────────────────────────────
  app.get("/api/sequence-report", isDashboardUser, async (_req, res) => {
    try {
      const client = await pool.connect();
      try {
        const seqRows = await client.query(`
          SELECT
            s.id, s.name, s.status, s.trigger_type, s.sequence_family,
            s.description, s.eligible_consent_tiers, s.channels_allowed,
            s.lifecycle_stages_allowed, s.total_steps,
            COUNT(ss.id)::int AS step_count,
            SUM(CASE WHEN ss.action_type = 'email' THEN 1 ELSE 0 END)::int AS email_steps,
            SUM(CASE WHEN ss.action_type = 'sms' THEN 1 ELSE 0 END)::int AS sms_steps,
            SUM(CASE WHEN ss.action_type = 'ghl_workflow' THEN 1 ELSE 0 END)::int AS ghl_steps,
            SUM(CASE WHEN ss.action_type = 'task' THEN 1 ELSE 0 END)::int AS task_steps,
            MAX(ss.delay_days + COALESCE(ss.delay_hours, 0) / 24.0)::numeric(6,1) AS max_delay_days,
            COUNT(CASE WHEN e.status = 'active' THEN 1 END)::int AS active_enrollments,
            COUNT(CASE WHEN e.status = 'completed' THEN 1 END)::int AS completed_enrollments
          FROM follow_up_sequences s
          LEFT JOIN sequence_steps ss ON ss.sequence_id = s.id
          LEFT JOIN sequence_enrollments e ON e.sequence_id = s.id
          GROUP BY s.id, s.name, s.status, s.trigger_type, s.sequence_family,
                   s.description, s.eligible_consent_tiers, s.channels_allowed,
                   s.lifecycle_stages_allowed, s.total_steps
          ORDER BY s.status DESC, s.sequence_family NULLS LAST, s.name
        `);

        const siRows = await client.query(`
          SELECT id, label, domain, email_address, mailbox_type, provider,
                 is_active, warmup_status, daily_limit, sent_today,
                 bounces_today, complaints_today, health_score, vertical_assignment, last_used_at
          FROM sending_identities ORDER BY id
        `);

        const enrollRows = await client.query(`
          SELECT
            se.status,
            COUNT(*)::int AS count,
            COUNT(DISTINCT se.sequence_id)::int AS unique_sequences,
            COUNT(DISTINCT se.contact_id)::int AS unique_contacts
          FROM sequence_enrollments se
          GROUP BY se.status
        `);

        const sequences = seqRows.rows;
        const active = sequences.filter((s: any) => s.status === "active");
        const paused = sequences.filter((s: any) => s.status === "paused");
        const stalled = sequences.filter((s: any) => s.status === "paused" && (s.active_enrollments ?? 0) > 0);

        const totalEmailSteps = sequences.reduce((a: number, s: any) => a + (s.email_steps ?? 0), 0);
        const totalSmsSteps = sequences.reduce((a: number, s: any) => a + (s.sms_steps ?? 0), 0);
        const dailyCap = siRows.rows.filter((i: any) => i.is_active).reduce((a: number, i: any) => a + (i.daily_limit ?? 0), 0);
        const stallCount = stalled.reduce((a: number, s: any) => a + (s.active_enrollments ?? 0), 0);

        const enrollTotals: Record<string, number> = {};
        for (const r of enrollRows.rows) enrollTotals[r.status] = r.count;

        const pausedByFamily: Record<string, any[]> = {};
        for (const s of paused) {
          const key = s.sequence_family || "Legacy / Ungrouped";
          if (!pausedByFamily[key]) pausedByFamily[key] = [];
          pausedByFamily[key].push(s);
        }

        res.json({
          generatedAt: new Date().toISOString(),
          summary: {
            total: sequences.length,
            active: active.length,
            paused: paused.length,
            totalEmailSteps,
            totalSmsSteps,
            dailyCap,
            stallCount,
            activeIdentities: siRows.rows.filter((i: any) => i.is_active).length,
          },
          sendingIdentities: siRows.rows,
          activeSequences: active,
          stalledEnrollments: stalled,
          enrollmentTotals: enrollTotals,
          pausedByFamily,
          sequences,
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      serverError(res, err);
    }
  });

  app.post("/api/sequence-report/analyze", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const { summary, activeSequences, stalledEnrollments, sendingIdentities, enrollmentTotals, pausedByFamily } = req.body;
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });

      const activeNames = (activeSequences || []).map((s: any) => `  • [${s.trigger_type}] ${s.name} — ${s.email_steps}E/${s.sms_steps}S over ${s.max_delay_days}d (${s.active_enrollments} enrolled)`).join("\n");
      const stalledNames = (stalledEnrollments || []).map((s: any) => `  • "${s.name}" — ${s.active_enrollments} contacts stalled (sequence is PAUSED)`).join("\n");
      const identityList = (sendingIdentities || []).map((i: any) => `  • ${i.label} <${i.email_address}> | ${i.warmup_status} | health ${i.health_score} | daily_limit ${i.daily_limit} | sent_today ${i.sent_today}`).join("\n");
      const familyNames = Object.keys(pausedByFamily || {}).slice(0, 20).join(", ");
      // ── kill-switch gate (also records spend for daily cap accounting) ──

      const systemPrompt = `You are a senior revenue operations and email deliverability consultant auditing a payment processing company's (Liberty Bancard) outbound sales automation system. 
Analyze the sequence data objectively. Flag risks, gaps, and opportunities clearly. Be direct and concise. Use markdown with ## headings and bullet points. 
Focus on: business impact, deliverability risk, compliance, sales coverage gaps, and go-live readiness.`;

      const userPrompt = `## Liberty Bancard — Sequence & Sending Audit

**Business Model:** B2B payment processing sales targeting Florida merchants (auto repair, med spa, dental, salon, gym, restaurant, construction). Revenue from merchant processing volume (interchange + margin). Goal: convert small-to-mid merchants away from incumbents (Square, Stripe, local ISOs).

**System Snapshot:**
- Total sequences: ${summary?.total ?? 0}
- Active: ${summary?.active ?? 0} | Paused: ${summary?.paused ?? 0}
- Sending identities: ${summary?.activeIdentities ?? 0} active | Daily email cap: ${summary?.dailyCap ?? 0} emails/day
- Enrollment totals: ${JSON.stringify(enrollmentTotals)}
- Stalled contacts (active enrollments in PAUSED sequences): ${summary?.stallCount ?? 0}

**Active Sequences:**
${activeNames || "  (none)"}

**Stalled Enrollments (URGENT):**
${stalledNames || "  (none — good)"}

**Sending Infrastructure:**
${identityList || "  (none configured)"}

**Paused Sequence Families:**
${familyNames || "  (all ungrouped)"}

Please provide:
1. **Executive Summary** — 3-sentence read on overall system health
2. **Critical Issues** — anything blocking revenue or creating compliance/deliverability risk
3. **Sending Infrastructure Assessment** — capacity vs. business needs
4. **Sequence Coverage Analysis** — are the right verticals and funnel stages covered?
5. **Stalled Enrollment Action Plan** — what to do with the ${summary?.stallCount ?? 0} stuck contacts
6. **Go-Live Readiness Score** (0–100) with rationale
7. **Top 5 Priority Actions** — ordered by revenue impact`;

      const { completion } = await logAiCall(
        {
          triggerType: "sequence-analysis",
          actorType: "admin",
          actorId: String((req.user as any)?.id ?? "system"),
          model: "gpt-4o",
        },
        () => openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 2000,
        })
      );

      const analysis = completion.choices[0]?.message?.content ?? "No analysis generated.";
      res.json({ analysis, generatedAt: new Date().toISOString() });
    } catch (err: any) {
      serverError(res, err);
    }
  });

  // POST /api/sequences/steps/test-send
  // #544 — Send a test email for a sequence step body to the logged-in user's email.
  app.post("/api/sequences/steps/test-send", isDashboardUser, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.email) return res.status(400).json({ message: "No email on your account." });

      const { subject, body } = req.body;
      if (!body) return res.status(400).json({ message: "body is required" });

      const { sendSmtpEmail } = await import("../services/smtp-email");
      const result = await sendSmtpEmail({
        to: user.email,
        subject: `[TEST] ${subject || "Sequence Step Preview"}`,
        html: body,
        category: "internal_ops",
      });

      if (!result.success) {
        return res.status(500).json({ message: result.error || "SMTP send failed." });
      }
      res.json({ success: true });
    } catch (err: any) {
      serverError(res, err);
    }
  });

}
