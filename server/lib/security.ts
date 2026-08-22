import cors, { type CorsOptions } from "cors";
import helmet, { type HelmetOptions } from "helmet";

export type SecurityEnvironment = "production" | "development";

/**
 * These are the script origins justified by the current client and SSR
 * execution paths. The GHL wildcards stay until a report-only browser check
 * proves the widget's runtime subresources can be narrowed safely.
 */
export const PRODUCTION_SCRIPT_SOURCES = [
  "'self'",
  "*.leadconnectorhq.com",
  "*.ghl.io",
  "www.googletagmanager.com",
  "connect.facebook.net",
] as const;

const DEVELOPMENT_HMR_EXCEPTION = "'unsafe-inline'";

export class DeniedCorsOriginError extends Error {
  readonly code = "CORS_ORIGIN_DENIED";
  readonly statusCode = 403;

  constructor() {
    super("CORS origin denied");
    this.name = "DeniedCorsOriginError";
  }
}

export function getScriptSources(environment: SecurityEnvironment): string[] {
  return environment === "development"
    ? [...PRODUCTION_SCRIPT_SOURCES, DEVELOPMENT_HMR_EXCEPTION]
    : [...PRODUCTION_SCRIPT_SOURCES];
}

export function getHelmetOptions(environment: SecurityEnvironment): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: getScriptSources(environment),
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
          "*.msgsndr.com",
          "services.msgsndr.com",
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
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  };
}

export function isDevelopmentCorsOriginAllowed(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
      return true;
    }
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname.endsWith(".replit.dev") || parsed.hostname.endsWith(".repl.co"))
    );
  } catch {
    return false;
  }
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  environment: SecurityEnvironment,
): boolean {
  if (!origin) return true;
  if (environment === "development" && isDevelopmentCorsOriginAllowed(origin)) return true;
  return allowedOrigins.includes(origin);
}

export function getCorsOptions(
  allowedOrigins: readonly string[],
  environment: SecurityEnvironment,
): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (isCorsOriginAllowed(origin, allowedOrigins, environment)) {
        return callback(null, true);
      }
      return callback(new DeniedCorsOriginError());
    },
    credentials: true,
  };
}

export function createSecurityMiddleware(
  allowedOrigins: readonly string[],
  environment: SecurityEnvironment,
) {
  return {
    helmet: helmet(getHelmetOptions(environment)),
    cors: cors(getCorsOptions(allowedOrigins, environment)),
  };
}

export function isDeniedCorsOriginError(error: unknown): error is DeniedCorsOriginError {
  return error instanceof DeniedCorsOriginError || (error as { code?: unknown } | null)?.code === "CORS_ORIGIN_DENIED";
}
