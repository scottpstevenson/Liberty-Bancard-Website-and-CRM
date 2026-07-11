import type { Express } from "express";
import { isAuthenticated, isDashboardUser, requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { z } from "zod";
import { DateValidationError } from "../utils/date-coerce";
import { contacts, followUpSequences, sequenceEnrollments, insertCampaignSchema, insertCampaignStepSchema, insertFollowUpSequenceSchema, insertSequenceEnrollmentSchema, insertSequenceStepSchema } from "@shared/schema";
import type { AbTestConfig, AbTestResults } from "@shared/schema";
import { getCampaignAnalytics, processSendQueue, queueCampaignMessages, queueContactCampaignMessages, startCampaignPreviewAsync, getCampaignPreviewState, computeTargetingHash } from "../services/campaign-engine";
import { parse } from "csv-parse/sync";
import { checkAbTestWinners } from "../services/ab-test-worker";
import { pool, db } from "../db";
import { eq, and, count } from "drizzle-orm";

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
      res.json(campaigns);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getCampaign(Number(req.params.id));
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      res.json(campaign);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/campaigns", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignSchema.parse(req.body);
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const updated = await storage.updateCampaign(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Campaign not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/campaigns/:id/analytics", isAuthenticated, async (req, res) => {
    try {
      const analytics = await getCampaignAnalytics(Number(req.params.id));
      res.json(analytics);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === CAMPAIGN STEPS ===
  app.get("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getCampaignSteps(Number(req.params.id));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const input = insertCampaignStepSchema.parse({ ...req.body, campaignId: Number(req.params.id) });
      const step = await storage.createCampaignStep(input);
      res.status(201).json(step);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/campaign-steps/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.deleteCampaignStep(Number(req.params.id));
      res.json({ message: "Step deleted" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === OUTBOUND MESSAGES ===
  app.get("/api/outbound-messages", isAuthenticated, async (req, res) => {
    try {
      const campaignId = req.query.campaignId ? Number(req.query.campaignId) : undefined;
      const messages = await storage.getOutboundMessages(campaignId);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
        // Phase 2: verify readiness model version matches the snapshot in the preview.
        // If the scoring model was updated between preview and queue, block queueing.
        const { READINESS_MODEL_VERSION } = await import("../services/contact-readiness");
        if (
          preview.readinessModelVersion !== null &&
          preview.readinessModelVersion !== undefined &&
          preview.readinessModelVersion !== READINESS_MODEL_VERSION
        ) {
          return res.status(400).json({
            message: `Readiness scoring model updated (preview used v${preview.readinessModelVersion}, current is v${READINESS_MODEL_VERSION}). Please re-run the audience preview.`,
          });
        }
        if (preview.consumedAt) {
          return res.status(409).json({ message: "This preview was already used to queue messages. Re-run the audience preview to queue again." });
        }
        // ATOMIC CONSUME: single conditional UPDATE — only succeeds if consumed_at
        // is still NULL.  Two concurrent requests for the same previewId will each
        // try this UPDATE; exactly one wins (non-empty RETURNING), the other gets
        // null and receives 409.  No application-level lock needed.
        const consumed = await storage.consumeCampaignPreviewAtomic(preview.id);
        if (!consumed) {
          return res.status(409).json({ message: "This preview was already consumed by a concurrent request. Re-run the audience preview to queue again." });
        }

        queued = await queueContactCampaignMessages(campaignId);
        mode = "contacts";
        const previewEligibleCount = preview.eligibleCount ?? 0;
        return res.json({
          queued,
          mode,
          previewEligibleCount,
          countDifference: queued - previewEligibleCount,
          message: queued === previewEligibleCount
            ? `${queued} messages queued (matches preview).`
            : `${queued} messages queued (preview showed ${previewEligibleCount} eligible — difference due to contactability changes since preview).`,
        });
      } else {
        queued = await queueCampaignMessages(campaignId);
        mode = "prospects";
      }
      res.json({ queued, mode, message: `${queued} messages queued for sending` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST — start an async audience preview (DB-backed, restart-safe).
  // Creates a campaign_previews row with status=running and returns { status, previewId }.
  // Client should poll GET below until status === "done", then pass previewId to /queue.
  app.post("/api/campaigns/:id/audience-preview", isAuthenticated, async (req, res) => {
    try {
      const campaignId = Number(req.params.id);
      const campaign = await storage.getCampaign(campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });
      const requestedBy = (req as any).user?.email ?? (req as any).user?.id?.toString();
      const previewId = await startCampaignPreviewAsync(campaignId, requestedBy);
      res.json({ status: "running", previewId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/outbound/process-queue", isAuthenticated, async (req, res) => {
    try {
      const result = await processSendQueue();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === OUTBOUND WEBHOOK (for GHL tracking) ===
  app.post("/api/outbound/webhook", async (req, res) => {
    try {
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
          await storage.updateProspect(msg.prospectId, { doNotContact: true, status: "do_not_contact" });
        }
      }

      if (Object.keys(updates).length > 0) {
        await storage.updateOutboundMessage(msg.id, updates);
      }

      res.json({ message: "Webhook processed" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // === FOLLOW-UP SEQUENCES (DRIP CAMPAIGNS) ===
  app.get("/api/sequences", isAuthenticated, async (req, res) => {
    try {
      const sequences = await storage.getFollowUpSequences();
      res.json(sequences);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/sequences/:id", isAuthenticated, async (req, res) => {
    try {
      const seq = await storage.getFollowUpSequence(Number(req.params.id));
      if (!seq) return res.status(404).json({ message: "Not found" });
      res.json(seq);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequences/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateFollowUpSequence(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/sequences/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteFollowUpSequence(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/contacts/readiness-stats
  // Aggregated readiness score distribution — computed in Postgres via CASE on
  // the integer column, never loads JSONB blobs into Node.
  app.get("/api/contacts/readiness-stats", isDashboardUser, async (req, res) => {
    try {
      const { sql } = await import("drizzle-orm");
      const { db } = await import("../db");
      const { contacts } = await import("@shared/schema");
      const { READINESS_MODEL_VERSION, READINESS_GRADE_THRESHOLDS } = await import("../services/contact-readiness");

      const [row] = await db.execute(sql`
        SELECT
          COUNT(*)                                                       AS total,
          COUNT(*) FILTER (WHERE data_readiness_score IS NULL)           AS null_score,
          COUNT(*) FILTER (WHERE readiness_model_version < ${READINESS_MODEL_VERSION} OR readiness_model_version IS NULL) AS stale_model,
          COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.A}) AS grade_a,
          COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.B}
                            AND data_readiness_score < ${READINESS_GRADE_THRESHOLDS.A})   AS grade_b,
          COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.C}
                            AND data_readiness_score < ${READINESS_GRADE_THRESHOLDS.B})   AS grade_c,
          COUNT(*) FILTER (WHERE data_readiness_score >= ${READINESS_GRADE_THRESHOLDS.D}
                            AND data_readiness_score < ${READINESS_GRADE_THRESHOLDS.C})   AS grade_d,
          COUNT(*) FILTER (WHERE data_readiness_score < ${READINESS_GRADE_THRESHOLDS.D}
                            AND data_readiness_score IS NOT NULL)                         AS grade_f,
          ROUND(AVG(data_readiness_score), 1)                            AS avg_score,
          MIN(data_readiness_score)                                       AS min_score,
          MAX(data_readiness_score)                                       AS max_score
        FROM contacts
        WHERE archived_at IS NULL
      `);

      res.json({
        total: Number(row.total),
        nullScore: Number(row.null_score),
        staleModel: Number(row.stale_model),
        grades: {
          A: Number(row.grade_a),
          B: Number(row.grade_b),
          C: Number(row.grade_c),
          D: Number(row.grade_d),
          F: Number(row.grade_f),
        },
        avgScore: row.avg_score !== null ? Number(row.avg_score) : null,
        minScore: row.min_score !== null ? Number(row.min_score) : null,
        maxScore: row.max_score !== null ? Number(row.max_score) : null,
        modelVersion: READINESS_MODEL_VERSION,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SEQUENCE STEPS ===
  app.get("/api/sequences/:sequenceId/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await storage.getSequenceSteps(Number(req.params.sequenceId));
      res.json(steps);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequence-steps/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      const updated = await storage.updateSequenceStep(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/sequence-steps/:id", isDashboardUser, requireRole("admin", "manager"), async (req, res) => {
    try {
      await storage.deleteSequenceStep(Number(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === SEQUENCE TIER BREAKDOWN ===
  app.get("/api/sequences/:id/enrollments/by-tier", isDashboardUser, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
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
      res.status(500).json({ message: err.message });
    }
  });

  // === SEQUENCE ENROLLMENTS ===
  app.get("/api/sequence-enrollments", isAuthenticated, async (req, res) => {
    try {
      const sequenceId = req.query.sequenceId ? Number(req.query.sequenceId) : undefined;
      const enrollments = await storage.getSequenceEnrollments(sequenceId);
      res.json(enrollments);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequence-enrollments", isAuthenticated, async (req, res) => {
    try {
      const { canEnrollContactInSequence } = await import("../services/sequence-eligibility");
      const input = insertSequenceEnrollmentSchema.parse(req.body);
      if (input.sequenceId) {
        const seq = await storage.getFollowUpSequence(input.sequenceId);
        if (!seq) return res.status(404).json({ message: "Sequence not found." });
        if (seq.status !== "active") return res.status(409).json({ message: `Sequence "${seq.name}" is ${seq.status}. Activate it before enrolling contacts.` });
        if (input.contactId) {
          const eligibility = await canEnrollContactInSequence(input.contactId, seq);
          if (!eligibility.allowed) {
            await storage.createAuditLog({
              action: "sequence_enrollment_blocked_consent",
              entityType: "contact",
              entityId: input.contactId,
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
        }
      }
      const enrollment = await storage.createSequenceEnrollment(input);
      if (enrollment === null) {
        return res.status(409).json({ message: "Contact is already enrolled in an active or paused sequence." });
      }
      await storage.createAuditLog({ action: "sequence_enrolled", entityType: "contact", entityId: enrollment.contactId || 0, details: { sequenceId: String(enrollment.sequenceId) } });
      res.status(201).json(enrollment);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/sequence-enrollments/:id", isAuthenticated, async (req, res) => {
    try {
      const enrollmentDateSchema = z.object({
        nextActionAt: z.coerce.date().optional().nullable(),
        completedAt: z.coerce.date().optional().nullable(),
        pausedAt: z.coerce.date().optional().nullable(),
      }).passthrough();
      const body = enrollmentDateSchema.parse(req.body);
      const updated = await storage.updateSequenceEnrollment(Number(req.params.id), body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      if (err instanceof DateValidationError) return res.status(400).json({ message: err.message, field: err.field });
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:contactId/enrollments", isAuthenticated, async (req, res) => {
    try {
      const enrollments = await storage.getContactEnrollments(Number(req.params.contactId));
      res.json(enrollments);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/contacts/:id/sequence-suggestions", isAuthenticated, async (req, res) => {
    try {
      const { suggestSequenceFamiliesForContact } = await import("../services/sequence-eligibility");
      const contactId = Number(req.params.id);
      const suggestions = await suggestSequenceFamiliesForContact(contactId);
      res.json(suggestions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequence-steps/:id/ab-test-results", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        variantASent: z.number().int().min(0).optional(),
        variantBSent: z.number().int().min(0).optional(),
        aOpens: z.number().int().min(0).optional(),
        bOpens: z.number().int().min(0).optional(),
        aClicks: z.number().int().min(0).optional(),
        bClicks: z.number().int().min(0).optional(),
        aReplies: z.number().int().min(0).optional(),
        bReplies: z.number().int().min(0).optional(),
        winnerSelected: z.string().nullable().optional(),
        winnerAt: z.string().nullable().optional(),
        statisticallySignificant: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const step = await storage.updateSequenceStepAbTestResults(
        Number(req.params.id),
        {
          variantASent: parsed.data.variantASent ?? 0,
          variantBSent: parsed.data.variantBSent ?? 0,
          aOpens: parsed.data.aOpens ?? 0,
          bOpens: parsed.data.bOpens ?? 0,
          aClicks: parsed.data.aClicks ?? 0,
          bClicks: parsed.data.bClicks ?? 0,
          aReplies: parsed.data.aReplies ?? 0,
          bReplies: parsed.data.bReplies ?? 0,
          winnerSelected: parsed.data.winnerSelected ?? null,
          winnerAt: parsed.data.winnerAt ?? null,
          startedAt: null,
          statisticallySignificant: parsed.data.statisticallySignificant,
        }
      );
      if (!step) return res.status(404).json({ message: "Step not found" });
      res.json(step);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/sequences/trigger-ab-check", isAuthenticated, async (_req, res) => {
    try {
      const result = await checkAbTestWinners();
      res.json({ message: "A/B test check complete", ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // === VERTICAL BULK ENROLLMENT ===

  app.get("/api/contacts/verticals", isAuthenticated, async (_req, res) => {
    try {
      const verticals = await storage.getContactVerticalCounts();
      res.json(verticals);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

      const { canEnrollContactInSequence } = await import("../services/sequence-eligibility");
      const contactsInVertical = await storage.getContactsByVertical(vertical);
      const totalMatching = contactsInVertical.length;

      const existingEnrollments = await storage.getSequenceEnrollments(seqId);
      const enrolledContactIds = new Set(
        existingEnrollments
          .filter(e => e.status === "active" || e.status === "completed")
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
        const eligibility = await canEnrollContactInSequence(c.id, seq);
        if (!eligibility.allowed) {
          notEligible++;
          const reason = eligibility.reason ?? "ineligible";
          skippedBreakdown[reason] = (skippedBreakdown[reason] ?? 0) + 1;
        } else {
          eligible++;
          if (previewContacts.length < 5) {
            previewContacts.push({ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email });
          }
        }
      }

      const userId = (req as any).user?.id?.toString() ?? null;
      await storage.createAuditLog({
        action: "sequence_vertical_bulk_enroll_previewed",
        entityType: "sequence",
        entityId: seqId,
        userId,
        actorType: "user",
        details: { sequenceId: seqId, vertical, totalMatching, eligible, alreadyEnrolled, notEligible, dryRun: true },
      });

      res.json({ totalMatching, eligible, alreadyEnrolled, notEligible, skippedBreakdown, previewContacts });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
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

      const seq = await storage.getFollowUpSequence(seqId);
      if (!seq) return res.status(404).json({ message: "Sequence not found." });
      if (seq.status !== "active") return res.status(409).json({ message: `Sequence "${seq.name}" is ${seq.status}. Activate it before enrolling contacts.` });

      const { canEnrollContactInSequence } = await import("../services/sequence-eligibility");
      const contactsInVertical = await storage.getContactsByVertical(vertical);

      const existingEnrollments = await storage.getSequenceEnrollments(seqId);
      const enrolledContactIds = new Set(
        existingEnrollments
          .filter(e => e.status === "active" || e.status === "completed")
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
      const skippedBreakdown: Record<string, number> = {};

      const BATCH_SIZE = 50;
      for (let i = 0; i < contactsInVertical.length; i += BATCH_SIZE) {
        const batch = contactsInVertical.slice(i, i + BATCH_SIZE);
        for (const c of batch) {
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
          await storage.createSequenceEnrollment({
            sequenceId: seqId,
            contactId: c.id,
            status: "active",
            currentStep: 0,
            nextActionAt: new Date(),
          });
          enrolledContactIds.add(c.id);
          queued++;
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
          skippedBreakdown: { alreadyEnrolled: skippedAlreadyEnrolled, ineligible: skippedIneligible, missingInfo: skippedMissingInfo, ...skippedBreakdown },
          dryRun: false,
        },
      });

      res.json({
        queued,
        skipped,
        skippedBreakdown: {
          alreadyEnrolled: skippedAlreadyEnrolled,
          ineligible: skippedIneligible,
          missingInfo: skippedMissingInfo,
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/email-logs/:id/track-click", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await storage.updateEmailLog(id, { clickedAt: new Date(), status: "clicked" });
      res.json({ message: "Click recorded" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

}
