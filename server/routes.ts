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
import { registerSsrRoutes } from "./routes/ssr-routes";
import { registerGlossaryRoutes } from "./routes/glossary";
import { registerTrainingRoutes } from "./routes/training";
import { registerMyDayRoutes } from "./routes/my-day";
import { registerLiveChatRoutes } from "./routes/live-chat";
import { registerChargebacksRoutes } from "./routes/chargebacks";
import { registerToolkitRoutes } from "./routes/toolkit";

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
      req.path.startsWith("/auth");
    if (allowed) return next();
    return res.status(403).json({ message: "Partner accounts do not have CRM access." });
  });

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
  registerSsrRoutes(app);
  registerGlossaryRoutes(app);
  registerTrainingRoutes(app);
  registerMyDayRoutes(app);
  registerLiveChatRoutes(app);
  registerChargebacksRoutes(app);
  registerToolkitRoutes(app);

  return httpServer;
}
