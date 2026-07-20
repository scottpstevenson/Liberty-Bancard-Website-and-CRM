import type { Express } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { requireRole } from "../replit_integrations/auth";
import { storage } from "../storage";
import { db } from "../db";
import { contacts, contactSourceEvents, followUpSequences, auditLogs, sequenceEnrollments } from "@shared/schema";
import { eq, and, like, ilike } from "drizzle-orm";
import { featureFlags } from "../services/feature-flags";
import { sendGhlEmail } from "../services/ghl";
import {
  getWizardFlagOverride,
  setWizardFlagOverride,
  getAllFlagStates,
  isValidWizardFlag,
  startFlagCacheRefresh,
} from "../services/wizard-flag-overrides";
import { analyzeStatementBuffer } from "../services/statement-analyzer";
import { writeContact } from "../services/contact-writer";
import { getQueueManager } from "../services/queue-manager";

const wizardUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = file.mimetype === "application/pdf";
    cb(null, ok);
  },
});

const wizardTestRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { ok: false, error: "Too many test sends — limit is 5 per 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.NODE_ENV === "production") return false;
    const ip = req.ip ?? "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
});

const CALENDAR_VARS: Array<{ key: string; name: string }> = [
  { key: "GHL_CALENDAR_ID", name: "Default" },
  { key: "GHL_CALENDAR_MEDICAL", name: "Medical" },
  { key: "GHL_CALENDAR_DENTAL", name: "Dental" },
  { key: "GHL_CALENDAR_MEDSPA", name: "Med Spa" },
  { key: "GHL_CALENDAR_AUTO", name: "Auto" },
  { key: "GHL_CALENDAR_RESTAURANT", name: "Restaurant" },
];

const QUEUE_EXPECTED_INTERVALS: Record<string, number> = {
  "ghl-sync":      45_000,
  "sequences":     30_000,
  "sla-checks":    5 * 60_000,
  "enrichment":    10 * 60_000,
  "digests":       60 * 60_000,
  "discovery":     24 * 60 * 60_000,
  "mid-ingestion": 24 * 60 * 60_000,
};

export function registerWizardRoutes(app: Express): void {
  // Hydrate the flag cache immediately so getCachedWizardFlagOverrideSync()
  // returns real DB values on the very first featureFlags.* access.
  startFlagCacheRefresh();

  // ── Phase 1: Connectivity ───────────────────────────────────────────────────
  app.get("/api/wizard/connectivity", requireRole("admin", "manager"), async (_req, res) => {
    const timeoutMs = 8_000;

    const [ghlResult, redisResult, openaiResult, smtpResult, webhookResult] = await Promise.allSettled([
      // GHL
      (async () => {
        const { checkGhlHealth } = await import("../services/ghl");
        const start = Date.now();
        const h = await checkGhlHealth();
        return {
          ok: h.connected,
          latencyMs: h.latencyMs ?? (Date.now() - start),
          detail: h.connected
            ? `Connected — ${h.locationName ?? "unknown location"}`
            : (h.error ?? "Not configured"),
        };
      })(),

      // Redis
      (async () => {
        const { isUsingMockRedis } = await import("../services/queue-connection");
        const usingMock = isUsingMockRedis();
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
          return {
            ok: true,
            usingMock: true,
            detail: "In-memory mock — set REDIS_URL for production durability",
          };
        }

        try {
          const Redis = (await import("ioredis")).default;
          const url = new URL(redisUrl);
          const forceTls = url.protocol === "rediss:" || url.hostname.includes("upstash.io");
          const probe = new Redis({
            host: url.hostname,
            port: parseInt(url.port || "6379", 10),
            password: url.password || undefined,
            username: url.username || undefined,
            tls: forceTls ? {} : undefined,
            connectTimeout: 5000,
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableReadyCheck: false,
          });
          await probe.connect();
          const result = await Promise.race([
            probe.ping(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
          ]);
          probe.disconnect();
          return {
            ok: result === "PONG",
            usingMock: false,
            detail: result === "PONG" ? "Connected" : "Unexpected PING response",
          };
        } catch (err: any) {
          return { ok: false, usingMock, detail: err.message ?? "Ping failed" };
        }
      })(),

      // OpenAI
      (async () => {
        const OpenAI = (await import("openai")).default;
        const openai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });
        try {
          await Promise.race([
            openai.models.list(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5_000)),
          ]);
          return { ok: true, detail: "API key valid" };
        } catch (err: any) {
          const msg = String(err?.message ?? "");
          if (msg.includes("401") || msg.includes("invalid")) {
            return { ok: false, detail: "Invalid or expired API key" };
          }
          return { ok: false, detail: msg.slice(0, 100) || "Connection failed" };
        }
      })(),

      // SMTP
      (async () => {
        const configured = !!(
          process.env.SMTP_HOST &&
          process.env.SMTP_USER &&
          process.env.SMTP_PASS
        );
        return {
          ok: configured,
          configured,
          detail: configured
            ? `Configured (${process.env.SMTP_HOST})`
            : "SMTP_HOST, SMTP_USER, SMTP_PASS not set — GHL will be used for email",
        };
      })(),

      // Webhook secret
      (async () => {
        const present = !!process.env.GHL_WEBHOOK_SECRET;
        return {
          ok: present,
          detail: present
            ? "GHL_WEBHOOK_SECRET is set"
            : "GHL_WEBHOOK_SECRET not set — webhook signature verification is disabled",
        };
      })(),
    ]);

    const extract = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
      r.status === "fulfilled" ? r.value : fallback;

    res.json({
      ghl: extract(ghlResult, { ok: false, latencyMs: 0, detail: "Check failed" }),
      redis: extract(redisResult, { ok: false, usingMock: true, detail: "Check failed" }),
      openai: extract(openaiResult, { ok: false, detail: "Check failed" }),
      smtp: extract(smtpResult, { ok: false, configured: false, detail: "Check failed" }),
      webhookSecret: extract(webhookResult, { ok: false, detail: "Check failed" }),
    });
  });

  // ── Phase 2: Test Contact ───────────────────────────────────────────────────
  app.post("/api/wizard/test-contact", requireRole("admin", "manager"), async (req, res) => {
    const { email, phone, firstName } = req.body as {
      email: string;
      phone?: string;
      firstName?: string;
    };

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    // Idempotent: check for existing wizard_test_contact with same email
    const existing = await storage.getContacts({ limit: 5000 });
    const found = existing.data.find(
      (c) => c.email?.toLowerCase() === email.toLowerCase() &&
        Array.isArray(c.tags) && c.tags.includes("wizard_test_contact")
    );

    if (found) {
      return res.json({
        contactId: found.id,
        email: found.email,
        phone: found.phone,
        alreadyExisted: true,
      });
    }

    const contact = await writeContact({
      mode: "local_only",
      mutation: {
        firstName: firstName || "Wizard",
        lastName: "Test",
        email,
        phone: phone || "",
        tags: ["wizard_test_contact"],
        consentEmail: true,
        consentSms: true,
        consentTier: "pewc_full_automation",
      },
      provenance: {
        sourceCategory: "manual_crm",
        sourceType: "dashboard",
        eventKey: `wizard:test-contact:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "wizard"),
        metadata: { wizardCreated: true },
      },
      actor: {
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "wizard"),
        userId: (req.user as any)?.id ?? null,
      },
    });

    res.json({
      contactId: contact.id,
      email: contact.email,
      phone: contact.phone,
      alreadyExisted: false,
    });
  });

  app.delete("/api/wizard/test-contact/:contactId", requireRole("admin", "manager"), async (req, res) => {
    const contactId = Number(req.params.contactId);
    if (!contactId) return res.status(400).json({ error: "Invalid contactId" });

    const contact = await storage.getContact(contactId);
    if (!contact) return res.status(404).json({ error: "Contact not found" });

    const tags = Array.isArray(contact.tags) ? contact.tags : [];
    if (!tags.includes("wizard_test_contact")) {
      return res.status(403).json({
        error: "This contact does not have the wizard_test_contact tag — refusing to delete to protect real contacts",
      });
    }

    // Null out primary_source_event_id FK first (deferrable constraint), then delete source events, then contact
    await db.update(contacts).set({ primarySourceEventId: null } as any).where(eq(contacts.id, contactId));
    await db.delete(contactSourceEvents).where(eq(contactSourceEvents.contactId, contactId));
    await db.delete(contacts).where(eq(contacts.id, contactId));

    res.json({ deleted: true });
  });

  // ── Phase 3: Live Channel Tests ─────────────────────────────────────────────
  app.post("/api/wizard/test-send/email", requireRole("admin", "manager"), wizardTestRateLimit, async (req, res) => {
    const { contactId } = req.body as { contactId: number };
    if (!contactId) return res.status(400).json({ ok: false, detail: "contactId is required" });

    try {
      const result = await sendGhlEmail({
        contactId,
        subject: "Liberty Bancard — System Test Email",
        body: "<p>This is a live test from the Setup Wizard. No action required.</p><p>If you received this, the email channel is working correctly.</p>",
        skipActivityLog: false,
      });
      return res.json({
        ok: result.success,
        messageId: result.messageId,
        detail: result.success ? "Email sent successfully" : (result.error ?? "Send failed"),
      });
    } catch (err: any) {
      return res.json({ ok: false, detail: err.message ?? "Send failed" });
    }
  });

  app.post("/api/wizard/test-send/sms", requireRole("admin", "manager"), wizardTestRateLimit, async (req, res) => {
    const { contactId } = req.body as { contactId: number };
    if (!contactId) return res.status(400).json({ ok: false, detail: "contactId is required" });

    if (!featureFlags.SMS_ENABLED) {
      return res.json({ ok: false, blocked: true, reason: "SMS_ENABLED is off — enable in Phase 6" });
    }

    try {
      const { sendGhlSms } = await import("../services/ghl");
      await sendGhlSms({ contactId, body: "Liberty Bancard setup wizard test SMS — please ignore." });
      return res.json({ ok: true, detail: "SMS sent successfully" });
    } catch (err: any) {
      return res.json({ ok: false, detail: err.message ?? "SMS send failed" });
    }
  });

  app.post("/api/wizard/test-send/voice", requireRole("admin", "manager"), wizardTestRateLimit, async (req, res) => {
    const { contactId } = req.body as { contactId: number };
    if (!contactId) return res.status(400).json({ ok: false, detail: "contactId is required" });

    if (!featureFlags.VOICE_AI_ENABLED) {
      return res.json({ ok: false, blocked: true, reason: "VOICE_AI_ENABLED is off — enable in Phase 6" });
    }

    try {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
      if (!contact) return res.json({ ok: false, detail: "Test contact not found" });
      if (!contact.phone) {
        return res.json({ ok: false, detail: "Test contact has no phone number — add one in Phase 2 to test voice" });
      }
      if (!contact.ghlContactId) {
        return res.json({ ok: false, detail: "Contact not yet synced to GHL — wait for the next sync tick (~45 s) and retry" });
      }

      const { enrollInGhlWorkflow } = await import("../services/ghl-workflows");
      const result = await enrollInGhlWorkflow({
        workflowKey: "GHL_WORKFLOW_VOICE_AI_OUTREACH",
        ghlContactId: contact.ghlContactId,
      });
      return res.json({
        ok: result.enrolled,
        method: result.method ?? null,
        detail: result.enrolled
          ? `Voice AI workflow triggered for ${contact.firstName ?? contact.email} (GHL contact ${contact.ghlContactId})`
          : (result.reason ?? "GHL voice workflow not configured — set GHL_WORKFLOW_VOICE_AI_OUTREACH in env or via the Workflow ID Manager"),
      });
    } catch (err: any) {
      return res.json({ ok: false, detail: err.message ?? "Voice AI initiation failed" });
    }
  });

  app.post("/api/wizard/test-send/voicemail", requireRole("admin", "manager"), wizardTestRateLimit, async (req, res) => {
    const { contactId } = req.body as { contactId: number };
    if (!contactId) return res.status(400).json({ ok: false, detail: "contactId is required" });

    if (!featureFlags.RINGLESS_VM_ENABLED) {
      return res.json({ ok: false, blocked: true, reason: "RINGLESS_VM_ENABLED is off — enable in Phase 6" });
    }

    try {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
      if (!contact) return res.json({ ok: false, detail: "Test contact not found" });
      if (!contact.phone) {
        return res.json({ ok: false, detail: "Test contact has no phone number — add one in Phase 2 to test ringless VM" });
      }
      if (!contact.ghlContactId) {
        return res.json({ ok: false, detail: "Contact not yet synced to GHL — wait for the next sync tick (~45 s) and retry" });
      }

      const { enrollInGhlWorkflow } = await import("../services/ghl-workflows");
      const result = await enrollInGhlWorkflow({
        workflowKey: "GHL_WORKFLOW_RINGLESS_VM",
        ghlContactId: contact.ghlContactId,
      });
      return res.json({
        ok: result.enrolled,
        method: result.method ?? null,
        detail: result.enrolled
          ? `Ringless voicemail workflow triggered for ${contact.firstName ?? contact.email} (GHL contact ${contact.ghlContactId})`
          : (result.reason ?? "GHL ringless VM workflow not configured — set GHL_WORKFLOW_RINGLESS_VM in env or via the Workflow ID Manager"),
      });
    } catch (err: any) {
      return res.json({ ok: false, detail: err.message ?? "Ringless VM initiation failed" });
    }
  });

  // ── Phase 4A: Sequence Enrollment ──────────────────────────────────────────
  app.post("/api/wizard/test-sequence", requireRole("admin", "manager"), async (req, res) => {
    const { contactId, sequenceId: rawSequenceId } = req.body as {
      contactId: number;
      sequenceId?: number;
    };

    if (!contactId) return res.status(400).json({ ok: false, error: "contactId is required" });

    let sequence: any;

    if (rawSequenceId) {
      sequence = await storage.getSequence(rawSequenceId);
    } else {
      // Find the "Inbound Confirmation" sequence by name
      const allSeqs = await storage.getSequences();
      sequence = allSeqs.find(
        (s: any) =>
          s.name?.toLowerCase().includes("inbound confirmation") ||
          s.name?.toLowerCase().includes("inbound lead")
      ) ?? allSeqs[0];
    }

    if (!sequence) {
      return res.json({ ok: false, error: "No sequences found — create a sequence first" });
    }

    if (sequence.status !== "active") {
      return res.json({
        ok: false,
        error: `Sequence "${sequence.name}" is paused — activate it in Phase 6 first`,
        sequenceName: sequence.name,
        sequenceId: sequence.id,
      });
    }

    const steps = await storage.getSequenceSteps(sequence.id);

    if (!steps || steps.length === 0) {
      return res.json({
        ok: false,
        error: `Sequence "${sequence.name}" has no steps — add at least one step before testing enrollment`,
        sequenceName: sequence.name,
        sequenceId: sequence.id,
      });
    }

    const enrollment = await storage.createSequenceEnrollment({
      contactId,
      sequenceId: sequence.id,
      status: "active",
      currentStep: 0,
      metadata: { wizardTest: true },
    } as any);

    if (!enrollment) {
      return res.json({ ok: false, error: "Failed to create enrollment — contact may already be enrolled" });
    }

    const nextStepAt = new Date(Date.now() + (steps[0]?.delayHours ?? 0) * 3600_000).toISOString();

    return res.json({
      ok: true,
      enrollmentId: enrollment.id,
      sequenceName: sequence.name,
      sequenceId: sequence.id,
      steps: steps.map((s: any) => ({
        stepNumber: s.stepNumber,
        type: s.type,
        delayHours: s.delayHours,
        subject: s.subject ?? null,
      })),
      nextStepAt,
    });
  });

  app.delete("/api/wizard/test-sequence/:enrollmentId", requireRole("admin", "manager"), async (req, res) => {
    const enrollmentId = Number(req.params.enrollmentId);
    if (!enrollmentId) return res.status(400).json({ error: "Invalid enrollmentId" });

    const [enrollment] = await db
      .select()
      .from(sequenceEnrollments)
      .where(eq(sequenceEnrollments.id, enrollmentId))
      .limit(1);

    if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });
    if (!(enrollment.metadata as any)?.wizardTest) {
      return res.status(403).json({ error: "This enrollment was not created by the Setup Wizard and cannot be cancelled here" });
    }

    await storage.updateSequenceEnrollment(enrollmentId, { status: "cancelled" } as any);
    return res.json({ cancelled: true });
  });

  // ── Phase 4B: Statement AI Audit ───────────────────────────────────────────
  app.post(
    "/api/wizard/test-statement",
    requireRole("admin", "manager"),
    wizardUpload.single("file"),
    async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded or file too large (max 5MB)" });
      }

      if (!req.file.mimetype.includes("pdf")) {
        return res.status(400).json({ error: "Only PDF files are accepted for statement analysis" });
      }

      try {
        const result = await analyzeStatementBuffer(req.file.buffer, req.file.originalname);
        return res.json(result);
      } catch (err: any) {
        return res.status(500).json({ error: err.message ?? "Analysis failed" });
      }
    }
  );

  // ── Phase 4C: Booking Links ─────────────────────────────────────────────────
  app.get("/api/wizard/booking-links", requireRole("admin", "manager"), async (_req, res) => {
    const configured: Array<{ key: string; name: string; calendarId: string; bookingUrl: string }> = [];
    const unconfigured: string[] = [];

    for (const { key, name } of CALENDAR_VARS) {
      const calendarId = process.env[key];
      if (calendarId && calendarId.trim()) {
        configured.push({
          key,
          name,
          calendarId: calendarId.trim(),
          bookingUrl: `https://api.leadconnectorhq.com/widget/booking/${calendarId.trim()}`,
        });
      } else {
        unconfigured.push(key);
      }
    }

    return res.json({
      configured: configured.length > 0,
      calendars: configured,
      unconfigured,
    });
  });

  // ── Phase 4D: Merchant Application Test ────────────────────────────────────
  app.post("/api/wizard/test-application", requireRole("admin", "manager"), async (req, res) => {
    const { email } = req.body as { email: string };
    if (!email) return res.status(400).json({ error: "email is required" });

    const contact = await writeContact({
      mode: "ghl_upsert_first",
      mutation: {
        firstName: "Wizard",
        lastName: "Test",
        email,
        companyName: "WizardTest LLC",
        tags: ["wizard_application_test"],
        consentEmail: true,
      },
      provenance: {
        sourceCategory: "public_form",
        sourceType: "get_started_form",
        eventKey: `wizard:test-app:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "wizard"),
        metadata: { wizardApplicationTest: true },
      },
      actor: {
        actorType: "admin",
        actorId: String((req.user as any)?.id ?? "wizard"),
        userId: (req.user as any)?.id ?? null,
      },
    });

    const deal = await storage.createDeal({
      contactId: contact.id,
      pipeline: "sales",
      stage: "New Lead",
      notes: "Wizard test application — safe to delete",
      value: null,
    } as any);

    return res.json({
      ok: true,
      contactId: contact.id,
      dealId: deal.id,
      dealUrl: `/dashboard/contacts/${contact.id}`,
    });
  });

  // ── Phase 5: Queue Health ───────────────────────────────────────────────────
  app.get("/api/wizard/queue-health", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const qm = await getQueueManager();
      const { queues, usingMock } = await qm.getAllQueueMetrics();

      const now = Date.now();
      const enrichedQueues = queues
        .filter((q: any) =>
          Object.keys(QUEUE_EXPECTED_INTERVALS).some((name) => q.name?.includes(name))
        )
        .map((q: any) => {
          const matchedKey = Object.keys(QUEUE_EXPECTED_INTERVALS).find((k) => q.name?.includes(k));
          const expectedIntervalMs = matchedKey ? QUEUE_EXPECTED_INTERVALS[matchedKey] : null;

          let isStale = false;
          let staleSince: string | null = null;

          if (expectedIntervalMs && q.lastCompletedAt) {
            const lastMs = new Date(q.lastCompletedAt).getTime();
            if (now - lastMs > 3 * expectedIntervalMs) {
              isStale = true;
              staleSince = new Date(lastMs + 3 * expectedIntervalMs).toISOString();
            }
          } else if (expectedIntervalMs && !q.lastCompletedAt) {
            isStale = true;
          }

          return {
            name: q.name,
            expectedIntervalMs,
            lastCompletedAt: q.lastCompletedAt ?? null,
            isStale,
            staleSince,
            waiting: q.waiting ?? 0,
            active: q.active ?? 0,
            failed: q.failed ?? 0,
            paused: q.isPaused ?? false,
            usingMock,
          };
        });

      return res.json({ queues: enrichedQueues, usingMock });
    } catch (err: any) {
      return res.status(500).json({ error: err.message ?? "Failed to fetch queue metrics" });
    }
  });

  // ── Phase 6A: Sequence Activator (read from existing sequence routes) ───────
  // W6 sequences are listed via GET /api/sequences — no new route needed.
  // The toggle is PUT /api/sequences/:id/toggle-status (existing campaigns.ts route).

  // ── Phase 6B: Feature Flags ─────────────────────────────────────────────────
  app.get("/api/wizard/feature-flags", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const states = await getAllFlagStates();
      return res.json(states);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/wizard/feature-flag", requireRole("admin"), async (req, res) => {
    const { flag, enabled, confirmReason } = req.body as {
      flag: string;
      enabled: boolean;
      confirmReason: string;
    };

    if (!flag || !isValidWizardFlag(flag)) {
      return res.status(400).json({
        error: `Invalid flag. Valid flags: SDR_ENABLED, ORCHESTRATOR_ENABLED, LEGACY_OUTREACH_ENABLED, SMS_ENABLED, VOICE_AI_ENABLED, RINGLESS_VM_ENABLED, NIGHTLY_DISCOVERY_ENABLED`,
      });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    if (!confirmReason || String(confirmReason).trim().length < 10) {
      return res.status(400).json({ error: "confirmReason must be at least 10 characters" });
    }

    const actorEmail = (req.user as any)?.email ?? "unknown";
    await setWizardFlagOverride(flag, enabled, actorEmail, confirmReason.trim());

    return res.json({ ok: true, flag, enabled, source: "db_override" });
  });
}
