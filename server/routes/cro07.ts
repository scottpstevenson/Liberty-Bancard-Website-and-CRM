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
import {
  ingestCro07Feedback,
  verifyCro07WebhookSignature,
  resolveCro07WebhookSecret,
} from "../services/cro07-feedback";
import { getCro07AttributionForContact } from "../services/cro07-attribution";
import { getCro07Taxonomy } from "../services/cro07-taxonomy";
import {
  decideCro07Experiment,
  freezeCro07Experiment,
  getCro07Experiment,
  listCro07Experiments,
  recordCro07ExperimentSample,
  startCro07Experiment,
  stopCro07Experiment,
  evaluateCro07Experiment,
  freezePreparedPhase7Experiment,
} from "../services/cro07-experiments";

import { bindWorkActor, WorkCommandError } from "../services/work-item-command";
import { experimentDigest } from "../services/cro07-experiments";
import { phase7DesignSchema } from "../../shared/phase7-experiment";
import {
  readPhase7CopyInventory,
  readPhase7Eligibility,
  preparePhase7ReviewDraft,
  previewPhase7Experiment,
} from "../services/phase7-draft-workspace";
import {
  qualifyPhase7Reply,
  ingestPhase7ProviderFeedback,
} from "../services/phase7-feedback";
import { readPhase7SchemaStatus } from "../services/phase7-schema-status";
const uuid = z.string().uuid();
const experimentCommandFields = z.object({
  commandId: uuid,
  expectedVersion: z.number().int().positive(),
  expectedActorId: z.string().min(1),
  expectedAccountVersion: z.number().int().positive(),
});
function experimentCommand(
  req: Request,
  body: z.infer<typeof experimentCommandFields>,
) {
  return {
    commandId: body.commandId,
    expectedVersion: body.expectedVersion,
    actor: bindWorkActor(
      req.user,
      body.expectedActorId,
      body.expectedAccountVersion,
    ),
  };
}

function actorId(req: Request): string {
  const user = req.user as any;
  return String(user?.email ?? user?.id ?? "unknown-admin");
}

function idempotencyKey(req: Request): string | null {
  const value = req.get("Idempotency-Key");
  return value && value.length >= 8 && value.length <= 200 ? value : null;
}

function cro07Error(res: any, error: unknown) {
  if (error instanceof WorkCommandError)
    return res
      .status(error.status)
      .json({ code: "CRO07_AUTHORITY_CONFLICT", message: error.message });
  if ((error as any)?.constraint === "cro07_one_collecting_step")
    return res.status(409).json({ code: "CRO07_STEP_ALREADY_COLLECTING" });
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      code: "CRO07_INVALID_COMMAND",
      message: "Invalid governed command",
    });
  }
  const message =
    error instanceof Error ? error.message : "CRO07_UNKNOWN_ERROR";
  if (message.includes("NOT_FOUND"))
    return res.status(404).json({ code: message });
  if (message.startsWith("CRO07_"))
    return res.status(409).json({ code: message });
  return serverError(res, error);
}

export function registerCro07Routes(app: Express) {
  // ─── Release authority ────────────────────────────────────────────────
  app.post(
    "/api/admin/cro07/releases",
    requireRole("admin"),
    async (req, res) => {
      try {
        const key = idempotencyKey(req);
        if (!key)
          return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
        const input = z
          .object({
            cr06DeliveryIntentId: uuid,
            reviewedSha: z.string().trim().min(7).max(64),
            migrationHead: z.string().trim().min(1).max(200),
            senderRoute: z.string().trim().min(1).max(120),
            providerSource: z.string().trim().min(1).max(80),
            caps: z.object({
              dailyCap: z.number().int().min(0).max(10000),
              perHourCap: z.number().int().min(0).max(1000),
            }),
            canarySize: z.number().int().min(0).max(1000),
            stopThresholds: z.object({
              maxBounceRatePct: z.number().min(0).max(100),
              maxComplaintRatePct: z.number().min(0).max(100),
              maxReplyBacklog: z.number().int().min(0),
            }),
            reason: z.string().trim().min(1).max(500),
            expiresAt: z.string().datetime(),
          })
          .strict()
          .parse(req.body);
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
    },
  );

  app.get(
    "/api/admin/cro07/releases/:id",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const release = await getCro07Release(uuid.parse(req.params.id));
        if (!release)
          return res.status(404).json({ code: "CRO07_RELEASE_NOT_FOUND" });
        res.json(release);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.get(
    "/api/admin/cro07/intents/:id/releases",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        res.json(await listCro07ReleasesForIntent(uuid.parse(req.params.id)));
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/releases/:id/approve",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = z
          .object({ expectedRevisionHash: z.string().trim().min(1) })
          .strict()
          .parse(req.body);
        const release = await approveCro07Release({
          releaseId: uuid.parse(req.params.id),
          approverId: actorId(req),
          expectedRevisionHash: input.expectedRevisionHash,
        });
        res.json(release);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  // ─── Denied transport attempts (never actually deliver) ────────────────
  app.post(
    "/api/admin/cro07/attempts/claim",
    requireRole("admin"),
    async (req, res) => {
      try {
        const key = idempotencyKey(req);
        if (!key)
          return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
        const input = z
          .object({
            releaseId: uuid,
            provider: z.string().trim().min(1).max(80),
          })
          .strict()
          .parse(req.body);
        const result = await claimCro07Attempt({
          releaseId: input.releaseId,
          provider: input.provider,
          idempotencyKey: key,
        });
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/attempts/:id/execute",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = z
          .object({ frozenPayloadHash: z.string().trim().min(1) })
          .strict()
          .parse(req.body);
        const result = await executeCro07Attempt({
          attemptId: uuid.parse(req.params.id),
          frozenPayloadHash: input.frozenPayloadHash,
        });
        res.json({
          ...result,
          productionConnected: CRO07_PRODUCTION_CONNECTED,
          sendingEnabled: CRO07_SENDING_ENABLED,
        });
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/attempts/:id/reconcile",
    requireRole("admin"),
    async (req, res) => {
      try {
        const key = idempotencyKey(req);
        if (!key)
          return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED" });
        const input = z
          .object({
            toState: z.enum([
              "reconciled_success",
              "reconciled_failed",
              "duplicate",
            ]),
            reasonCode: z.string().trim().min(1).max(120),
            evidence: z.record(z.string(), z.unknown()).default({}),
          })
          .strict()
          .parse(req.body);
        const result = await reconcileCro07Attempt({
          attemptId: uuid.parse(req.params.id),
          toState: input.toState,
          reasonCode: input.reasonCode,
          evidence: input.evidence,
          actorId: actorId(req),
          idempotencyKey: key,
        });
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  // ─── Authenticated CRO-07 feedback ingress (separate from CR-06 synthetic) ──
  app.post("/api/webhooks/cro07/feedback/:source", async (req, res) => {
    try {
      const source = z.string().trim().min(1).max(80).parse(req.params.source);
      const rawBody = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
      const secret = resolveCro07WebhookSecret(source);
      const signatureHeader = req.get("X-CRO07-Signature") ?? null;
      const signatureValid =
        !!secret &&
        verifyCro07WebhookSignature(secret, rawBody, signatureHeader);

      // NOTE: contactId / cr06DeliveryIntentId / canonicalEffect are
      // deliberately NOT accepted from the request body. Contact/intent
      // identity is derived exclusively from the validated attemptId inside
      // ingestCro07Feedback, and canonicalEffect is derived server-side from
      // eventType — trusting either from the caller would let a validly
      // signed event for one send be applied against an arbitrary contact
      // or an arbitrary declared effect.
      const body = z
        .object({
          // REQUIRED — checked against the immutable provider_account_id
          // recorded on the referenced attempt at claim time; see
          // ingestCro07Feedback's provider-account correlation check.
          providerAccountId: z.string().trim().min(1).max(200),
          providerEventId: z.string().trim().min(1).max(200),
          eventType: z.string().trim().min(1).max(80),
          attemptId: z.string().uuid(),
          providerOccurredAt: z.string().datetime().optional(),
          payload: z.record(z.string(), z.unknown()).default({}),
        })
        .strict()
        .parse(req.body);

      const result = await ingestCro07Feedback({
        source,
        signatureHeader,
        rawBody,
        signatureValid,
        providerAccountId: body.providerAccountId,
        providerEventId: body.providerEventId,
        eventType: body.eventType,
        attemptId: body.attemptId,
        providerOccurredAt: body.providerOccurredAt
          ? new Date(body.providerOccurredAt)
          : undefined,
        payload: body.payload,
      });
      // Always 200/201 to the provider once durably recorded — an
      // authentication failure is recorded as evidence, not surfaced as a
      // retryable 4xx/5xx that would encourage a provider replay storm.
      res
        .status(result.replayed ? 200 : 201)
        .json({ received: true, applied: (result as any).applied ?? false });
    } catch (error) {
      if (error instanceof z.ZodError)
        return res.status(400).json({ code: "CRO07_FEEDBACK_INVALID_PAYLOAD" });
      serverError(res, error);
    }
  });

  app.get("/api/admin/cro07/phase7/feedback-status",requireRole("admin"),async(_req,res)=>{try{const {readPhase7CurrentFeedbackStatus}=await import("../services/phase7-sendgrid");res.setHeader("Cache-Control","no-store");res.json(await readPhase7CurrentFeedbackStatus());}catch(e){serverError(res,e);}});
  app.post("/api/webhooks/cro07/sendgrid", async(req,res)=>{
    try {
      const raw=(req as any).rawBody;
      if(!Buffer.isBuffer(raw))return res.status(400).json({code:"SENDGRID_RAW_BODY_REQUIRED"});
      const {receivePhase7SendGrid}=await import("../services/phase7-sendgrid");
      return res.status(200).json(await receivePhase7SendGrid(raw,req.get("X-Twilio-Email-Event-Webhook-Signature"),req.get("X-Twilio-Email-Event-Webhook-Timestamp")));
    }catch(e){const code=e instanceof Error?e.message:"SENDGRID_INGEST_FAILED";if(code==='SENDGRID_SIGNATURE_REQUIRED')return res.status(401).json({code});if(/INVALID|REPLAY_CONFLICT/.test(code))return res.status(400).json({code});return serverError(res,e);}
  });

  // Same authenticated CRO07 ingress, distinct typed SMTP sequence lineage. Never aliases denied CRO07 attempt IDs.
  app.post(
    "/api/webhooks/cro07/sequence-feedback/:source",
    async (req, res) => {
      try {
        const source = z
            .string()
            .regex(/^[a-zA-Z0-9_]{1,80}$/)
            .parse(req.params.source),
          secret = resolveCro07WebhookSecret(source),
          raw = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
        if (
          !secret ||
          !verifyCro07WebhookSignature(
            secret,
            raw,
            req.get("X-CRO07-Signature") ?? null,
          )
        )
          return res.status(401).json({ code: "CRO07_SIGNATURE_REQUIRED" });
        const body = z
          .object({
            providerAccountId: z.string().min(1).max(200),
            providerEventId: z.string().min(1).max(200),
            providerMessageId: z.string().min(1).max(500),
            eventType: z.enum([
              "delivered",
              "hard_bounce",
              "complaint",
              "explicit_unsubscribe",
              "open",
              "click",
            ]),
            occurredAt: z.string().datetime(),
          })
          .strict()
          .parse(req.body);
        res.status(201).json(
          await ingestPhase7ProviderFeedback({
            ...body,
            source,
            occurredAt: new Date(body.occurredAt),
            payloadHash: experimentDigest(body),
          }),
        );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );

  // ─── Attribution / taxonomy (read-only reporting) ──────────────────────
  app.get(
    "/api/admin/cro07/attribution/contacts/:id",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const contactId = z.coerce
          .number()
          .int()
          .positive()
          .parse(req.params.id);
        res.json(await getCro07AttributionForContact(contactId));
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.get(
    "/api/admin/cro07/taxonomy",
    requireRole("admin", "manager"),
    async (_req, res) => {
      try {
        res.json(await getCro07Taxonomy());
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.get(
    "/api/admin/cro07/phase7/schema",
    requireRole("admin"),
    async (_req, res) => {
      try {
        res
          .set("Cache-Control", "private, no-store")
          .json(await readPhase7SchemaStatus());
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  // ─── Governed growth experiments ───────────────────────────────────────
  app.get(
    "/api/admin/cro07/phase7/inventory",
    requireRole("admin"),
    async (_req, res) => {
      try {
        res
          .set("Cache-Control", "private, no-store")
          .json(await readPhase7CopyInventory());
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.get(
    "/api/admin/cro07/phase7/eligibility",
    requireRole("admin"),
    async (_req, res) => {
      try {
        res
          .set("Cache-Control", "private, no-store")
          .json(await readPhase7Eligibility());
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.post(
    "/api/admin/cro07/phase7/drafts",
    requireRole("admin"),
    async (req, res) => {
      try {
        const body = experimentCommandFields
          .extend({
            key: z.string().regex(/^[a-zA-Z0-9_-]{3,100}$/),
            vertical: z.string().trim().min(1).max(120),
            sourceSequenceId: z.number().int().positive(),
            challengerSubject: z.string().trim().min(1).max(500),
            followupBodies: z.tuple([
              z.string().trim().min(1).max(10000),
              z.string().trim().min(1).max(10000),
            ]),
          })
          .strict()
          .parse(req.body);
        const {
          commandId,
          expectedVersion,
          expectedActorId,
          expectedAccountVersion,
          ...draft
        } = body;
        res
          .status(201)
          .json(
            await preparePhase7ReviewDraft(draft, experimentCommand(req, body)),
          );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.post(
    "/api/admin/cro07/experiments/:id/freeze",
    requireRole("admin"),
    async (req, res) => {
      try {
        const body = experimentCommandFields.strict().parse(req.body);
        res.json(
          await freezePreparedPhase7Experiment(
            uuid.parse(req.params.id),
            experimentCommand(req, body),
          ),
        );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.get(
    "/api/admin/cro07/experiments/:id/preview",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const e = await getCro07Experiment(
          uuid.parse(req.params.id),
          (req.user as any)?.role === "admin" ? null : (req.user as any)?.id,
        );
        if (!e)
          return res.status(404).json({ code: "CRO07_EXPERIMENT_NOT_FOUND" });
        res
          .set("Cache-Control", "private, no-store")
          .json(await previewPhase7Experiment(e));
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.get(
    "/api/admin/cro07/experiments",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        res.json(
          await listCro07Experiments(
            (req.user as any)?.role === "admin" ? null : (req.user as any)?.id,
          ),
        );
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.get(
    "/api/admin/cro07/experiments/:id",
    requireRole("admin", "manager"),
    async (req, res) => {
      try {
        const experiment = await getCro07Experiment(
          uuid.parse(req.params.id),
          (req.user as any)?.role === "admin" ? null : (req.user as any)?.id,
        );
        if (
          !experiment ||
          ((req.user as any)?.role !== "admin" &&
            experiment.frozen_by !== (req.user as any)?.id)
        )
          return res.status(404).json({ code: "CRO07_EXPERIMENT_NOT_FOUND" });
        res.json(experiment);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/experiments",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = z
          .object({
            ...experimentCommandFields.shape,
            phase7Design: phase7DesignSchema,
            key: z.string().trim().min(3).max(120),
            hypothesis: z.string().trim().min(1).max(2000),
            metric: z.string().trim().min(1).max(120),
            populationDefinition: z.record(z.string(), z.unknown()),
            allocation: z.record(z.string(), z.number().min(0).max(1)),
            versions: z.record(z.string(), z.unknown()),
            minSampleSize: z.number().int().min(1),
            minDurationDays: z.number().int().min(0),
            confidenceRule: z.object({
              method: z.string(),
              alpha: z.number().min(0).max(1),
            }),
            guardrails: z.array(
              z.object({ metric: z.string(), maxDegradationPct: z.number() }),
            ),
            contaminationExclusions: z.array(z.string()).default([]),
          })
          .strict()
          .parse(req.body);
        const {
          commandId,
          expectedVersion,
          expectedActorId,
          expectedAccountVersion,
          ...design
        } = input;
        const experiment = await freezeCro07Experiment(
          { ...design, frozenBy: actorId(req) },
          experimentCommand(req, input),
        );
        res.status(201).json(experiment);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/experiments/:id/qualify-reply",
    requireRole("admin"),
    async (req, res) => {
      try {
        const body = experimentCommandFields
          .extend({
            receiptId: uuid,
            classification: z.enum(["qualified", "not_qualified"]),
            reason: z.string().trim().min(20).max(2000),
            dealId: z.number().int().positive().optional(),
          })
          .strict()
          .parse(req.body);
        res.json(
          await qualifyPhase7Reply(
            {
              experimentId: uuid.parse(req.params.id),
              receiptId: body.receiptId,
              classification: body.classification,
              reason: body.reason,
              dealId: body.dealId,
            },
            experimentCommand(req, body),
          ),
        );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.post(
    "/api/admin/cro07/experiments/:id/start",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = experimentCommandFields.strict().parse(req.body);
        res.json(
          await startCro07Experiment(
            uuid.parse(req.params.id),
            experimentCommand(req, input),
          ),
        );
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  app.post(
    "/api/admin/cro07/experiments/:id/samples",
    requireRole("admin"),
    (_req, res) => {
      res.status(410).json({
        code: "CRO07_RECEIPT_REQUIRED",
        message:
          "Samples are derived from verified message receipts; arbitrary counters are retired.",
      });
    },
  );
  app.post(
    "/api/admin/cro07/experiments/:id/evaluate",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = experimentCommandFields.strict().parse(req.body);
        const command = experimentCommand(req, input);
        res.json(
          await evaluateCro07Experiment(uuid.parse(req.params.id), command),
        );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );
  app.post(
    "/api/admin/cro07/experiments/:id/stop",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = experimentCommandFields
          .extend({
            state: z.enum(["cancelled", "revoked", "stopped_guardrail"]),
          })
          .strict()
          .parse(req.body);
        res.json(
          await stopCro07Experiment(
            uuid.parse(req.params.id),
            input.state,
            experimentCommand(req, input),
          ),
        );
      } catch (e) {
        cro07Error(res, e);
      }
    },
  );

  app.post(
    "/api/admin/cro07/experiments/:id/decide",
    requireRole("admin"),
    async (req, res) => {
      try {
        const input = experimentCommandFields
          .extend({
            evaluationId: uuid,
            decision: z.enum([
              "winner_a",
              "winner_b",
              "inconclusive",
              "stopped_guardrail",
            ]),
          })
          .strict()
          .parse(req.body);
        const result = await decideCro07Experiment({
          experimentId: uuid.parse(req.params.id),
          decision: input.decision,
          decidedBy: actorId(req),
          evaluationId: input.evaluationId,
          command: experimentCommand(req, input),
        });
        res.json(result);
      } catch (error) {
        cro07Error(res, error);
      }
    },
  );

  // ─── Truthful status endpoint for operator UI / final evidence ─────────
  app.get(
    "/api/admin/cro07/status",
    requireRole("admin", "manager"),
    (_req, res) => {
      res.json({
        codeComplete: true,
        productionConnected: CRO07_PRODUCTION_CONNECTED,
        sendingEnabled: CRO07_SENDING_ENABLED,
        outreach: "PAUSED",
        authorized: false,
        message:
          "CRO-07 is code-complete and provider-denied. No approved cold-outreach transport is configured.",
      });
    },
  );
}
