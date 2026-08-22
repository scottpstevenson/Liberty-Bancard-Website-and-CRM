import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startSlaWorker } from "./services/sla-worker";
import { startAutoSyncLoop } from "./services/ghl-sync";
import { getQueueManager, shutdownQueueManager, claimLegacyGhlSync } from "./services/queue-manager";
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
import { storage } from "./storage";

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
import { getCorsOrigins } from "./lib/canonical-url";
import {
  createSecurityMiddleware,
  isDeniedCorsOriginError,
} from "./lib/security";
const _allowedOrigins: string[] = getCorsOrigins();

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

function logEnvVarChecklist() {
  const checks: Array<{ envVar: string | string[]; feature: string }> = [
    { envVar: "PAYARC_API_KEY",             feature: "Payarc processor boarding (MID provisioning disabled without it)" },
    { envVar: "GHL_LOCATION_ID",           feature: "GoHighLevel CRM sync and all GHL communications" },
    { envVar: "GHL_DEFAULT_BOOKING_LINK",  feature: "{{link}} in SDR outreach templates (falls back to Calendly URL)" },
    { envVar: "GHL_WORKFLOW_BOOKING_LINK", feature: "Automated booking link workflow trigger via GHL" },
    { envVar: "GHL_BOOKING_URL",           feature: "Public 'Book a Call' CTA (VITE_GHL_BOOKING_URL must also be set for frontend)" },
    { envVar: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"], feature: "Push notifications (auto-generated fallback keys used — not portable across restarts without this)" },
    { envVar: "SENTRY_DSN",                feature: "Sentry error monitoring" },
    { envVar: "SERPER_API_KEY",            feature: "Serper.dev Google search enrichment in Outreach Command Center" },
    { envVar: "APOLLO_API_KEY",            feature: "Apollo.io B2B contact discovery" },
    { envVar: "PROXYCURL_API_KEY",         feature: "ProxyCurl LinkedIn enrichment" },
    { envVar: "APIFY_API_TOKEN",           feature: "Apify Yelp/Facebook business scraping" },
    { envVar: "OUTSCRAPER_API_KEY",        feature: "Outscraper Google Maps bulk data pulls" },
    { envVar: "SMTP_HOST",                 feature: "SMTP email fallback (used when GHL is not configured or contact has no GHL ID)" },
    { envVar: "SMTP_PASS",                 feature: "SMTP authentication — required alongside SMTP_HOST/USER for actual delivery" },
    { envVar: "AI_INTEGRATIONS_OPENAI_API_KEY", feature: "AI enrichment, intent classification, blueprint generation, proposal engine" },
  ];

  const missing: string[] = [];
  for (const check of checks) {
    const vars = Array.isArray(check.envVar) ? check.envVar : [check.envVar];
    const allMissing = vars.every((v) => !process.env[v]);
    if (allMissing) {
      const label = vars.join(" / ");
      missing.push(`  ✗ ${label.padEnd(35)} → ${check.feature}`);
    }
  }

  if (missing.length === 0) {
    console.log("[Config] ✓ All monitored environment variables are set.");
  } else {
    console.warn(`[Config] Missing optional/feature-gating env vars (${missing.length}):\n${missing.join("\n")}`);
  }
}

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
const SHUTDOWN_HARD_CEILING_MS = parseInt(process.env.SHUTDOWN_HARD_CEILING_MS ?? "10000");

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Process] ${signal} received — starting graceful shutdown (hard ceiling ${SHUTDOWN_HARD_CEILING_MS}ms)`);

  const forceExitTimer = setTimeout(() => {
    console.error(
      `[Process] Graceful shutdown exceeded ${SHUTDOWN_HARD_CEILING_MS}ms — forcing exit so the port is released for the next process`
    );
    process.exit(1);
  }, SHUTDOWN_HARD_CEILING_MS);
  forceExitTimer.unref();

  try {
    await shutdownQueueManager();
    console.log("[Process] Graceful shutdown complete");
    process.exit(0);
  } catch (err: any) {
    console.error("[Process] Error shutting down queue manager:", err.message);
    process.exit(1);
  } finally {
    clearTimeout(forceExitTimer);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const app = express();
const httpServer = createServer(app);

// Trust Replit's reverse proxy so req.hostname reflects X-Forwarded-Host
// (the custom domain, e.g. libertybancard.com) rather than the internal
// Replit hostname (liberty-bancard-system.replit.app).  Without this,
// Express uses the raw Host header set by the proxy and res.redirect('/path')
// constructs absolute URLs with the wrong hostname.
app.set("trust proxy", 1);

// Canonical-host redirect: intentionally removed.
// Application-layer host redirects (301 → libertybancard.com) consistently
// intercept Cloud Run's autoscale startup health probe — which uses an internal
// *.a.run.app hostname that doesn't match any safe-list pattern — causing every
// promote step to time out. Canonical host enforcement should be handled at the
// CDN / DNS layer (e.g. a Replit custom-domain redirect rule), not in Express.

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Common security headers must run before CORS so denied-origin responses have
// the same Helmet protections as every other response.
const { helmet: securityHeaders, cors: corsMiddleware } = createSecurityMiddleware(
  _allowedOrigins,
  process.env.NODE_ENV === "production" ? "production" : "development",
);
app.use(securityHeaders);
app.use(corsMiddleware);
// CORS failures are intentionally handled immediately after the CORS
// middleware. The typed error has a fixed public message and never reflects
// the rejected Origin header.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!isDeniedCorsOriginError(err)) return next(err);
  if (res.headersSent) return next(err);
  return res.status(403).json({ message: "CORS origin denied" });
});

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

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  // C-03 (#1626): fail-fast fake GHL transport for test servers. When the
  // pre-deploy wrapper starts the server with GHL_TRANSPORT_FAILFAST=true, any
  // server-side call to the GHL API base URL throws TestTransportError instead
  // of reaching the real provider. Installed before registerRoutes so no
  // request handler can slip through before the intercept is active.
  if (process.env.GHL_TRANSPORT_FAILFAST === "true") {
    const { installGhlFailFastTransport } = await import("./services/ghl-test-transport");
    installGhlFailFastTransport();
  }

  await runDrizzleMigrations();
  const { reconcileEnrichmentState, reconcileScoringState, seedAutomationRegistry } = await import("./services/startup-reconcile");
  await reconcileEnrichmentState();
  await reconcileScoringState();
  await seedAutomationRegistry();
  // Mark any previews left 'running' by a previous server process as interrupted.
  // This prevents stale running previews from ever being used for queuing after a restart.
  try {
    await storage.markInterruptedCampaignPreviews();
    console.log("[CampaignPreview] Startup: interrupted any stale running previews");
  } catch (e: any) {
    console.warn("[CampaignPreview] Startup interrupt-mark failed (non-fatal):", e?.message);
  }
  await registerRoutes(httpServer, app);

  const { logSmtpStartupWarning } = await import("./services/smtp-email");
  logSmtpStartupWarning();

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
      logEnvVarChecklist();

      // ── PAUSE AUTHORITY INITIALIZATION (must complete before any worker starts) ──
      // Read and validate the global outbound pause state before starting any
      // outbound-capable service or worker. Missing/malformed/DB-error resolves
      // to paused (fail-closed). Only after the state is known and logged may
      // workers initialize. This prevents the startup race where workers could
      // begin processing before pause state is known.
      let pauseInitialized = false;
      try {
        const { initializePauseControl } = await import("./services/outbound-control-service");
        const pauseState = await initializePauseControl();
        log(
          `[PauseAuthority] Startup state: ${pauseState.state} epoch=${pauseState.epoch} ` +
          `source=${pauseState.source}` +
          (pauseState.reason ? ` reason="${pauseState.reason}"` : ""),
        );
        // Treat safe_default as a failed initialization — the canonical control
        // table was missing or unreadable. Workers must not start until the table
        // exists and can be read, because the authority cannot make authoritative
        // decisions and cannot fall back to legacy system_settings (which may be
        // explicitly unpaused).
        if (pauseState.source === "safe_default") {
          throw new Error(
            `Pause control table missing or unreadable (source=safe_default, state=${pauseState.state}). ` +
            `Apply migration 0133 and restart before starting outbound-capable workers.`,
          );
        }
        pauseInitialized = true;
      } catch (pauseInitErr: any) {
        // Fail-closed: if pause initialization throws or returns safe_default,
        // do NOT start outbound-capable workers.
        console.error(
          `[PauseAuthority] STARTUP ERROR: pause initialization failed — ` +
          `outbound workers blocked until resolved: ${pauseInitErr.message}`,
        );
        pauseInitialized = false;
      }

      // Seed legacy system_settings pause keys (for backward compat, channel-level pauses)
      (async () => {
        const CHANNEL_PAUSE_KEYS = [
          "outboundGlobalPaused",
          "emailChannelPaused",
          "smsChannelPaused",
          "coldEmailChannelPaused",
        ] as const;
        for (const key of CHANNEL_PAUSE_KEYS) {
          const existing = await storage.getSystemSetting(key);
          if (existing === null) {
            await storage.setSystemSetting(key, true);
            log(`[PauseSeed] ${key}=true seeded (fail-closed default)`);
          }
        }
      })().catch(err => console.warn("[PauseSeed] Non-critical seeding error:", err.message));

      seedDefaultData();
      seedSequences();
      seedVerticalCampaigns();
      seedStageRules();
      // Demo prospects only run when DEV_SEED_DEMO=true (never in production).
      if (process.env.DEV_SEED_DEMO === "true") {
        seedDemoProspects();
      }

      // ── Workers start only after pause state is initialized ───────────────
      // If pauseInitialized=false, workers are skipped entirely (fail-closed).
      if (!pauseInitialized) {
        console.error(
          "[PauseAuthority] Workers NOT started — pause state unknown. " +
          "Resolve the DB error and restart to enable outbound processing.",
        );
        // Continue with non-outbound startup (routes, seeds, etc.)
      }

      // BullMQ durable job queue — replaces setInterval workers for GHL sync,
      // SLA checks, sequence processing, enrichment, discovery, and digests.
      // Requires a real Redis connection (REDIS_URL). Without it, falls back
      // to lightweight setInterval workers so the server still functions.
      // NOTE: This block only executes when pause state was successfully initialized.
      if (!pauseInitialized) { /* skip workers — outbound state unknown */ } else
      getQueueManager().then(async qm => {
        log("[Queue] BullMQ job queues initialized");
        // BullMQ's GHL_SYNC repeatable job is now the sole active GHL sync mechanism.
        // getQueueManager() tears down any partially-created queues/workers on failure
        // before propagating the error, so this branch and the legacy-fallback branch
        // below are mutually exclusive within a process.
        log("GHL sync mode: bullmq");
        // Also record a visible health signal so the Operator Dashboard's Job Queue
        // panel reflects sync mode, not just the startup log.
        const { recordWorkerSuccess, JOB_NAMES } = await import("./services/job-registry");
        await recordWorkerSuccess(JOB_NAMES.GHL_SYNC_MODE).catch(() => {});
      }).catch(async err => {
        console.error("[Queue] Failed to initialize BullMQ — falling back to setInterval workers:", err.message);
        startSlaWorker();
        // Claim GHL sync duty for the legacy interval BEFORE starting it, so that
        // if BullMQ later becomes available (e.g. Redis recovers and something
        // else lazily calls getQueueManager() to enqueue an enrichment job), it
        // will permanently exclude GHL_SYNC from the queues/workers it manages —
        // guaranteeing only one GHL sync mechanism is ever active in this process.
        claimLegacyGhlSync();
        startAutoSyncLoop();
        log("GHL sync mode: legacy_interval_fallback");
        const { recordWorkerFailure, JOB_NAMES } = await import("./services/job-registry");
        await recordWorkerFailure(
          JOB_NAMES.GHL_SYNC_MODE,
          `GHL sync running in legacy interval fallback mode — BullMQ unavailable: ${err.message}`
        ).catch(() => {});
        if (featureFlags.LEGACY_OUTREACH_ENABLED) {
          startDailyOutreachWorker();
        }
      });

      // Hydrate GHL workflow IDs from DB into process.env so they behave as env vars,
      // then run a non-blocking live validation against GHL to surface stale/deleted IDs.
      hydrateWorkflowEnvFromDb().then(async n => {
        if (n > 0) log(`[GHL Workflows] Hydrated ${n} workflow IDs from DB into process.env`);
        // Validate configured workflow IDs against real GHL after hydration so all IDs are visible
        try {
          const { validateGhlWorkflowRegistry } = await import("./services/ghl-workflows");
          const { isSdrGhlConfigured } = await import("./services/sdr/ghl-client");
          const { isGhlConfigured } = await import("./services/ghl");
          if (isGhlConfigured() || isSdrGhlConfigured()) {
            const v = await validateGhlWorkflowRegistry();
            if (v.checkedCount === 0) {
              log(`[GHL Workflow Validation] No workflow IDs configured yet — skipping live check`);
            } else {
              const broken = v.unresolvedKeys.length + v.inactiveKeys.length;
              if (broken > 0) {
                console.warn(
                  `[GHL Workflow Validation] STARTUP WARNING: ${broken} workflow ID(s) invalid ` +
                  `(${v.unresolvedKeys.length} not found in GHL, ${v.inactiveKeys.length} inactive). ` +
                  `Affected env keys: ${[...v.unresolvedKeys, ...v.inactiveKeys].join(", ")}. ` +
                  `These automations will silently skip until fixed.`
                );
              } else {
                log(`[GHL Workflow Validation] ${v.okCount}/${v.checkedCount} configured workflow IDs verified active in GHL`);
              }
            }
          }
        } catch (err: any) {
          console.warn(`[GHL Workflow Validation] Startup validation failed (non-critical): ${err.message}`);
        }
      }).catch(() => {});

      // Seed Scott's sending identity as the primary SDR inbox if not already present
      seedScottSendingIdentity().catch(err => {
        console.error("[Seed] Failed to seed Scott sending identity:", err);
      });

      // Seed default sender profiles (sales / support / onboarding) into system_settings
      // so they are configurable via the admin UI without hardcoded fallbacks.
      import("./services/email-signatures").then(({ seedDefaultSignatures }) => {
        return seedDefaultSignatures();
      }).catch(err => {
        console.warn("[Seed] Sender profile seeding failed (non-critical):", err.message);
      });

      const { seedInboundMessageWorkflows } = await import("./services/seed-inbound-workflows");
      seedInboundMessageWorkflows().catch(err => {
        console.error("[Seed] Failed to seed inbound message workflows:", err);
      });

      // Seed statement acquisition cadence config if not already set.
      // Admins can tune these via the system_settings table without a redeploy.
      (async () => {
        const acqCfg = await storage.getSystemSetting("statement_acquisition_config");
        if (acqCfg === null) {
          await storage.setSystemSetting("statement_acquisition_config", {
            upload_nudge_sms_hours: 24,
            rep_task_hours: 48,
            educational_email_hours: 72,
            stall_escalation_days: 5,
          });
          log("[StatementAcquisition] Default cadence config seeded into system_settings");
        }
      })().catch(err => console.warn("[StatementAcquisition] Non-critical seeding error:", err.message));

      startDailyMaintenanceScheduler();

      // Task #179 — Content Engine: scheduled blog publish + LinkedIn drafts
      // Only start when pause state is known — LinkedIn auto-publish is an
      // external outbound action and must not run when workers are blocked.
      if (pauseInitialized) {
        startContentScheduler();
      } else {
        console.warn("[ContentScheduler] NOT started — pause state unknown; LinkedIn auto-publish blocked until restart with control table available");
      }
      seedContentEngine().catch(err => {
        console.error("[Seed] Content Engine seeding failed:", err);
      });
    },
  );
})();
