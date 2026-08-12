import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";
import { csrfTokenEndpoint } from "./middleware/csrf";

import { registerContactsRoutes } from "./routes/contacts";
import { registerDealsRoutes } from "./routes/deals";
import { registerTicketsTasksRoutes } from "./routes/tickets-tasks";
import { registerDocumentsRoutes } from "./routes/documents";
import { registerNotificationsRoutes } from "./routes/notifications";
import { registerPublicRoutes } from "./routes/public";
import { registerWorkflowsRoutes } from "./routes/workflows";
import { registerAiRoutes } from "./routes/ai";
import { registerIntegrationsRoutes } from "./routes/integrations";
import { registerTemplatesSettingsRoutes } from "./routes/templates-settings";
import { registerAnalyticsRoutes } from "./routes/analytics";
import { registerProspectsRoutes } from "./routes/prospects";
import { registerCampaignsRoutes } from "./routes/campaigns";
import { registerSearchRoutes } from "./routes/search";
import { registerActivityRoutes } from "./routes/activity";
import { registerMerchantsRoutes } from "./routes/merchants";
import { registerAdminRoutes } from "./routes/admin";
import { registerPartnersRoutes } from "./routes/partners";
import { registerCrmOperationsRoutes } from "./routes/crm-operations";
import { registerImportsRoutes } from "./routes/imports";
import { registerSdrRoutes } from "./routes/sdr";
import { registerActivationRoutes } from "./routes/activation";
import { registerSsrRoutes } from "./routes/ssr-routes";
import { registerOgRoutes } from "./routes/og";
import { registerSeoAdminRoutes } from "./routes/seo-admin";
import { registerGlossaryRoutes } from "./routes/glossary";
import { registerTrainingRoutes } from "./routes/training";
import { registerMyDayRoutes } from "./routes/my-day";
import { registerLiveChatRoutes } from "./routes/live-chat";
import { registerChargebacksRoutes } from "./routes/chargebacks";
import { registerToolkitRoutes } from "./routes/toolkit";
import { registerLifecycleRoutes } from "./routes/lifecycle";
import { registerChurnRoutes } from "./routes/churn";
import { registerPortfolioRoutes } from "./routes/portfolio";
import { registerRateReviewRoutes } from "./routes/rate-review";
import { registerResidualsRoutes } from "./routes/residuals";
// registerVirtualTerminalRoutes removed — Virtual Terminal feature decommissioned (#1473)
import { registerBoardingRoutes } from "./routes/boarding";
import { registerPushRoutes } from "./routes/push";
import { registerPartnerOrgsRoutes } from "./routes/partner-orgs";
import { registerPermissionsAuditRoutes } from "./routes/permissions-audit";
import { registerContentRoutes } from "./routes/content";
import { registerSocialRoutes } from "./routes/social";
import { registerReviewQueueRoutes } from "./routes/review-queue";
import { registerQueueMetricsRoutes } from "./routes/queue-metrics";
import { registerRelationshipsRoutes } from "./routes/relationships";
import { registerSavingsRoutes } from "./routes/savings";
import { registerWidgetRoutes } from "./routes/widget";
import { registerTerminalEconomicsRoutes } from "./routes/terminal-economics";
import { registerUnderwritingRoutes } from "./routes/underwriting";
import { registerConversationAiConfigRoutes } from "./routes/conversation-ai-config";
import { registerRegistryImportRoutes } from "./routes/registry-import";
import { registerSystemAuditRoutes } from "./routes/system-audit";
import { registerExecutiveRoutes } from "./routes/executive";
import { registerWizardRoutes } from "./routes/wizard";
import { registerGmailOAuthRoutes } from "./routes/gmail-oauth";
import { registerChatAssistantRoutes } from "./routes/chat-assistant";
import { registerKnowledgeAdminRoutes } from "./routes/knowledge-admin";
import { registerAcquisitionRoutes } from "./routes/acquisition";
import { registerInboxRoutes } from "./routes/inbox";
import { registerInformationFlowRoutes } from "./routes/information-flow";
import { registerInboxOwnershipRoutes } from "./routes/inbox-ownership";
import { registerStatementReviewRoutes } from "./routes/statement-review";
import { registerOnboardingStagesRoutes } from "./routes/onboarding-stages";
import { registerMerchantPortalInviteRoutes } from "./routes/merchant-portal-invite";
import { registerNbaRoutes } from "./routes/nba";
import { registerUnderwritingConditionRoutes } from "./routes/underwriting-conditions";
import { registerMerchantMidRoutes } from "./routes/merchant-mids";
import { registerSaveCaseRoutes } from "./routes/save-cases";
import { registerAiMemoryRoutes } from "./routes/ai-memory";
import { registerDailyBriefingRoutes } from "./routes/daily-briefing";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerAudioRoutes(app);

  app.get("/api/csrf-token", csrfTokenEndpoint);

  app.use("/api", (req, res, next) => {
    if (!req.isAuthenticated()) return next();
    const role = (req.user as any)?.role;
    if (role !== "partner") return next();
    const partnerAllowedExact = new Set([
      "/partner-apply",
      "/partner/login",
      "/partner/session",
      "/partner/logout",
    ]);
    const allowed =
      partnerAllowedExact.has(req.path) ||
      req.path.startsWith("/partner/dashboard/") ||
      req.path.startsWith("/partner-org/") ||
      req.path.startsWith("/auth");
    if (allowed) return next();
    return res.status(403).json({ message: "Partner accounts do not have CRM access." });
  });

  registerPartnerOrgsRoutes(app);
  registerContactsRoutes(app);
  registerDealsRoutes(app);
  registerTicketsTasksRoutes(app);
  registerDocumentsRoutes(app);
  registerNotificationsRoutes(app);
  registerPublicRoutes(app);
  registerWorkflowsRoutes(app);
  registerAiRoutes(app);
  registerIntegrationsRoutes(app);
  registerTemplatesSettingsRoutes(app);
  registerAnalyticsRoutes(app);
  registerProspectsRoutes(app);
  registerCampaignsRoutes(app);
  registerSearchRoutes(app);
  registerActivityRoutes(app);
  registerMerchantsRoutes(app);
  registerAdminRoutes(app);
  registerPartnersRoutes(app);
  registerCrmOperationsRoutes(app);
  registerImportsRoutes(app);
  registerSdrRoutes(app);
  registerActivationRoutes(app);
  registerQueueMetricsRoutes(app);

  // SEO #178 — programmatic OG image route + admin coverage endpoint.
  // Registered BEFORE registerSsrRoutes so the 301 redirect for the
  // duplicate /thanks-application path wins over the SPA fallback.
  registerOgRoutes(app);
  registerSeoAdminRoutes(app);

  // Server-side noindex enforcement for auth and thank-you routes. Sets
  // X-Robots-Tag header so crawlers see the directive immediately, without
  // depending on client-side react-helmet-async to mount. Belt-and-suspenders
  // alongside the in-page <meta name="robots"> tags rendered by <SEO noindex>.
  const NOINDEX_PATH_PREFIXES = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/activate-portal",
    "/thanks-statement",
    "/thanks-estimate",
    "/thanks-call",
    "/thanks-support",
    "/thanks/application",
    "/nps/",
    "/proposal/",
    "/savings/",
    "/assets/",
    "/dashboard",
    "/mobile",
    "/partner-portal",
  ];
  app.use((req, res, next) => {
    const p = req.path;
    if (
      NOINDEX_PATH_PREFIXES.some(
        (prefix) => p === prefix || p.startsWith(prefix + (prefix.endsWith("/") ? "" : "/")) || p === prefix
      )
    ) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    next();
  });

  // /thanks-application → /thanks/application (301) is registered inside
  // registerSsrRoutes (server/routes/ssr-routes.ts) — do not duplicate here.

  registerSsrRoutes(app);
  registerGlossaryRoutes(app);
  registerTrainingRoutes(app);
  registerMyDayRoutes(app);
  registerLiveChatRoutes(app);
  registerChargebacksRoutes(app);
  registerToolkitRoutes(app);
  registerLifecycleRoutes(app);
  registerChurnRoutes(app);
  registerPortfolioRoutes(app);
  registerRateReviewRoutes(app);
  registerResidualsRoutes(app);
  // registerVirtualTerminalRoutes(app); — removed (#1473)
  registerBoardingRoutes(app);
  registerPushRoutes(app);
  registerContentRoutes(app);
  registerSocialRoutes(app);
  registerReviewQueueRoutes(app);
  registerRelationshipsRoutes(app);
  registerSavingsRoutes(app);
  registerWidgetRoutes(app);
  registerTerminalEconomicsRoutes(app);
  registerUnderwritingRoutes(app);
  registerConversationAiConfigRoutes(app);
  registerRegistryImportRoutes(app);
  registerSystemAuditRoutes(app);
  registerExecutiveRoutes(app);
  registerWizardRoutes(app);
  registerGmailOAuthRoutes(app);
  registerChatAssistantRoutes(app);
  registerKnowledgeAdminRoutes(app);
  registerAcquisitionRoutes(app);
  registerInboxRoutes(app);
  registerInformationFlowRoutes(app);
  registerInboxOwnershipRoutes(app);
  registerStatementReviewRoutes(app);
  registerOnboardingStagesRoutes(app);
  registerMerchantPortalInviteRoutes(app);
  registerNbaRoutes(app);
  registerUnderwritingConditionRoutes(app);   // #1403
  registerMerchantMidRoutes(app);             // #1404
  registerSaveCaseRoutes(app);                // #1407
  registerAiMemoryRoutes(app);               // #1408/#1409
  registerDailyBriefingRoutes(app);          // #1476 — daily briefing

  // Must be registered before the API 404 catch-all — extracts route
  // permissions by walking the already-populated express router stack
  // (Task #169 API surface audit).
  registerPermissionsAuditRoutes(app);

  // API 404 catch-all — must come AFTER all /api routes are registered but
  // BEFORE the Vite/static SPA fallback so unknown API paths return JSON
  // instead of the SPA HTML shell.
  app.use("/api", (req, res, next) => {
    if (res.headersSent) return next();
    res.status(404).json({
      message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
      code: "not_found",
    });
  });

  return httpServer;
}
