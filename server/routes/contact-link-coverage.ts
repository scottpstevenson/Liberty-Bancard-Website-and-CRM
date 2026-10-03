import type { Express } from "express";
import { z } from "zod";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";

export interface ContactLinkCoverageRouteDependencies {
  getStatus: () => Promise<unknown>;
  listCandidates: (input: { afterCreatedAt?: string; afterId?: string; limit?: number; reviewerId?: string }) => Promise<unknown>;
  start: (actorId: string) => Promise<unknown>;
  step: (actorId: string) => Promise<unknown>;
  pause: (actorId: string) => Promise<unknown>;
  resume: (actorId: string) => Promise<unknown>;
  reviewBatch: (items: unknown[], reviewerId: string) => Promise<unknown>;
  previewSourceRecoveryBatch: (items: unknown[]) => Promise<unknown>;
  applySourceRecoveryBatch: (items: unknown[]) => Promise<unknown>;
  auditSourceRecovery: (input: {
    action: string; entityType: string; entityKey: string; userId: string; details: Record<string, unknown>;
  }) => Promise<void>;
}

const productionDependencies: ContactLinkCoverageRouteDependencies = {
  getStatus: async () => (await import("../services/contact-link-coverage")).getContactLinkCoverageStatus(),
  listCandidates: async (input) => (await import("../services/contact-link-coverage")).listContactLinkCoverageCandidates(input),
  start: async (actorId) => (await import("../services/contact-link-coverage")).startContactLinkCoverage(actorId),
  step: async (actorId) => (await import("../services/contact-link-coverage")).stepContactLinkCoverage(actorId),
  pause: async (actorId) => (await import("../services/contact-link-coverage")).pauseContactLinkCoverage(actorId),
  resume: async (actorId) => (await import("../services/contact-link-coverage")).resumeContactLinkCoverage(actorId),
  reviewBatch: async (items, reviewerId) =>
    (await import("../services/contact-link-coverage")).reviewContactLinkCoverageBatch(items as any[], reviewerId),
  previewSourceRecoveryBatch: async (items) =>
    (await import("../services/contact-link-source-recovery")).previewContactLinkSourceRecoveryBatch(items as any[]),
  applySourceRecoveryBatch: async (items) =>
    (await import("../services/contact-link-source-recovery")).applyContactLinkSourceRecoveryBatch(items as any[]),
  auditSourceRecovery: async (input) => {
    const { storage } = await import("../storage");
    await storage.createAuditLog(input);
  },
};

const candidateCursorSchema = z.object({
  afterCreatedAt: z.string().datetime().optional(),
  afterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();

const reviewItemSchema = z.object({
  candidateId: z.string().uuid(),
  contactId: z.number().int().positive(),
  businessId: z.number().int().positive(),
  decision: z.enum(["verified", "missing", "conflicted", "legacy_unknown", "rejected"]),
  expectedRevision: z.number().int().nonnegative(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/i),
  evidenceSourceEventId: z.number().int().positive().optional(),
}).strict();
const sourceRecoveryIdentitySchema = z.object({
  candidateId: z.string().uuid(),
  contactId: z.number().int().positive(),
  businessId: z.number().int().positive(),
  sourceEntityId: z.number().int().positive(),
  filingNumber: z.string().trim().min(1).max(200),
}).strict();
const sourceRecoveryPreviewBatchSchema = z.object({
  items: z.array(sourceRecoveryIdentitySchema).min(1).max(25),
}).strict();
const sourceRecoveryApplyBatchSchema = z.object({
  items: z.array(sourceRecoveryIdentitySchema.extend({
    expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })).min(1).max(25),
}).strict();

function authenticatedOperatorId(req: { user?: unknown }): string | null {
  const id = String((req.user as any)?.id ?? "").trim();
  return id || null;
}

export function registerContactLinkCoverageRoutes(
  app: Express,
  dependencies: ContactLinkCoverageRouteDependencies = productionDependencies,
) {
  app.get("/api/admin/contact-link-coverage/automation", isDashboardUser, requireRole("admin"),
    async (_req, res) => {
      try {
        const { getContactLinkAutomationStatus } = await import("../services/contact-link-automation");
        res.json({ program: await getContactLinkAutomationStatus() });
      } catch (error) { serverError(res, error); }
    });
  app.post("/api/admin/contact-link-coverage/automation", isDashboardUser, requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      const parsed = z.object({
        enabled: z.boolean(),
        automaticCommitsAuthorized: z.literal(true).optional(),
      }).strict().safeParse(req.body);
      if (!parsed.success || (parsed.data.enabled && !parsed.data.automaticCommitsAuthorized)) {
        return res.status(400).json({ message: "Explicit authorization for independently guarded automatic links is required" });
      }
      try {
        const { setContactLinkAutomation } = await import("../services/contact-link-automation");
        res.json({ program: await setContactLinkAutomation(parsed.data.enabled, actorId) });
      } catch (error) { serverError(res, error); }
    });
  app.get(
    "/api/admin/contact-link-coverage/status",
    isDashboardUser,
    requireRole("admin"),
    async (_req, res) => {
      try {
        res.json(await dependencies.getStatus());
      } catch (error) {
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/source-recovery/preview",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const parsed = sourceRecoveryPreviewBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid bounded source-recovery preview", errors: parsed.error.errors });
      }
      try {
        res.json(await dependencies.previewSourceRecoveryBatch(parsed.data.items));
      } catch (error: any) {
        const message = String(error?.message ?? error);
        if (message.startsWith("CONTACT_LINK_SOURCE_RECOVERY_BATCH_LIMIT_")) {
          return res.status(400).json({ message });
        }
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/source-recovery/apply",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      const parsed = sourceRecoveryApplyBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid bounded source-recovery apply", errors: parsed.error.errors });
      }
      try {
        const result = await dependencies.applySourceRecoveryBatch(parsed.data.items) as {
          results?: Array<{
            identity: { candidateId: string; contactId: number; businessId: number; sourceEntityId: number; filingNumber: string };
            status: string; reasonCodes: string[]; sourceLinkId: string | null; snapshotHash: string | null;
          }>;
        };
        for (const outcome of result.results ?? []) {
          await dependencies.auditSourceRecovery({
            action: "contact_link_source_recovery_applied",
            entityType: "contact_link_source_recovery",
            entityKey: outcome.identity.candidateId,
            userId: actorId,
            details: {
              contactId: outcome.identity.contactId,
              businessId: outcome.identity.businessId,
              sourceEntityId: outcome.identity.sourceEntityId,
              filingNumber: outcome.identity.filingNumber,
              status: outcome.status,
              reasonCodes: outcome.reasonCodes,
              sourceLinkId: outcome.sourceLinkId,
              snapshotHash: outcome.snapshotHash,
            },
          });
        }
        res.json(result);
      } catch (error: any) {
        const message = String(error?.message ?? error);
        if (message.startsWith("CONTACT_LINK_SOURCE_RECOVERY_BATCH_LIMIT_")) {
          return res.status(400).json({ message });
        }
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/start",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      try {
        const result = await dependencies.start(actorId);
        res.json(result);
      } catch (error: any) {
        if (error?.message === "CONTACT_LINK_COVERAGE_ALREADY_RUNNING"
            || error?.message === "CONTACT_LINK_COVERAGE_RESUME_REQUIRED") {
          return res.status(409).json({ message: error.message });
        }
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/step",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      try {
        res.json(await dependencies.step(actorId));
      } catch (error: any) {
        if (String(error?.message ?? "").startsWith("CONTACT_LINK_COVERAGE_")) {
          return res.status(409).json({ message: error.message });
        }
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/pause",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      try {
        res.json(await dependencies.pause(actorId));
      } catch (error: any) {
        if (String(error?.message ?? "").startsWith("CONTACT_LINK_COVERAGE_")) {
          return res.status(409).json({ message: error.message });
        }
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/resume",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const actorId = authenticatedOperatorId(req);
      if (!actorId) return res.status(401).json({ message: "Authenticated admin identity required" });
      try {
        res.json(await dependencies.resume(actorId));
      } catch (error: any) {
        if (String(error?.message ?? "").startsWith("CONTACT_LINK_COVERAGE_")) {
          return res.status(409).json({ message: error.message });
        }
        serverError(res, error);
      }
    },
  );

  app.get(
    "/api/admin/contact-link-coverage/candidates",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const parsed = candidateCursorSchema.safeParse({
        afterCreatedAt: req.query.afterCreatedAt,
        afterId: req.query.afterId,
        limit: req.query.limit,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact-link candidate cursor", errors: parsed.error.errors });
      }
      try {
        res.json(await dependencies.listCandidates({ ...parsed.data, reviewerId: authenticatedOperatorId(req) ?? undefined }));
      } catch (error) {
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/review-batch",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      const reviewerId = authenticatedOperatorId(req);
      if (!reviewerId) return res.status(401).json({ message: "Authenticated admin identity required" });
      const parsed = z.object({
        items: z.array(reviewItemSchema).min(1).max(500),
      }).strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact-link review batch", errors: parsed.error.errors });
      }
      try {
        res.json(await dependencies.reviewBatch(
          parsed.data.items,
          reviewerId,
        ));
      } catch (error) {
        serverError(res, error);
      }
    },
  );
}
