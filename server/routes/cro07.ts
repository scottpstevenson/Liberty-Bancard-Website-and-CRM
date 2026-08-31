import type { Express, Request } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import {
  CRO07_PRODUCTION_CONNECTED,
  CRO07_SENDING_ENABLED,
  approveCro07Release,
  createCro07Release,
  getCro07Release,
  listCro07ReleasesForIntent,
} from "../services/cro07-release-authority";
import {
  claimCro07Attempt,
  executeCro07Attempt,
  reconcileCro07Attempt,
} from "../services/cro07-transport-adapter";
import { ingestCro07Feedback, verifyCro07WebhookSignature, resolveCro07WebhookSecret } from "../services/cro07-feedback";
import { getCro07AttributionForContact } from "../services/cro07-attribution";
import { getCro07Taxonomy } from "../services/cro07-taxonomy";
import {
  decideCro07Experiment,
  freezeCro07Experiment,
  getCro07Experiment,
  listCro07Experiments,
  recordCro07ExperimentSample,
  startCro07Experiment,
} from "../services/cro07-experiments";

const uuid = z.string().uuid();

function actorId(req: Request): string {
  const user = req.user as any;
  return String(user?.email ?? user?.id ?? "unknown-admin");
}

function idempotencyKey(req: Request): string | null {
  const value = req.get("Idempotency-Key");
  return value && value.length >= 8 && value.length <= 200 ? value : null;
}

function cro07Error(res: any, error: unknown) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ code: "CRO07_INVALID_COMMAND", message: "Invalid governed command" });
  }
  const message = error instanceof Error ? error.message : "CRO07_UNKNOWN_ERROR";
  if (message.includes("NOT_FOUND")) return res.status(404).json({ code: message });
  if (message.startsWith("CRO07_")) return res.status(409).json({ code: message });
  return serverError(res, error);
}

export function registerCro07Routes(app: Express) {
  // ─── Release authority ────────────────────────────────────────────────
  app.post("/api/admin/cro07/releases", requireRole("admin"), async (req, res) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = z.object({
        cr06DeliveryIntentId: uuid,
        reviewedSha: z.string().trim().min(7).max(64),
        migrationHead: z.string().trim().min(1).max(200),
        senderRoute: z.string().trim().min(1).max(120),
        providerSource: z.string().trim().min(1).max(80),
        caps: z.object({ dailyCap: z.number().int().min(0).max(10000), perHourCap: z.number().int().min(0).max(1000) }),
        canarySize: z.number().int().min(0).max(1000),
        stopThresholds: z.object({
          maxBounceRatePct: z.number().min(0).max(100),
          maxComplaintRatePct: z.number().min(0).max(100),
          maxReplyBacklog: z.number().int().min(0),
        }),
        reason: z.string().trim().min(1).max(500),
        expiresAt: z.string().datetime(),
      }).strict().parse(req.body);
      const result = await createCro07Release({
        ...input,
        expiresAt: new Date(input.expiresAt),
        actorId: actorId(req),
        idempotencyKey: key,
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.get("/api/admin/cro07/releases/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const release = await getCro07Release(uuid.parse(req.params.id));
      if (!release) return res.status(404).json({ code: "CRO07_RELEASE_NOT_FOUND" });
      res.json(release);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.get("/api/admin/cro07/intents/:id/releases", requireRole("admin", "manager"), async (req, res) => {
    try {
      res.json(await listCro07ReleasesForIntent(uuid.parse(req.params.id)));
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/releases/:id/approve", requireRole("admin"), async (req, res) => {
    try {
      const input = z.object({ expectedRevisionHash: z.string().trim().min(1) }).strict().parse(req.body);
      const release = await approveCro07Release({
        releaseId: uuid.parse(req.params.id),
        approverId: actorId(req),
        expectedRevisionHash: input.expectedRevisionHash,
      });
      res.json(release);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  // ─── Denied transport attempts (never actually deliver) ────────────────
  app.post("/api/admin/cro07/attempts/claim", requireRole("admin"), async (req, res) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = z.object({ releaseId: uuid, provider: z.string().trim().min(1).max(80) }).strict().parse(req.body);
      const result = await claimCro07Attempt({ releaseId: input.releaseId, provider: input.provider, idempotencyKey: key });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/attempts/:id/execute", requireRole("admin"), async (req, res) => {
    try {
      const input = z.object({ frozenPayloadHash: z.string().trim().min(1) }).strict().parse(req.body);
      const result = await executeCro07Attempt({ attemptId: uuid.parse(req.params.id), frozenPayloadHash: input.frozenPayloadHash });
      res.json({ ...result, productionConnected: CRO07_PRODUCTION_CONNECTED, sendingEnabled: CRO07_SENDING_ENABLED });
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/attempts/:id/reconcile", requireRole("admin"), async (req, res) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = z.object({
        toState: z.enum(["reconciled_success", "reconciled_failed", "duplicate"]),
        reasonCode: z.string().trim().min(1).max(120),
        evidence: z.record(z.unknown()).default({}),
      }).strict().parse(req.body);
      const result = await reconcileCro07Attempt({
        attemptId: uuid.parse(req.params.id),
        toState: input.toState, reasonCode: input.reasonCode, evidence: input.evidence,
        actorId: actorId(req), idempotencyKey: key,
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  // ─── Authenticated CRO-07 feedback ingress (separate from CR-06 synthetic) ──
  app.post("/api/webhooks/cro07/feedback/:source", async (req, res) => {
    try {
      const source = z.string().trim().min(1).max(80).parse(req.params.source);
      const rawBody = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
      const secret = resolveCro07WebhookSecret(source);
      const signatureHeader = req.get("X-CRO07-Signature") ?? null;
      const signatureValid = !!secret && verifyCro07WebhookSignature(secret, rawBody, signatureHeader);

      // NOTE: contactId / cr06DeliveryIntentId / canonicalEffect are
      // deliberately NOT accepted from the request body. Contact/intent
      // identity is derived exclusively from the validated attemptId inside
      // ingestCro07Feedback, and canonicalEffect is derived server-side from
      // eventType — trusting either from the caller would let a validly
      // signed event for one send be applied against an arbitrary contact
      // or an arbitrary declared effect.
      const body = z.object({
        // REQUIRED — checked against the immutable provider_account_id
        // recorded on the referenced attempt at claim time; see
        // ingestCro07Feedback's provider-account correlation check.
        providerAccountId: z.string().trim().min(1).max(200),
        providerEventId: z.string().trim().min(1).max(200),
        eventType: z.string().trim().min(1).max(80),
        attemptId: z.string().uuid(),
        providerOccurredAt: z.string().datetime().optional(),
        payload: z.record(z.unknown()).default({}),
      }).strict().parse(req.body);

      const result = await ingestCro07Feedback({
        source, signatureHeader, rawBody, signatureValid,
        providerAccountId: body.providerAccountId,
        providerEventId: body.providerEventId,
        eventType: body.eventType,
        attemptId: body.attemptId,
        providerOccurredAt: body.providerOccurredAt ? new Date(body.providerOccurredAt) : undefined,
        payload: body.payload,
      });
      // Always 200/201 to the provider once durably recorded — an
      // authentication failure is recorded as evidence, not surfaced as a
      // retryable 4xx/5xx that would encourage a provider replay storm.
      res.status(result.replayed ? 200 : 201).json({ received: true, applied: (result as any).applied ?? false });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ code: "CRO07_FEEDBACK_INVALID_PAYLOAD" });
      serverError(res, error);
    }
  });

  // ─── Attribution / taxonomy (read-only reporting) ──────────────────────
  app.get("/api/admin/cro07/attribution/contacts/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const contactId = z.coerce.number().int().positive().parse(req.params.id);
      res.json(await getCro07AttributionForContact(contactId));
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.get("/api/admin/cro07/taxonomy", requireRole("admin", "manager"), async (_req, res) => {
    try {
      res.json(await getCro07Taxonomy());
    } catch (error) {
      cro07Error(res, error);
    }
  });

  // ─── Governed growth experiments ───────────────────────────────────────
  app.get("/api/admin/cro07/experiments", requireRole("admin", "manager"), async (_req, res) => {
    try {
      res.json(await listCro07Experiments());
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.get("/api/admin/cro07/experiments/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const experiment = await getCro07Experiment(uuid.parse(req.params.id));
      if (!experiment) return res.status(404).json({ code: "CRO07_EXPERIMENT_NOT_FOUND" });
      res.json(experiment);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/experiments", requireRole("admin"), async (req, res) => {
    try {
      const input = z.object({
        key: z.string().trim().min(3).max(120),
        hypothesis: z.string().trim().min(1).max(2000),
        metric: z.string().trim().min(1).max(120),
        populationDefinition: z.record(z.unknown()),
        allocation: z.record(z.number().min(0).max(1)),
        versions: z.record(z.unknown()),
        minSampleSize: z.number().int().min(1),
        minDurationDays: z.number().int().min(0),
        confidenceRule: z.object({ method: z.string(), alpha: z.number().min(0).max(1) }),
        guardrails: z.array(z.object({ metric: z.string(), maxDegradationPct: z.number() })),
        contaminationExclusions: z.array(z.string()).default([]),
      }).strict().parse(req.body);
      const experiment = await freezeCro07Experiment({ ...input, frozenBy: actorId(req) });
      res.status(201).json(experiment);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/experiments/:id/start", requireRole("admin"), async (req, res) => {
    try {
      res.json(await startCro07Experiment(uuid.parse(req.params.id)));
    } catch (error) {
      cro07Error(res, error);
    }
  });

  // Admin-only, and requires a real event identity via Idempotency-Key so a
  // sample can never be a free-floating, arbitrary agent-supplied count —
  // it must reference one real exposure/outcome occurrence (e.g. an attempt
  // or feedback-receipt id) and is deduplicated against that identity.
  // Production sample recording is expected to come from the trusted
  // internal attribution/feedback pipeline, not manual agent input; this
  // route exists for admin-supervised manual corrections only.
  app.post("/api/admin/cro07/experiments/:id/samples", requireRole("admin"), async (req, res) => {
    try {
      const key = idempotencyKey(req);
      if (!key) return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
      const input = z.object({ arm: z.string().trim().min(1).max(80), success: z.boolean(), guardrailBreach: z.boolean().optional() }).strict().parse(req.body);
      res.json(await recordCro07ExperimentSample({
        experimentId: uuid.parse(req.params.id), ...input,
        eventKey: key, source: `manual_admin:${actorId(req)}`,
      }));
    } catch (error) {
      cro07Error(res, error);
    }
  });

  app.post("/api/admin/cro07/experiments/:id/decide", requireRole("admin"), async (req, res) => {
    try {
      const input = z.object({ decision: z.enum(["winner_a", "winner_b", "inconclusive", "stopped_guardrail"]) }).strict().parse(req.body);
      const result = await decideCro07Experiment({ experimentId: uuid.parse(req.params.id), decision: input.decision, decidedBy: actorId(req) });
      res.json(result);
    } catch (error) {
      cro07Error(res, error);
    }
  });

  // ─── Truthful status endpoint for operator UI / final evidence ─────────
  app.get("/api/admin/cro07/status", requireRole("admin", "manager"), (_req, res) => {
    res.json({
      codeComplete: true,
      productionConnected: CRO07_PRODUCTION_CONNECTED,
      sendingEnabled: CRO07_SENDING_ENABLED,
      outreach: "PAUSED",
      authorized: false,
      message: "CRO-07 is code-complete and provider-denied. No approved cold-outreach transport is configured.",
    });
  });
}
