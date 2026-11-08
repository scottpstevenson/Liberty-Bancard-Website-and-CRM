import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "../replit_integrations/auth";
import { serverError } from "../utils/server-error";
import { getBackgroundProfile } from "../services/background-profile";
import { resolvePolicy } from "../services/sender-policy";
import {
  ACK_SOURCE_CLASSES,
  ACK_PREVIEW_SOURCE_TYPE,
  buildAckContent,
  getAckCapability,
  getAcknowledgementStatusCounts,
  getAckWorkerStatus,
  setAckCapability,
  startInboundAcknowledgementWorker,
} from "../services/inbound-acknowledgement";

/**
 * Admin surface for the inbound acknowledgement owner. "Enable transactional purpose" lives here and is distinct
 * from publishing message content and from activating any campaign or release. It never unpauses outbound.
 */
export function registerInboundAcknowledgementRoutes(app: Express) {
  if (getBackgroundProfile() !== "off") {
    startInboundAcknowledgementWorker();
    void import("../services/partner-application-intake").then((m) => m.startPartnerApplicationRecovery());
    void import("../services/partner-approval-delivery").then((m) => m.startPartnerApprovalDeliveryWorker());
  } else {
    console.log("[BackgroundProfile] off — InboundAcknowledgementWorker not started");
  }

  app.get("/api/admin/inbound-acknowledgements/status", requireRole("admin", "manager"), async (_req, res) => {
    try {
      const [capability, counts, worker] = await Promise.all([getAckCapability(), getAcknowledgementStatusCounts(), getAckWorkerStatus()]);
      res.json({
        capability,
        counts,
        worker,
        meaning: {
          blocked: "Request recorded; no email attempt is authorized yet.",
          accepted: "Accepted by the mail transport; not proof of inbox delivery.",
          uncertain: "Transport outcome unknown; never resent automatically.",
        },
      });
    } catch (err) {
      serverError(res, err);
    }
  });

  // Exact receipt wording for each request type, rendered with a sample reference. Read-only: nothing is prepared,
  // queued or sent, and receipt wording is code-owned (not editable here).
  app.get("/api/admin/inbound-acknowledgements/preview", requireRole("admin", "manager"), async (_req, res) => {
    try {
      // Receipts are sent under the `support` sender category for every class (fixed by sender policy); the preview
      // reports that identity rather than assuming it.
      const policy = resolvePolicy("support");
      const sample = "abcd1234-0000-4000-8000-000000000000";
      const build = async (sourceClass: (typeof ACK_SOURCE_CLASSES)[number], sourceType: string, variant: string) => {
        const c = await buildAckContent({ sourceClass, sourceType, requestId: sample, firstName: "Alex" });
        return {
          sourceClass, variant, sourceType, templateKey: c.templateKey, subject: c.subject, html: c.html, text: c.text,
          sender: { name: policy.displayName, address: policy.from },
          replyTo: policy.replyTo,
        };
      };
      const previews = await Promise.all([
        ...ACK_SOURCE_CLASSES.map((sourceClass) => build(sourceClass, ACK_PREVIEW_SOURCE_TYPE[sourceClass], "default")),
        // The sales class is previewed with an estimate example above; a statement upload receipt names the statement.
        build("sales_request", "statement_upload", "statement_upload"),
      ]);
      res.json({
        previews,
        note: "Sample reference and first name. Nothing is sent by previewing. The Sales preview uses an estimate request as its example; the Statement upload preview shows the wording a statement receipt uses.",
      });
    } catch (err) {
      serverError(res, err);
    }
  });

  const capabilitySchema = z.object({
    enabled: z.boolean(),
    sourceClasses: z.array(z.enum(ACK_SOURCE_CLASSES)).max(ACK_SOURCE_CLASSES.length).optional(),
    eligibleFrom: z.string().datetime().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  }).strict();

  app.post("/api/admin/inbound-acknowledgements/capability", requireRole("admin"), async (req, res) => {
    try {
      const body = capabilitySchema.parse(req.body);
      if (body.enabled && (!body.sourceClasses || body.sourceClasses.length === 0)) {
        return res.status(400).json({ message: "Choose at least one request type to enable." });
      }
      const actor = (req.user as { email?: string; id?: string } | undefined)?.email ?? (req.user as { id?: string } | undefined)?.id ?? "admin";
      const capability = await setAckCapability({
        enabled: body.enabled,
        sourceClasses: body.sourceClasses,
        eligibleFrom: body.eligibleFrom ? new Date(body.eligibleFrom) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        actor,
      });
      res.json({ capability });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      serverError(res, err);
    }
  });
}
