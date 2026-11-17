/**
 * Partner program routes: public application, published referral policy, staff review and the partner introduction flow.
 *
 * Authority summary
 *  - `POST /api/partner-apply` is a public, idempotent, consented application. It creates a pending partner row and a
 *    durable application; it never creates a login, password, session, approval or commission terms, and a legacy
 *    password payload is answered 410 before any occurrence is claimed.
 *  - `GET /api/public/partner-policy` projects the single administrator-approved referral policy, or the safe default.
 *  - Staff routes are role-gated on the server: admin + manager read, admin alone decides and manages the policy.
 *  - Partner introduction routes derive the partner from the authenticated session; the body never names a partner.
 */
import type { Express, Request, Response } from "express";
import { isPartnerAuthenticated, requireRole } from "../replit_integrations/auth";
import { publicLeadRateLimit } from "../middleware/public-rate-limit";
import { storage } from "../storage";
import { claimPublicInbound } from "../services/public-inbound-intake";
import { setInboundRequestLifecycle } from "../services/inbound-request-authority";
import {
  createPartnerApplication,
  resolveApplicationConsent,
  resolveMarketingDisclosure,
} from "../services/partner-application";
import { completePartnerApplicationLocal, resumePartnerApplication } from "../services/partner-application-intake";
import {
  approveReferralPolicy,
  createReferralPolicyDraft,
  getPublishedReferralPolicy,
  listReferralPolicyVersions,
  revokeReferralPolicy,
} from "../services/partner-public-policy";
import {
  decidePartnerApplication,
  getPartnerApplicationDetail,
  listPartnerApplications,
  normalizeApplicationFilters,
} from "../services/partner-application-review";
import {
  completePartnerIntroduction,
  INTRODUCTION_KEY_PATTERN,
  listIntroductionsForReview,
  listPartnerIntroductionsFor,
  parseIntroductionBody,
  recordPartnerIntroduction,
  toPartnerIntroductionView,
} from "../services/partner-introductions";
import { isLegacyPartnerPayload, parsePartnerApplication } from "@shared/partner-application";
import { PARTNER_NOT_ACCEPTED_ONLINE } from "@shared/partner-public-content";
import { logOperationalDiagnostic, serverError } from "../utils/server-error";
import { privatePartnerResponse } from "../utils/partner-response";

const actorIdOf = (req: Request): string => {
  const user = (req as any).user;
  return String(user?.id ?? user?.claims?.sub ?? "");
};

const DECISION_KEYS = new Set(["decision", "expectedRevision", "commissionPercent", "scheduleReference", "note"]);
const POLICY_DRAFT_KEYS = new Set(["sharePercent", "scheduleReference", "copyVersion"]);
const hasOnlyKeys = (body: unknown, allowed: Set<string>) =>
  Boolean(body) && typeof body === "object" && !Array.isArray(body) && Object.keys(body as object).every((k) => allowed.has(k));

function sendStaff(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}

export function registerPartnerProgramRoutes(app: Express) {
  // === PUBLIC APPLICATION ===
  app.post("/api/partner-apply", publicLeadRateLimit, async (req, res) => {
    try {
      // Health probe: answered before the body is read or any occurrence is claimed.
      if (req.query.probe === "1") return res.json({ probe: true, endpoint: "/api/partner-apply" });
      // The retired form posted a browser-chosen password and created an account. It is refused before anything is read
      // from it or claimed; the password is never inspected, logged or stored.
      if (isLegacyPartnerPayload(req.body)) {
        return res.status(410).json({
          code: "PARTNER_APPLICATION_FORM_RETIRED",
          message: "This application form has been replaced. Please apply from the partners page.",
          applyAt: "/partners",
        });
      }
      const parsed = parsePartnerApplication(req.body);
      if (!parsed.ok) return res.status(400).json({ code: "VALIDATION_FAILED", message: "Please check the highlighted fields.", issues: parsed.issues });
      const input = parsed.data;
      // The server owns consent wording: it must recognize the rendered version and, when marketing is ticked, its disclosure.
      if (!resolveApplicationConsent(input.consentVersion)) {
        return res.status(400).json({ code: "VALIDATION_FAILED", message: "Reload the page and try again.", issues: [{ field: "consentVersion", message: "Reload the page to see the current wording." }] });
      }
      if (input.marketingOptIn && !resolveMarketingDisclosure(input.emailDisclosureId ?? "")) {
        return res.status(400).json({ code: "VALIDATION_FAILED", message: "Reload the page and try again.", issues: [{ field: "emailDisclosureId", message: "Reload the page to see the current wording." }] });
      }

      const inbound = await claimPublicInbound(req, res, ["website_form", "partner_application"], input, {
        onReplay: async (request) => resumePartnerApplication(request, "partner"),
      });
      if (!inbound) return;

      const created = await createPartnerApplication(input, { inboundRequestId: inbound.id });
      if (created.kind !== "created") {
        // One uniform answer for every refusal: the page must not reveal whether a mailbox is a partner, a user or has an
        // application. The precise reason stays on the occurrence for staff.
        const reason = created.kind === "refused" ? `APPLICATION_REFUSED_${created.reason}` : `APPLICATION_INVALID_${created.reason}`;
        await setInboundRequestLifecycle(inbound.id, "failed", reason).catch(() => undefined);
        return res.status(created.kind === "invalid" ? 400 : 409).json({ code: "APPLICATION_NOT_ACCEPTED", message: PARTNER_NOT_ACCEPTED_ONLINE });
      }

      const completed = await completePartnerApplicationLocal(inbound, created.partner as any, "partner");
      return res.status(201).json({
        success: true,
        message: "Application received.",
        receipt: {
          applicationRecorded: true,
          reviewQueued: completed.reviewNotified,
          contactRecorded: completed.contactRecorded,
          emailReceipt: completed.emailReceipt,
          requestReceipt: inbound.id,
        },
      });
    } catch (err: any) {
      serverError(res, err, "partner_apply");
    }
  });

  // === PUBLISHED REFERRAL POLICY ===
  app.get("/api/public/partner-policy", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ referral: await getPublishedReferralPolicy() });
  });

  // === POLICY ADMINISTRATION (admin only; approver comes from the session) ===
  app.get("/api/partner-policy", requireRole("admin"), async (_req, res) => {
    try {
      sendStaff(res);
      res.json({ published: await getPublishedReferralPolicy(), versions: await listReferralPolicyVersions() });
    } catch (err) { serverError(res, err, "partner_policy_list"); }
  });

  app.post("/api/partner-policy/drafts", requireRole("admin"), async (req, res) => {
    try {
      if (!hasOnlyKeys(req.body, POLICY_DRAFT_KEYS)) return res.status(400).json({ code: "INVALID_BODY" });
      const result = await createReferralPolicyDraft(req.body, actorIdOf(req));
      if (!result.ok) return res.status(result.status).json({ code: result.code });
      sendStaff(res);
      res.status(201).json(result.value);
    } catch (err) { serverError(res, err, "partner_policy_draft"); }
  });

  app.post("/api/partner-policy/:id/approve", requireRole("admin"), async (req, res) => {
    try {
      const result = await approveReferralPolicy(String(req.params.id), actorIdOf(req));
      if (!result.ok) return res.status(result.status).json({ code: result.code });
      sendStaff(res);
      res.json(result.value);
    } catch (err) { serverError(res, err, "partner_policy_approve"); }
  });

  app.post("/api/partner-policy/:id/revoke", requireRole("admin"), async (req, res) => {
    try {
      const result = await revokeReferralPolicy(String(req.params.id), actorIdOf(req));
      if (!result.ok) return res.status(result.status).json({ code: result.code });
      sendStaff(res);
      res.json(result.value);
    } catch (err) { serverError(res, err, "partner_policy_revoke"); }
  });

  // === STAFF REVIEW OF APPLICATIONS ===
  app.get("/api/partner-applications", requireRole("admin", "manager"), async (req, res) => {
    try {
      sendStaff(res);
      res.json(await listPartnerApplications(normalizeApplicationFilters(req.query as Record<string, unknown>)));
    } catch (err) { serverError(res, err, "partner_application_list"); }
  });

  app.get("/api/partner-applications/:id", requireRole("admin", "manager"), async (req, res) => {
    try {
      const detail = await getPartnerApplicationDetail(String(req.params.id));
      if (!detail) return res.status(404).json({ message: "Not found" });
      sendStaff(res);
      res.json(detail);
    } catch (err) { serverError(res, err, "partner_application_detail"); }
  });

  // Administrators decide. The actor is the session user; the partner is the application's own row; the revision must match.
  app.post("/api/partner-applications/:id/decision", requireRole("admin"), async (req, res) => {
    try {
      if (!hasOnlyKeys(req.body, DECISION_KEYS)) return res.status(400).json({ code: "INVALID_BODY" });
      const actor = actorIdOf(req);
      if (!actor) return res.status(401).json({ message: "Unauthorized" });
      const result = await decidePartnerApplication(String(req.params.id), req.body, actor);
      if (!result.ok) return res.status(result.status).json({ code: result.code });
      sendStaff(res);
      res.json({
        applicationId: result.application.id,
        reviewStatus: result.application.reviewStatus,
        revision: result.application.revision,
        partnerStatus: result.partner.status,
        invitation: result.invitation ? { id: result.invitation.id, kind: result.invitation.kind, state: result.invitation.state } : null,
      });
    } catch (err) { serverError(res, err, "partner_application_decision"); }
  });

  // === PARTNER INTRODUCTIONS ===
  app.get("/api/partners/me/introductions", isPartnerAuthenticated, async (req, res) => {
    try {
      const partner = await storage.getPartnerByEmail(String((req as any).user?.email ?? ""));
      if (!partner) return res.status(404).json({ message: "Partner account not found." });
      privatePartnerResponse(res);
      res.json({ introductions: await listPartnerIntroductionsFor(partner.id) });
    } catch (err) { serverError(res, err, "partner_introduction_list"); }
  });

  app.post("/api/partners/me/introductions", isPartnerAuthenticated, async (req, res) => {
    try {
      const key = req.header("Idempotency-Key") ?? "";
      if (!INTRODUCTION_KEY_PATTERN.test(key)) return res.status(400).json({ code: "MISSING_IDEMPOTENCY_KEY" });
      const parsed = parseIntroductionBody(req.body);
      if (!parsed.ok) return res.status(400).json({ code: "VALIDATION_FAILED", message: "Please check the highlighted fields.", issues: parsed.issues });
      const user = (req as any).user;
      const partner = await storage.getPartnerByEmail(String(user?.email ?? ""));
      if (!partner) return res.status(404).json({ message: "Partner account not found." });

      const recorded = await recordPartnerIntroduction(partner, { userId: user?.id ? String(user.id) : null }, key, parsed.data);
      if (recorded.kind === "refused") {
        return res.status(recorded.status).json({
          code: recorded.code,
          message: recorded.code === "PARTNER_NOT_ACTIVE"
            ? "Your partner account is not active, so introductions cannot be submitted."
            : "This submission key was already used for different details.",
        });
      }
      res.setHeader("Idempotency-Key", key);
      let intro = recorded.introduction;
      try {
        intro = await completePartnerIntroduction(intro.id);
      } catch (error) {
        // The submission is durable; a retry with the same key resumes the missing work.
        logOperationalDiagnostic("partner_introduction", error, "completion_failed", { partnerId: partner.id });
      }
      privatePartnerResponse(res);
      res.status(recorded.replayed ? 200 : 201).json({ ...toPartnerIntroductionView(intro), replayed: recorded.replayed });
    } catch (err) { serverError(res, err, "partner_introduction_submit"); }
  });

  // Staff review of introductions that need a decision (duplicates, competing referrers, new records).
  app.get("/api/partner-introductions", requireRole("admin", "manager"), async (req, res) => {
    try {
      const q = req.query as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "string" && /^\d{1,5}$/.test(v) ? Number(v) : undefined);
      sendStaff(res);
      res.json(await listIntroductionsForReview({
        reviewState: typeof q.reviewState === "string" ? q.reviewState : undefined, page: num(q.page), pageSize: num(q.pageSize),
      }));
    } catch (err) { serverError(res, err, "partner_introduction_review_list"); }
  });
}
