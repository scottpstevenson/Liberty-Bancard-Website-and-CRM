import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import * as Sentry from "@sentry/node";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startSlaWorker } from "./services/sla-worker";
import { startAutoSyncLoop } from "./services/ghl-sync";
import { getQueueManager, shutdownQueueManager } from "./services/queue-manager";
import { seedDefaultData } from "./services/seed-workflows";
import { seedSequences } from "./services/seed-sequences";
import { seedVerticalCampaigns } from "./services/seed-vertical-campaigns";
import { seedStageRules, seedDemoProspects } from "./services/seed-automation";
import { startDailyOutreachWorker } from "./services/daily-outreach";
import { startDailyMaintenanceScheduler, seedScottSendingIdentity } from "./services/sdr/inbox-rotation";
import { startContentScheduler } from "./services/content-scheduler";
import { seedContentEngine } from "./services/seed-content-engine";
import { featureFlags } from "./services/feature-flags";
import { runDrizzleMigrations } from "./db-migrate";
import { hydrateWorkflowEnvFromDb } from "./services/ghl-workflows";
import { validateEnv } from "./lib/validate-env";

// Validate required environment variables before anything else starts.
validateEnv();

// Initialize Sentry error monitoring as early as possible so it captures all
// subsequent errors including those that occur during startup.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
  });
  console.log("[Sentry] Error monitoring initialized");
} else {
  console.warn("[Sentry] SENTRY_DSN not set — error monitoring is disabled");
}

// Build CORS origin allowlist from ALLOWED_ORIGINS env var (comma-separated).
// Falls back to the production domain so the app is safe out of the box.
const _allowedOrigins: string[] = (
  process.env.ALLOWED_ORIGINS || process.env.APP_URL || "https://libertybancard.com"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function validateCriticalEnvVars() {
  const criticalVars = [
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
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  }
});

process.on("uncaughtException", (err: Error) => {
  console.error("[Process] Uncaught exception:", err);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  process.exit(1);
});

let isShuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Process] ${signal} received — starting graceful shutdown`);
  try {
    await shutdownQueueManager();
  } catch (err: any) {
    console.error("[Process] Error shutting down queue manager:", err.message);
  }
  console.log("[Process] Graceful shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// CORS — restrict credentialed API calls to the configured origin allowlist.
// In development Vite serves on the same origin, so the list is also permissive
// for localhost. Set ALLOWED_ORIGINS in production to lock this down.
const _isDev = process.env.NODE_ENV !== "production";

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps).
      if (!origin) return callback(null, true);
      // In development only: permit localhost and Replit preview origins so
      // the dev workflow is not broken. These bypasses are NOT active in prod.
      if (_isDev) {
        if (
          origin.startsWith("http://localhost") ||
          origin.startsWith("http://127.0.0.1") ||
          origin.includes(".replit.dev") ||
          origin.includes(".repl.co")
        ) {
          return callback(null, true);
        }
      }
      if (_allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // 'unsafe-inline' is required because Vite injects inline scripts during
          // development (HMR bootstrap) and the React bundle uses inline event
          // handlers. Removing it without a nonce-based build pipeline would break
          // the app. Track https://vitejs.dev/guide/features.html#content-security-policy
          // for nonce support progress.
          "'unsafe-inline'",
          // NOTE: 'unsafe-eval' has been intentionally removed. Vite's production
          // build does NOT require eval(). It was only needed in legacy bundler
          // configurations. If a runtime error like "unsafe-eval is not allowed"
          // appears after this change, identify the specific library causing it and
          // add a targeted allowlist entry rather than re-enabling the directive.
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
  await runDrizzleMigrations();
  await registerRoutes(httpServer, app);

  // Sentry error-handler must be registered AFTER all routes so it can capture
  // errors propagated via next(err). It must also come BEFORE the generic error
  // handler below so Sentry receives the full error object.
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

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

      // BullMQ durable job queue — replaces setInterval workers for GHL sync,
      // SLA checks, sequence processing, enrichment, discovery, and digests.
      // Requires a real Redis connection (REDIS_URL). Without it, falls back
      // to lightweight setInterval workers so the server still functions.
      getQueueManager().then(qm => {
        log("[Queue] BullMQ job queues initialized");
      }).catch(err => {
        console.error("[Queue] Failed to initialize BullMQ — falling back to setInterval workers:", err.message);
        startSlaWorker();
        startAutoSyncLoop();
        if (featureFlags.LEGACY_OUTREACH_ENABLED) {
          startDailyOutreachWorker();
        }
      });

      // Hydrate GHL workflow IDs from DB into process.env so they behave as env vars
      hydrateWorkflowEnvFromDb().then(n => {
        if (n > 0) log(`[GHL Workflows] Hydrated ${n} workflow IDs from DB into process.env`);
      }).catch(() => {});

      // Seed Scott's sending identity as the primary SDR inbox if not already present
      seedScottSendingIdentity().catch(err => {
        console.error("[Seed] Failed to seed Scott sending identity:", err);
      });

      startDailyMaintenanceScheduler();

      // Task #179 — Content Engine: scheduled blog publish + LinkedIn drafts
      startContentScheduler();
      seedContentEngine().catch(err => {
        console.error("[Seed] Content Engine seeding failed:", err);
      });
    },
  );
})();
