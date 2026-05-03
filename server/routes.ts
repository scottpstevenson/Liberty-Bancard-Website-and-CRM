import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { registerAudioRoutes } from "./replit_integrations/audio/routes";

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
import { registerResidualsRoutes } from "./routes/residuals";
import { registerVirtualTerminalRoutes } from "./routes/virtual-terminal";
import { registerBoardingRoutes } from "./routes/boarding";
import { registerPushRoutes } from "./routes/push";
import { registerPartnerOrgsRoutes } from "./routes/partner-orgs";
import { registerPermissionsAuditRoutes } from "./routes/permissions-audit";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  registerAudioRoutes(app);

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
    "/thanks-statement",
    "/thanks-estimate",
    "/thanks-call",
    "/thanks-support",
    "/thanks/application",
    "/nps/",
    "/proposal/",
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

  app.get("/thanks-application", (_req, res) => {
    res.redirect(301, "/thanks/application");
  });

  registerSsrRoutes(app);
  registerGlossaryRoutes(app);
  registerTrainingRoutes(app);
  registerMyDayRoutes(app);
  registerLiveChatRoutes(app);
  registerChargebacksRoutes(app);
  registerToolkitRoutes(app);
  registerLifecycleRoutes(app);
  registerResidualsRoutes(app);
  registerVirtualTerminalRoutes(app);
  registerBoardingRoutes(app);
  registerPushRoutes(app);

  // Must be registered LAST — extracts route permissions by walking the
  // already-populated express router stack (Task #169 API surface audit).
  registerPermissionsAuditRoutes(app);

  return httpServer;
}
