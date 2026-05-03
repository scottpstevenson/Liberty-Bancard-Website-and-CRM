import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startSlaWorker } from "./services/sla-worker";
import { startAutoSyncLoop } from "./services/ghl-sync";
import { seedDefaultData } from "./services/seed-workflows";
import { seedSequences } from "./services/seed-sequences";
import { seedVerticalCampaigns } from "./services/seed-vertical-campaigns";
import { seedStageRules, seedDemoProspects } from "./services/seed-automation";
import { startDailyOutreachWorker } from "./services/daily-outreach";
import { startDailyMaintenanceScheduler, seedScottSendingIdentity } from "./services/sdr/inbox-rotation";
import { startContentScheduler } from "./services/content-scheduler";
import { seedContentEngine } from "./services/seed-content-engine";
import { featureFlags } from "./services/feature-flags";
import { runStartupMigrations } from "./services/migrations";
import { hydrateWorkflowEnvFromDb } from "./services/ghl-workflows";

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[FATAL] SESSION_SECRET environment variable is not set. Exiting.");
    process.exit(1);
  } else {
    console.warn("[WARN] SESSION_SECRET is not set. This is insecure and must be set before going to production.");
  }
}

function validateCriticalEnvVars() {
  const criticalVars = [
    "SESSION_SECRET",
    "GHL_LOCATION_ID",
    "GHL_PRIVATE_INTEGRATION_TOKEN",
    "APP_URL",
    "GHL_WEBHOOK_SECRET",
    "ADMIN_DIGEST_EMAIL",
  ];
  for (const name of criticalVars) {
    if (!process.env[name]) {
      console.warn(`[Config] WARNING: Missing critical env var: ${name}`);
    }
  }
}
validateCriticalEnvVars();

process.on("unhandledRejection", (reason: any) => {
  console.error("[Process] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err: Error) => {
  console.error("[Process] Uncaught exception:", err);
  process.exit(1);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "*.leadconnectorhq.com",
          "*.ghl.io",
          "*.googletagmanager.com",
          "*.google-analytics.com",
          "*.facebook.com",
          "connect.facebook.net",
          "fonts.googleapis.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "fonts.googleapis.com",
          "*.leadconnectorhq.com",
          "*.ghl.io",
        ],
        fontSrc: [
          "'self'",
          "fonts.gstatic.com",
          "*.leadconnectorhq.com",
          "*.ghl.io",
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "*.google-analytics.com",
          "*.googletagmanager.com",
          "*.facebook.com",
          "*.leadconnectorhq.com",
          "*.ghl.io",
          "img.youtube.com",
          "i.ytimg.com",
        ],
        connectSrc: [
          "'self'",
          "*.leadconnectorhq.com",
          "*.ghl.io",
          "*.googletagmanager.com",
          "*.google-analytics.com",
          "*.facebook.com",
          "connect.facebook.net",
        ],
        frameSrc: [
          "'self'",
          "*.leadconnectorhq.com",
          "*.ghl.io",
          "*.youtube.com",
          "*.youtube-nocookie.com",
        ],
        frameAncestors: ["'self'"],
      },
    },
  })
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(cookieParser());
app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await runStartupMigrations();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    if (status >= 500) {
      return res.status(status).json({ message: "Internal server error" });
    }

    return res.status(status).json({ message: err.message || "Error" });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      seedDefaultData();
      seedSequences();
      seedVerticalCampaigns();
      seedStageRules();
      seedDemoProspects();
      startSlaWorker();
      startAutoSyncLoop();

      // Hydrate GHL workflow IDs from DB into process.env so they behave as env vars
      hydrateWorkflowEnvFromDb().then(n => {
        if (n > 0) log(`[GHL Workflows] Hydrated ${n} workflow IDs from DB into process.env`);
      }).catch(() => {});

      // Seed Scott's sending identity as the primary SDR inbox if not already present
      seedScottSendingIdentity().catch(err => {
        console.error("[Seed] Failed to seed Scott sending identity:", err);
      });

      if (featureFlags.LEGACY_OUTREACH_ENABLED) {
        log("LEGACY_OUTREACH_ENABLED=true — starting legacy outreach workers");
        startDailyOutreachWorker();
      } else {
        log("LEGACY_OUTREACH_ENABLED=false — legacy outreach workers disabled");
      }

      startDailyMaintenanceScheduler();

      // Task #179 — Content Engine: scheduled blog publish + LinkedIn drafts
      startContentScheduler();
      seedContentEngine().catch(err => {
        console.error("[Seed] Content Engine seeding failed:", err);
      });
    },
  );
})();
