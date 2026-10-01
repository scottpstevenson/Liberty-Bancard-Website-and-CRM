import type { Express } from "express";
import { z } from "zod";
import { isDashboardUser, requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import {
  getContactLinkCoverageStatus,
  listContactLinkCoverageCandidates,
  pauseContactLinkCoverage,
  resumeContactLinkCoverage,
  reviewContactLinkCoverageBatch,
  startContactLinkCoverage,
  stepContactLinkCoverage,
} from "../services/contact-link-coverage";

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

export function registerContactLinkCoverageRoutes(app: Express) {
  app.get(
    "/api/admin/contact-link-coverage/status",
    isDashboardUser,
    requireRole("admin"),
    async (_req, res) => {
      try {
        res.json(await getContactLinkCoverageStatus());
      } catch (error) {
        serverError(res, error);
      }
    },
  );

  app.post(
    "/api/admin/contact-link-coverage/start",
    isDashboardUser,
    requireRole("admin"),
    async (req, res) => {
      try {
        const result = await startContactLinkCoverage(String((req.user as any)?.id ?? ""));
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
      try {
        res.json(await stepContactLinkCoverage(String((req.user as any)?.id ?? "")));
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
      try {
        res.json(await pauseContactLinkCoverage(String((req.user as any)?.id ?? "")));
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
      try {
        res.json(await resumeContactLinkCoverage(String((req.user as any)?.id ?? "")));
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
        res.json(await listContactLinkCoverageCandidates(parsed.data));
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
      const parsed = z.object({
        items: z.array(reviewItemSchema).min(1).max(500),
      }).strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact-link review batch", errors: parsed.error.errors });
      }
      try {
        res.json(await reviewContactLinkCoverageBatch(
          parsed.data.items,
          String((req.user as any)?.id ?? ""),
        ));
      } catch (error) {
        serverError(res, error);
      }
    },
  );
}
