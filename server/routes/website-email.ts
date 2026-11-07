import type { Express, Request } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { storage } from "../storage";
import { readGmailSenderEvidence } from "../services/gmail-oauth";
import {
  appendLaneConfigRevision,
  approveWarmRevision,
  createWarmRevisionFromSequence,
  previewLaneChange,
  retireWarmRevision,
} from "../services/website-email-lane-store";
import { resolveUncertainReceipt } from "../services/website-email-runtime";
import { closeMailboxReader, openMailboxReader } from "../services/gmail-mailbox-reader";
import { readWarmRevisionPreview, readWebsiteEmailStatus } from "../services/website-email-status";
import { WARM_PROGRAMS } from "../services/website-email-contracts";

const actorOf = (req: Request) => {
  const user = req.user as { email?: string; id?: string } | undefined;
  return user?.email ?? user?.id ?? "admin";
};

/** Operator actions leave an audit row. The row carries ids and outcomes only (no addresses, bodies or tokens). */
const audit = (req: Request, action: string, entityType: string, entityId: number | null, details: Record<string, unknown>) =>
  storage.createAuditLog({ action, entityType, entityId, actorType: "user", actorId: actorOf(req), details });

const proposedSchema = z.object({
  status: z.enum(["closed", "open", "revoked"]),
  sourceProgramMap: z.record(z.string(), z.record(z.string(), z.number().int().positive())),
  senderAccount: z.string().trim().email().nullable(),
  eligibilityStartsAt: z.string().datetime().nullable().optional(),
  dailyLimit: z.number().int().min(0).max(500),
}).strict();

const toProposed = (body: z.infer<typeof proposedSchema>) => ({
  status: body.status,
  sourceProgramMap: body.sourceProgramMap,
  senderAccount: body.senderAccount,
  eligibilityStartsAt: body.eligibilityStartsAt ? new Date(body.eligibilityStartsAt) : null,
  dailyLimit: body.dailyLimit,
});

/**
 * Admin surface for the website email lifecycle lane. Every mutation here is an explicit admin act and none of them
 * sends, probes a provider, unpauses outbound, or edits a legacy sequence. Opening the lane is a configuration
 * revision that must pass the same validation the preview shows.
 */
export function registerWebsiteEmailRoutes(app: Express) {
  app.get("/api/admin/website-email/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      res.json(await readWebsiteEmailStatus());
    } catch (err) {
      serverError(res, err);
    }
  });

  app.get("/api/admin/website-email/revisions/:id/preview", requireRole("admin", "manager"), async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const preview = await readWarmRevisionPreview(id);
      if (!preview) return res.status(404).json({ code: "NOT_FOUND" });
      res.json(preview);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST" });
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/config/preview", requireRole("admin"), async (req, res) => {
    try {
      const body = proposedSchema.parse(req.body);
      const gmail = await readGmailSenderEvidence();
      res.json(await previewLaneChange(toProposed(body), gmail));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST", message: "Check the configuration fields." });
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/config", requireRole("admin"), async (req, res) => {
    try {
      const body = proposedSchema.extend({ expectedRevision: z.number().int().min(0), note: z.string().trim().max(500).optional() }).strict().parse(req.body);
      const gmail = await readGmailSenderEvidence();
      const result = await appendLaneConfigRevision({
        actorId: actorOf(req), expectedRevision: body.expectedRevision, proposed: toProposed(body), gmail, note: body.note ?? null,
      });
      if (!result.ok) return res.status(result.code === "STALE_REVISION" ? 409 : 422).json(result);
      await audit(req, "website_email_lane_config_appended", "website_lifecycle_config", result.revisionId, { revision: result.revision, status: body.status, dailyLimit: body.dailyLimit });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST", message: "Check the configuration fields." });
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/revisions", requireRole("admin"), async (req, res) => {
    try {
      const body = z.object({ sequenceId: z.number().int().positive(), program: z.enum(WARM_PROGRAMS) }).strict().parse(req.body);
      const result = await createWarmRevisionFromSequence({ sequenceId: body.sequenceId, program: body.program, actorId: actorOf(req) });
      if (!result.ok) return res.status(result.code === "SEQUENCE_NOT_FOUND" ? 404 : 422).json(result);
      await audit(req, "website_email_warm_revision_created", "website_warm_revision", result.revisionId, { program: body.program, sourceSequenceId: body.sequenceId, created: result.created });
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST", message: "Choose a sequence and a program." });
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/revisions/:id/approve", requireRole("admin"), async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const result = await approveWarmRevision({ revisionId: id, actorId: actorOf(req) });
      if (!result.ok) return res.status(result.code === "NOT_FOUND" ? 404 : 409).json(result);
      await audit(req, "website_email_warm_revision_approved", "website_warm_revision", id, {});
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST" });
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/revisions/:id/retire", requireRole("admin"), async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const result = await retireWarmRevision({ revisionId: id, actorId: actorOf(req) });
      if (!result.ok) return res.status(404).json({ code: "NOT_FOUND" });
      await audit(req, "website_email_warm_revision_retired", "website_warm_revision", id, {});
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST" });
      serverError(res, err);
    }
  });

  // Opening the reader starts read-only mailbox observation from "now" (no backfill). It sends nothing.
  app.post("/api/admin/website-email/reader/open", requireRole("admin"), async (req, res) => {
    try {
      const result = await openMailboxReader();
      if (!result.ok) return res.status(409).json(result);
      await audit(req, "website_email_reader_opened", "gmail_mailbox_reader", null, {});
      res.json({ ok: true, note: "The reader initializes at the next tick and only reads messages that arrive after that." });
    } catch (err) {
      serverError(res, err);
    }
  });

  app.post("/api/admin/website-email/reader/close", requireRole("admin"), async (req, res) => {
    try {
      const closed = await closeMailboxReader();
      await audit(req, "website_email_reader_closed", "gmail_mailbox_reader", null, { ok: closed.ok });
      res.json(closed);
    } catch (err) {
      serverError(res, err);
    }
  });

  // Operator resolution of a send whose Gmail answer was unknown. Never resends: "not_sent" only frees the slot.
  app.post("/api/admin/website-email/receipts/:id/resolve", requireRole("admin"), async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const body = z.object({
        resolution: z.enum(["accepted", "not_sent"]),
        providerMessageId: z.string().trim().max(200).optional(),
        threadId: z.string().trim().max(200).optional(),
      }).strict().parse(req.body);
      const result = await resolveUncertainReceipt({ receiptId: id, ...body });
      if (!result.ok) return res.status(result.code === "NOT_FOUND" ? 404 : 409).json(result);
      await audit(req, "website_email_uncertain_receipt_resolved", "website_email_receipt", id, { resolution: body.resolution });
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ code: "INVALID_REQUEST" });
      serverError(res, err);
    }
  });
}
